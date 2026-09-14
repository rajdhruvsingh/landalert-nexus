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
from sklearn.model_selection import GroupKFold
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

# ─── Hyperparameters ────────────────────────────────────────────────────────
PSEUDO_ABSENCE_RATIO = 3       # negatives per positive event
# RF clearly outperformed XGBoost in CV (0.6443 vs 0.6053), so weight it more heavily.
ENSEMBLE_WEIGHTS = {"rf": 0.7, "xgb": 0.3}
CV_FOLDS = 5
RF_N_ESTIMATORS = 400
XGB_N_ESTIMATORS = 400
RANDOM_SEED = 42
# ────────────────────────────────────────────────────────────────────────────


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
    """
    zones_indexed = zones_df.set_index("id")
    rows: list[list[float]] = []
    labels: list[int] = []
    groups: list[str] = []

    # ── Positives ──────────────────────────────────────────────────────────
    print("\n[Train] Extracting features for positive events…")
    skipped_pos = 0
    for _, ev in events_df.iterrows():
        zid = int(ev["zone_id"])
        if zid not in zones_indexed.index:
            skipped_pos += 1
            continue
        # Reconstruct a Series that includes 'id' as a named field so that
        # extract_features_for_zone (which calls zone_row["id"]) works correctly.
        z_row = zones_indexed.loc[zid].copy()
        z_row["id"] = zid
        as_of = pd.Timestamp(ev["event_date"])

        feats, _ = extract_features_for_zone(
            z_row, as_of, weather_df, events_df, temporal_proximity=True
        )
        if feats is None:
            skipped_pos += 1
            continue

        rows.append([feats[k] for k in CANONICAL_FEATURES])
        labels.append(1)
        groups.append(str(z_row.get("district", f"zone_{zid}")))


    n_pos = len(labels)
    print(f"[Train]   → {n_pos} positives extracted  ({skipped_pos} skipped — insufficient history).")

    # ── Pseudo-absences ────────────────────────────────────────────────────
    print("[Train] Generating pseudo-absences…")
    target_absences = n_pos * PSEUDO_ABSENCE_RATIO

    # Build a fast lookup: {(zone_id, date) → True}
    pos_lookup: set[tuple[int, object]] = set(
        (int(ev["zone_id"]), pd.Timestamp(ev["event_date"]).date())
        for _, ev in events_df.iterrows()
    )

    weather_df["reading_date"] = pd.to_datetime(weather_df["reading_date"])
    min_date = weather_df["reading_date"].min() + pd.Timedelta(days=35)
    max_date = weather_df["reading_date"].max()
    all_dates = pd.date_range(min_date, max_date, freq="D")
    zone_ids = list(zones_indexed.index)

    rng = np.random.default_rng(RANDOM_SEED)
    absence_count = 0
    max_attempts = target_absences * 25

    for _ in range(max_attempts):
        if absence_count >= target_absences:
            break

        zid = int(rng.choice(zone_ids))
        rand_ts = pd.Timestamp(all_dates[int(rng.integers(0, len(all_dates)))])

        # Exclude dates within ±3 days of any real event in this zone
        near_event = any(
            abs((rand_ts.date() - d).days) <= 3
            for (z, d) in pos_lookup
            if z == zid
        )
        if near_event:
            continue

        if zid not in zones_indexed.index:
            continue

        z_row = zones_indexed.loc[zid].copy()
        z_row["id"] = zid
        feats, _ = extract_features_for_zone(
            z_row, rand_ts, weather_df, events_df, temporal_proximity=True
        )
        if feats is None:
            continue

        rows.append([feats[k] for k in CANONICAL_FEATURES])
        labels.append(0)
        groups.append(str(z_row.get("district", f"zone_{zid}")))
        absence_count += 1

    print(f"[Train]   → {absence_count} pseudo-absences generated.")

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


# ─── Training ─────────────────────────────────────────────────────────────────

def _train_ensemble(
    X: np.ndarray,
    y: np.ndarray,
    groups: np.ndarray,
) -> tuple:
    """
    Trains RF (calibrated) + XGBoost (calibrated) with Spatial GroupKFold CV.
    Returns (rf_final, xgb_final, scaler, metrics).
    """
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    n_pos = int(y.sum())
    n_neg = int((y == 0).sum())
    spw = float(n_neg) / max(n_pos, 1)   # XGBoost scale_pos_weight

    gkf = GroupKFold(n_splits=CV_FOLDS)

    print(f"\n[Train] Spatial GroupKFold CV (n_splits={CV_FOLDS})…")
    fold_pr_aucs_rf:  list[float] = []
    fold_pr_aucs_xgb: list[float] = []
    fold_pr_aucs_ens: list[float] = []

    for fold_idx, (train_idx, val_idx) in enumerate(gkf.split(X_scaled, y, groups)):
        X_tr, X_val = X_scaled[train_idx], X_scaled[val_idx]
        y_tr, y_val = y[train_idx], y[val_idx]

        # ── RandomForest (Platt-calibrated) ───────────────────────────────
        rf_cv = CalibratedClassifierCV(
            RandomForestClassifier(
                n_estimators=RF_N_ESTIMATORS,
                class_weight="balanced",
                max_features="sqrt",
                min_samples_leaf=3,
                random_state=RANDOM_SEED,
                n_jobs=-1,
            ),
            method="sigmoid",
            cv=3,
        )
        rf_cv.fit(X_tr, y_tr)
        rf_p = rf_cv.predict_proba(X_val)[:, 1]

        # ── XGBoost (Platt-calibrated) ────────────────────────────────────
        xgb_base = xgb.XGBClassifier(
            n_estimators=XGB_N_ESTIMATORS,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            scale_pos_weight=spw,
            eval_metric="aucpr",
            random_state=RANDOM_SEED,
            n_jobs=-1,
            verbosity=0,
        )
        xgb_cv = CalibratedClassifierCV(xgb_base, method="sigmoid", cv=3)
        xgb_cv.fit(X_tr, y_tr)
        xgb_p = xgb_cv.predict_proba(X_val)[:, 1]

        # ── Blend ─────────────────────────────────────────────────────────
        w_rf  = ENSEMBLE_WEIGHTS["rf"]
        w_xgb = ENSEMBLE_WEIGHTS["xgb"]
        ens_p = w_rf * rf_p + w_xgb * xgb_p

        pr_rf  = average_precision_score(y_val, rf_p)
        pr_xgb = average_precision_score(y_val, xgb_p)
        pr_ens = average_precision_score(y_val, ens_p)

        fold_pr_aucs_rf.append(pr_rf)
        fold_pr_aucs_xgb.append(pr_xgb)
        fold_pr_aucs_ens.append(pr_ens)

        print(
            f"  Fold {fold_idx + 1}: "
            f"RF PR-AUC={pr_rf:.4f}  XGB PR-AUC={pr_xgb:.4f}  "
            f"Ensemble PR-AUC={pr_ens:.4f}"
        )

    mean_rf  = float(np.mean(fold_pr_aucs_rf))
    mean_xgb = float(np.mean(fold_pr_aucs_xgb))
    mean_ens = float(np.mean(fold_pr_aucs_ens))

    print(
        f"\n[Train] CV Summary:\n"
        f"  RF only   : PR-AUC = {mean_rf:.4f}\n"
        f"  XGBoost   : PR-AUC = {mean_xgb:.4f}\n"
        f"  Ensemble  : PR-AUC = {mean_ens:.4f}  "
        f"({'↑' if mean_ens > 0.6037 else '↓'} vs v0.4 LR = 0.6037)"
    )

    # ── Final models on full training set ─────────────────────────────────
    print("\n[Train] Training final models on full dataset…")
    rf_final = CalibratedClassifierCV(
        RandomForestClassifier(
            n_estimators=RF_N_ESTIMATORS,
            class_weight="balanced",
            max_features="sqrt",
            min_samples_leaf=3,
            random_state=RANDOM_SEED,
            n_jobs=-1,
        ),
        method="sigmoid",
        cv=3,
    )
    rf_final.fit(X_scaled, y)

    xgb_final = CalibratedClassifierCV(
        xgb.XGBClassifier(
            n_estimators=XGB_N_ESTIMATORS,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            scale_pos_weight=spw,
            eval_metric="aucpr",
            random_state=RANDOM_SEED,
            n_jobs=-1,
            verbosity=0,
        ),
        method="sigmoid",
        cv=3,
    )
    xgb_final.fit(X_scaled, y)

    # In-sample Recall@80% for reporting (not a hold-out estimate)
    rf_p_full  = rf_final.predict_proba(X_scaled)[:, 1]
    xgb_p_full = xgb_final.predict_proba(X_scaled)[:, 1]
    ens_p_full = (
        ENSEMBLE_WEIGHTS["rf"] * rf_p_full + ENSEMBLE_WEIGHTS["xgb"] * xgb_p_full
    )
    prec_arr, recall_arr, _ = precision_recall_curve(y, ens_p_full)
    recall_at_80 = (
        float(recall_arr[prec_arr >= 0.80].max())
        if (prec_arr >= 0.80).any()
        else 0.0
    )
    print(f"[Train] Recall@80% Precision (in-sample, indicative): {recall_at_80:.4f}")

    metrics = {
        "validation_strategy": f"Spatial GroupKFold n={CV_FOLDS} by district",
        "pr_auc": round(mean_ens, 4),
        "pr_auc_rf_only": round(mean_rf, 4),
        "pr_auc_xgb_only": round(mean_xgb, 4),
        "recall_at_80_precision": round(recall_at_80, 4),
        "prevalence": round(float(y.mean()), 4),
        "baseline_lr_v04_pr_auc": 0.6037,
    }

    return rf_final, xgb_final, scaler, metrics


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
    print(f"  CV PR-AUC:  {metrics['pr_auc']:.4f}  (v0.4 baseline: 0.6037)")
    print(f"  RF only:    {metrics['pr_auc_rf_only']:.4f}")
    print(f"  XGB only:   {metrics['pr_auc_xgb_only']:.4f}")
    print(f"  Ensemble:   {metrics['pr_auc']:.4f}")
    print()
    print("  Next steps:")
    print("  1. Verify inference:  python3 -m src.lib.ml.inference --zone 1")
    print("  2. Run tests:         npx vitest run")
    print("  3. Promote in DB:     UPDATE risk_model_config")
    print(f"       SET artifact_path='{args.out}', model_version='v0.5-rf-xgb-ensemble'")
    print("       WHERE is_active=true;")
    print("=" * 72)


if __name__ == "__main__":
    main()
