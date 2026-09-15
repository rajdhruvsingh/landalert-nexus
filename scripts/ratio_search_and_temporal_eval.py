"""
scripts/ratio_search_and_temporal_eval.py
==========================================
Executes:
  1. Fix 2: Pseudo-absence ratio grid search (2:1, 3:1, 4:1, 5:1, 6:1)
     Finds the optimal ratio via 5-fold Spatial GroupKFold CV PR-AUC.
  2. Fix 3: Temporal validation (train on <2022, test on 2022-2024)
     Evaluates out-of-time temporal stability / generalisation.
"""

import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, ".")

# Load .env
for line in Path(".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ[k.strip()] = v.strip().strip('"').strip("'")

import numpy as np
import pandas as pd
import psycopg2
from sklearn.model_selection import GroupKFold
from sklearn.metrics import average_precision_score, roc_auc_score, precision_recall_curve
from sklearn.preprocessing import StandardScaler

from src.lib.ml.features import CANONICAL_FEATURES, extract_features_for_zone
from src.lib.ml.train_v05 import (
    _load_training_data,
    _make_rf,
    _make_xgb,
    PSEUDO_ABSENCE_EXCLUSION_DAYS,
    ENSEMBLE_WEIGHTS,
    CV_FOLDS,
)

DATABASE_URL = os.environ["DATABASE_URL"]

def extract_positives(events_df, zones_df, weather_df):
    zones_indexed = zones_df.set_index("id")
    rows = []
    dates = []
    groups = []
    zone_ids = []
    skipped = 0

    for _, ev in events_df.iterrows():
        zid = int(ev["zone_id"])
        if zid not in zones_indexed.index:
            skipped += 1
            continue
        z_row = zones_indexed.loc[zid].copy()
        z_row["id"] = zid
        as_of = pd.Timestamp(ev["event_date"])

        feats, _ = extract_features_for_zone(
            z_row, as_of, weather_df, events_df, temporal_proximity=True
        )
        if feats is None:
            skipped += 1
            continue

        rows.append([feats[k] for k in CANONICAL_FEATURES])
        dates.append(as_of)
        groups.append(str(z_row.get("district", f"zone_{zid}")))
        zone_ids.append(zid)

    print(f"Extracted {len(rows)} positives ({skipped} skipped due to insufficient history).")
    return rows, dates, groups, zone_ids

def generate_negatives(ratio, n_pos, events_df, zones_df, weather_df, seed=42):
    zones_indexed = zones_df.set_index("id")
    target_absences = int(n_pos * ratio)
    pos_lookup = set(
        (int(ev["zone_id"]), pd.Timestamp(ev["event_date"]).date())
        for _, ev in events_df.iterrows()
    )
    
    weather_df["reading_date"] = pd.to_datetime(weather_df["reading_date"])
    min_date = weather_df["reading_date"].min() + pd.Timedelta(days=35)
    max_date = weather_df["reading_date"].max()
    all_dates = pd.date_range(min_date, max_date, freq="D")
    zone_ids = list(zones_indexed.index)

    rng = np.random.default_rng(seed)
    rows = []
    dates = []
    groups = []
    max_attempts = target_absences * 30

    for _ in range(max_attempts):
        if len(rows) >= target_absences:
            break
        zid = int(rng.choice(zone_ids))
        rand_ts = pd.Timestamp(all_dates[int(rng.integers(0, len(all_dates)))])

        near_event = any(
            abs((rand_ts.date() - d).days) <= PSEUDO_ABSENCE_EXCLUSION_DAYS
            for (z, d) in pos_lookup
            if z == zid
        )
        if near_event:
            continue

        z_row = zones_indexed.loc[zid].copy()
        z_row["id"] = zid
        feats, _ = extract_features_for_zone(
            z_row, rand_ts, weather_df, events_df, temporal_proximity=True
        )
        if feats is None:
            continue

        rows.append([feats[k] for k in CANONICAL_FEATURES])
        dates.append(rand_ts)
        groups.append(str(z_row.get("district", f"zone_{zid}")))

    return rows, dates, groups

def evaluate_cv(X, y, groups):
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    n_pos = int(y.sum())
    n_neg = int((y == 0).sum())
    spw = float(n_neg) / max(n_pos, 1)

    gkf = GroupKFold(n_splits=CV_FOLDS)
    fold_prs_rf = []
    fold_prs_xgb = []
    fold_prs_ens = []

    for train_idx, val_idx in gkf.split(X_scaled, y, groups):
        X_tr, X_val = X_scaled[train_idx], X_scaled[val_idx]
        y_tr, y_val = y[train_idx], y[val_idx]

        rf = _make_rf()
        rf.fit(X_tr, y_tr)
        rf_p = rf.predict_proba(X_val)[:, 1]

        xgb_m = _make_xgb(spw)
        xgb_m.fit(X_tr, y_tr)
        xgb_p = xgb_m.predict_proba(X_val)[:, 1]

        ens_p = ENSEMBLE_WEIGHTS["rf"] * rf_p + ENSEMBLE_WEIGHTS["xgb"] * xgb_p

        fold_prs_rf.append(average_precision_score(y_val, rf_p))
        fold_prs_xgb.append(average_precision_score(y_val, xgb_p))
        fold_prs_ens.append(average_precision_score(y_val, ens_p))

    return {
        "ens_pr_auc": float(np.mean(fold_prs_ens)),
        "rf_pr_auc": float(np.mean(fold_prs_rf)),
        "xgb_pr_auc": float(np.mean(fold_prs_xgb)),
        "min_fold": float(np.min(fold_prs_ens)),
        "max_fold": float(np.max(fold_prs_ens)),
        "folds": fold_prs_ens,
    }

def main():
    conn = psycopg2.connect(DATABASE_URL)
    events_df, zones_df, weather_df = _load_training_data(conn)
    conn.close()

    print("\n" + "="*70)
    print("STEP 1: Extracting positive features (once for all evaluations)")
    print("="*70)
    pos_rows, pos_dates, pos_groups, pos_zids = extract_positives(events_df, zones_df, weather_df)
    n_pos = len(pos_rows)

    print("\n" + "="*70)
    print("FIX 2: Pseudo-Absence Ratio Grid Search (2:1 to 6:1)")
    print("="*70)
    ratio_results = {}
    ratios = [2, 3, 4, 5, 6]

    for r in ratios:
        neg_rows, neg_dates, neg_groups = generate_negatives(r, n_pos, events_df, zones_df, weather_df)
        X = np.array(pos_rows + neg_rows, dtype=np.float64)
        y = np.array([1]*n_pos + [0]*len(neg_rows), dtype=np.int32)
        groups = np.array(pos_groups + neg_groups)

        metrics = evaluate_cv(X, y, groups)
        ratio_results[r] = {
            "metrics": metrics,
            "n_samples": len(y),
            "neg_rows": neg_rows,
            "neg_dates": neg_dates,
            "neg_groups": neg_groups,
            "X": X,
            "y": y,
            "groups": groups,
        }
        print(f"Ratio {r}:1 | Samples: {len(y)} | CV PR-AUC: {metrics['ens_pr_auc']:.4f} "
              f"(RF: {metrics['rf_pr_auc']:.4f}, XGB: {metrics['xgb_pr_auc']:.4f}) | "
              f"Worst Fold: {metrics['min_fold']:.4f}")

    best_ratio = max(ratios, key=lambda r: ratio_results[r]["metrics"]["ens_pr_auc"])
    print(f"\n--> Best pseudo-absence ratio: {best_ratio}:1 with CV PR-AUC = {ratio_results[best_ratio]['metrics']['ens_pr_auc']:.4f}")

    print("\n" + "="*70)
    print("FIX 3: Temporal Validation (Train < 2022, Test 2022-2024)")
    print("="*70)
    best_data = ratio_results[best_ratio]
    all_dates = pos_dates + best_data["neg_dates"]
    split_date = pd.Timestamp("2022-01-01")

    train_mask = np.array([d < split_date for d in all_dates])
    test_mask = np.array([d >= split_date for d in all_dates])

    X_train, y_train = best_data["X"][train_mask], best_data["y"][train_mask]
    X_test, y_test = best_data["X"][test_mask], best_data["y"][test_mask]

    print(f"Train set (< 2022): {len(y_train)} samples ({int(y_train.sum())} pos, {int((y_train==0).sum())} neg)")
    print(f"Test set (2022-2024): {len(y_test)} samples ({int(y_test.sum())} pos, {int((y_test==0).sum())} neg)")

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    spw_tr = float((y_train == 0).sum()) / max(int(y_train.sum()), 1)

    rf_temp = _make_rf()
    rf_temp.fit(X_train_scaled, y_train)
    rf_p = rf_temp.predict_proba(X_test_scaled)[:, 1]

    xgb_temp = _make_xgb(spw_tr)
    xgb_temp.fit(X_train_scaled, y_train)
    xgb_p = xgb_temp.predict_proba(X_test_scaled)[:, 1]

    ens_p = ENSEMBLE_WEIGHTS["rf"] * rf_p + ENSEMBLE_WEIGHTS["xgb"] * xgb_p

    temp_pr_auc = average_precision_score(y_test, ens_p)
    temp_roc_auc = roc_auc_score(y_test, ens_p)
    rf_temp_pr = average_precision_score(y_test, rf_p)
    xgb_temp_pr = average_precision_score(y_test, xgb_p)

    prec_arr, recall_arr, thresh_arr = precision_recall_curve(y_test, ens_p)
    f1_arr = 2 * (prec_arr * recall_arr) / np.maximum(prec_arr + recall_arr, 1e-8)
    best_idx = np.argmax(f1_arr)
    best_f1 = f1_arr[best_idx]
    best_th = thresh_arr[min(best_idx, len(thresh_arr)-1)]

    print(f"\nTemporal Holdout (2022-2024 Unseen Future Years) Results:")
    print(f"  Ensemble PR-AUC : {temp_pr_auc:.4f}")
    print(f"  Ensemble ROC-AUC: {temp_roc_auc:.4f}")
    print(f"  RF PR-AUC       : {rf_temp_pr:.4f}")
    print(f"  XGBoost PR-AUC  : {xgb_temp_pr:.4f}")
    print(f"  Best F1 Score   : {best_f1:.4f} (at threshold {best_th:.3f})")
    print(f"  Precision@BestF1: {prec_arr[best_idx]:.4f}")
    print(f"  Recall@BestF1   : {recall_arr[best_idx]:.4f}")

if __name__ == "__main__":
    main()
