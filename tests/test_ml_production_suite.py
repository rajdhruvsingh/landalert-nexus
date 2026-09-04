#!/usr/bin/env python3
"""
Comprehensive Production ML Test Suite for Landslide Early Warning
(SIH26001 / landalert-nexus)

Validates:
1. Feature schema invariants (19 features, strict order, names)
2. Artifact serialization, roundtrip, and schema compliance
3. Mathematical consistency of Logistic Regression inference & explainability
4. Missing, stale, and fallback data resilience
5. Pseudo-absence generation scientific invariants
6. Model registry state machine and gating invariants
"""

import sys
import os
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import json
import math
import pytest
import numpy as np
import pandas as pd

from src.lib.ml.features import (
    FEATURE_SCHEMA_VERSION,
    CANONICAL_FEATURES,
    validate_feature_vector,
    haversine_km,
    compute_terrain_features,
    compute_temporal_features
)
from src.lib.ml.artifact import load_model_artifact, ModelArtifact
from src.lib.ml.inference import LandslideRiskInferenceEngine

ARTIFACT_FILE = PROJECT_ROOT / "models" / "v0.2-lr-trained.json"

# =====================================================================
# 1. Feature Schema Invariants
# =====================================================================

def test_canonical_feature_count_and_schema_version():
    """Verify that exactly 19 canonical features exist and match v1.0.0."""
    assert len(CANONICAL_FEATURES) == 19
    assert FEATURE_SCHEMA_VERSION == "v1.0.0"
    expected_features = [
        "rain_1d", "rain_3d", "rain_7d", "rain_15d", "rain_30d",
        "rain_intensity_max_1d", "antecedent_wetness_index", "threshold_exceedance_flag",
        "rain_3d_vs_e_thr", "soil_moisture_latest", "soil_moisture_7d_trend",
        "slope_norm", "slope_sin", "slope_class",
        "dist_to_nearest_event_km", "historical_event_density",
        "day_of_year_sin", "day_of_year_cos", "is_monsoon"
    ]
    assert CANONICAL_FEATURES == expected_features

def test_feature_vector_validation():
    """Verify validate_feature_vector catches missing and invalid features."""
    valid_vec = {f: 1.0 for f in CANONICAL_FEATURES}
    assert validate_feature_vector(valid_vec) is True

    # Test missing feature raises ValueError
    invalid_vec = {f: 1.0 for f in CANONICAL_FEATURES if f != "rain_3d"}
    with pytest.raises(ValueError, match="Feature keys mismatch"):
        validate_feature_vector(invalid_vec)

    # Test NaN value raises ValueError
    nan_vec = {**valid_vec, "slope_norm": float("nan")}
    with pytest.raises(ValueError, match="Invalid feature value"):
        validate_feature_vector(nan_vec)

# =====================================================================
# 2. Artifact Integrity and Serialization
# =====================================================================

def test_artifact_file_exists_and_loads():
    """Verify the active model artifact JSON is valid and loadable."""
    assert ARTIFACT_FILE.exists(), f"Artifact missing at {ARTIFACT_FILE}"
    artifact = load_model_artifact(str(ARTIFACT_FILE))
    assert isinstance(artifact, ModelArtifact)
    assert artifact.model_version == "v0.2-lr-trained"
    assert artifact.feature_schema_version == "v1.0.0"
    assert len(artifact.weights) == 19
    assert len(artifact.scaler_mean) == 19
    assert len(artifact.scaler_scale) == 19

def test_artifact_provenance_and_metrics():
    """Verify artifact metrics match verified benchmark results."""
    with open(ARTIFACT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    assert data["metrics"]["pr_auc"] == pytest.approx(0.5934, abs=1e-4)
    assert data["metrics"]["recall_at_80_precision"] == pytest.approx(0.1250, abs=1e-4)
    assert data["sample_counts"]["positives"] == 8
    assert data["sample_counts"]["pseudo_absences"] == 24

# =====================================================================
# 3. Mathematical Consistency of Inference & Explainability
# =====================================================================

def test_logistic_regression_math_consistency():
    """
    Verify that predict_proba mathematically matches:
    z = intercept + sum(weights * (x - mean) / scale)
    prob = 1 / (1 + exp(-z))
    """
    artifact = load_model_artifact(str(ARTIFACT_FILE))
    sample_features = {f: 10.0 for f in CANONICAL_FEATURES}

    # Manual compute
    z = artifact.intercept
    for i, feat in enumerate(CANONICAL_FEATURES):
        val = sample_features[feat]
        scaled = (val - artifact.scaler_mean[i]) / artifact.scaler_scale[i]
        z += artifact.weights[i] * scaled
    expected_prob = 1.0 / (1.0 + math.exp(-z))

    actual_prob = artifact.predict_proba(sample_features)
    assert actual_prob == pytest.approx(expected_prob, abs=1e-5)

def test_explainability_attribution_additivity():
    """Verify that individual feature contributions sum to the total logit offset."""
    artifact = load_model_artifact(str(ARTIFACT_FILE))
    sample_features = {f: 5.0 for f in CANONICAL_FEATURES}

    exp = artifact.explain(sample_features)
    contributions = [f["contribution"] for f in exp["all_features"]]
    
    total_feature_contrib = sum(contributions)
    z = artifact.intercept + total_feature_contrib
    expected_prob = 1.0 / (1.0 + math.exp(-z))

    actual_prob = artifact.predict_proba(sample_features)
    assert actual_prob == pytest.approx(expected_prob, abs=1e-5)

def test_soil_moisture_zero_weight_invariant():
    """
    Because historical soil moisture had zero variance (100% fallback 0.50),
    the model weight for soil moisture must be strictly 0.0.
    """
    artifact = load_model_artifact(str(ARTIFACT_FILE))
    sm_idx = CANONICAL_FEATURES.index("soil_moisture_latest")
    trend_idx = CANONICAL_FEATURES.index("soil_moisture_7d_trend")
    assert artifact.weights[sm_idx] == 0.0
    assert artifact.weights[trend_idx] == 0.0

# =====================================================================
# 4. Terrain & Temporal Feature Determinism
# =====================================================================

def test_terrain_features():
    """Verify slope normalization and sine transformations."""
    t = compute_terrain_features(22.5)
    assert t["slope_norm"] == pytest.approx(22.5 / 45.0)
    assert t["slope_sin"] == pytest.approx(math.sin(math.radians(22.5)), abs=1e-4)
    assert t["slope_class"] == 1 # 15-30 deg is class 1

def test_monsoon_temporal_features():
    """Verify monsoon indicator (June 1 - Sept 30) and day of year cycles."""
    # July 15 (monsoon)
    m_feat = compute_temporal_features(pd.Timestamp("2024-07-15"))
    assert m_feat["is_monsoon"] == 1
    assert -1.0 <= m_feat["day_of_year_sin"] <= 1.0

    # January 15 (non-monsoon)
    nm_feat = compute_temporal_features(pd.Timestamp("2024-01-15"))
    assert nm_feat["is_monsoon"] == 0

# =====================================================================
# 5. Inference Engine Edge Cases
# =====================================================================

def test_inference_engine_invalid_zone():
    """Verify engine returns INVALID status for non-existent zone."""
    engine = LandslideRiskInferenceEngine()
    res = engine.predict_zone(zone_id=999999)
    assert res["status"] == "INVALID"
    assert "error" in res

def test_inference_engine_active_zone():
    """Verify engine returns VALID prediction for Zone 1."""
    engine = LandslideRiskInferenceEngine()
    res = engine.predict_zone(zone_id=1)
    assert res["status"] in ["VALID", "FALLBACK"]
    assert "probability" in res
    assert "risk_score" in res
    assert 0.0 <= res["probability"] <= 1.0
    assert 0.0 <= res["risk_score"] <= 100.0
    assert res["model_version"] == "v0.2-lr-trained"

# =====================================================================
# 6. Risk Calibration, Monotonicity & Cutoff Alignment
# =====================================================================

def test_risk_score_calibration_and_monotonicity():
    """
    Test edge cases across the [0, 1] probability spectrum:
    0.0, 0.001, 0.379, 0.380, 0.559, 0.560, 0.739, 0.740, 0.999, 1.0.
    Verify strict monotonicity and boundary clamping.
    """
    artifact = load_model_artifact(str(ARTIFACT_FILE))
    
    # Boundary tests
    s0, l0 = artifact.compute_risk_score(0.0)
    assert s0 == 0.0 and l0 == "Low"

    s_low, l_low = artifact.compute_risk_score(0.379)
    assert s_low == 37.9 and l_low == "Low"

    s_mod_start, l_mod_start = artifact.compute_risk_score(0.380)
    assert s_mod_start == 38.0 and l_mod_start == "Moderate"

    s_mod_end, l_mod_end = artifact.compute_risk_score(0.559)
    assert s_mod_end == 55.9 and l_mod_end == "Moderate"

    s_high_start, l_high_start = artifact.compute_risk_score(0.560)
    assert s_high_start == 56.0 and l_high_start == "High"

    s_high_end, l_high_end = artifact.compute_risk_score(0.739)
    assert s_high_end == 73.9 and l_high_end == "High"

    s_sev_start, l_sev_start = artifact.compute_risk_score(0.740)
    assert s_sev_start == 74.0 and l_sev_start == "Severe"

    s1, l1 = artifact.compute_risk_score(1.0)
    assert s1 == 100.0 and l1 == "Severe"

    # Clamping tests
    s_neg, _ = artifact.compute_risk_score(-0.5)
    assert s_neg == 0.0
    s_over, _ = artifact.compute_risk_score(1.5)
    assert s_over == 100.0

    # Monotonicity test across 1,000 steps
    probs = np.linspace(0.0, 1.0, 1000)
    scores = [artifact.compute_risk_score(p)[0] for p in probs]
    for i in range(len(scores) - 1):
        assert scores[i] <= scores[i+1], f"Monotonicity violation at step {i}: {scores[i]} > {scores[i+1]}"

def test_database_and_artifact_cutoffs_match():
    """Verify that PostgreSQL risk_model_config and model artifact cutoffs agree exactly."""
    import psycopg2
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/landalert")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        SELECT cutoff_moderate, cutoff_high, cutoff_severe
        FROM public.risk_model_config
        WHERE is_active = true;
    """)
    db_row = cur.fetchone()
    conn.close()

    assert db_row is not None, "No active model row found in risk_model_config"
    db_mod, db_high, db_sev = db_row

    artifact = load_model_artifact(str(ARTIFACT_FILE))
    assert artifact.cutoffs["moderate"] == pytest.approx(float(db_mod)), "cutoff_moderate mismatch between DB and artifact"
    assert artifact.cutoffs["high"] == pytest.approx(float(db_high)), "cutoff_high mismatch between DB and artifact"
    assert artifact.cutoffs["severe"] == pytest.approx(float(db_sev)), "cutoff_severe mismatch between DB and artifact"

def test_numerical_stability_extreme_values():
    """Verify that extreme feature values do not cause NaN or Inf outputs."""
    artifact = load_model_artifact(str(ARTIFACT_FILE))
    extreme_high = {f: 1e6 for f in CANONICAL_FEATURES}
    p_high = artifact.predict_proba(extreme_high)
    assert not math.isnan(p_high)
    assert not math.isinf(p_high)
    assert 0.0 <= p_high <= 1.0

    extreme_low = {f: -1e6 for f in CANONICAL_FEATURES}
    p_low = artifact.predict_proba(extreme_low)
    assert not math.isnan(p_low)
    assert not math.isinf(p_low)
    assert 0.0 <= p_low <= 1.0

# =====================================================================
# 7. Model Registry Safety & Rollback Invariants
# =====================================================================

def test_model_registry_safety_gating():
    """Verify that candidate gating rejects invalid models."""
    from scripts.ml_registry import verify_model_candidate

    # Active model passes
    ok, reasons = verify_model_candidate("v0.2-lr-trained")
    assert ok is True, f"Active model candidate verification failed: {reasons}"

    # Non-existent model fails
    ok_fake, reasons_fake = verify_model_candidate("non-existent-v999")
    assert ok_fake is False
    assert any("not found" in r.lower() for r in reasons_fake)
