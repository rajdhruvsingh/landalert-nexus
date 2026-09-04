#!/usr/bin/env python3
"""
scripts/fold_evaluation.py
Calculates and prints fold-by-fold GroupKFold evaluation metrics
for both Logistic Regression and Random Forest.
"""
import os, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import precision_recall_curve, auc, precision_score, recall_score
from sklearn.preprocessing import StandardScaler
sys.path.insert(0, os.path.abspath('.'))
from scripts.ml_audit_pipeline import feature_df, FEATURE_COLS, RANDOM_SEED

X = feature_df[FEATURE_COLS]
y = feature_df['label'].values
groups = feature_df['district'].values

n_splits = min(5, len(set(groups)))
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
gkf = GroupKFold(n_splits=n_splits)

lr = LogisticRegression(class_weight='balanced', max_iter=1000, random_state=RANDOM_SEED)
rf = RandomForestClassifier(n_estimators=200, class_weight='balanced', max_depth=5, random_state=RANDOM_SEED)

def pr_auc(y_t, p):
    prec, rec, _ = precision_recall_curve(y_t, p)
    return float(auc(rec, prec))

def r80(y_t, p):
    prec, rec, _ = precision_recall_curve(y_t, p)
    idx = next((i for i, pr in enumerate(prec) if pr >= 0.80), None)
    return float(rec[idx]) if idx is not None else 0.0

print("=" * 80)
print(f"FOLD-LEVEL PERFORMANCE REPORT (GroupKFold n={n_splits} by District)")
print("=" * 80)
print(f"{'Fold':<5} {'Validation District(s)':<32} {'Pos':<5} {'Neg':<5} {'LR PR-AUC':<11} {'LR Rec@80p':<11} {'RF PR-AUC':<11} {'RF Rec@80p':<11}")
print("-" * 92)

lr_praucs, lr_r80s, rf_praucs, rf_r80s = [], [], [], []

for fold, (tr_idx, val_idx) in enumerate(gkf.split(X_scaled, y, groups)):
    val_y = y[val_idx]
    val_g = groups[val_idx]
    districts = ", ".join(sorted(set(val_g)))
    n_pos = int((val_y == 1).sum())
    n_neg = int((val_y == 0).sum())

    if n_pos == 0:
        print(f"{fold+1:<5} {districts:<32} {n_pos:<5} {n_neg:<5} {'N/A (0 pos)':<11} {'N/A':<11} {'N/A (0 pos)':<11} {'N/A':<11}")
        continue

    # Train LR
    lr.fit(X_scaled[tr_idx], y[tr_idx])
    p_lr = lr.predict_proba(X_scaled[val_idx])[:, 1]
    pa_l = pr_auc(val_y, p_lr)
    r80_l = r80(val_y, p_lr)

    # Train RF
    rf.fit(X.values[tr_idx], y[tr_idx])
    p_rf = rf.predict_proba(X.values[val_idx])[:, 1]
    pa_r = pr_auc(val_y, p_rf)
    r80_r = r80(val_y, p_rf)

    lr_praucs.append(pa_l)
    lr_r80s.append(r80_l)
    rf_praucs.append(pa_r)
    rf_r80s.append(r80_r)

    note = " (1 pos)" if n_pos == 1 else ""
    print(f"{fold+1:<5} {districts:<32} {n_pos:<5} {n_neg:<5} {pa_l:<11.4f} {r80_l:<11.4f} {pa_r:<11.4f} {r80_r:<11.4f}{note}")

print("-" * 92)
print("AGGREGATE SUMMARY ACROSS DEFINED FOLDS:")
print(f"LR PR-AUC:   Mean = {np.mean(lr_praucs):.4f}, Std = {np.std(lr_praucs):.4f}, Range = [{min(lr_praucs):.4f}, {max(lr_praucs):.4f}]")
print(f"LR Rec@80p:  Mean = {np.mean(lr_r80s):.4f}, Std = {np.std(lr_r80s):.4f}, Range = [{min(lr_r80s):.4f}, {max(lr_r80s):.4f}]")
print(f"RF PR-AUC:   Mean = {np.mean(rf_praucs):.4f}, Std = {np.std(rf_praucs):.4f}, Range = [{min(rf_praucs):.4f}, {max(rf_praucs):.4f}]")
print(f"RF Rec@80p:  Mean = {np.mean(rf_r80s):.4f}, Std = {np.std(rf_r80s):.4f}, Range = [{min(rf_r80s):.4f}, {max(rf_r80s):.4f}]")
print("=" * 80)
