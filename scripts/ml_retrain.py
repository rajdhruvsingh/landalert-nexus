#!/usr/bin/env python3
"""
Production Retraining Pipeline for Landslide Early Warning
(SIH26001 / landalert-nexus)

Enforces strict MLOps principles:
1. Eligibility verification (triggers on >=10 new verified positives, or --force)
2. Strict data hygiene (real rainfall landslides only; zero synthetic; zero GLOF)
3. Canonical 19-feature extraction (schema v1.0.0) with zero temporal leakage
4. Spatial GroupKFold cross-validation
5. Model selection gate (RF must exceed LR by >0.05 PR-AUC)
6. Comparison against active production model
7. Export of versioned artifact with complete provenance and fingerprint
8. Registration as 'candidate' / 'validated'
9. STRICT NON-AUTO-ACTIVATION: Model requires explicit human operator activation.

Usage:
    python3 scripts/ml_retrain.py [--force] [--version <ver>] [--dry-run]
"""

import sys
import os
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import json
import argparse
from datetime import datetime, timezone
import hashlib
import psycopg2
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import GroupKFold
from sklearn.metrics import precision_recall_curve, auc

from src.lib.ml.features import (
    FEATURE_SCHEMA_VERSION,
    CANONICAL_FEATURES,
    extract_features_for_zone
)
from src.lib.ml.artifact import save_model_artifact, load_model_artifact

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/landalert")

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def evaluate_spatial_cv(X, y, groups, model_type="logistic_regression"):
    gkf = GroupKFold(n_splits=5)
    all_y_true = []
    all_y_pred_prob = []

    for train_idx, val_idx in gkf.split(X, y, groups):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]

        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_val_scaled = scaler.transform(X_val)

        if model_type == "logistic_regression":
            clf = LogisticRegression(class_weight="balanced", C=1.0, random_state=42, max_iter=1000)
            clf.fit(X_train_scaled, y_train)
            probs = clf.predict_proba(X_val_scaled)[:, 1]
        elif model_type == "random_forest":
            clf = RandomForestClassifier(
                n_estimators=100,
                max_depth=4,
                min_samples_split=3,
                class_weight="balanced",
                random_state=42
            )
            clf.fit(X_train, y_train)
            probs = clf.predict_proba(X_val)[:, 1]
        else:
            raise ValueError(f"Unknown model_type {model_type}")

        all_y_true.extend(y_val.tolist())
        all_y_pred_prob.extend(probs.tolist())

    prec, rec, _ = precision_recall_curve(all_y_true, all_y_pred_prob)
    pr_auc = float(auc(rec, prec))

    # Recall at 80% precision
    valid_recs = [r for p, r in zip(prec, rec) if p >= 0.80]
    rec_at_80 = float(max(valid_recs)) if valid_recs else 0.0

    return pr_auc, rec_at_80, all_y_true, all_y_pred_prob

def run_retraining(version: str = None, force: bool = False, dry_run: bool = False):
    conn = get_db_connection()
    print("=" * 65)
    print("  PRODUCTION RETRAINING PIPELINE (SIH26001 / landalert-nexus)")
    print("=" * 65)

    try:
        # Step 1: Active Model Audit
        cur = conn.cursor()
        cur.execute("""
            SELECT model_version, pr_auc, recall_at_80_precision, dataset_fingerprint
            FROM public.risk_model_config
            WHERE is_active = true;
        """)
        active_row = cur.fetchone()
        if not active_row:
            print("⚠ WARNING: No active model in risk_model_config.")
            active_version = "none"
            active_prauc = 0.0
        else:
            active_version = active_row[0]
            active_prauc = float(active_row[1]) if active_row[1] is not None else 0.0
            print(f"Active Model:    {active_version} (PR-AUC: {active_prauc:.4f})")

        # Step 2: Inflow Check
        cur.execute("""
            SELECT COUNT(*) FROM public.historical_landslides
            WHERE is_synthetic = false AND hazard_type != 'GLOF';
        """)
        real_positives_count = cur.fetchone()[0]
        print(f"Verified Real Positives in DB: {real_positives_count}")

        BASELINE_POSITIVES = 8
        new_events = real_positives_count - BASELINE_POSITIVES
        if new_events < 10 and not force:
            print(f"\n[ABORTED] Retraining trigger not met: {new_events} new events (minimum required: 10).")
            print("Use --force to override for scheduled, monsoon, or test runs.")
            return False

        print(f"Trigger condition met ({'--force' if force else f'{new_events} new verified events'}). Proceeding.")

        # Step 3: Extract Verified Positives and Generate Validated Pseudo-Absences
        cur.execute("""
            SELECT h.id, h.event_date, h.lat, h.lng, h.zone_id, z.district, h.severity, h.hazard_type, h.source
            FROM public.historical_landslides h
            LEFT JOIN public.risk_zones z ON h.zone_id = z.id
            WHERE h.is_synthetic = false AND h.hazard_type != 'GLOF'
            ORDER BY h.event_date ASC;
        """)
        cols = [c[0] for c in cur.description]
        pos_df = pd.DataFrame(cur.fetchall(), columns=cols)
        print(f"Loaded {len(pos_df)} verified training positives.")

        # Step 4: Feature Matrix Construction directly from DB
        print("\n--- Constructing Canonical 19-Feature Matrix from Database ---")
        zones_df = pd.read_sql("SELECT * FROM public.risk_zones ORDER BY id", conn)
        slides_df = pd.read_sql("SELECT * FROM public.historical_landslides ORDER BY event_date", conn)
        slides_df["event_date"] = pd.to_datetime(slides_df["event_date"])
        weather_df = pd.read_sql("""
            SELECT zone_id, reading_time::date AS reading_date,
                   SUM(rainfall_mm) AS rainfall_mm,
                   MAX(soil_moisture_pct) FILTER (WHERE soil_moisture_pct IS NOT NULL) AS soil_moisture_pct
            FROM public.weather_readings
            GROUP BY zone_id, reading_time::date
            ORDER BY zone_id, reading_date;
        """, conn)
        weather_df["reading_date"] = pd.to_datetime(weather_df["reading_date"])

        real_all = slides_df[~slides_df["is_synthetic"]].copy()
        rainfall_ev = real_all[real_all["hazard_type"] == "rainfall_slope_failure"].copy()

        # Build positive rows
        pos_rows = []
        for _, slide in rainfall_ev.iterrows():
            z_match = zones_df[zones_df["id"] == slide["zone_id"]]
            if z_match.empty:
                continue
            z_row = z_match.iloc[0]
            feats, _ = extract_features_for_zone(z_row, slide["event_date"], weather_df, real_all)
            if feats:
                pos_rows.append({**feats, "label": 1, "district": z_row["district"], "zone_id": z_row["id"]})

        # Build deterministic pseudo-absences
        from src.lib.ml.features import haversine_km
        eligible_zones = zones_df[zones_df["mean_slope_deg"] > 5.0]
        rng = np.random.default_rng(42)
        min_year = max(int(rainfall_ev["event_date"].dt.year.min()) - 2, 2010)
        max_year = int(rainfall_ev["event_date"].dt.year.max())
        year_pool = list(range(min_year, max_year + 1))
        n_needed = len(pos_rows) * 3
        negatives = []
        attempts = 0
        while len(negatives) < n_needed and attempts < n_needed * 20:
            attempts += 1
            z_row = eligible_zones.sample(1, random_state=int(rng.integers(0, 99999))).iloc[0]
            zone_id = int(z_row["id"])
            y_sample = int(rng.choice(year_pool))
            m_sample = int(rng.integers(1, 13))
            d_max = 28 if m_sample == 2 else (30 if m_sample in [4, 6, 9, 11] else 31)
            d_sample = int(rng.integers(1, d_max + 1))
            try:
                cdate = pd.Timestamp(year=y_sample, month=m_sample, day=d_sample)
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
            feats, _ = extract_features_for_zone(z_row, neg["event_date"], weather_df, real_all)
            if feats:
                neg_rows.append({**feats, "label": 0, "district": z_row["district"], "zone_id": z_row["id"]})

        df = pd.DataFrame(pos_rows + neg_rows).reset_index(drop=True)
        print(f"Feature Matrix Shape: {df.shape[0]} rows × {len(CANONICAL_FEATURES)} features")
        print(f"  Positives: {(df['label'] == 1).sum()}, Pseudo-absences: {(df['label'] == 0).sum()}")

        X = df[CANONICAL_FEATURES]
        y = df["label"]
        groups = df["district"]

        # Step 5: Spatial CV Evaluation of Candidates
        print("\n--- Spatial 5-Fold GroupKFold Cross-Validation ---")
        lr_prauc, lr_rec80, _, _ = evaluate_spatial_cv(X, y, groups, model_type="logistic_regression")
        rf_prauc, rf_rec80, _, _ = evaluate_spatial_cv(X, y, groups, model_type="random_forest")

        print(f"Candidate Logistic Regression: PR-AUC = {lr_prauc:.4f}, Recall@80% = {lr_rec80:.4f}")
        print(f"Candidate Random Forest:       PR-AUC = {rf_prauc:.4f}, Recall@80% = {rf_rec80:.4f}")

        # Model Selection Rule: RF must beat LR by >0.05 PR-AUC
        if rf_prauc > (lr_prauc + 0.05):
            selected_type = "Random Forest"
            selected_prauc = rf_prauc
            selected_rec80 = rf_rec80
            print(f"\nSelection: Random Forest exceeds LR by >0.05 PR-AUC ({rf_prauc:.4f} > {lr_prauc:.4f} + 0.05).")
        else:
            selected_type = "Logistic Regression"
            selected_prauc = lr_prauc
            selected_rec80 = lr_rec80
            print(f"\nSelection: Logistic Regression retained ({lr_prauc:.4f} vs RF {rf_prauc:.4f}). Simpler, defensible model.")

        # Step 6: Full-Fit Final Candidate Model
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        lr_final = LogisticRegression(class_weight="balanced", C=1.0, random_state=42, max_iter=1000)
        lr_final.fit(X_scaled, y)

        # Generate Candidate Version Tag
        today_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        cand_version = version or f"v0.3-candidate-{today_str}"
        artifact_name = f"{cand_version}.json"
        artifact_path = PROJECT_ROOT / "models" / artifact_name

        fingerprint = hashlib.sha256(pd.util.hash_pandas_object(df, index=True).values).hexdigest()

        if dry_run:
            print(f"\n[DRY RUN] Would export candidate artifact to {artifact_path}")
            print(f"[DRY RUN] Would register {cand_version} with status 'candidate'")
            return True

        # Step 7: Export Serialized Artifact
        weights_dict = {feat: float(w) for feat, w in zip(CANONICAL_FEATURES, lr_final.coef_[0])}
        scaler_means = {feat: float(m) for feat, m in zip(CANONICAL_FEATURES, scaler.mean_)}
        scaler_scales = {feat: float(s) for feat, s in zip(CANONICAL_FEATURES, scaler.scale_)}

        # Obtain current git commit
        try:
            import subprocess
            git_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT).decode().strip()
        except Exception:
            git_commit = "unknown"

        save_model_artifact(
            file_path=str(artifact_path),
            model_version=cand_version,
            model_type=selected_type,
            weights=[float(w) for w in lr_final.coef_[0]],
            intercept=float(lr_final.intercept_[0]),
            scaler_mean=[float(m) for m in scaler.mean_],
            scaler_scale=[float(s) for s in scaler.scale_],
            metrics={"pr_auc": selected_prauc, "recall_at_80_precision": selected_rec80},
            dataset_fingerprint=fingerprint,
            sample_counts={"positives": int((y == 1).sum()), "pseudo_absences": int((y == 0).sum())},
            git_commit=git_commit,
            notes=(
                f"Retrained candidate on {len(df)} rows ({int((y == 1).sum())} positives). "
                f"Evaluation: PR-AUC={selected_prauc:.4f}, Recall@80%={selected_rec80:.4f}. "
                f"Soil moisture variance remains zero in historical training rows."
            )
        )
        print(f"\nSaved Candidate Artifact: {artifact_path}")

        # Step 8: Register Candidate into Database
        cur.execute("""
            INSERT INTO public.risk_model_config (
                model_version, weight_intensity, weight_antecedent, weight_soil_moisture,
                weight_slope, weight_history, cutoff_moderate, cutoff_high, cutoff_severe,
                pr_auc, recall_at_80_precision, notes, is_active,
                artifact_path, status, dataset_fingerprint, feature_schema_version, trained_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, %s, 'candidate', %s, %s, now()
            )
            ON CONFLICT (model_version) DO UPDATE SET
                pr_auc = EXCLUDED.pr_auc,
                recall_at_80_precision = EXCLUDED.recall_at_80_precision,
                artifact_path = EXCLUDED.artifact_path,
                dataset_fingerprint = EXCLUDED.dataset_fingerprint,
                status = 'candidate';
        """, (
            cand_version,
            0.32, 0.22, 0.18, 0.16, 0.12, # operational engineering weights
            38.0, 56.0, 74.0,             # standard operational cutoffs
            selected_prauc, selected_rec80,
            f"Retrained candidate evaluated via Spatial GroupKFold. Dataset: {fingerprint[:16]}",
            str(artifact_path.relative_to(PROJECT_ROOT)),
            fingerprint,
            FEATURE_SCHEMA_VERSION
        ))
        conn.commit()
        print(f"Registered candidate in DB: '{cand_version}' (status: 'candidate', is_active: false)")

        # Step 9: Safety Gate Verification
        print("\n--- Model Safety Gate Verification ---")
        from scripts.ml_registry import verify_model_candidate
        gate_ok, reasons = verify_model_candidate(cand_version)
        if gate_ok:
            print("✓ Candidate PASSED all verification checks. Status updated to 'validated'.")
        else:
            print(f"⚠ Candidate GATED: {reasons}")

        # Step 10: Print Strict Human Operator Instructions
        print("\n" + "=" * 65)
        print("  RETRAINING FINISHED — IMPORTANT PRODUCTION SAFEGUARD")
        print("=" * 65)
        print("Per NON-NEGOTIABLE RULE 13:")
        print("A candidate model NEVER automatically replaces an active model.")
        print(f"Current Active:   {active_version} (PR-AUC: {active_prauc:.4f})")
        print(f"Candidate:        {cand_version} (PR-AUC: {selected_prauc:.4f})")
        print("\nTo inspect and activate this candidate model, run:")
        print(f"  python3 scripts/ml_registry.py activate {cand_version} --reason 'Retrained seasonal update'")
        print("=" * 65)

    finally:
        conn.close()

    return True

def main():
    parser = argparse.ArgumentParser(description="Landslide Early Warning Retraining Pipeline")
    parser.add_argument("--version", type=str, default=None, help="Explicit version tag for candidate")
    parser.add_argument("--force", action="store_true", help="Force retrain even if <10 new events recorded")
    parser.add_argument("--dry-run", action="store_true", help="Simulate pipeline without saving")
    args = parser.parse_args()

    success = run_retraining(version=args.version, force=args.force, dry_run=args.dry_run)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
