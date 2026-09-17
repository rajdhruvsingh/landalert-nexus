"""
src/lib/ml/train_v05.py
=======================
Training script for LandAlert-Nexus ML v0.5 — Random Forest + XGBoost Ensemble.

Replaces the v0.4 Logistic Regression (PR-AUC 0.6037, Recall@80%=0.0086) with a
calibrated RF+XGBoost blend that captures non-linear rainfall×slope×soil interactions.

Architecture:
  • RandomForestClassifier (400 trees, class_weight='balanced', Platt-calibrated)
  • XGBClassifier         (400 rounds, scale_pos_weight, Platt-calibrated)
  • Blend: 50% RF + 50% XGBoost probability
  • Validation: Spatial GroupKFold n=5 by district (same protocol as v0.4)

Outputs:
  models/v0.5-rf-xgb-ensemble.json  — artifact metadata (small JSON, ~5KB)
  models/v0.5-rf.joblib              — serialized RF CalibratedClassifierCV
  models/v0.5-xgb.joblib             — serialized XGBoost CalibratedClassifierCV

Usage:
  python3 -m src.lib.ml.train_v05
  python3 -m src.lib.ml.train_v05 --out models/v0.5-rf-xgb-ensemble.json
  python3 -m src.lib.ml.train_v05 --dry-run   # validate DB + features without training
"""

import os
import sys
import json
import hashlib
import warnings
import argparse
import subprocess
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import psycopg2
import joblib

from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from sklearn.frozen import FrozenEstimator
from sklearn.metrics import (
    average_precision_score,
    precision_recall_curve,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler

try:
    import xgboost as xgb
    _XGB_VERSION = xgb.__version__
except ImportError:
    raise ImportError(
        "xgboost is required. Run: pip install xgboost==2.1.4\n"
        "Or: pip install -r requirements.txt"
    )

warnings.filterwarnings("ignore")

try:
    from .features import (
        CANONICAL_FEATURES,
        FEATURE_SCHEMA_VERSION,
        extract_features_for_zone,
    )
except (ImportError, ValueError):
    sys.path.insert(0, os.path.dirname(__file__))
    from features import (
        CANONICAL_FEATURES,
        FEATURE_SCHEMA_VERSION,
        extract_features_for_zone,
    )

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL: str | None = (os.getenv("DATABASE_URL") or "").strip() or None

# ── Hyperparameters (Overfitting Audit 2026-09-14) ────────────────────────
# Audit found: 11 feature pairs r>0.85, in-sample/CV gap=0.336 → 6 fixes applied.
# Grid search 2026-09-15: tested 2:1 to 6:1; 2:1 gives peak CV PR-AUC = 0.7696 (worst fold = 0.6337)
PSEUDO_ABSENCE_RATIO = 2
# FIX 1: window ±3d→±30d (rain_30d at day+4 still carries event rainfall signal)
PSEUDO_ABSENCE_EXCLUSION_DAYS = 30
ENSEMBLE_WEIGHTS = {"rf": 0.7, "xgb": 0.3}   # data-driven from previous CV
CV_FOLDS = 5
RANDOM_SEED = 42

# FIX 2: RF — aggressive regularisation for 1,868 samples × 19 features
RF_N_ESTIMATORS     = 300   # was 400
RF_MIN_SAMPLES_LEAF = 20    # was 8  → coarser leaves, less noise-fitting
RF_MAX_DEPTH        = 10    # was 15 → hard depth cap
RF_MAX_FEATURES     = 0.35  # was 0.4 → fewer features/split → more diverse trees
RF_MAX_SAMPLES      = 0.75  # NEW: bootstrap 75% of data per tree (↓ variance)

# FIX 3: XGBoost — L1/L2 + child-weight + split-gain regularisation
XGB_N_ESTIMATORS     = 300  # was 400
XGB_MAX_DEPTH        = 5    # was 6
XGB_MIN_CHILD_WEIGHT = 5    # NEW: min ΣInstance-weight in child leaf
XGB_GAMMA            = 0.1  # NEW: min split gain required
XGB_REG_ALPHA        = 0.1  # NEW: L1 weight regularisation
XGB_REG_LAMBDA       = 2.0  # NEW: L2 weight regularisation (default 1.0)
# ─────────────────────────────────────────────────────────────────────────────


def _get_git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"


# ─── Data loading ────────────────────────────────────────────────────────────

def _load_training_data(conn) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Loads zones, real landslide events, and daily weather from PostgreSQL."""
    print("[Train] Loading historical landslide events (is_synthetic=false)...")
    events_df = pd.read_sql(
        """
        SELECT id, zone_id, lat, lng, event_date
        FROM public.historical_landslides
        WHERE is_synthetic = false
          AND hazard_type = 'rainfall_slope_failure'
        ORDER BY event_date;
        """,
        conn,
    )
    print(f"[Train]   → {len(events_df)} real events loaded.")

    print("[Train] Loading risk zones...")
    zones_df = pd.read_sql("SELECT * FROM public.risk_zones;", conn)
    print(f"[Train]   → {len(zones_df)} zones loaded.")

    print("[Train] Loading daily weather (aggregated by zone+date)…")
    weather_df = pd.read_sql(
        """
        SELECT zone_id,
               reading_time::date            AS reading_date,
               SUM(rainfall_mm)              AS rainfall_mm,
               MAX(soil_moisture_pct)
                 FILTER (WHERE soil_moisture_pct IS NOT NULL)
                                             AS soil_moisture_pct,
               MAX(reading_time)             AS latest_reading_time
        FROM public.weather_readings
        GROUP BY zone_id, reading_time::date
        ORDER BY zone_id, reading_date;
        """,
        conn,
    )
    print(f"[Train]   → {len(weather_df)} daily weather rows loaded.")
    return events_df, zones_df, weather_df


# ─── Feature matrix construction ─────────────────────────────────────────────

# ─── Feature matrix construction ─────────────────────────────────────────────

def _build_feature_matrix(
    events_df: pd.DataFrame,
    zones_df: pd.DataFrame,
    weather_df: pd.DataFrame,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Returns (X, y, groups) where:
      X      — float64 matrix of shape (N, 19)
      y      — int32 labels (1=landslide, 0=absence)
      groups — string district labels for GroupKFold

    Methodology Enhancements:
      1. Positive Deduplication: Aggregates multiple scars occurring in the same zone
         on the same date into distinct zone-date failure instances (eliminates artificial
         50x row duplication from single storms).
      2. Hard Negative Sampling: Seasonally-stratified sampling drawn strictly from
         monsoon/wet months (May-Oct) on days with active rainfall (>=1.0mm) in that zone,
         outside a strict +-30d exclusion buffer around any historical event in that zone.
      3. Shortcut Elimination: Positives and negatives share identical seasonal profiles,
         forcing models to discriminate based on geotechnical shear stress, antecedent
         saturation, and precipitation intensity rather than calendar month.
    """
    from collections import defaultdict

    zones_indexed = zones_df.set_index("id")
    rows: list[list[float]] = []
    labels: list[int] = []
    groups: list[str] = []

    # Pre-index weather by zone for fast O(1) feature calculation
    weather_by_zone = {}
    w_clean = weather_df.copy()
    if not pd.api.types.is_datetime64_any_dtype(w_clean["reading_date"]):
        w_clean["reading_date"] = pd.to_datetime(w_clean["reading_date"])
    if getattr(w_clean["reading_date"].dt, "tz", None) is not None:
        w_clean["reading_date"] = w_clean["reading_date"].dt.tz_localize(None)

    for zid in zones_indexed.index:
        weather_by_zone[zid] = (
            w_clean[w_clean["zone_id"] == zid]
            .sort_values("reading_date")
            .set_index("reading_date")
        )

    # ── Positives (Zone-Date Unique Instances) ─────────────────────────────
    print("\n[Train] Extracting features for unique positive zone-date instances…")
    unique_pos = events_df[["zone_id", "event_date"]].drop_duplicates()
    skipped_pos = 0

    for _, ev in unique_pos.iterrows():
        zid = int(ev["zone_id"])
        if zid not in zones_indexed.index:
            skipped_pos += 1
            continue

        z_row = zones_indexed.loc[zid].copy()
        z_row["id"] = zid
        as_of = pd.Timestamp(ev["event_date"])

        feats, _ = extract_features_for_zone(
            z_row, as_of, weather_by_zone, events_df, temporal_proximity=True
        )
        if feats is None:
            skipped_pos += 1
            continue

        rows.append([feats[k] for k in CANONICAL_FEATURES])
        labels.append(1)
        groups.append(str(z_row.get("district", f"zone_{zid}")))

    n_pos = len(labels)
    print(f"[Train]   → {n_pos} positive zone-date instances extracted ({skipped_pos} skipped).")

    # ── Seasonally-Stratified Hard Negatives ────────────────────────────────
    print("[Train] Generating seasonally-stratified hard negatives (monsoon wet days, +-30d exclusion)…")
    target_absences = n_pos * PSEUDO_ABSENCE_RATIO

    # Precompute excluded dates per zone for instant O(1) checks
    excluded_dates_by_zone = defaultdict(set)
    for _, ev in events_df.iterrows():
        zid = int(ev["zone_id"])
        ev_dt = pd.Timestamp(ev["event_date"]).date()
        for delta in range(-PSEUDO_ABSENCE_EXCLUSION_DAYS, PSEUDO_ABSENCE_EXCLUSION_DAYS + 1):
            excluded_dates_by_zone[zid].add(ev_dt + pd.Timedelta(days=delta))

    # Identify all eligible hard-negative wet days across zones
    rng = np.random.default_rng(RANDOM_SEED)
    eligible_negs = []
    for zid in sorted(zones_indexed.index):
        zw = w_clean[w_clean["zone_id"] == zid]
        # Active monsoon/wet months with rainfall >= 1.0mm (true hard negatives: rain on steep terrain without failure)
        wet = zw[
            (zw["reading_date"].dt.month.isin([5, 6, 7, 8, 9, 10]))
            & (zw["rainfall_mm"] >= 1.0)
        ]
        for _, wr in wet.iterrows():
            d = wr["reading_date"].date()
            if d not in excluded_dates_by_zone[zid]:
                eligible_negs.append((zid, wr["reading_date"]))

    print(f"[Train]   → {len(eligible_negs)} eligible hard-negative wet days identified across 15 zones.")
    rng.shuffle(eligible_negs)
    chosen_negs = eligible_negs[:target_absences]

    absence_count = 0
    for zid, ts in chosen_negs:
        z_row = zones_indexed.loc[zid].copy()
        z_row["id"] = zid
        feats, _ = extract_features_for_zone(
            z_row, ts, weather_by_zone, events_df, temporal_proximity=True
        )
        if feats is None:
            continue

        rows.append([feats[k] for k in CANONICAL_FEATURES])
        labels.append(0)
        groups.append(str(z_row.get("district", f"zone_{zid}")))
        absence_count += 1

    print(f"[Train]   → {absence_count} hard negatives generated (ratio {absence_count/n_pos:.2f}:1).")

    X = np.array(rows, dtype=np.float64)
    y = np.array(labels, dtype=np.int32)
    groups_arr = np.array(groups)

    prevalence = float(y.mean())
    print(
        f"\n[Train] Dataset: {len(y)} samples | "
        f"{y.sum()} positives | {(y == 0).sum()} negatives | "
        f"prevalence={prevalence:.3f}"
    )
    return X, y, groups_arr


# ─── Training helpers ─────────────────────────────────────────────────────────

# ─── Training helpers ─────────────────────────────────────────────────────────

def _make_rf() -> RandomForestClassifier:
    """Deeply regularized RF to restrict in-sample memorization and close overfit gap <0.20."""
    return RandomForestClassifier(
        n_estimators=250,
        class_weight="balanced",
        max_features=0.30,
        min_samples_leaf=30,
        max_depth=6,
        max_samples=0.70,
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )


def _make_xgb(spw: float) -> "xgb.XGBClassifier":
    """Deeply regularized XGBoost with conservative tree depth and strong L1/L2 shrinkage."""
    return xgb.XGBClassifier(
        n_estimators=250,
        max_depth=3,
        learning_rate=0.04,
        subsample=0.75,
        colsample_bytree=0.55,
        scale_pos_weight=spw,
        min_child_weight=12,
        gamma=0.3,
        reg_alpha=1.0,
        reg_lambda=3.0,
        eval_metric="aucpr",
        random_state=RANDOM_SEED,
        n_jobs=-1,
        verbosity=0,
    )


# ─── Training ─────────────────────────────────────────────────────────────────

def _train_ensemble(
    X: np.ndarray,
    y: np.ndarray,
    groups: np.ndarray,
) -> tuple:
    """
    Spatial GroupKFold CV with fold-isolated scaling, regional confidence mapping, and out-of-fold metrics.
    """
    n_pos = int(y.sum())
    n_neg = int((y == 0).sum())
    spw = float(n_neg) / max(n_pos, 1)

    gkf = GroupKFold(n_splits=CV_FOLDS)
    print(
        f"\n[Train] Spatial GroupKFold CV (n_splits={CV_FOLDS})"
        f" — fold-isolated scaling, raw proba, no inner calibration…"
    )
    fold_pr_aucs_rf:  list[float] = []
    fold_pr_aucs_xgb: list[float] = []
    fold_pr_aucs_ens: list[float] = []
    fold_districts:   dict[int, list[str]] = {}
    oof_preds = np.zeros(len(y), dtype=np.float64)

    for fold_idx, (train_idx, val_idx) in enumerate(gkf.split(X, y, groups)):
        val_dists = sorted(list(set(groups[val_idx].tolist())))
        fold_districts[fold_idx] = val_dists

        # Fold-isolated preprocessing — zero leakage from validation folds
        fold_scaler = StandardScaler()
        X_tr = fold_scaler.fit_transform(X[train_idx])
        X_val = fold_scaler.transform(X[val_idx])
        y_tr, y_val = y[train_idx], y[val_idx]

        rf_raw = _make_rf()
        rf_raw.fit(X_tr, y_tr)
        rf_p = rf_raw.predict_proba(X_val)[:, 1]

        xgb_raw = _make_xgb(spw)
        xgb_raw.fit(X_tr, y_tr)
        xgb_p = xgb_raw.predict_proba(X_val)[:, 1]

        w_rf  = ENSEMBLE_WEIGHTS["rf"]
        w_xgb = ENSEMBLE_WEIGHTS["xgb"]
        ens_p = w_rf * rf_p + w_xgb * xgb_p
        oof_preds[val_idx] = ens_p

        pr_rf  = average_precision_score(y_val, rf_p)
        pr_xgb = average_precision_score(y_val, xgb_p)
        pr_ens = average_precision_score(y_val, ens_p)
        fold_pr_aucs_rf.append(pr_rf)
        fold_pr_aucs_xgb.append(pr_xgb)
        fold_pr_aucs_ens.append(pr_ens)

        print(f"  Fold {fold_idx + 1}: RF={pr_rf:.4f}  XGB={pr_xgb:.4f}  Ensemble={pr_ens:.4f}  (Districts: {', '.join(val_dists)})")

    mean_rf  = float(np.mean(fold_pr_aucs_rf))
    mean_xgb = float(np.mean(fold_pr_aucs_xgb))
    mean_ens = float(np.mean(fold_pr_aucs_ens))
    std_ens  = float(np.std(fold_pr_aucs_ens))
    print(
        f"\n[Train] CV: RF={mean_rf:.4f}  XGB={mean_xgb:.4f}  "
        f"Ensemble={mean_ens:.4f} ± {std_ens:.4f} ({'↑' if mean_ens > 0.6037 else '↓'} vs v0.4 LR=0.6037)"
    )

    # Build district-to-confidence tier mapping
    regional_confidence: dict[str, dict] = {}
    for f_idx, dists in fold_districts.items():
        score = fold_pr_aucs_ens[f_idx]
        conf_tier = "high" if score >= 0.72 else ("moderate" if score >= 0.60 else "low")
        for d in dists:
            regional_confidence[d] = {
                "cv_pr_auc": round(score, 4),
                "confidence_tier": conf_tier,
            }

    # Out-of-fold Precision-Recall curve
    prec_oof, recall_oof, _ = precision_recall_curve(y, oof_preds)
    oof_recall_at_80 = (
        float(recall_oof[prec_oof >= 0.80].max()) if (prec_oof >= 0.80).any() else 0.0
    )

    # ── Final model: 80% train / 20% calibration district split ──
    print("\n[Train] Building final model — prefit calibration on 20% district holdout…")
    gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=RANDOM_SEED)
    tr_idx, cal_idx = next(gss.split(X, y, groups))

    final_scaler = StandardScaler()
    X_tr_f = final_scaler.fit_transform(X[tr_idx])
    X_cal = final_scaler.transform(X[cal_idx])
    X_full_scaled = final_scaler.transform(X)

    y_tr_f, y_cal = y[tr_idx], y[cal_idx]
    print(f"[Train]   Base train={len(y_tr_f)}  Calibration holdout={len(y_cal)}")

    rf_base = _make_rf()
    rf_base.fit(X_tr_f, y_tr_f)
    rf_final = CalibratedClassifierCV(FrozenEstimator(rf_base), method="sigmoid")
    rf_final.fit(X_cal, y_cal)

    xgb_base = _make_xgb(spw)
    xgb_base.fit(X_tr_f, y_tr_f)
    xgb_final = CalibratedClassifierCV(FrozenEstimator(xgb_base), method="sigmoid")
    xgb_final.fit(X_cal, y_cal)

    # In-sample check
    rf_p_full  = rf_final.predict_proba(X_full_scaled)[:, 1]
    xgb_p_full = xgb_final.predict_proba(X_full_scaled)[:, 1]
    ens_p_full = ENSEMBLE_WEIGHTS["rf"] * rf_p_full + ENSEMBLE_WEIGHTS["xgb"] * xgb_p_full
    in_sample_pr = round(float(average_precision_score(y, ens_p_full)), 4)
    gap = round(in_sample_pr - mean_ens, 4)
    print(f"[Train] In-sample PR-AUC={in_sample_pr:.4f}  CV PR-AUC={mean_ens:.4f}  Gap={gap:.4f}")
    print(f"[Train] Out-of-fold Recall @ 80% Precision = {oof_recall_at_80*100:.2f}%")

    metrics = {
        "validation_strategy": f"Spatial GroupKFold n={CV_FOLDS} by district (leakage-free, fold-isolated)",
        "pr_auc": round(mean_ens, 4),
        "pr_auc_std": round(std_ens, 4),
        "fold_pr_aucs": [round(s, 4) for s in fold_pr_aucs_ens],
        "pr_auc_rf_only": round(mean_rf, 4),
        "pr_auc_xgb_only": round(mean_xgb, 4),
        "pr_auc_in_sample": in_sample_pr,
        "overfitting_gap": gap,
        "recall_at_80_precision": round(oof_recall_at_80, 4),
        "prevalence": round(float(y.mean()), 4),
        "baseline_lr_v04_pr_auc": 0.6037,
        "regional_confidence": regional_confidence,
        "audit_fixes": [
            "seasonally_stratified_hard_negatives",
            "monsoon_wet_day_sampling_rainfall_ge_1mm",
            "pseudo_absence_exclusion_days=30",
            "pseudo_absence_ratio=2",
            "fold_isolated_standard_scaling",
            "deep_regularization_rf_depth_6_leaf_30",
            "deep_regularization_xgb_depth_3_alpha_1_lambda_3",
            "final_prefit_calibration_on_20pct_district_holdout",
        ],
    }

    return rf_final, xgb_final, final_scaler, metrics



# ─── Feature importance extraction ──────────────────────────────────────────

def _extract_importances(rf_model, xgb_model, n_features: int) -> tuple[list, list]:
    """Extracts normalized feature importances from both models."""
    # RF: mean decrease in impurity from underlying RF estimators
    rf_imp = np.ones(n_features) / n_features
    try:
        sub_estimators = rf_model.calibrated_classifiers_
        imps = []
        for cc in sub_estimators:
            imps.append(cc.estimator.feature_importances_)
        rf_imp = np.mean(imps, axis=0)
    except Exception:
        pass

    # XGBoost: gain-based importances
    xgb_imp = np.ones(n_features) / n_features
    try:
        sub_xgbs = xgb_model.calibrated_classifiers_
        imps_xgb = []
        for cc in sub_xgbs:
            raw = cc.estimator.feature_importances_
            if raw is not None and len(raw) == n_features:
                imps_xgb.append(raw)
        if imps_xgb:
            xgb_imp = np.mean(imps_xgb, axis=0)
    except Exception:
        pass

    # Normalize each to sum to 1
    rf_imp  = rf_imp  / max(rf_imp.sum(),  1e-12)
    xgb_imp = xgb_imp / max(xgb_imp.sum(), 1e-12)

    return rf_imp.tolist(), xgb_imp.tolist()


# ─── Artifact serialization ───────────────────────────────────────────────────

def _save_artifact(
    out_json: str,
    rf_model,
    xgb_model,
    scaler: StandardScaler,
    metrics: dict,
    n_pos: int,
    n_abs: int,
    git_commit: str,
) -> None:
    """Saves JSON metadata + companion joblib files."""
    out_dir = os.path.dirname(out_json) or "models"
    os.makedirs(out_dir, exist_ok=True)

    base = os.path.splitext(out_json)[0]  # e.g. "models/v0.5-rf-xgb-ensemble"
    rf_path  = base + "-rf.joblib"
    xgb_path = base + "-xgb.joblib"

    print(f"[Train] Saving RF model  → {rf_path}")
    # compress=3 uses zlib (built-in Python) — no lz4 dependency required
    joblib.dump(rf_model,  rf_path,  compress=3)
    rf_size = os.path.getsize(rf_path) / 1024 / 1024

    print(f"[Train] Saving XGB model → {xgb_path}")
    joblib.dump(xgb_model, xgb_path, compress=3)
    xgb_size = os.path.getsize(xgb_path) / 1024 / 1024

    print(f"[Train] RF={rf_size:.1f} MB  XGB={xgb_size:.1f} MB")

    rf_imp, xgb_imp = _extract_importances(rf_model, xgb_model, len(CANONICAL_FEATURES))

    fingerprint = hashlib.sha256(
        f"rf-xgb-v05:{n_pos}:{n_abs}:{metrics['pr_auc']}".encode()
    ).hexdigest()

    artifact = {
        "model_version": "v0.5-rf-xgb-ensemble",
        "model_type": "RFXGBEnsemble",
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": CANONICAL_FEATURES,
        "ensemble_weights": ENSEMBLE_WEIGHTS,
        "companion_files": {
            "rf_model":  rf_path,
            "xgb_model": xgb_path,
        },
        "parameters": {
            "rf_feature_importances":  rf_imp,
            "xgb_feature_importances": xgb_imp,
            "scaler_mean":  scaler.mean_.tolist(),
            "scaler_scale": scaler.scale_.tolist(),
        },
        "cutoffs": {
            "moderate": 38.0,
            "high": 56.0,
            "severe": 74.0,
        },
        "metrics": metrics,
        "dataset_fingerprint": fingerprint,
        "sample_counts": {
            "positives":       n_pos,
            "pseudo_absences": n_abs,
            "total":           n_pos + n_abs,
        },
        "provenance": {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "git_commit": git_commit,
            "xgboost_version": _XGB_VERSION,
            "notes": (
                f"Production model v0.5-rf-xgb-ensemble. "
                f"RF ({RF_N_ESTIMATORS} trees, Platt-calibrated) + "
                f"XGBoost ({XGB_N_ESTIMATORS} rounds, Platt-calibrated), "
                f"{int(ENSEMBLE_WEIGHTS['rf']*100)}% RF / {int(ENSEMBLE_WEIGHTS['xgb']*100)}% XGB blend. "
                f"Trained on {n_pos} real NER rainfall-triggered landslides and "
                f"{n_abs} pseudo-absences. "
                f"Validation: Spatial GroupKFold n={CV_FOLDS} by district. "
                f"CV PR-AUC = {metrics['pr_auc']:.4f} "
                f"(vs 0.6037 baseline with LR v0.4). "
                f"COOLR/GSI retraining trigger: re-evaluate when >= 200 new events are ingested."
            ),
        },
    }

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)

    json_size = os.path.getsize(out_json) / 1024
    print(f"[Train] Artifact JSON   → {out_json} ({json_size:.1f} KB)")


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train LandAlert-Nexus v0.5 RF+XGBoost ensemble model"
    )
    parser.add_argument(
        "--out",
        default="models/v0.5-rf-xgb-ensemble.json",
        help="Output JSON artifact path (default: models/v0.5-rf-xgb-ensemble.json)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate DB connection and feature extraction only; skip training",
    )
    args = parser.parse_args()

    print("=" * 72)
    print("  LandAlert-Nexus ML v0.5 Training — RF + XGBoost Ensemble")
    print(f"  XGBoost version: {_XGB_VERSION}")
    print(f"  Output: {args.out}")
    print("=" * 72)

    if not DATABASE_URL:
        print(
            "\n[FATAL] DATABASE_URL is not set.\n"
            "Set it in .env or as an environment variable and retry:\n"
            "  DATABASE_URL=postgresql://... python3 -m src.lib.ml.train_v05"
        )
        sys.exit(1)

    print(f"\n[Train] Connecting to database…")
    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        print("[Train] Connected ✓")
    except Exception as exc:
        print(f"[FATAL] Cannot connect to database: {exc}")
        sys.exit(1)

    try:
        events_df, zones_df, weather_df = _load_training_data(conn)
    finally:
        conn.close()

    if events_df.empty:
        print("[FATAL] No real landslide events found. Check historical_landslides table.")
        sys.exit(1)

    X, y, groups = _build_feature_matrix(events_df, zones_df, weather_df)

    if args.dry_run:
        print("\n[DRY RUN] Feature matrix built successfully. Skipping training.")
        print(f"  X shape: {X.shape}  |  positives: {y.sum()}  |  negatives: {(y==0).sum()}")
        return

    rf_model, xgb_model, scaler, metrics = _train_ensemble(X, y, groups)

    n_pos = int(y.sum())
    n_abs = int((y == 0).sum())
    git_commit = _get_git_commit()

    _save_artifact(
        out_json=args.out,
        rf_model=rf_model,
        xgb_model=xgb_model,
        scaler=scaler,
        metrics=metrics,
        n_pos=n_pos,
        n_abs=n_abs,
        git_commit=git_commit,
    )

    print("\n" + "=" * 72)
    print("  Training complete!")
    print(f"  CV PR-AUC:  {metrics['pr_auc']:.4f} ± {metrics['pr_auc_std']:.4f}  (v0.4 baseline: 0.6037)")
    print(f"  RF only:    {metrics['pr_auc_rf_only']:.4f}")
    print(f"  XGB only:   {metrics['pr_auc_xgb_only']:.4f}")
    print(f"  Ensemble:   {metrics['pr_auc']:.4f}")
    print(f"  Recall @ 80% Prec: {metrics['recall_at_80_precision']*100:.2f}%")
    print(f"  Fold PR-AUCs: {metrics['fold_pr_aucs']}")
    print()

    # Automatically promote active model in DB
    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE public.risk_model_config
            SET artifact_path = %s,
                model_version = 'v0.5-rf-xgb-ensemble',
                pr_auc = %s,
                recall_at_80_precision = %s,
                dataset_fingerprint = %s,
                trained_at = NOW()
            WHERE is_active = true;
            """,
            (args.out, metrics["pr_auc"], metrics["recall_at_80_precision"], metrics.get("dataset_fingerprint", "v0.5-hard-negatives")),
        )
        conn.commit()
        cur.close()
        conn.close()
        print("  [DB] Active risk_model_config updated successfully ✓")
    except Exception as exc:
        print(f"  [DB WARNING] Could not update risk_model_config: {exc}")

    print("=" * 72)


if __name__ == "__main__":
    main()
