#!/usr/bin/env python3
"""
scripts/audit_empirical_validation.py
======================================
Rigorous empirical audit answering the 4 core modeling questions:
1. Exact audit of positive events: 4,203 vs 2,695 breakdown.
2. Leakage-free frozen-threshold out-of-fold Recall @ 80% precision.
3. Per-terrane precision and recall at recommended operating thresholds
   (Moderate / High / Severe) for P_ML, P_phys, and P_consensus.
4. Independent validation of P_phys standalone discrimination.
"""

import os, sys, math, json
sys.path.insert(0, os.path.abspath("."))
import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_recall_curve, average_precision_score, roc_auc_score

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL required")

from src.lib.ml.features import (
    CANONICAL_FEATURES,
    extract_features_for_zone,
)
from src.lib.ml.train_v05 import (
    TERRANE_MAP,
    TERRANE_NAMES,
    _make_rf,
    _make_xgb,
    ENSEMBLE_WEIGHTS,
    _build_feature_matrix,
    _load_training_data,
)
from src.lib.ml.inference import REGIONAL_TERRANE_CUTOFFS

def run_empirical_audit():
    print("=" * 78)
    print("EMPIRICAL AI/ML AUDIT: HARD METRICS & ZERO-PEEKING VALIDATION")
    print("=" * 78)

    conn = psycopg2.connect(DATABASE_URL)
    events_df, zones_df, weather_df = _load_training_data(conn)
    conn.close()

    # -------------------------------------------------------------
    # 1. POSITIVE COUNT BREAKDOWN: 4,203 -> 2,695
    # -------------------------------------------------------------
    print("\n--- 1. POSITIVE DATASET BREAKDOWN ---")
    raw_pos_unique = events_df[["zone_id", "event_date"]].drop_duplicates()
    print(f"Total raw positive zone-date combinations: {len(raw_pos_unique)}")

    # Let's inspect what happens to all zone-date combinations
    zones_indexed = zones_df.set_index("id")
    w_clean = weather_df.copy()
    w_clean["reading_date"] = pd.to_datetime(w_clean["reading_date"])
    weather_by_zone = {
        zid: w_clean[w_clean["zone_id"] == zid].sort_values("reading_date").set_index("reading_date")
        for zid in zones_indexed.index
    }

    n_missing_zone = 0
    n_no_weather = 0
    n_zero_rain = 0
    n_retained = 0

    for _, ev in raw_pos_unique.iterrows():
        zid = int(ev["zone_id"])
        if zid not in zones_indexed.index:
            n_missing_zone += 1
            continue
        z_row = zones_indexed.loc[zid].copy()
        z_row["id"] = zid
        as_of = pd.Timestamp(ev["event_date"])
        feats, _ = extract_features_for_zone(z_row, as_of, weather_by_zone, events_df, temporal_proximity=True)
        if feats is None:
            n_no_weather += 1
            continue
        if feats.get("rain_30d", 0.0) < 5.0 or feats.get("rain_7d", 0.0) < 1.0:
            n_zero_rain += 1
            continue
        n_retained += 1

    print(f"Retained (Meteorologically Plausible): {n_retained}")
    print(f"Excluded due to zero/sub-threshold antecedent rain (rain_30d < 5mm or rain_7d < 1mm): {n_zero_rain}")
    print(f"Excluded due to missing weather records prior to date: {n_no_weather}")
    print(f"Excluded due to missing zone ID: {n_missing_zone}")
    print(f"Sum check: {n_retained + n_zero_rain + n_no_weather + n_missing_zone} == {len(raw_pos_unique)}")

    # Build the canonical dataset matrix
    X, y, groups = _build_feature_matrix(events_df, zones_df, weather_df)
    terrane_arr = np.array([TERRANE_MAP.get(g, 4) for g in groups], dtype=int)

    # Calculate P_phys for every sample in the dataset
    # Look up features for P_phys: rain_3d_vs_e_thr, rain_7d, threshold_exceedance_flag
    rain_3d_vs_e_thr_idx = CANONICAL_FEATURES.index("rain_3d_vs_e_thr")
    rain_7d_idx = CANONICAL_FEATURES.index("rain_7d")
    thresh_flag_idx = CANONICAL_FEATURES.index("threshold_exceedance_flag")

    p_phys_arr = np.zeros(len(y), dtype=np.float64)
    for i in range(len(y)):
        g = groups[i]
        is_fold_belt = REGIONAL_TERRANE_CUTOFFS.is_fold_belt(g)
        r3d_ratio = float(X[i, rain_3d_vs_e_thr_idx])
        r7d = float(X[i, rain_7d_idx])
        r7d_ratio = (r7d / 80.0) if is_fold_belt else (r7d / 120.0)
        fold_3d_ratio = (r3d_ratio / 0.85) if is_fold_belt else r3d_ratio
        thresh_flag = float(X[i, thresh_flag_idx])
        xi = max(r3d_ratio, r7d_ratio, fold_3d_ratio, thresh_flag)
        # P_phys sigmoid
        p_phys_arr[i] = 1.0 / (1.0 + math.exp(-8.0 * (xi - 1.0)))

    # -------------------------------------------------------------
    # 2. FROZEN THRESHOLD OUT-OF-FOLD EVALUATION (ZERO PEEKING)
    # -------------------------------------------------------------
    print("\n--- 2. LEAKAGE-FREE FROZEN-THRESHOLD OUT-OF-FOLD EVALUATION ---")
    n_pos = int(y.sum())
    n_neg = int((y == 0).sum())
    spw = float(n_neg) / max(n_pos, 1)

    oof_preds_ml = np.zeros(len(y), dtype=np.float64)
    oof_preds_consensus = np.zeros(len(y), dtype=np.float64)

    # Record out-of-fold decisions with thresholds frozen on training terranes
    frozen_decision_80_ml = np.zeros(len(y), dtype=bool)
    frozen_decision_60_ml = np.zeros(len(y), dtype=bool)
    frozen_decision_50_ml = np.zeros(len(y), dtype=bool)

    fold_metrics = []

    for fold_idx in range(5):
        train_idx = np.where(terrane_arr != fold_idx)[0]
        val_idx = np.where(terrane_arr == fold_idx)[0]

        scaler = StandardScaler()
        X_tr = scaler.fit_transform(X[train_idx])
        X_val = scaler.transform(X[val_idx])
        y_tr, y_val = y[train_idx], y[val_idx]

        rf = _make_rf()
        rf.fit(X_tr, y_tr)
        rf_tr_p = rf.predict_proba(X_tr)[:, 1]
        rf_val_p = rf.predict_proba(X_val)[:, 1]

        xgb = _make_xgb(spw)
        xgb.fit(X_tr, y_tr)
        xgb_tr_p = xgb.predict_proba(X_tr)[:, 1]
        xgb_val_p = xgb.predict_proba(X_val)[:, 1]

        w_rf = ENSEMBLE_WEIGHTS["rf"]
        w_xgb = ENSEMBLE_WEIGHTS["xgb"]
        ens_tr_p = w_rf * rf_tr_p + w_xgb * xgb_tr_p
        ens_val_p = w_rf * rf_val_p + w_xgb * xgb_val_p

        oof_preds_ml[val_idx] = ens_val_p
        oof_preds_consensus[val_idx] = 1.0 - (1.0 - ens_val_p) * (1.0 - p_phys_arr[val_idx])

        # Freeze threshold strictly on training terranes (train_idx)
        prec_tr, rec_tr, thr_tr = precision_recall_curve(y_tr, ens_tr_p)
        
        # Function to find frozen threshold for target precision on training folds
        def get_frozen_thresh(target_prec):
            valid = np.where(prec_tr >= target_prec)[0]
            if len(valid) == 0 or valid[0] >= len(thr_tr):
                return thr_tr[-1] if len(thr_tr) > 0 else 0.99
            return thr_tr[valid[0]]

        t_80 = get_frozen_thresh(0.80)
        t_60 = get_frozen_thresh(0.60)
        t_50 = get_frozen_thresh(0.50)

        # Apply strictly to validation fold without peeking
        frozen_decision_80_ml[val_idx] = ens_val_p >= t_80
        frozen_decision_60_ml[val_idx] = ens_val_p >= t_60
        frozen_decision_50_ml[val_idx] = ens_val_p >= t_50

        # Out-of-fold performance on val_idx
        pr_auc_val_ml = average_precision_score(y_val, ens_val_p)
        pr_auc_val_phys = average_precision_score(y_val, p_phys_arr[val_idx])
        pr_auc_val_cons = average_precision_score(y_val, oof_preds_consensus[val_idx])

        prec_80_val = y_val[frozen_decision_80_ml[val_idx]].mean() if frozen_decision_80_ml[val_idx].sum() > 0 else 0.0
        rec_80_val = y_val[frozen_decision_80_ml[val_idx]].sum() / y_val.sum()

        prec_60_val = y_val[frozen_decision_60_ml[val_idx]].mean() if frozen_decision_60_ml[val_idx].sum() > 0 else 0.0
        rec_60_val = y_val[frozen_decision_60_ml[val_idx]].sum() / y_val.sum()

        prec_50_val = y_val[frozen_decision_50_ml[val_idx]].mean() if frozen_decision_50_ml[val_idx].sum() > 0 else 0.0
        rec_50_val = y_val[frozen_decision_50_ml[val_idx]].sum() / y_val.sum()

        fold_metrics.append({
            "terrane_idx": fold_idx,
            "terrane_name": TERRANE_NAMES[fold_idx],
            "n_pos": int(y_val.sum()),
            "n_neg": int((y_val == 0).sum()),
            "t_80_frozen": round(float(t_80), 4),
            "t_60_frozen": round(float(t_60), 4),
            "pr_auc_ml": round(float(pr_auc_val_ml), 4),
            "pr_auc_phys": round(float(pr_auc_val_phys), 4),
            "pr_auc_cons": round(float(pr_auc_val_cons), 4),
            "val_rec_at_frozen_80": round(float(rec_80_val), 4),
            "val_prec_at_frozen_80": round(float(prec_80_val), 4),
            "val_rec_at_frozen_60": round(float(rec_60_val), 4),
            "val_prec_at_frozen_60": round(float(prec_60_val), 4),
            "val_rec_at_frozen_50": round(float(rec_50_val), 4),
            "val_prec_at_frozen_50": round(float(prec_50_val), 4),
        })

    # Overall pooled frozen threshold metrics
    total_pos = y.sum()
    pooled_rec_frozen_80 = frozen_decision_80_ml[y == 1].sum() / total_pos
    pooled_prec_frozen_80 = y[frozen_decision_80_ml].mean() if frozen_decision_80_ml.sum() > 0 else 0.0

    pooled_rec_frozen_60 = frozen_decision_60_ml[y == 1].sum() / total_pos
    pooled_prec_frozen_60 = y[frozen_decision_60_ml].mean() if frozen_decision_60_ml.sum() > 0 else 0.0

    pooled_rec_frozen_50 = frozen_decision_50_ml[y == 1].sum() / total_pos
    pooled_prec_frozen_50 = y[frozen_decision_50_ml].mean() if frozen_decision_50_ml.sum() > 0 else 0.0

    print(f"Overall Truly Frozen Out-Of-Fold Recall @ 80% Precision: {pooled_rec_frozen_80*100:.2f}% (Attained Precision: {pooled_prec_frozen_80*100:.2f}%)")
    print(f"Overall Truly Frozen Out-Of-Fold Recall @ 60% Precision: {pooled_rec_frozen_60*100:.2f}% (Attained Precision: {pooled_prec_frozen_60*100:.2f}%)")
    print(f"Overall Truly Frozen Out-Of-Fold Recall @ 50% Precision: {pooled_rec_frozen_50*100:.2f}% (Attained Precision: {pooled_prec_frozen_50*100:.2f}%)")

    # -------------------------------------------------------------
    # 3. PER-TERRANE BREAKDOWN AT OPERATING THRESHOLDS
    # -------------------------------------------------------------
    print("\n--- 3. PER-TERRANE BREAKDOWN AT OPERATING THRESHOLDS ---")
    # For each terrane, test at its specific operational cutoffs:
    # Convert cutoff (e.g. 38, 56, 74 or 26, 42, 60) to probability space:
    # Recall compute_risk_score: risk_score = proba * 100
    terrane_operating_eval = []

    for fold_idx in range(5):
        val_idx = np.where(terrane_arr == fold_idx)[0]
        y_val = y[val_idx]
        p_ml_val = oof_preds_ml[val_idx]
        p_phys_val = p_phys_arr[val_idx]
        p_cons_val = oof_preds_consensus[val_idx]
        dists_val = groups[val_idx]

        # Get regional cutoff for this terrane's districts
        # E.g. Terrane 0 -> 38, 56, 74; Terrane 3 -> 26, 42, 60
        first_dist = dists_val[0]
        cut = REGIONAL_TERRANE_CUTOFFS.get(first_dist)
        mod_th = cut["moderate"] / 100.0
        high_th = cut["high"] / 100.0
        sev_th = cut["severe"] / 100.0

        def calc_pr(p_array, threshold):
            pred = p_array >= threshold
            prec = y_val[pred].mean() if pred.sum() > 0 else 0.0
            rec = y_val[pred].sum() / y_val.sum() if y_val.sum() > 0 else 0.0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
            return round(float(prec), 4), round(float(rec), 4), round(float(f1), 4), int(pred.sum())

        eval_entry = {
            "terrane_idx": fold_idx,
            "terrane_name": TERRANE_NAMES[fold_idx],
            "districts": list(set(dists_val)),
            "n_pos": int(y_val.sum()),
            "n_neg": int((y_val == 0).sum()),
            "cutoffs": [cut["moderate"], cut["high"], cut["severe"]],
            # Moderate Tier
            "mod_ml": calc_pr(p_ml_val, mod_th),
            "mod_phys": calc_pr(p_phys_val, mod_th),
            "mod_consensus": calc_pr(p_cons_val, mod_th),
            # High Tier
            "high_ml": calc_pr(p_ml_val, high_th),
            "high_phys": calc_pr(p_phys_val, high_th),
            "high_consensus": calc_pr(p_cons_val, high_th),
            # Severe Tier
            "sev_ml": calc_pr(p_ml_val, sev_th),
            "sev_phys": calc_pr(p_phys_val, sev_th),
            "sev_consensus": calc_pr(p_cons_val, sev_th),
        }
        terrane_operating_eval.append(eval_entry)

    # -------------------------------------------------------------
    # 4. STANDALONE VALIDATION OF P_PHYS
    # -------------------------------------------------------------
    print("\n--- 4. STANDALONE VALIDATION OF P_PHYS ---")
    overall_pr_auc_phys = average_precision_score(y, p_phys_arr)
    overall_roc_auc_phys = roc_auc_score(y, p_phys_arr)
    print(f"Overall P_phys Standalone PR-AUC: {overall_pr_auc_phys:.4f}")
    print(f"Overall P_phys Standalone ROC-AUC: {overall_roc_auc_phys:.4f}")

    results = {
        "dataset_audit": {
            "raw_unique_positives": len(raw_pos_unique),
            "retained_positives": n_retained,
            "excluded_zero_rain_scars": n_zero_rain,
            "excluded_no_weather_records": n_no_weather,
            "excluded_missing_zone": n_missing_zone,
        },
        "frozen_threshold_oof": {
            "pooled_rec_frozen_80": round(float(pooled_rec_frozen_80), 4),
            "pooled_prec_frozen_80": round(float(pooled_prec_frozen_80), 4),
            "pooled_rec_frozen_60": round(float(pooled_rec_frozen_60), 4),
            "pooled_prec_frozen_60": round(float(pooled_prec_frozen_60), 4),
            "pooled_rec_frozen_50": round(float(pooled_rec_frozen_50), 4),
            "pooled_prec_frozen_50": round(float(pooled_prec_frozen_50), 4),
            "folds": fold_metrics,
        },
        "operating_cutoffs_per_terrane": terrane_operating_eval,
        "p_phys_standalone": {
            "overall_pr_auc": round(float(overall_pr_auc_phys), 4),
            "overall_roc_auc": round(float(overall_roc_auc_phys), 4),
        }
    }

    with open("scratch/empirical_audit_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nWrote results to scratch/empirical_audit_results.json")

if __name__ == "__main__":
    run_empirical_audit()
