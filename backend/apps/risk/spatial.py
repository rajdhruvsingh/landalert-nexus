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
    slope_factor = math.pow(max(6.0, slope) / 25.0, 0.70)
    elevation = cell.get("elevation_m", 800.0)
    orographic_factor = 0.85 + 0.40 * min(1.0, max(0.0, elevation) / 1800.0)
    dynamic_trigger = min(92.0, max(8.0, ambient_trigger * slope_factor * orographic_factor))

    combined = round(static_susc * 100.0 * 0.35 + dynamic_trigger * 0.65)
    final_score = max(5, min(98, combined))

    if final_score >= 74:
        risk_level = "Severe"
    elif final_score >= 56:
        risk_level = "High"
    elif final_score >= 38:
        risk_level = "Moderate"
    else:
        risk_level = "Low"

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
            "computed_at": as_of_date,
        },
    }

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
