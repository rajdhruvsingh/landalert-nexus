"""
src/lib/ml/inference.py
=======================
Canonical production inference engine for LandAlert-Nexus.
Handles:
- Loading the active model artifact
- Extracting canonical 19 features with strict temporal cutoff
- Assessing data freshness and quality states (VALID, STALE, FALLBACK, MISSING, INVALID)
- Computing calibrated probability, operational risk score, and risk category
- Producing ranked, mathematically grounded feature attributions and dynamic explanations
"""

import os
import sys
import json
import math
import warnings
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import psycopg2

warnings.filterwarnings("ignore", category=UserWarning, module="pandas")
from dotenv import load_dotenv

try:
    from .features import (
        CANONICAL_FEATURES,
        FEATURE_SCHEMA_VERSION,
        extract_features_for_zone,
        validate_feature_vector,
    )
    from .artifact import load_model_artifact, ModelArtifact
except (ImportError, ValueError):
    sys.path.insert(0, os.path.dirname(__file__))
    from features import (
        CANONICAL_FEATURES,
        FEATURE_SCHEMA_VERSION,
        extract_features_for_zone,
        validate_feature_vector,
    )
    from artifact import load_model_artifact, ModelArtifact

load_dotenv()
_raw_db_url = os.getenv("DATABASE_URL")
DATABASE_URL = _raw_db_url.strip() if _raw_db_url and _raw_db_url.strip() else None

class LandslideRiskInferenceEngine:
    def __init__(self, artifact_path: str = "models/v0.2-lr-trained.json"):
        self.artifact_path = artifact_path
        self.artifact = load_model_artifact(artifact_path)

    def predict_zone(self, zone_id: int, as_of_date=None, conn=None) -> dict:
        """
        Executes end-to-end inference for a specific risk zone as of a given timestamp.
        Returns a rich prediction response containing scores, levels, factor attributions,
        provenance, and data quality states.
        """
        close_conn = False
        if conn is None:
            if not DATABASE_URL:
                if _is_production:
                    raise RuntimeError("Production DATABASE_URL is not configured")
                raise RuntimeError("DATABASE_URL is not configured")
            conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
            close_conn = True

        as_of = pd.Timestamp.now(tz=timezone.utc) if as_of_date is None else pd.Timestamp(as_of_date)

        try:
            # 1. Load zone
            zones_df = pd.read_sql("SELECT * FROM public.risk_zones WHERE id = %s;", conn, params=(zone_id,))
            if zones_df.empty:
                return {
                    "status": "INVALID",
                    "error": f"Zone id {zone_id} not found",
                    "inference_timestamp": datetime.now(timezone.utc).isoformat(),
                }
            z_row = zones_df.iloc[0]

            # 2. Load weather up to as_of
            weather_df = pd.read_sql("""
                SELECT zone_id, reading_time::date AS reading_date,
                       SUM(rainfall_mm) AS rainfall_mm,
                       MAX(soil_moisture_pct) FILTER (WHERE soil_moisture_pct IS NOT NULL) AS soil_moisture_pct,
                       MAX(reading_time) as latest_reading_time
                FROM public.weather_readings
                WHERE zone_id = %s AND reading_time < %s
                GROUP BY zone_id, reading_time::date
                ORDER BY reading_date;
            """, conn, params=(zone_id, as_of))

            if weather_df.empty:
                return {
                    "status": "MISSING",
                    "error": f"No weather readings found for zone {zone_id} before {as_of}",
                    "zone_id": zone_id,
                    "zone_name": str(z_row["zone_name"]),
                    "inference_timestamp": datetime.now(timezone.utc).isoformat(),
                }

            # 3. Load real historical events for proximity
            real_events_df = pd.read_sql("""
                SELECT id, lat, lng, event_date
                FROM public.historical_landslides
                WHERE is_synthetic = false AND hazard_type = 'rainfall_slope_failure'
                ORDER BY event_date;
            """, conn)

            # 4. Extract canonical features
            feats, meta = extract_features_for_zone(z_row, as_of, weather_df, real_events_df)
            if feats is None:
                return {
                    "status": "MISSING",
                    "error": "Insufficient weather history for feature extraction (<30d)",
                    "zone_id": zone_id,
                    "inference_timestamp": datetime.now(timezone.utc).isoformat(),
                }

            # 5. Evaluate data quality & freshness state
            latest_wx_time = weather_df["latest_reading_time"].max()
            if latest_wx_time is not None:
                ts = pd.Timestamp(latest_wx_time)
                if ts.tzinfo is not None:
                    ts = ts.tz_convert(timezone.utc)
                else:
                    ts = ts.tz_localize(timezone.utc)
                as_of_utc = as_of if as_of.tzinfo is not None else as_of.tz_localize(timezone.utc)
                wx_age_hours = (as_of_utc - ts).total_seconds() / 3600.0
            else:
                wx_age_hours = 999.0
            sm_status = meta["soil_moisture_status"]

            if wx_age_hours > 72.0:
                data_state = "STALE"
            elif sm_status == "fallback":
                data_state = "FALLBACK"
            else:
                data_state = "VALID"

            # 6. Execute ML prediction
            proba = self.artifact.predict_proba(feats)
            risk_score, risk_level = self.artifact.compute_risk_score(proba)
            explanation = self.artifact.explain(feats)

            # 7. Construct dynamic explanation text
            top_cat = explanation["top_categories"][0]["category"].replace("_", " ")
            secondary_cats = [c["category"].replace("_", " ") for c in explanation["top_categories"][1:3]]

            narrative = (
                f"Main risk driver: {top_cat}. Secondary contributors: {', '.join(secondary_cats)}. "
                f"Detail — 72-hr rainfall: {feats['rain_1d']:.1f}mm / 3-day {feats['rain_3d']:.1f}mm "
                f"(vs zone threshold ratio: {feats['rain_3d_vs_e_thr']:.2f}). "
                f"Soil moisture: {feats['soil_moisture_latest']*100.0:.1f}% ({sm_status}). "
                f"Terrain slope: {float(z_row.get('slope_p90_deg', z_row['mean_slope_deg'])):.1f}° (p90 hazard slope). "
                f"Model: {self.artifact.model_version} (ML Probability: {proba:.3f}). "
                f"Combined operational score: {risk_score}/100 → {risk_level}."
            )

            return {
                "status": data_state,
                "zone_id": zone_id,
                "zone_name": str(z_row["zone_name"]),
                "district": str(z_row["district"]),
                "state": str(z_row["state"]),
                "model_version": self.artifact.model_version,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "probability": round(proba, 4),
                "risk_score": risk_score,
                "risk_level": risk_level,
                "explanation_narrative": narrative,
                "factor_attribution": explanation,
                "canonical_features": feats,
                "data_freshness": {
                    "latest_weather_timestamp": str(latest_wx_time) if latest_wx_time else None,
                    "weather_age_hours": round(wx_age_hours, 1),
                    "soil_moisture_status": sm_status,
                },
                "inference_timestamp": datetime.now(timezone.utc).isoformat(),
            }

        finally:
            if close_conn:
                conn.close()

    def persist_prediction(self, pred: dict, conn=None) -> bool:
        """
        Persists an authoritative prediction into public.risk_predictions table with idempotency.
        """
        if pred.get("status") not in ("VALID", "FALLBACK", "STALE"):
            return False
        close_conn = False
        if conn is None:
            try:
                conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
                close_conn = True
            except Exception:
                return False
        try:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO public.risk_predictions (
                    zone_id, prediction_time, model_version, feature_schema_version,
                    probability, risk_score, risk_category, explanation,
                    data_quality, features
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (zone_id, prediction_time, model_version) DO UPDATE
                SET probability = EXCLUDED.probability,
                    risk_score = EXCLUDED.risk_score,
                    risk_category = EXCLUDED.risk_category,
                    explanation = EXCLUDED.explanation,
                    data_quality = EXCLUDED.data_quality,
                    features = EXCLUDED.features;
            """, (
                pred["zone_id"],
                pred["inference_timestamp"],
                pred["model_version"],
                pred["feature_schema_version"],
                pred["probability"],
                pred["risk_score"],
                pred["risk_level"],
                pred["explanation_narrative"],
                json.dumps(pred.get("data_freshness", {})),
                json.dumps(pred.get("canonical_features", {})),
            ))
            conn.commit()
            return True
        except Exception:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
            return False
        finally:
            if close_conn:
                conn.close()

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="LandAlert-Nexus Canonical ML Inference CLI")
    parser.add_argument("--zone", type=int, required=True, help="Zone ID (1-15)")
    parser.add_argument("--as-of", type=str, default=None, help="As-of ISO date (e.g. 2024-06-15)")
    parser.add_argument("--artifact", type=str, default="models/v0.2-lr-trained.json", help="Path to model artifact")
    parser.add_argument("--persist", action="store_true", help="Persist prediction record to database")
    args = parser.parse_args()

    engine = LandslideRiskInferenceEngine(artifact_path=args.artifact)
    res = engine.predict_zone(zone_id=args.zone, as_of_date=args.as_of)

    if args.persist and res.get("status") in ("VALID", "FALLBACK", "STALE"):
        engine.persist_prediction(res)

    print(json.dumps(res, indent=2, default=str))
