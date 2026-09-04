"""
src/lib/ml/features.py
======================
Canonical 19-feature pipeline for LandAlert-Nexus landslide risk modeling.
Schema Version: v1.0.0

Guarantees identical feature definitions, ordering, transformations,
and missing-data policies between training and production inference.
"""

import math
from math import radians, sin, cos, asin, sqrt
import numpy as np
import pandas as pd

FEATURE_SCHEMA_VERSION = "v1.0.0"

CANONICAL_FEATURES = [
    # 1-9: Rainfall dynamics
    "rain_1d",
    "rain_3d",
    "rain_7d",
    "rain_15d",
    "rain_30d",
    "rain_intensity_max_1d",
    "antecedent_wetness_index",
    "threshold_exceedance_flag",
    "rain_3d_vs_e_thr",
    # 10-11: Soil moisture state
    "soil_moisture_latest",
    "soil_moisture_7d_trend",
    # 12-14: Terrain susceptibility
    "slope_norm",
    "slope_sin",
    "slope_class",
    # 15-16: Spatial proximity & history
    "dist_to_nearest_event_km",
    "historical_event_density",
    # 17-19: Temporal & monsoon seasonality
    "day_of_year_sin",
    "day_of_year_cos",
    "is_monsoon",
]

FEATURE_METADATA = {
    "rain_1d": {"type": "float64", "unit": "mm", "min": 0.0, "max": 1000.0, "description": "1-day cumulative precipitation"},
    "rain_3d": {"type": "float64", "unit": "mm", "min": 0.0, "max": 2000.0, "description": "3-day cumulative precipitation"},
    "rain_7d": {"type": "float64", "unit": "mm", "min": 0.0, "max": 3000.0, "description": "7-day cumulative precipitation"},
    "rain_15d": {"type": "float64", "unit": "mm", "min": 0.0, "max": 5000.0, "description": "15-day cumulative precipitation"},
    "rain_30d": {"type": "float64", "unit": "mm", "min": 0.0, "max": 8000.0, "description": "30-day antecedent cumulative precipitation"},
    "rain_intensity_max_1d": {"type": "float64", "unit": "mm/day", "min": 0.0, "max": 1000.0, "description": "Peak single-day rainfall in 30-day window"},
    "antecedent_wetness_index": {"type": "float64", "unit": "index", "min": 0.0, "max": 2000.0, "description": "Exponentially decayed rainfall (decay=0.90/day)"},
    "threshold_exceedance_flag": {"type": "int64", "unit": "binary", "min": 0, "max": 1, "description": "1 if 3-day intensity exceeds empirical I-D threshold"},
    "rain_3d_vs_e_thr": {"type": "float64", "unit": "ratio", "min": 0.0, "max": 10.0, "description": "Ratio of 3-day rainfall to zone E-threshold"},
    "soil_moisture_latest": {"type": "float64", "unit": "fraction", "min": 0.0, "max": 1.0, "description": "Latest soil moisture fraction (0.5=neutral fallback)"},
    "soil_moisture_7d_trend": {"type": "float64", "unit": "rate", "min": -1.0, "max": 1.0, "description": "7-day rate of change in soil moisture"},
    "slope_norm": {"type": "float64", "unit": "ratio", "min": 0.0, "max": 1.0, "description": "Mean DEM slope normalized by 45 degrees"},
    "slope_sin": {"type": "float64", "unit": "sine", "min": 0.0, "max": 1.0, "description": "Sine of mean DEM slope angle"},
    "slope_class": {"type": "int64", "unit": "ordinal", "min": 0, "max": 2, "description": "Slope classification: 0(<15°), 1(15-30°), 2(>30°)"},
    "dist_to_nearest_event_km": {"type": "float64", "unit": "km", "min": 0.0, "max": 1000.0, "description": "Haversine distance to nearest known real landslide"},
    "historical_event_density": {"type": "float64", "unit": "fraction", "min": 0.0, "max": 1.0, "description": "Historical events within 50km normalized by 4"},
    "day_of_year_sin": {"type": "float64", "unit": "sine", "min": -1.0, "max": 1.0, "description": "Sine cyclical calendar term"},
    "day_of_year_cos": {"type": "float64", "unit": "cosine", "min": -1.0, "max": 1.0, "description": "Cosine cyclical calendar term"},
    "is_monsoon": {"type": "int64", "unit": "binary", "min": 0, "max": 1, "description": "1 if calendar month is June-September, else 0"},
}

def haversine_km(lat1, lon1, lat2, lon2):
    """Calculates spherical distance in km between two lat/lng coordinates."""
    r = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return r * 2 * asin(sqrt(a))

def compute_rainfall_features(zone_id, as_of_date, weather_df, i_coef, i_exp, e_thr):
    """
    Computes 9 rainfall features strictly using weather records before as_of_date.
    Returns None if no meteorological observations exist prior to as_of_date.
    """
    as_of = pd.Timestamp(as_of_date)
    if as_of.tzinfo is not None:
        as_of = as_of.tz_localize(None)
    w_df = weather_df.copy()
    if not pd.api.types.is_datetime64_any_dtype(w_df["reading_date"]):
        w_df["reading_date"] = pd.to_datetime(w_df["reading_date"])
    if getattr(w_df["reading_date"].dt, "tz", None) is not None:
        w_df["reading_date"] = w_df["reading_date"].dt.tz_localize(None)
    zone_wx = w_df[
        (w_df["zone_id"] == zone_id) & (w_df["reading_date"] < as_of)
    ].sort_values("reading_date").set_index("reading_date")

    if zone_wx.empty:
        return None

    def cumrain(days):
        start = as_of - pd.Timedelta(days=days)
        return float(zone_wx.loc[zone_wx.index >= start, "rainfall_mm"].sum())

    r1 = cumrain(1)
    r3 = cumrain(3)
    r7 = cumrain(7)
    r15 = cumrain(15)
    r30 = cumrain(30)

    # 30-day window slice
    start_30 = as_of - pd.Timedelta(days=30)
    wx_30 = zone_wx.loc[zone_wx.index >= start_30, "rainfall_mm"]
    max_1d = float(wx_30.max()) if len(wx_30) > 0 else 0.0

    # Antecedent Wetness Index with 0.90 daily exponential decay
    n = len(wx_30)
    decay = np.array([0.90 ** i for i in range(n)][::-1])
    awi = float((wx_30.values * decay).sum()) if n > 0 else 0.0

    # Empirical threshold comparison
    i_thr = float(i_coef * (3.0 ** i_exp)) if i_coef and i_exp else 14.4
    intensity_3d = r3 / 3.0
    threshold_flag = 1 if intensity_3d > i_thr else 0
    rain_vs_e = float(r3 / e_thr) if e_thr and e_thr > 0 else 0.0

    return {
        "rain_1d": r1,
        "rain_3d": r3,
        "rain_7d": r7,
        "rain_15d": r15,
        "rain_30d": r30,
        "rain_intensity_max_1d": max_1d,
        "antecedent_wetness_index": awi,
        "threshold_exceedance_flag": threshold_flag,
        "rain_3d_vs_e_thr": rain_vs_e,
    }

def compute_soil_moisture_features(zone_id, as_of_date, weather_df):
    """
    Computes soil moisture state and trend strictly before as_of_date.
    Distinguishes 'measured', 'stale' (>72h old), and 'fallback'.
    """
    as_of = pd.Timestamp(as_of_date)
    if as_of.tzinfo is not None:
        as_of = as_of.tz_localize(None)
    w_df = weather_df.copy()
    if not pd.api.types.is_datetime64_any_dtype(w_df["reading_date"]):
        w_df["reading_date"] = pd.to_datetime(w_df["reading_date"])
    if getattr(w_df["reading_date"].dt, "tz", None) is not None:
        w_df["reading_date"] = w_df["reading_date"].dt.tz_localize(None)
    sm = w_df[
        (w_df["zone_id"] == zone_id)
        & (w_df["reading_date"] < as_of)
        & (w_df["soil_moisture_pct"].notna())
    ].sort_values("reading_date")

    if sm.empty:
        return {
            "soil_moisture_latest": 0.5,
            "soil_moisture_7d_trend": 0.0,
            "soil_moisture_status": "fallback",
        }

    latest_row = sm.iloc[-1]
    latest_val = float(latest_row["soil_moisture_pct"] / 100.0)
    age_days = (as_of - latest_row["reading_date"]).days

    # Status determination
    status = "stale" if age_days > 3 else "measured"

    # 7-day rate of change trend
    wk = sm[sm["reading_date"] >= as_of - pd.Timedelta(days=7)]
    trend = 0.0
    if len(wk) >= 2:
        old_val = float(wk["soil_moisture_pct"].iloc[0] / 100.0)
        trend = float(np.clip((latest_val - old_val) / max(old_val, 0.01), -1.0, 1.0))

    return {
        "soil_moisture_latest": latest_val,
        "soil_moisture_7d_trend": trend,
        "soil_moisture_status": status,
    }

def compute_terrain_features(mean_slope_deg):
    """Computes slope normalization, trigonometric sine, and ordinal slope category."""
    s = float(mean_slope_deg)
    return {
        "slope_norm": min(s / 45.0, 1.0),
        "slope_sin": float(sin(radians(s))),
        "slope_class": 0 if s < 15.0 else (1 if s < 30.0 else 2),
    }

def compute_proximity_features(centroid_lat, centroid_lng, real_events_df, as_of_date=None):
    """
    Computes distance to nearest known real landslide and event density within 50km.
    If as_of_date is provided, strictly filters events prior to as_of_date.
    """
    loc = real_events_df.dropna(subset=["lat", "lng"]).copy()
    if as_of_date is not None:
        as_of_cut = pd.Timestamp(as_of_date)
        if as_of_cut.tzinfo is not None:
            as_of_cut = as_of_cut.tz_localize(None)
        if not pd.api.types.is_datetime64_any_dtype(loc["event_date"]):
            loc["event_date"] = pd.to_datetime(loc["event_date"])
        if getattr(loc["event_date"].dt, "tz", None) is not None:
            loc["event_date"] = loc["event_date"].dt.tz_localize(None)
        loc = loc[loc["event_date"] < as_of_cut]

    if loc.empty:
        return {
            "dist_to_nearest_event_km": 999.0,
            "historical_event_density": 0.0,
        }

    dists = loc.apply(
        lambda r: haversine_km(centroid_lat, centroid_lng, float(r["lat"]), float(r["lng"])),
        axis=1,
    )
    return {
        "dist_to_nearest_event_km": float(dists.min()),
        "historical_event_density": min(int((dists <= 50.0).sum()) / 4.0, 1.0),
    }

def compute_temporal_features(as_of_date):
    """Computes cyclical calendar features and monsoon season indicator."""
    dt = pd.Timestamp(as_of_date)
    doy = dt.timetuple().tm_yday
    return {
        "day_of_year_sin": float(math.sin(2 * math.pi * doy / 365.0)),
        "day_of_year_cos": float(math.cos(2 * math.pi * doy / 365.0)),
        "is_monsoon": 1 if 6 <= dt.month <= 9 else 0,
    }

def extract_features_for_zone(zone_row, as_of_date, weather_df, real_events_df, temporal_proximity=False):
    """
    Extracts the complete canonical 19-feature vector for a zone as of a given timestamp.
    Returns (feature_dict, metadata_dict). If weather data is missing, returns (None, None).
    """
    zid = int(zone_row["id"])
    rain_d = compute_rainfall_features(
        zid,
        as_of_date,
        weather_df,
        float(zone_row["threshold_i_coefficient"]),
        float(zone_row["threshold_i_exponent"]),
        float(zone_row["threshold_e_mm"]),
    )
    if rain_d is None:
        return None, None

    soil_d = compute_soil_moisture_features(zid, as_of_date, weather_df)
    sm_status = soil_d.pop("soil_moisture_status")

    terrain_d = compute_terrain_features(float(zone_row["mean_slope_deg"]))

    prox_cutoff = as_of_date if temporal_proximity else None
    prox_d = compute_proximity_features(
        float(zone_row["centroid_lat"]),
        float(zone_row["centroid_lng"]),
        real_events_df,
        as_of_date=prox_cutoff,
    )

    temp_d = compute_temporal_features(as_of_date)

    full_dict = {
        **rain_d,
        **soil_d,
        **terrain_d,
        **prox_d,
        **temp_d,
    }

    # Validate all 19 keys in canonical order
    canonical_vector = {k: full_dict[k] for k in CANONICAL_FEATURES}

    metadata = {
        "schema_version": FEATURE_SCHEMA_VERSION,
        "zone_id": zid,
        "zone_name": str(zone_row["zone_name"]),
        "district": str(zone_row["district"]),
        "state": str(zone_row["state"]),
        "as_of_date": str(pd.Timestamp(as_of_date).date()),
        "soil_moisture_status": sm_status,
    }

    return canonical_vector, metadata

def validate_feature_vector(feature_dict):
    """Asserts schema compliance, ordering, and absence of NaN / Inf."""
    if list(feature_dict.keys()) != CANONICAL_FEATURES:
        raise ValueError(
            f"Feature keys mismatch canonical order.\nExpected: {CANONICAL_FEATURES}\nGot: {list(feature_dict.keys())}"
        )
    for k, v in feature_dict.items():
        if v is None or math.isnan(v) or math.isinf(v):
            raise ValueError(f"Invalid feature value for {k}: {v}")
    return True
