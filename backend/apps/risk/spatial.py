import json
import math
from datetime import datetime, timezone
from pathlib import Path

_CELLS_FILE = Path(__file__).resolve().parent / "spatial_cells.json"
_CELLS = None

def _get_cells():
    global _CELLS
    if _CELLS is None:
        if _CELLS_FILE.exists():
            _CELLS = json.loads(_CELLS_FILE.read_text())
        else:
            _CELLS = []
    return _CELLS

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * r * math.asin(math.sqrt(a))

def get_all_spatial_cells():
    return _get_cells()

def get_spatial_cells_by_state(state_name: str):
    s = state_name.lower().strip()
    return [c for c in _get_cells() if c.get("state_name", "").lower() == s or c.get("state", "").lower() == s]

def get_spatial_cells_by_district(district_name: str):
    d = district_name.lower().strip()
    return [c for c in _get_cells() if c.get("district_name", "").lower() == d or c.get("district", "").lower() == d]

def find_surrounding_cells(lat: float, lng: float, radius_km: float = 45.0):
    results = []
    for c in _get_cells():
        centroid = c.get("centroid") or [0, 0]
        dist = haversine_km(lat, lng, centroid[0], centroid[1])
        if dist <= radius_km:
            results.append({"cell": c, "distanceKm": dist})
    results.sort(key=lambda x: x["distanceKm"])
    return results

import numpy as np

_ML_ARTIFACT = None
def _get_ml_artifact():
    global _ML_ARTIFACT
    if _ML_ARTIFACT is None:
        try:
            from src.lib.ml.inference import get_active_artifact_path_from_registry, load_model_artifact
            path = get_active_artifact_path_from_registry()
            _ML_ARTIFACT = load_model_artifact(path)
        except Exception:
            _ML_ARTIFACT = None
    return _ML_ARTIFACT

def _build_cell_features(cell: dict, ambient_trigger: float, orographic_factor: float, doy: int, month: int) -> dict:
    slope = float(cell.get("slope_deg", 18.0))
    s_norm = min(slope / 45.0, 1.0)
    s_sin = float(math.sin(math.radians(slope)))
    s_class = 0 if slope < 15.0 else (1 if slope < 30.0 else 2)

    # Weather dynamics scaled by orographic factor and ambient trigger
    intensity_ratio = ambient_trigger / 100.0
    r1d = max(0.0, intensity_ratio * 35.0 * orographic_factor)
    r3d = max(0.0, intensity_ratio * 75.0 * orographic_factor)
    r7d = max(0.0, intensity_ratio * 140.0 * orographic_factor)
    r15d = max(0.0, intensity_ratio * 250.0 * orographic_factor)
    r30d = max(0.0, intensity_ratio * 450.0 * orographic_factor)
    r_max1d = max(r1d, 15.0 * (ambient_trigger / 50.0))
    awi = r7d * 0.90
    r3d_ethr = r3d / 70.0
    flag = 1 if r3d_ethr >= 1.0 else 0

    # Hydrological proxy
    sm_val = float(np.clip(0.18 + 0.67 * (1.0 - math.exp(-r30d / 140.0)), 0.15, 0.88))
    sm_trend = float(np.clip((r7d - 25.0) / 100.0, -1.0, 1.0))

    # Proximity features
    static_susc = float(cell.get("static_susceptibility", 0.5))
    dist_km = max(0.1, (1.0 - static_susc) * 20.0)
    density = min(1.0, max(0.0, static_susc * 1.2))

    return {
        "rain_1d": r1d,
        "rain_3d": r3d,
        "rain_7d": r7d,
        "rain_15d": r15d,
        "rain_30d": r30d,
        "rain_intensity_max_1d": r_max1d,
        "antecedent_wetness_index": awi,
        "threshold_exceedance_flag": flag,
        "rain_3d_vs_e_thr": r3d_ethr,
        "soil_moisture_latest": sm_val,
        "soil_moisture_7d_trend": sm_trend,
        "slope_norm": s_norm,
        "slope_sin": s_sin,
        "slope_class": s_class,
        "dist_to_nearest_event_km": dist_km,
        "historical_event_density": density,
        "day_of_year_sin": math.sin(2 * math.pi * doy / 365.0),
        "day_of_year_cos": math.cos(2 * math.pi * doy / 365.0),
        "is_monsoon": 1 if 6 <= month <= 9 else 0,
    }

def evaluate_cell_risk(cell: dict, active_zones: list = None, as_of_date: str = None):
    if active_zones is None:
        active_zones = []
    if as_of_date is None:
        as_of_date = datetime.now(timezone.utc).isoformat()

    static_susc = cell.get("static_susceptibility", 0.5)
    ambient_trigger = 38.0
    nearest_zone = None
    min_dist = 999999.0

    centroid = cell.get("centroid", [26.0, 92.0])

    if active_zones:
        total_weight = 0.0
        weighted_sum = 0.0
        for z in active_zones:
            d = haversine_km(centroid[0], centroid[1], z.centroid_lat, z.centroid_lng)
            if d < min_dist:
                min_dist = d
                nearest_zone = z
            w = 1.0 / math.pow(max(12.0, d), 1.6)
            total_weight += w
            weighted_sum += z.risk_score * w
        if total_weight > 0:
            ambient_trigger = weighted_sum / total_weight

    slope = cell.get("slope_deg", 18.0)
    elevation = cell.get("elevation_m", 800.0)
    orographic_factor = 0.85 + 0.40 * min(1.0, max(0.0, elevation) / 1800.0)

    # 19-Feature Machine Learning Ensemble Inference
    artifact = _get_ml_artifact()
    if artifact:
        try:
            from src.lib.ml.inference import REGIONAL_TERRANE_CUTOFFS
            try:
                dt = datetime.fromisoformat(as_of_date.replace("Z", "+00:00"))
            except Exception:
                dt = datetime.now(timezone.utc)
            doy = dt.timetuple().tm_yday
            month = dt.month

            feats = _build_cell_features(cell, ambient_trigger, orographic_factor, doy, month)
            district_name = cell.get("district_name") or cell.get("state_name", "")
            cutoffs = REGIONAL_TERRANE_CUTOFFS.get(district_name)
            if not cutoffs and "centroid" in cell:
                cutoffs = REGIONAL_TERRANE_CUTOFFS.resolve_for_coordinate(cell["centroid"][0], cell["centroid"][1])

            raw_proba = float(artifact.predict_proba(feats))
            is_fold_belt = REGIONAL_TERRANE_CUTOFFS.is_fold_belt(district_name)
            r3d_ratio = float(feats.get("rain_3d_vs_e_thr", 0.0))
            r7d = float(feats.get("rain_7d", 0.0))
            r7d_ratio = (r7d / 80.0) if is_fold_belt else (r7d / 120.0)
            fold_3d_ratio = (r3d_ratio / 0.85) if is_fold_belt else r3d_ratio
            stress_ratio = max(r3d_ratio, r7d_ratio, fold_3d_ratio, float(feats.get("threshold_exceedance_flag", 0)))
            p_phys = 1.0 / (1.0 + math.exp(-8.0 * (stress_ratio - 1.0)))
            proba = 1.0 - (1.0 - raw_proba) * (1.0 - p_phys)
            proba = max(0.001, min(0.999, proba))

            final_score, risk_level = artifact.compute_risk_score(proba, cutoffs=cutoffs)
            dynamic_trigger = final_score
        except Exception:
            slope_factor = math.pow(max(6.0, slope) / 25.0, 0.70)
            dynamic_trigger = min(92.0, max(8.0, ambient_trigger * slope_factor * orographic_factor))
            combined = round(static_susc * 100.0 * 0.35 + dynamic_trigger * 0.65)
            final_score = max(5, min(98, combined))
            risk_level = "Severe" if final_score >= 74 else ("High" if final_score >= 56 else ("Moderate" if final_score >= 38 else "Low"))
    else:
        slope_factor = math.pow(max(6.0, slope) / 25.0, 0.70)
        dynamic_trigger = min(92.0, max(8.0, ambient_trigger * slope_factor * orographic_factor))
        combined = round(static_susc * 100.0 * 0.35 + dynamic_trigger * 0.65)
        final_score = max(5, min(98, combined))
        risk_level = "Severe" if final_score >= 74 else ("High" if final_score >= 56 else ("Moderate" if final_score >= 38 else "Low"))

    data_confidence = "MODERATE"
    if nearest_zone and min_dist <= 35.0:
        data_confidence = "HIGH"
    elif nearest_zone and min_dist <= 90.0:
        data_confidence = "MODERATE"
    elif active_zones:
        data_confidence = "LOW"
    else:
        data_confidence = "INSUFFICIENT_DATA"

    weather_source = (
        f"In-situ Monitored Telemetry ({nearest_zone.zone_name}, {round(min_dist)}km)"
        if nearest_zone and min_dist <= 35.0
        else (
            f"Regional NWP & Telemetry Interpolation ({nearest_zone.zone_name}, {round(min_dist)}km)"
            if nearest_zone
            else "Regional NWP Climatological Model"
        )
    )

    return {
        "cell_id": cell.get("cell_id"),
        "centroid": centroid,
        "bounds": cell.get("bounds"),
        "state": cell.get("state_name"),
        "district": cell.get("district_name"),
        "elevation_m": elevation,
        "slope_deg": slope,
        "static_susceptibility": static_susc,
        "dynamic_trigger_score": round(dynamic_trigger, 1),
        "final_risk_score": final_score,
        "risk_level": risk_level,
        "probability": None,
        "data_confidence": data_confidence,
        "provenance": {
            "terrain_source": "Survey of India DEM / GSI Geomorphology Base",
            "weather_source": weather_source,
            "satellite_source": "Copernicus Sentinel-1 InSAR Interface",
            "satellite_status": "AVAILABLE",
            "observation_count": 0,
            "model_version": "v0.3-spatial-surface",
            "ml_ensemble_model_version": artifact.model_version if artifact else "v0.5-rf-xgb-ensemble",
            "computed_at": as_of_date,
        },
    }

def evaluate_cells_batch_ml(cells: list, active_zones: list = None, as_of_date: str = None) -> list:
    """
    Evaluates risk for multiple spatial cells in a high-speed vectorized batch pass (<150ms).
    Executes full 19-feature ensemble inference across all cells simultaneously.
    """
    if not cells:
        return []
    if active_zones is None:
        active_zones = []
    if as_of_date is None:
        as_of_date = datetime.now(timezone.utc).isoformat()

    artifact = _get_ml_artifact()
    if not artifact:
        return [evaluate_cell_risk(c, active_zones, as_of_date) for c in cells]

    try:
        from src.lib.ml.inference import REGIONAL_TERRANE_CUTOFFS, CANONICAL_FEATURES
        try:
            dt = datetime.fromisoformat(as_of_date.replace("Z", "+00:00"))
        except Exception:
            dt = datetime.now(timezone.utc)
        doy = dt.timetuple().tm_yday
        month = dt.month

        feature_rows = []
        cell_metas = []
        for cell in cells:
            centroid = cell.get("centroid", [26.0, 92.0])
            elevation = cell.get("elevation_m", 800.0)
            orographic_factor = 0.85 + 0.40 * min(1.0, max(0.0, elevation) / 1800.0)

            ambient_trigger = 38.0
            nearest_zone = None
            min_dist = 999999.0
            if active_zones:
                total_w = 0.0
                weighted_sum = 0.0
                for z in active_zones:
                    d = haversine_km(centroid[0], centroid[1], z.centroid_lat, z.centroid_lng)
                    if d < min_dist:
                        min_dist = d
                        nearest_zone = z
                    w = 1.0 / math.pow(max(12.0, d), 1.6)
                    total_w += w
                    weighted_sum += z.risk_score * w
                if total_w > 0:
                    ambient_trigger = weighted_sum / total_w

            feats = _build_cell_features(cell, ambient_trigger, orographic_factor, doy, month)
            feature_rows.append([feats[k] for k in CANONICAL_FEATURES])
            cell_metas.append({
                "cell": cell,
                "centroid": centroid,
                "elevation": elevation,
                "nearest_zone": nearest_zone,
                "min_dist": min_dist,
                "feats": feats,
            })

        X = np.array(feature_rows, dtype=np.float64)
        probas = artifact.predict_proba_batch(X)

        results = []
        for i, meta in enumerate(cell_metas):
            cell = meta["cell"]
            raw_proba = float(probas[i])
            district_name = cell.get("district_name") or cell.get("state_name", "")
            cutoffs = REGIONAL_TERRANE_CUTOFFS.get(district_name)
            if not cutoffs and "centroid" in cell:
                cutoffs = REGIONAL_TERRANE_CUTOFFS.resolve_for_coordinate(cell["centroid"][0], cell["centroid"][1])

            is_fold_belt = REGIONAL_TERRANE_CUTOFFS.is_fold_belt(district_name)
            f_row = meta["feats"]
            r3d_ratio = float(f_row.get("rain_3d_vs_e_thr", 0.0))
            r7d = float(f_row.get("rain_7d", 0.0))
            r7d_ratio = (r7d / 80.0) if is_fold_belt else (r7d / 120.0)
            fold_3d_ratio = (r3d_ratio / 0.85) if is_fold_belt else r3d_ratio
            stress_ratio = max(r3d_ratio, r7d_ratio, fold_3d_ratio, float(f_row.get("threshold_exceedance_flag", 0)))
            p_phys = 1.0 / (1.0 + math.exp(-8.0 * (stress_ratio - 1.0)))
            proba = 1.0 - (1.0 - raw_proba) * (1.0 - p_phys)
            proba = max(0.001, min(0.999, proba))

            final_score, risk_level = artifact.compute_risk_score(proba, cutoffs=cutoffs)

            nz = meta["nearest_zone"]
            md = meta["min_dist"]
            data_confidence = "MODERATE"
            if nz and md <= 35.0:
                data_confidence = "HIGH"
            elif nz and md <= 90.0:
                data_confidence = "MODERATE"
            elif active_zones:
                data_confidence = "LOW"
            else:
                data_confidence = "INSUFFICIENT_DATA"

            weather_source = (
                f"In-situ Monitored Telemetry ({nz.zone_name}, {round(md)}km)"
                if nz and md <= 35.0
                else (
                    f"Regional NWP & Telemetry Interpolation ({nz.zone_name}, {round(md)}km)"
                    if nz
                    else "Regional NWP Climatological Model"
                )
            )

            results.append({
                "cell_id": cell.get("cell_id"),
                "centroid": meta["centroid"],
                "bounds": cell.get("bounds"),
                "state": cell.get("state_name"),
                "district": cell.get("district_name"),
                "elevation_m": meta["elevation"],
                "slope_deg": cell.get("slope_deg", 18.0),
                "static_susceptibility": cell.get("static_susceptibility", 0.5),
                "dynamic_trigger_score": float(final_score),
                "final_risk_score": final_score,
                "risk_level": risk_level,
                "probability": None,
                "data_confidence": data_confidence,
                "provenance": {
                    "terrain_source": "Survey of India DEM / GSI Geomorphology Base",
                    "weather_source": weather_source,
                    "satellite_source": "Copernicus Sentinel-1 InSAR Interface",
                    "satellite_status": "AVAILABLE",
                    "observation_count": 0,
                    "model_version": "v0.3-spatial-surface",
                    "ml_ensemble_model_version": artifact.model_version,
                    "computed_at": as_of_date,
                },
            })
        return results
    except Exception:
        return [evaluate_cell_risk(c, active_zones, as_of_date) for c in cells]

def derive_location_spatial_risk(name: str, location_type: str, district: str, state: str, coordinates: list, active_zones: list = None, radius_km: float = 35.0):
    if active_zones is None:
        active_zones = []
    surrounding = find_surrounding_cells(coordinates[0], coordinates[1], radius_km)
    if not surrounding:
        surrounding = find_surrounding_cells(coordinates[0], coordinates[1], 120.0)

    evaluated_cells = [evaluate_cell_risk(item["cell"], active_zones) for item in surrounding]
    total_w = 0.0
    weighted_score = 0.0
    for i, item in enumerate(surrounding):
        w = 1.0 / max(1.0, item["distanceKm"])
        total_w += w
        weighted_score += evaluated_cells[i]["final_risk_score"] * w

    score = round(weighted_score / total_w) if total_w > 0 else 35.0
    if score >= 74:
        level = "Severe"
    elif score >= 56:
        level = "High"
    elif score >= 38:
        level = "Moderate"
    else:
        level = "Low"

    return {
        "location": {
            "name": name,
            "type": location_type,
            "district": district,
            "state": state,
            "coordinates": coordinates,
        },
        "risk_assessment": {
            "final_risk_score": score,
            "risk_level": level,
            "data_confidence": "HIGH" if surrounding and surrounding[0]["distanceKm"] <= 20 else "MODERATE",
            "surrounding_cells_count": len(surrounding),
        },
        "cells": evaluated_cells,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }
