#!/usr/bin/env python3
"""
scripts/train_and_export_artifact.py
====================================
Trains the canonical Logistic Regression model on the verified 32x19 dataset,
computes Spatial GroupKFold metrics, and serializes the versioned artifact to JSON.
Performs an immediate round-trip test: TRAIN -> SAVE -> LOAD -> INFER.
"""

import os, sys, math, subprocess, warnings
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import precision_recall_curve, auc
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.abspath("."))
from src.lib.ml.features import (
    CANONICAL_FEATURES,
    FEATURE_SCHEMA_VERSION,
    extract_features_for_zone,
    validate_feature_vector,
)
from src.lib.ml.artifact import save_model_artifact, load_model_artifact

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
RANDOM_SEED = 42
MODEL_VERSION = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "v0.4-lr-trained"
ARTIFACT_PATH = f"models/{MODEL_VERSION}.json"

def get_git_commit():
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"]).decode("utf-8").strip()
    except Exception:
        return "unknown"

def main():
    print("=" * 72)
    print(f"TRAINING & ARTIFACT EXPORT PIPELINE: {MODEL_VERSION}")
    print("=" * 72)

    conn = psycopg2.connect(DATABASE_URL)
    zones_df = pd.read_sql("SELECT * FROM risk_zones ORDER BY id", conn)
    slides_df = pd.read_sql("SELECT * FROM historical_landslides ORDER BY event_date", conn)
    slides_df["event_date"] = pd.to_datetime(slides_df["event_date"])
    weather_df = pd.read_sql("""
        SELECT zone_id, reading_time::date AS reading_date,
               SUM(rainfall_mm) AS rainfall_mm,
               MAX(soil_moisture_pct) FILTER (WHERE soil_moisture_pct IS NOT NULL) AS soil_moisture_pct
        FROM weather_readings GROUP BY zone_id, reading_time::date ORDER BY zone_id, reading_date
    """, conn)
    weather_df["reading_date"] = pd.to_datetime(weather_df["reading_date"])
    conn.close()

    real_all = slides_df[~slides_df["is_synthetic"]].copy()
    rainfall_ev = real_all[real_all["hazard_type"] == "rainfall_slope_failure"].copy()

    # 1. Build positive training rows
    print(f"Extracting features for {len(rainfall_ev)} verified rainfall events...")
    pos_rows = []
    for _, slide in rainfall_ev.iterrows():
        z_row = zones_df[zones_df["id"] == slide["zone_id"]].iloc[0]
        feats, meta = extract_features_for_zone(z_row, slide["event_date"], weather_df, real_all)
        if feats:
            pos_rows.append({**feats, "label": 1, "district": z_row["district"], "zone_id": z_row["id"]})

    print(f"  Valid positive feature vectors generated: {len(pos_rows)}")

    # 2. Build deterministic pseudo-absences
    from src.lib.ml.features import haversine_km
    eligible_zones = zones_df[zones_df["mean_slope_deg"] > 5.0]
    rng = np.random.default_rng(RANDOM_SEED)
    min_year = max(int(rainfall_ev["event_date"].dt.year.min()), 2010)
    max_year = min(int(rainfall_ev["event_date"].dt.year.max()), 2024)
    year_pool = list(range(min_year, max_year + 1))
    n_needed = len(pos_rows) * 3
    negatives = []
    attempts = 0
    while len(negatives) < n_needed and attempts < n_needed * 30:
        attempts += 1
        z_row = eligible_zones.sample(1, random_state=int(rng.integers(0, 99999))).iloc[0]
        zone_id = int(z_row["id"])
        y = int(rng.choice(year_pool))
        m = int(rng.integers(1, 13))
        d_max = 28 if m == 2 else (30 if m in [4, 6, 9, 11] else 31)
        d = int(rng.integers(1, d_max + 1))
        try:
            cdate = pd.Timestamp(year=y, month=m, day=d)
        except Exception:
            continue
        zone_evts = rainfall_ev[rainfall_ev["zone_id"] == zone_id]["event_date"]
        if any(abs((cdate - e).days) <= 14 for e in zone_evts):
            continue
        clat, clng = float(z_row["centroid_lat"]), float(z_row["centroid_lng"])
        pos_loc = rainfall_ev.dropna(subset=["lat", "lng"])
        if any(haversine_km(clat, clng, float(r["lat"]), float(r["lng"])) < 1.0 for _, r in pos_loc.iterrows()):
            continue
        negatives.append({"zone_id": zone_id, "event_date": cdate, "label": 0})

    neg_rows = []
    for neg in negatives:
        z_row = zones_df[zones_df["id"] == neg["zone_id"]].iloc[0]
        feats, meta = extract_features_for_zone(z_row, neg["event_date"], weather_df, real_all)
        if feats:
            neg_rows.append({**feats, "label": 0, "district": z_row["district"], "zone_id": z_row["id"]})

    feature_df = pd.DataFrame(pos_rows + neg_rows).reset_index(drop=True)
    X = feature_df[CANONICAL_FEATURES].values
    y = feature_df["label"].values
    groups = feature_df["district"].values

    print(f"Feature matrix: {X.shape[0]} rows x {X.shape[1]} features")
    print(f"  Positives: {(y==1).sum()}, Pseudo-absences: {(y==0).sum()}")

    # 3. Compute Spatial GroupKFold Cross-Validation Metrics
    n_splits = min(5, len(set(groups)))
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    gkf = GroupKFold(n_splits=n_splits)

    lr = LogisticRegression(class_weight="balanced", max_iter=1000, C=1.0, random_state=RANDOM_SEED)
    proba_cv = cross_val_predict(lr, X_scaled, y, groups=groups, cv=gkf, method="predict_proba")[:, 1]

    prec, rec, _ = precision_recall_curve(y, proba_cv)
    pr_auc_val = float(auc(rec, prec))
    idx80 = next((i for i, p in enumerate(prec) if p >= 0.80), None)
    recall_80p = float(rec[idx80]) if idx80 is not None else 0.0

    print(f"\nSpatial Cross-Validation Results (GroupKFold n={n_splits}):")
    print(f"  PR-AUC:                 {pr_auc_val:.4f}")
    print(f"  Recall @ 80% Precision: {recall_80p:.4f}")

    # 4. Train final model on full dataset
    lr.fit(X_scaled, y)
    weights = lr.coef_[0].tolist()
    intercept = float(lr.intercept_[0])

    # Compute dataset fingerprint
    import hashlib
    mat_str = feature_df[CANONICAL_FEATURES + ["label", "zone_id"]].to_csv(index=False)
    fp = hashlib.sha256(mat_str.encode("utf-8")).hexdigest()

    metrics = {
        "validation_strategy": f"Spatial GroupKFold n={n_splits} by district",
        "pr_auc": round(pr_auc_val, 4),
        "recall_at_80_precision": round(recall_80p, 4),
        "prevalence": float((y == 1).sum() / len(y)),
    }

    sample_counts = {
        "positives": int((y == 1).sum()),
        "pseudo_absences": int((y == 0).sum()),
        "total": int(len(y)),
    }

    git_commit = get_git_commit()

    notes = (
        f"Production model {MODEL_VERSION}. Trained on {sample_counts['positives']} real NER rainfall-triggered landslides and {sample_counts['pseudo_absences']} pseudo-absences. "
        f"Validation method: Spatial GroupKFold n={n_splits} by district. "
        "Soil moisture incorporates measured ERA5-Land data (0-7cm daily mean) where available. "
        f"ACTUAL EXECUTION: Spatial GroupKFold CV PR-AUC = {metrics['pr_auc']:.4f}, Recall@80% = {metrics['recall_at_80_precision']:.4f}. "
        "COOLR / GSI retraining trigger: re-evaluate when >= 200 new events are ingested."
    )

    # 5. Export Versioned Artifact
    save_model_artifact(
        file_path=ARTIFACT_PATH,
        model_version=MODEL_VERSION,
        model_type="LogisticRegression",
        weights=weights,
        intercept=intercept,
        scaler_mean=scaler.mean_.tolist(),
        scaler_scale=scaler.scale_.tolist(),
        metrics=metrics,
        dataset_fingerprint=fp,
        sample_counts=sample_counts,
        git_commit=git_commit,
        notes=notes,
    )
    print(f"\nSaved model artifact to: {ARTIFACT_PATH}")

    # 6. Round-trip Load and Inference Test
    print("\n[VERIFICATION] Performing round-trip test: LOAD -> INFER")
    artifact = load_model_artifact(ARTIFACT_PATH)
    assert artifact.model_version == MODEL_VERSION
    assert len(artifact.weights) == 19

    # Test inference on first positive sample
    sample_feat = {k: feature_df.iloc[0][k] for k in CANONICAL_FEATURES}
    pred_prob = artifact.predict_proba(sample_feat)
    score, level = artifact.compute_risk_score(pred_prob)
    explanation = artifact.explain(sample_feat)

    print(f"  Test prediction probability: {pred_prob:.4f}")
    print(f"  Test operational risk score: {score} ({level})")
    print(f"  Top contributing categories: {[c['category'] for c in explanation['top_categories'][:3]]}")
    print("\nROUND-TRIP ARTIFACT TEST PASSED.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
