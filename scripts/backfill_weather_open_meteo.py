#!/usr/bin/env python3
"""
backfill_weather_open_meteo.py -- landalert-nexus
==================================================
Fetches historical daily precipitation and soil moisture from the
Open-Meteo Historical Archive API (free, no auth, 1940-present)
for all 15 NER risk zones and backfills them into weather_readings.

API verified working 2026-09-04:
  Daily:  precipitation_sum (mm)
  Hourly: soil_moisture_0_to_1cm (m3/m3) -- aggregated to daily mean

Usage:
    python3 scripts/backfill_weather_open_meteo.py [--dry-run] [--start-year YEAR] [--end-year YEAR]

Arguments:
    --dry-run      Fetch and print counts without writing to DB
    --start-year   First year to fetch (default: 2016)
    --end-year     Last year to fetch (default: current year)

Requirements:
    pip install requests psycopg2-binary python-dotenv pandas
"""

import os, sys, time, argparse
from datetime import date

import requests
import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://localhost/landalert')

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
REQUEST_DELAY_S = 0.6   # stay within Open-Meteo free-tier rate limits
SOURCE_TAG = "Open-Meteo ERA5-Land historical archive (backfill)"

# Saturation reference: 0.40 m3/m3 field capacity for tropical/subtropical
# mountain soils (Albergel et al. 2012) -- converts volumetric to 0-100%.
SOIL_SATURATION_CAPACITY = 0.40


def fetch_zone_weather(lat: float, lng: float, start: date, end: date) -> pd.DataFrame:
    """
    Fetch daily precipitation + daily-mean soil moisture from Open-Meteo.
    Soil moisture is hourly (m3/m3), aggregated to daily mean and converted
    to 0-100% saturation scale.
    Returns a DataFrame with columns: date, rainfall_mm, soil_moisture_pct
    """
    params = {
        "latitude":   lat,
        "longitude":  lng,
        "start_date": str(start),
        "end_date":   str(end),
        "daily":      "precipitation_sum",
        "hourly":     "soil_moisture_0_to_1cm",
        "timezone":   "Asia/Kolkata",
    }
    resp = requests.get(OPEN_METEO_ARCHIVE_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # Daily precipitation
    daily    = data.get("daily", {})
    d_dates  = daily.get("time", [])
    d_precip = daily.get("precipitation_sum", [None] * len(d_dates))

    # Hourly soil moisture -> aggregate to daily mean
    hourly   = data.get("hourly", {})
    h_times  = hourly.get("time", [])
    h_soil   = hourly.get("soil_moisture_0_to_1cm", [None] * len(h_times))

    # Build daily soil moisture from hourly data
    sm_series = pd.Series(h_soil, index=pd.to_datetime(h_times), dtype=float)
    sm_daily  = sm_series.resample("D").mean()

    rows = []
    for d, p in zip(d_dates, d_precip):
        rain_mm  = float(p) if p is not None else None
        sm_raw   = sm_daily.get(pd.Timestamp(d), None)
        soil_pct = None
        if sm_raw is not None and not pd.isna(sm_raw):
            soil_pct = min(float(sm_raw) / SOIL_SATURATION_CAPACITY * 100.0, 100.0)
        rows.append({"date": d, "rainfall_mm": rain_mm, "soil_moisture_pct": soil_pct})

    return pd.DataFrame(rows)


def upsert_zone_weather(conn, zone_id: int, df: pd.DataFrame) -> int:
    """
    Upsert daily rows into weather_readings.
    Idempotent: uses ON CONFLICT (station_id, reading_time) DO UPDATE.
    station_id pattern: 'OM-HIST-{zone_id}'
    """
    cur = conn.cursor()
    inserted = 0
    for _, row in df.iterrows():
        if row["rainfall_mm"] is None and row["soil_moisture_pct"] is None:
            continue
        reading_time = f"{row['date']}T12:00:00+05:30"
        station_id   = f"OM-HIST-{zone_id}"
        cur.execute("""
            INSERT INTO weather_readings
                (zone_id, station_id, reading_time, rainfall_mm, soil_moisture_pct, source)
            VALUES (%s, %s, %s::timestamptz, %s, %s, %s)
            ON CONFLICT (zone_id, station_id, reading_time)
            DO UPDATE SET
                rainfall_mm       = EXCLUDED.rainfall_mm,
                soil_moisture_pct = EXCLUDED.soil_moisture_pct,
                source            = EXCLUDED.source
        """, (zone_id, station_id, reading_time,
              row["rainfall_mm"], row["soil_moisture_pct"], SOURCE_TAG))
        inserted += 1
    conn.commit()
    cur.close()
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Backfill historical weather from Open-Meteo")
    parser.add_argument("--dry-run",    action="store_true")
    parser.add_argument("--start-year", type=int, default=2016)
    parser.add_argument("--end-year",   type=int, default=date.today().year)
    args = parser.parse_args()

    start_date = date(args.start_year, 1, 1)
    end_date   = date(args.end_year, 12, 31)

    print(f"Open-Meteo Historical Backfill")
    print(f"  Fetch range:  {start_date} to {end_date}")
    print(f"  Source:       {SOURCE_TAG}")
    print(f"  Dry run:      {args.dry_run}")

    conn = None
    if not args.dry_run:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            print(f"  DB:           {DATABASE_URL}")
        except Exception as e:
            print(f"FATAL: Cannot connect to DB: {e}"); sys.exit(1)
    print()

    # Load zones from DB if connected, else use hardcoded centroids
    if conn:
        zones = pd.read_sql(
            "SELECT id, zone_name, centroid_lat, centroid_lng FROM risk_zones ORDER BY id", conn)
    else:
        zones = pd.DataFrame([
            (1, "Tamenglong",                24.91, 93.49),
            (2, "Noney",                     24.87, 93.67),
            (3, "Aizawl East",               23.74, 92.74),
            (4, "Lunglei Slopes",            22.89, 92.79),
            (5, "Shillong-Sohra Escarpment", 25.26, 91.69),
            (6, "Jaintia Hills Ridge",        25.48, 92.52),
            (7, "Kohima Ridge",              25.67, 94.13),
            (8, "Dimapur Foothills",         25.91, 93.72),
            (9, "Papum Pare",                27.00, 93.67),
            (10,"Dibang Valley",             28.25, 95.86),
            (11,"Gangtok-Singtam Corridor",  27.33, 88.62),
            (12,"Mangan North",              27.51, 88.54),
            (13,"Haflong Hills",             25.17, 93.03),
            (14,"Karbi Anglong West",        26.38, 92.64),
            (15,"Ambassa Hills",             24.00, 91.87),
        ], columns=["id","zone_name","centroid_lat","centroid_lng"])

    total_rows = 0
    for _, z in zones.iterrows():
        zone_id = int(z["id"])
        lat     = float(z["centroid_lat"])
        lng     = float(z["centroid_lng"])
        print(f"  zone {zone_id:2} {z['zone_name']:<30} ({lat},{lng}) ... ", end="", flush=True)
        try:
            df = fetch_zone_weather(lat, lng, start_date, end_date)
            n_rain = df["rainfall_mm"].notna().sum()
            n_soil = df["soil_moisture_pct"].notna().sum()
            print(f"{len(df)} days: {n_rain} rainfall, {n_soil} soil", end="")
            if not args.dry_run and conn:
                n = upsert_zone_weather(conn, zone_id, df)
                print(f" -> {n} upserted", end="")
                total_rows += n
            print()
        except requests.exceptions.HTTPError as e:
            print(f"HTTP ERROR: {e.response.status_code} — {e.response.text[:200]}")
        except Exception as e:
            print(f"ERROR: {e}")
        time.sleep(REQUEST_DELAY_S)

    if conn:
        conn.close()

    print(f"\nTotal rows upserted: {total_rows}")
    if not args.dry_run:
        print("\nNEXT STEPS:")
        print("  1. python3 scripts/ml_audit_pipeline.py")
        print("     Verifies non-empty feature matrix and reports real PR-AUC / recall.")
        print("  2. Open ml-notebooks/01_risk_calibration.ipynb, run all cells.")
        print("     Cell 14 writes real metrics to risk_model_config.")
        print("  3. Commit docs/model_evaluation_results.csv, docs/pr_curve.png.")


if __name__ == "__main__":
    main()
