"""
src/lib/ml/artifact.py
======================
Model artifact serialization, deserialization, and deterministic inference.
Supports versioned JSON artifacts with full cryptographic provenance.
"""

import json, os, math
from datetime import datetime, timezone
import numpy as np
from .features import CANONICAL_FEATURES, FEATURE_SCHEMA_VERSION, validate_feature_vector

class ModelArtifact:
    """Encapsulates a trained, versioned model artifact."""
    def __init__(self, data: dict):
        self.data = data
        self.model_version = data["model_version"]
        self.model_type = data["model_type"]
        self.feature_schema_version = data["feature_schema_version"]
        self.feature_names = data["feature_names"]
        self.dataset_fingerprint = data["dataset_fingerprint"]
        self.metrics = data["metrics"]
        self.weights = np.array(data["parameters"]["weights"], dtype=np.float64)
        self.intercept = float(data["parameters"]["intercept"])
        self.scaler_mean = np.array(data["parameters"]["scaler_mean"], dtype=np.float64)
        self.scaler_scale = np.array(data["parameters"]["scaler_scale"], dtype=np.float64)
        self.cutoffs = data.get("cutoffs", {"moderate": 42.0, "high": 58.0, "severe": 72.0})

    def predict_proba(self, feature_vector: dict) -> float:
        """Computes calibrated probability P(landslide=1) via logistic sigmoid."""
        validate_feature_vector(feature_vector)
        x = np.array([feature_vector[k] for k in self.feature_names], dtype=np.float64)
        x_scaled = (x - self.scaler_mean) / np.where(self.scaler_scale == 0, 1.0, self.scaler_scale)
        z = self.intercept + np.dot(self.weights, x_scaled)
        # Numerically stable sigmoid
        proba = float(1.0 / (1.0 + np.exp(-np.clip(z, -30.0, 30.0))))
        return proba

    def explain(self, feature_vector: dict) -> dict:
        """
        Computes exact linear contributions c_i = w_i * (x_i - mean_i) / scale_i
        and groups them into high-level emergency management categories.
        """
        validate_feature_vector(feature_vector)
        x = np.array([feature_vector[k] for k in self.feature_names], dtype=np.float64)
        x_scaled = (x - self.scaler_mean) / np.where(self.scaler_scale == 0, 1.0, self.scaler_scale)
        contributions = self.weights * x_scaled

        feat_contrib = []
        for i, fname in enumerate(self.feature_names):
            feat_contrib.append({
                "feature": fname,
                "value": float(x[i]),
                "scaled_value": float(x_scaled[i]),
                "weight": float(self.weights[i]),
                "contribution": float(contributions[i]),
                "direction": "increases_risk" if contributions[i] > 0 else "decreases_risk",
            })

        # Rank by absolute contribution
        feat_contrib.sort(key=lambda item: abs(item["contribution"]), reverse=True)

        # Categorical grouping
        category_scores = {
            "rainfall_intensity": sum(c["contribution"] for c in feat_contrib if c["feature"] in ["rain_1d", "rain_3d", "rain_intensity_max_1d", "threshold_exceedance_flag"]),
            "antecedent_wetness": sum(c["contribution"] for c in feat_contrib if c["feature"] in ["rain_7d", "rain_15d", "rain_30d", "antecedent_wetness_index", "rain_3d_vs_e_thr"]),
            "soil_moisture": sum(c["contribution"] for c in feat_contrib if "soil" in c["feature"]),
            "terrain_slope": sum(c["contribution"] for c in feat_contrib if "slope" in c["feature"]),
            "historical_proximity": sum(c["contribution"] for c in feat_contrib if "event" in c["feature"]),
            "seasonality": sum(c["contribution"] for c in feat_contrib if "monsoon" in c["feature"] or "day_of_year" in c["feature"]),
        }

        top_factors = sorted(category_scores.items(), key=lambda kv: abs(kv[1]), reverse=True)

        return {
            "top_categories": [{"category": k, "net_contribution": float(v)} for k, v in top_factors],
            "top_features": feat_contrib[:5],
            "all_features": feat_contrib,
        }

    def compute_risk_score(self, proba: float) -> tuple:
        """
        Maps probability to an operational risk score (0-100) and risk category.
        Score = proba * 100 clamped to [0, 100].
        """
        score = round(min(max(proba * 100.0, 0.0), 100.0), 1)
        if score >= self.cutoffs["severe"]:
            lvl = "Severe"
        elif score >= self.cutoffs["high"]:
            lvl = "High"
        elif score >= self.cutoffs["moderate"]:
            lvl = "Moderate"
        else:
            lvl = "Low"
        return score, lvl

def save_model_artifact(file_path: str, model_version: str, model_type: str,
                        weights: list, intercept: float, scaler_mean: list, scaler_scale: list,
                        metrics: dict, dataset_fingerprint: str, sample_counts: dict,
                        git_commit: str, notes: str = "") -> str:
    """Serializes a model artifact to JSON with complete metadata."""
    artifact_dict = {
        "model_version": model_version,
        "model_type": model_type,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": CANONICAL_FEATURES,
        "parameters": {
            "weights": [float(w) for w in weights],
            "intercept": float(intercept),
            "scaler_mean": [float(m) for m in scaler_mean],
            "scaler_scale": [float(s) for s in scaler_scale],
        },
        "cutoffs": {
            "moderate": 42.0,
            "high": 58.0,
            "severe": 72.0,
        },
        "metrics": metrics,
        "dataset_fingerprint": dataset_fingerprint,
        "sample_counts": sample_counts,
        "provenance": {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "git_commit": git_commit,
            "notes": notes,
        },
    }

    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(artifact_dict, f, indent=2)

    return file_path

def load_model_artifact(file_path: str) -> ModelArtifact:
    """Loads and validates a ModelArtifact from disk."""
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Model artifact not found: {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if data.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
        raise ValueError(
            f"Schema version mismatch: expected {FEATURE_SCHEMA_VERSION}, got {data.get('feature_schema_version')}"
        )
    if data.get("feature_names") != CANONICAL_FEATURES:
        raise ValueError("Artifact feature names mismatch canonical feature list")

    return ModelArtifact(data)
