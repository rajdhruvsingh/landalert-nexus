"""
src/lib/ml/artifact.py
======================
Model artifact serialization, deserialization, and deterministic inference.
Supports:
  - LogisticRegression (v0.4): versioned JSON with weights/scaler stored inline.
  - RFXGBEnsemble (v0.5): JSON metadata + companion joblib files for RF and XGBoost models,
    with 50/50 probability blend and averaged MDI+gain feature attributions.
"""

import json
import os
import math
from datetime import datetime, timezone
import numpy as np

try:
    from .features import CANONICAL_FEATURES, FEATURE_SCHEMA_VERSION, validate_feature_vector
except (ImportError, ValueError):
    from features import CANONICAL_FEATURES, FEATURE_SCHEMA_VERSION, validate_feature_vector


# ---------------------------------------------------------------------------
# Category grouping shared by both model types
# ---------------------------------------------------------------------------
_CATEGORY_FEATURES = {
    "rainfall_intensity": {"rain_1d", "rain_3d", "rain_intensity_max_1d", "threshold_exceedance_flag"},
    "antecedent_wetness": {"rain_7d", "rain_15d", "rain_30d", "antecedent_wetness_index", "rain_3d_vs_e_thr"},
    "soil_moisture": {"soil_moisture_latest", "soil_moisture_7d_trend"},
    "terrain_slope": {"slope_norm", "slope_sin", "slope_class"},
    "historical_proximity": {"dist_to_nearest_event_km", "historical_event_density"},
    "seasonality": {"day_of_year_sin", "day_of_year_cos", "is_monsoon"},
}


class ModelArtifact:
    """Encapsulates a trained, versioned model artifact.

    Transparent dispatch: behaves identically from the caller's perspective
    regardless of whether the underlying model is LogisticRegression or
    RFXGBEnsemble.
    """

    def __init__(self, data: dict, artifact_dir: str = None):
        self.data = data
        self.model_version = data["model_version"]
        self.model_type = data["model_type"]
        self.feature_schema_version = data["feature_schema_version"]
        self.feature_names = data["feature_names"]
        self.dataset_fingerprint = data.get("dataset_fingerprint", "")
        self.metrics = data.get("metrics", {})
        self.cutoffs = data.get("cutoffs", {"moderate": 42.0, "high": 58.0, "severe": 72.0})

        # Shared scaler parameters (both model types use StandardScaler)
        self.scaler_mean = np.array(data["parameters"]["scaler_mean"], dtype=np.float64)
        self.scaler_scale = np.array(data["parameters"]["scaler_scale"], dtype=np.float64)

        if self.model_type == "LogisticRegression":
            self._init_logistic_regression(data)
        elif self.model_type == "RFXGBEnsemble":
            self._init_rf_xgb_ensemble(data, artifact_dir)
        else:
            raise ValueError(
                f"Unsupported model_type '{self.model_type}'. "
                "Expected 'LogisticRegression' or 'RFXGBEnsemble'."
            )

    # ------------------------------------------------------------------
    # Initialization helpers
    # ------------------------------------------------------------------

    def _init_logistic_regression(self, data: dict) -> None:
        """Loads LR weights and intercept from the artifact JSON."""
        self.weights = np.array(data["parameters"]["weights"], dtype=np.float64)
        self.intercept = float(data["parameters"]["intercept"])

    def _init_rf_xgb_ensemble(self, data: dict, artifact_dir: str = None) -> None:
        """
        Loads RF and XGBoost calibrated classifiers from companion joblib files.
        Companion paths in the JSON are relative to the project root (cwd).
        artifact_dir overrides the base directory if provided.
        """
        try:
            import joblib
        except ImportError:
            raise ImportError("joblib is required for RFXGBEnsemble artifacts. Run: pip install joblib")

        params = data["parameters"]
        companion = data.get("companion_files", {})

        base_dir = artifact_dir or os.getcwd()

        rf_rel = companion.get("rf_model", "")
        xgb_rel = companion.get("xgb_model", "")

        rf_path = rf_rel if os.path.isabs(rf_rel) else os.path.join(base_dir, rf_rel)
        xgb_path = xgb_rel if os.path.isabs(xgb_rel) else os.path.join(base_dir, xgb_rel)

        if not os.path.isfile(rf_path):
            raise FileNotFoundError(
                f"RF companion model not found: {rf_path}\n"
                "Re-run training: python3 -m src.lib.ml.train_v05"
            )
        if not os.path.isfile(xgb_path):
            raise FileNotFoundError(
                f"XGBoost companion model not found: {xgb_path}\n"
                "Re-run training: python3 -m src.lib.ml.train_v05"
            )

        self.rf_model = joblib.load(rf_path)
        self.xgb_model = joblib.load(xgb_path)

        self.ensemble_weights = data.get("ensemble_weights", {"rf": 0.5, "xgb": 0.5})
        self.rf_importances = np.array(
            params.get("rf_feature_importances", [1.0 / len(self.feature_names)] * len(self.feature_names)),
            dtype=np.float64,
        )
        self.xgb_importances = np.array(
            params.get("xgb_feature_importances", [1.0 / len(self.feature_names)] * len(self.feature_names)),
            dtype=np.float64,
        )
        # Blended importance: weighted average of RF MDI + XGBoost gain
        w_rf = self.ensemble_weights.get("rf", 0.5)
        w_xgb = self.ensemble_weights.get("xgb", 0.5)
        blended_raw = w_rf * self.rf_importances + w_xgb * self.xgb_importances
        total = blended_raw.sum()
        self.blended_importances = blended_raw / max(total, 1e-12)

    # ------------------------------------------------------------------
    # Public inference API (identical signature for both model types)
    # ------------------------------------------------------------------

    def predict_proba(self, feature_vector: dict) -> float:
        """Computes P(landslide=1). Dispatches to the appropriate model path."""
        validate_feature_vector(feature_vector)
        x = np.array([feature_vector[k] for k in self.feature_names], dtype=np.float64)
        x_scaled = (x - self.scaler_mean) / np.where(self.scaler_scale == 0, 1.0, self.scaler_scale)

        if self.model_type == "LogisticRegression":
            z = self.intercept + np.dot(self.weights, x_scaled)
            # Numerically stable sigmoid
            return float(1.0 / (1.0 + np.exp(-np.clip(z, -30.0, 30.0))))

        elif self.model_type == "RFXGBEnsemble":
            rf_p = float(self.rf_model.predict_proba(x_scaled.reshape(1, -1))[0, 1])
            xgb_p = float(self.xgb_model.predict_proba(x_scaled.reshape(1, -1))[0, 1])
            w_rf = self.ensemble_weights.get("rf", 0.5)
            w_xgb = self.ensemble_weights.get("xgb", 0.5)
            return float(w_rf * rf_p + w_xgb * xgb_p)

        raise RuntimeError(f"predict_proba not implemented for model_type={self.model_type}")

    def explain(self, feature_vector: dict) -> dict:
        """
        Computes feature attributions and groups them into emergency-management categories.

        For LogisticRegression: exact linear contributions c_i = w_i × (x_i − μ_i) / σ_i
        For RFXGBEnsemble: importance-weighted scaled deviations
            c_i = blended_importance_i × scaled_x_i  (proxy, not exact SHAP)
        """
        validate_feature_vector(feature_vector)
        x = np.array([feature_vector[k] for k in self.feature_names], dtype=np.float64)
        x_scaled = (x - self.scaler_mean) / np.where(self.scaler_scale == 0, 1.0, self.scaler_scale)

        if self.model_type == "LogisticRegression":
            contributions = self.weights * x_scaled

        elif self.model_type == "RFXGBEnsemble":
            # Importance-weighted scaled deviation: preserves direction and magnitude ordering
            contributions = self.blended_importances * x_scaled
        else:
            contributions = np.zeros_like(x_scaled)

        feat_contrib = []
        for i, fname in enumerate(self.feature_names):
            feat_contrib.append({
                "feature": fname,
                "value": float(x[i]),
                "scaled_value": float(x_scaled[i]),
                "weight": float(
                    self.weights[i] if self.model_type == "LogisticRegression"
                    else self.blended_importances[i]
                ),
                "contribution": float(contributions[i]),
                "direction": "increases_risk" if contributions[i] > 0 else "decreases_risk",
            })

        # Rank by absolute contribution magnitude
        feat_contrib.sort(key=lambda item: abs(item["contribution"]), reverse=True)

        # Categorical grouping
        category_scores: dict[str, float] = {}
        for cat, feat_set in _CATEGORY_FEATURES.items():
            category_scores[cat] = sum(
                c["contribution"] for c in feat_contrib if c["feature"] in feat_set
            )

        top_factors = sorted(category_scores.items(), key=lambda kv: abs(kv[1]), reverse=True)

        return {
            "top_categories": [{"category": k, "net_contribution": float(v)} for k, v in top_factors],
            "top_features": feat_contrib[:5],
            "all_features": feat_contrib,
        }

    def compute_risk_score(self, proba: float) -> tuple:
        """
        Maps probability to an operational risk score (0-100) and risk category.
        Score = proba × 100 clamped to [0, 100].
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


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def save_model_artifact(
    file_path: str,
    model_version: str,
    model_type: str,
    weights: list,
    intercept: float,
    scaler_mean: list,
    scaler_scale: list,
    metrics: dict,
    dataset_fingerprint: str,
    sample_counts: dict,
    git_commit: str,
    notes: str = "",
) -> str:
    """Serializes a LogisticRegression model artifact to JSON with complete metadata."""
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
            "moderate": 38.0,
            "high": 56.0,
            "severe": 74.0,
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


def load_model_artifact(file_path: str, artifact_dir: str = None) -> ModelArtifact:
    """
    Loads and validates a ModelArtifact from disk.

    artifact_dir: base directory for resolving companion joblib paths in
        RFXGBEnsemble artifacts. Defaults to os.getcwd() (project root).
    """
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Model artifact not found: {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if data.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
        raise ValueError(
            f"Schema version mismatch: expected {FEATURE_SCHEMA_VERSION}, "
            f"got {data.get('feature_schema_version')}"
        )
    if data.get("feature_names") != CANONICAL_FEATURES:
        raise ValueError("Artifact feature names mismatch canonical feature list")

    return ModelArtifact(data, artifact_dir=artifact_dir)
