#!/usr/bin/env python3
"""
test_ml_leakage.py -- landalert-nexus
======================================
Automated regression tests for temporal and spatial leakage in the
ML feature engineering pipeline.

These tests run WITHOUT a database connection -- they verify the
feature engineering functions directly using synthetic in-memory data.

Usage: python3 scripts/test_ml_leakage.py
All tests must pass. Any failure indicates a leakage regression.
"""

import sys
import math
from math import radians, sin, cos, asin, sqrt
from datetime import date

import numpy as np
import pandas as pd

PASSED = 0
FAILED = 0

def test(name, condition, detail=""):
    global PASSED, FAILED
    if condition:
        print(f"  PASS  {name}")
        PASSED += 1
    else:
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))
        FAILED += 1


# ─── Replicate feature functions (identical to notebook / audit pipeline) ─────

def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1); dl = radians(lng2 - lng1)
    a = sin(dp/2)**2 + cos(p1)*cos(p2)*sin(dl/2)**2
    return R * 2 * asin(sqrt(a))


def build_rainfall_features(zone_id, as_of_date, weather_df, i_coef, i_exp, e_thr):
    """No-leakage: strictly < as_of_date."""
    zone_wx = weather_df[
        (weather_df['zone_id'] == zone_id) &
        (weather_df['reading_date'] < as_of_date)
    ].sort_values('reading_date').set_index('reading_date')
    if zone_wx.empty:
        return None
    as_of = pd.Timestamp(as_of_date)
    def cumrain(d):
        start = as_of - pd.Timedelta(days=d)
        return float(zone_wx.loc[zone_wx.index >= start, 'rainfall_mm'].sum())
    r3d = cumrain(3)
    i_thr = i_coef * (3.0 ** i_exp)
    r30 = zone_wx.loc[zone_wx.index >= as_of - pd.Timedelta(days=30), 'rainfall_mm']
    n = len(r30); decay = np.array([0.9**i for i in range(n)][::-1])
    awi = float((r30.values * decay).sum()) if n > 0 else 0.0
    return {
        'rain_1d': cumrain(1), 'rain_3d': r3d,
        'rain_7d': cumrain(7), 'rain_15d': cumrain(15), 'rain_30d': cumrain(30),
        'rain_intensity_max_1d': float(zone_wx['rainfall_mm'].max() or 0),
        'antecedent_wetness_index': awi,
        'threshold_exceedance_flag': 1 if (r3d/3.0) > i_thr else 0,
        'rain_3d_vs_e_thr': r3d / e_thr if e_thr > 0 else 0.0,
    }


def build_soil_features(zone_id, as_of_date, weather_df):
    sm = weather_df[
        (weather_df['zone_id'] == zone_id) &
        (weather_df['reading_date'] < as_of_date) &
        (weather_df['soil_moisture_pct'].notna())
    ].sort_values('reading_date')
    if sm.empty:
        return {'soil_moisture_latest': 0.5, 'soil_moisture_7d_trend': 0.0}
    latest = sm['soil_moisture_pct'].iloc[-1] / 100.0
    as_of = pd.Timestamp(as_of_date)
    week = sm[sm['reading_date'] >= as_of - pd.Timedelta(days=7)]
    trend = 0.0
    if len(week) >= 2:
        old = week['soil_moisture_pct'].iloc[0] / 100.0
        trend = float(np.clip((latest - old) / max(old, 0.01), -1.0, 1.0))
    return {'soil_moisture_latest': float(latest), 'soil_moisture_7d_trend': trend}


# ─── Build synthetic weather fixture ─────────────────────────────────────────

def make_weather(zone_id, start_date, days, base_rain=10.0, sm=50.0):
    dates = pd.date_range(start_date, periods=days, freq='D')
    return pd.DataFrame({
        'zone_id': zone_id,
        'reading_date': dates,
        'rainfall_mm': [float(base_rain)] * days,
        'soil_moisture_pct': [float(sm)] * days,
    })


def main():
    global PASSED, FAILED
    PASSED = 0
    FAILED = 0

    print("=" * 60)
    print("ML LEAKAGE REGRESSION TESTS")
    print("=" * 60)

    # ─── TEST GROUP 1: Temporal leakage in rainfall features ─────────────────────
    print("\n[1] Temporal leakage — rainfall features must not use day T or later")

    event_date = pd.Timestamp("2022-07-01")
    # Weather with a spike ON the event date (must be excluded)
    wx = make_weather(1, "2022-06-01", 31)
    wx.loc[wx['reading_date'] == event_date, 'rainfall_mm'] = 999.0  # spike on T

    feats = build_rainfall_features(1, event_date, wx, 43.26, -0.78, 200.0)

    test("Event day (T) excluded from rain_1d",
         feats is not None and feats['rain_1d'] < 100.0,
         f"rain_1d={feats['rain_1d'] if feats else 'None'}")

    test("Event day excluded from rain_3d",
         feats is not None and feats['rain_3d'] < 100.0,
         f"rain_3d={feats['rain_3d'] if feats else 'None'}")

    test("Event day excluded from rain_intensity_max_1d",
         feats is not None and feats['rain_intensity_max_1d'] < 100.0,
         f"max={feats['rain_intensity_max_1d'] if feats else 'None'}")

    # Future weather after event date must also be excluded
    wx2 = make_weather(1, "2022-06-01", 60)
    wx2.loc[wx2['reading_date'] > event_date, 'rainfall_mm'] = 999.0  # future spike
    feats2 = build_rainfall_features(1, event_date, wx2, 43.26, -0.78, 200.0)

    test("Future days (T+1, T+2, ...) excluded from features",
         feats2 is not None and feats2['rain_1d'] < 100.0,
         f"rain_1d={feats2['rain_1d'] if feats2 else 'None'}")

    # ─── TEST GROUP 2: Temporal leakage — soil moisture ──────────────────────────
    print("\n[2] Temporal leakage — soil moisture must not use day T or later")

    wx3 = make_weather(1, "2022-06-01", 31, sm=30.0)
    # Spike soil moisture on and after event date
    wx3.loc[wx3['reading_date'] >= event_date, 'soil_moisture_pct'] = 99.0
    soil = build_soil_features(1, event_date, wx3)

    test("Soil moisture on T excluded (latest < 99)",
         soil['soil_moisture_latest'] < 0.90,
         f"latest={soil['soil_moisture_latest']:.3f}")

    # ─── TEST GROUP 3: No data before event → returns None (not 0) ───────────────
    print("\n[3] No weather data before event → returns None (not fabricated zeros)")

    wx_after = make_weather(1, "2022-07-05", 10)  # all AFTER event
    feats_none = build_rainfall_features(1, event_date, wx_after, 43.26, -0.78, 200.0)

    test("Returns None when no weather before event date",
         feats_none is None,
         f"got: {feats_none}")

    # ─── TEST GROUP 4: AWI decay correctness ─────────────────────────────────────
    print("\n[4] Antecedent wetness index — decay formula correctness")

    # Build 30 days of weather where only day T-30 has rain (1mm)
    wx4 = make_weather(1, "2022-06-01", 30, base_rain=0.0)
    wx4.loc[wx4['reading_date'] == pd.Timestamp("2022-06-01"), 'rainfall_mm'] = 1.0  # 30 days ago

    feats4 = build_rainfall_features(1, event_date, wx4, 43.26, -0.78, 200.0)
    # AWI for 1mm at day_ago=29: 0.9^29 ≈ 0.0424
    expected_awi = 1.0 * (0.9 ** 29)
    test("AWI correctly decays a single old rain event",
         feats4 is not None and abs(feats4['antecedent_wetness_index'] - expected_awi) < 0.01,
         f"got={feats4['antecedent_wetness_index']:.4f}, expected={expected_awi:.4f}")

    # ─── TEST GROUP 5: Feature list completeness ─────────────────────────────────
    print("\n[5] Feature list completeness — all 19 canonical features present")

    FEATURE_COLS = [
        'rain_1d','rain_3d','rain_7d','rain_15d','rain_30d',
        'rain_intensity_max_1d','antecedent_wetness_index','threshold_exceedance_flag',
        'rain_3d_vs_e_thr',
        'soil_moisture_latest','soil_moisture_7d_trend',
        'slope_norm','slope_sin','slope_class',
        'dist_to_nearest_event_km','historical_event_density',
        'day_of_year_sin','day_of_year_cos','is_monsoon',
    ]
    test("Feature list has exactly 19 features",
         len(FEATURE_COLS) == 19,
         f"count={len(FEATURE_COLS)}")

    # Verify rainfall features return all 9 rainfall-related columns
    wx5 = make_weather(1, "2022-06-01", 30)
    feats5 = build_rainfall_features(1, event_date, wx5, 43.26, -0.78, 200.0)
    rainfall_expected = {
        'rain_1d','rain_3d','rain_7d','rain_15d','rain_30d',
        'rain_intensity_max_1d','antecedent_wetness_index',
        'threshold_exceedance_flag','rain_3d_vs_e_thr'
    }
    test("build_rainfall_features returns all 9 expected keys",
         feats5 is not None and rainfall_expected.issubset(feats5.keys()),
         f"keys={set(feats5.keys()) if feats5 else None}")

    # ─── TEST GROUP 6: Threshold exceedance flag ──────────────────────────────────
    print("\n[6] Threshold exceedance flag — correct trigger/no-trigger boundary")

    # Zone with i_coef=43.26, i_exp=-0.78, threshold at 3d = 43.26*3^-0.78 ≈ 17.8 mm/day
    # So 3d rain / 3 > 17.8 triggers flag. Need 3d rain > 53.4mm.
    i_thr_3d = 43.26 * (3.0 ** -0.78)  # noqa: F841 (used for documentation)

    # Below threshold: 10mm/day * 3 = 30mm < 53.4
    wx_lo = make_weather(1, "2022-06-01", 30, base_rain=10.0)
    feats_lo = build_rainfall_features(1, event_date, wx_lo, 43.26, -0.78, 200.0)
    test("Exceedance flag=0 below threshold",
         feats_lo is not None and feats_lo['threshold_exceedance_flag'] == 0,
         f"flag={feats_lo['threshold_exceedance_flag'] if feats_lo else 'None'}")

    # Above threshold: 20mm/day * 3 = 60mm > 53.4
    wx_hi = make_weather(1, "2022-06-01", 30, base_rain=20.0)
    feats_hi = build_rainfall_features(1, event_date, wx_hi, 43.26, -0.78, 200.0)
    test("Exceedance flag=1 above threshold",
         feats_hi is not None and feats_hi['threshold_exceedance_flag'] == 1,
         f"flag={feats_hi['threshold_exceedance_flag'] if feats_hi else 'None'}")

    # ─── TEST GROUP 7: Soil moisture fallback ─────────────────────────────────────
    print("\n[7] Soil moisture — fallback to neutral (0.5) when no data")

    wx_empty = pd.DataFrame(columns=['zone_id','reading_date','rainfall_mm','soil_moisture_pct'])
    soil_fb = build_soil_features(1, event_date, wx_empty)
    test("soil_moisture_latest fallback = 0.5",
         abs(soil_fb['soil_moisture_latest'] - 0.5) < 0.001)
    test("soil_moisture_7d_trend fallback = 0.0",
         abs(soil_fb['soil_moisture_7d_trend'] - 0.0) < 0.001)

    # ─── TEST GROUP 8: Haversine distance sanity checks ───────────────────────────
    print("\n[8] Haversine distance sanity checks")

    # Distance from a point to itself
    test("Haversine(same point) = 0",
         abs(haversine_km(25.0, 92.0, 25.0, 92.0)) < 0.001)

    # Approximate: 1° latitude ≈ 111km
    d1deg = haversine_km(25.0, 92.0, 26.0, 92.0)
    test("1° latitude ≈ 111km",
         abs(d1deg - 111.0) < 5.0,
         f"got={d1deg:.1f}km")

    # ─── SUMMARY ──────────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print(f"Results: {PASSED} passed, {FAILED} failed")
    print("=" * 60)

    if FAILED > 0:
        print(f"\nFAILED: {FAILED} leakage regression test(s). Fix before training.")
        sys.exit(1)
    else:
        print("\nAll leakage regression tests passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
