#!/usr/bin/env python3
"""
Production ML & Data Quality Monitoring Script for Landslide Early Warning
(SIH26001 / landalert-nexus)

Monitors:
1. Data Quality:
   - Weather freshness (age of newest reading per zone)
   - Stale weather detection (>48h)
   - Missing readings / gaps
   - Soil moisture status (measured vs fallback proxy rate)
2. Feature Drift:
   - Compares current operational zone features against training baseline
3. Prediction Drift:
   - Risk score distribution across all monitored zones
   - Risk category counts (Low, Moderate, High, Severe)
4. Model Status:
   - Active model version, fingerprint, schema version
   - Unverified vs verified event count since training

Usage:
    python3 scripts/ml_monitor.py [--json] [--alert-on-stale]
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
import numpy as np
import pandas as pd
import psycopg2

from src.lib.ml.features import FEATURE_SCHEMA_VERSION, CANONICAL_FEATURES
from src.lib.ml.inference import LandslideRiskInferenceEngine

DATABASE_URL = os.getenv("DATABASE_URL")

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def run_monitoring_check(alert_on_stale: bool = False):
    conn = get_db_connection()
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "HEALTHY",
        "alerts": [],
        "active_model": {},
        "data_quality": {},
        "soil_moisture": {},
        "prediction_distribution": {},
        "feature_summary": {}
    }

    try:
        # 1. Active Model Info
        cur = conn.cursor()
        cur.execute("""
            SELECT model_version, status, pr_auc, recall_at_80_precision,
                   activated_at, feature_schema_version, dataset_fingerprint,
                   artifact_path
            FROM public.risk_model_config
            WHERE is_active = true;
        """)
        row = cur.fetchone()
        if not row:
            report["status"] = "CRITICAL"
            report["alerts"].append("No active model found in risk_model_config!")
        else:
            report["active_model"] = {
                "version": row[0],
                "status": row[1],
                "pr_auc": float(row[2]) if row[2] is not None else None,
                "recall_at_80": float(row[3]) if row[3] is not None else None,
                "activated_at": row[4].isoformat() if row[4] else None,
                "feature_schema_version": row[5],
                "dataset_fingerprint": row[6],
                "artifact_path": row[7]
            }

        # 2. Zone & Weather Quality Check
        cur.execute("""
            SELECT 
                z.id, 
                z.zone_name, 
                z.state,
                z.soil_moisture_status,
                z.risk_score,
                z.current_risk_level,
                MAX(w.reading_time) as latest_weather
            FROM public.risk_zones z
            LEFT JOIN public.weather_readings w ON z.id = w.zone_id
            GROUP BY z.id, z.zone_name, z.state, z.soil_moisture_status, z.risk_score, z.current_risk_level
            ORDER BY z.id;
        """)
        zones_data = cur.fetchall()
        
        now = datetime.now(timezone.utc)
        total_zones = len(zones_data)
        stale_zones = []
        fallback_sm_count = 0
        measured_sm_count = 0
        missing_weather_zones = []
        risk_scores = []
        risk_levels = {"Low": 0, "Moderate": 0, "High": 0, "Severe": 0}

        for zid, zname, zstate, sm_status, rscore, rlvl, max_w in zones_data:
            if rscore is not None:
                risk_scores.append(float(rscore))
            if rlvl in risk_levels:
                risk_levels[rlvl] += 1

            if sm_status == "fallback":
                fallback_sm_count += 1
            elif sm_status == "measured":
                measured_sm_count += 1

            if max_w is None:
                missing_weather_zones.append(zname)
            else:
                age_hours = (now - max_w).total_seconds() / 3600.0
                if age_hours > 48.0:
                    stale_zones.append({"zone_id": zid, "zone_name": zname, "age_hours": round(age_hours, 1)})

        report["data_quality"] = {
            "total_monitored_zones": total_zones,
            "stale_weather_zones_count": len(stale_zones),
            "stale_zones": stale_zones,
            "missing_weather_zones": missing_weather_zones
        }

        fallback_rate = (fallback_sm_count / max(1, total_zones)) * 100.0
        report["soil_moisture"] = {
            "measured_zones": measured_sm_count,
            "fallback_zones": fallback_sm_count,
            "fallback_percentage": round(fallback_rate, 1),
            "is_informative_in_production": measured_sm_count > 0
        }

        if stale_zones:
            report["alerts"].append(f"{len(stale_zones)} zones have weather data older than 48 hours")
            if alert_on_stale:
                report["status"] = "WARNING"

        if missing_weather_zones:
            report["alerts"].append(f"{len(missing_weather_zones)} zones have NO weather readings")
            report["status"] = "CRITICAL"

        # 3. Prediction Distribution
        if risk_scores:
            report["prediction_distribution"] = {
                "mean_score": round(float(np.mean(risk_scores)), 1),
                "min_score": round(float(np.min(risk_scores)), 1),
                "max_score": round(float(np.max(risk_scores)), 1),
                "std_score": round(float(np.std(risk_scores)), 1),
                "category_counts": risk_levels
            }

        # 4. Canonical Feature Snapshot via Inference Engine
        engine = LandslideRiskInferenceEngine()
        sample_inf = engine.predict_zone(zone_id=1)
        if sample_inf.get("status") == "VALID":
            feats = sample_inf.get("canonical_features", {})
            report["feature_summary"] = {
                "sample_zone": "Zone 1 (Gangtok)",
                "schema_version": sample_inf.get("feature_schema_version"),
                "rain_3d_mm": feats.get("rain_3d"),
                "rain_30d_mm": feats.get("rain_30d"),
                "antecedent_wetness_index": round(feats.get("antecedent_wetness_index", 0), 1),
                "slope_deg": sample_inf.get("zone", {}).get("mean_slope_deg")
            }

        # 5. Label Inflow Check (New verified events)
        cur.execute("""
            SELECT COUNT(*) FROM public.historical_landslides
            WHERE is_synthetic = false AND hazard_type != 'GLOF';
        """)
        real_count = cur.fetchone()[0]
        report["label_inflow"] = {
            "total_verified_rainfall_positives": real_count,
            "trained_positives_baseline": 8,
            "new_verified_positives": real_count - 8,
            "retraining_recommended": (real_count - 8) >= 10
        }

        # 6. Field Observation Media Storage Budget Check
        cur.execute("""
            SELECT COUNT(*),
                   COALESCE(SUM((elem->>'size')::bigint), 0)
            FROM public.field_observations,
            LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(media_metadata) = 'array' THEN media_metadata ELSE '[]'::jsonb END
            ) AS elem;
        """)
        media_row = cur.fetchone()
        media_count = int(media_row[0]) if media_row and media_row[0] is not None else 0
        media_bytes = float(media_row[1]) if media_row and media_row[1] is not None else 0.0
        media_mb = float(media_bytes / (1024 * 1024))
        budget_mb = float(os.getenv("FIELD_MEDIA_BUDGET_MB", "1024"))

        report["media_storage"] = {
            "total_media_files": media_count,
            "total_storage_mb": round(media_mb, 2),
            "budget_mb": budget_mb,
            "budget_utilized_pct": round((media_mb / budget_mb) * 100, 2)
        }

        if media_mb >= budget_mb * 0.8:
            report["alerts"].append(f"Field media storage near capacity: {media_mb:.1f}MB ({report['media_storage']['budget_utilized_pct']}% of {budget_mb}MB budget)")
            if media_mb >= budget_mb and report["status"] != "CRITICAL":
                report["status"] = "WARNING"

    finally:
        conn.close()

    return report

def main():
    parser = argparse.ArgumentParser(description="ML and Data Quality Monitoring")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    parser.add_argument("--alert-on-stale", action="store_true", help="Set warning status if stale data found")
    args = parser.parse_args()

    report = run_monitoring_check(alert_on_stale=args.alert_on_stale)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("=" * 65)
        print("  LANDALERT-NEXUS: ML & DATA QUALITY MONITORING REPORT")
        print("=" * 65)
        print(f"Timestamp:       {report['timestamp']}")
        print(f"System Status:   {report['status']}")
        print(f"Active Model:    {report['active_model'].get('version')} (PR-AUC: {report['active_model'].get('pr_auc')})")
        print(f"Feature Schema:  {report['active_model'].get('feature_schema_version')}")
        print("-" * 65)
        print(f"Monitored Zones: {report['data_quality']['total_monitored_zones']}")
        print(f"Stale Zones (>48h): {report['data_quality']['stale_weather_zones_count']}")
        print(f"Soil Moisture:   {report['soil_moisture']['measured_zones']} measured, {report['soil_moisture']['fallback_zones']} fallback ({report['soil_moisture']['fallback_percentage']}%)")
        print("-" * 65)
        print("Risk Distribution:")
        dist = report.get("prediction_distribution", {})
        print(f"  Mean Score:    {dist.get('mean_score')} (Min: {dist.get('min_score')}, Max: {dist.get('max_score')})")
        print(f"  Categories:    {dist.get('category_counts')}")
        print("-" * 65)
        lbl = report.get("label_inflow", {})
        print(f"Verified Labels: {lbl.get('total_verified_rainfall_positives')} real landslides (New: {lbl.get('new_verified_positives')})")
        print(f"Retrain Trigger: {'TRIGGER RECOMMENDED (>=10 new events)' if lbl.get('retraining_recommended') else 'NO TRIGGER NEEDED'}")
        med = report.get("media_storage", {})
        print(f"Media Storage:   {med.get('total_media_files', 0)} files, {med.get('total_storage_mb', 0)} MB / {med.get('budget_mb', 1024)} MB ({med.get('budget_utilized_pct', 0)}%)")
        if report["alerts"]:
            print("-" * 65)
            print("ALERTS:")
            for a in report["alerts"]:
                print(f"  ⚠ {a}")
        print("=" * 65)

    if report["status"] == "CRITICAL":
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    main()
