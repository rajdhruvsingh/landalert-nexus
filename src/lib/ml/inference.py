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

import os, sys, math
from datetime import datetime, timezone
import pandas as pd
import psycopg2
from dotenv import load_dotenv

from .features import (
    CANONICAL_FEATURES,
    FEATURE_SCHEMA_VERSION,
    extract_features_for_zone,
    validate_feature_vector,
)
from .artifact import load_model_artifact, ModelArtifact

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/landalert")

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
            conn = psycopg2.connect(DATABASE_URL)
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
                f"Mean terrain slope: {float(z_row['mean_slope_deg']):.1f}°. "
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
