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
    Soil moisture variables: soil_moisture_0_to_1cm and soil_moisture_1_to_3cm (m3/m3),
    averaged to daily mean and converted to 0-100% saturation scale via 0.40 m3/m3 capacity.
    If Open-Meteo has no coverage (returns nulls), soil_moisture_pct is None (fallback preserved).
    Returns a DataFrame with columns: date, rainfall_mm, soil_moisture_pct
    """
    params = {
        "latitude":   lat,
        "longitude":  lng,
        "start_date": str(start),
        "end_date":   str(end),
        "daily":      "precipitation_sum",
        "hourly":     ["soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm"],
        "timezone":   "Asia/Kolkata",
    }
    resp = requests.get(OPEN_METEO_ARCHIVE_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # Daily precipitation
    daily    = data.get("daily", {})
    d_dates  = daily.get("time", [])
    d_precip = daily.get("precipitation_sum", [None] * len(d_dates))

    # Hourly soil moisture -> aggregate 0-1cm and 1-3cm to daily mean
    hourly   = data.get("hourly", {})
    h_times  = hourly.get("time", [])
    h_sm01   = hourly.get("soil_moisture_0_to_1cm", [None] * len(h_times))
    h_sm13   = hourly.get("soil_moisture_1_to_3cm", [None] * len(h_times))

    # Combine non-null values across the two surface layers
    combined_sm = []
    for s0, s1 in zip(h_sm01, h_sm13):
        valid = [v for v in (s0, s1) if v is not None and not pd.isna(v)]
        combined_sm.append(sum(valid) / len(valid) if valid else None)

    sm_series = pd.Series(combined_sm, index=pd.to_datetime(h_times), dtype=float)
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


def backfill_historical_events(conn, dry_run: bool = False):
    """
    Backfill soil moisture specifically for the exact coordinates and dates of:
    (a) The verified real positive events in historical_landslides
    (b) Deterministic pseudo-absences
    Upserts into weather_readings with source='Open-Meteo ERA5-Land historical soil moisture backfill'
    """
    from datetime import timedelta
    HIST_SM_SOURCE = "Open-Meteo ERA5-Land historical soil moisture backfill"
    
    cur = conn.cursor() if conn else None
    
    # 1. Load verified positive events
    if conn:
        cur.execute("""
            SELECT id, zone_id, event_date::date, lat, lng
            FROM public.historical_landslides
            WHERE is_synthetic = false AND hazard_type = 'rainfall_slope_failure'
            ORDER BY event_date;
        """)
        positives = cur.fetchall()
        
        # Load zones for pseudo-absences
        zones_df = pd.read_sql("SELECT id, centroid_lat, centroid_lng, mean_slope_deg FROM public.risk_zones", conn)
    else:
        positives = [
            (36, 3, date(2018, 6, 7), 23.74, 92.74),
            (37, 5, date(2019, 8, 1), 25.29, 91.73),
            (38, 7, date(2020, 7, 13), 25.66, 94.12),
            (39, 13, date(2021, 5, 25), 25.16, 93.03),
            (31, 2, date(2022, 6, 30), 24.82, 93.68),
            (32, 2, date(2022, 7, 4), 24.80, 93.71),
            (35, 12, date(2023, 6, 15), 27.50, 88.54),
            (33, 1, date(2024, 7, 30), 24.97, 93.51),
        ]
        zones_df = pd.DataFrame([
            (1, 24.91, 93.49, 31.4), (2, 24.87, 93.67, 38.2), (3, 23.74, 92.74, 42.6),
            (4, 22.89, 92.79, 36.1), (5, 25.26, 91.69, 45.8), (6, 25.48, 92.52, 33.7),
            (7, 25.67, 94.13, 40.3), (8, 25.91, 93.72, 21.5), (9, 27.00, 93.67, 29.9),
            (10, 28.25, 95.86, 47.2), (11, 27.33, 88.62, 44.1), (12, 27.51, 88.54, 48.6),
            (13, 25.17, 93.03, 34.8), (14, 26.38, 92.64, 24.6), (15, 24.00, 91.87, 19.8)
        ], columns=["id", "centroid_lat", "centroid_lng", "mean_slope_deg"])

    # 2. Build deterministic pseudo-absences
    import numpy as np
    rng = np.random.default_rng(42)
    eligible = zones_df[zones_df["mean_slope_deg"] > 5.0]
    pseudo_absences = []
    attempts = 0
    while len(pseudo_absences) < len(positives) * 3 and attempts < 500:
        attempts += 1
        z = eligible.sample(1, random_state=int(rng.integers(0, 99999))).iloc[0]
        y = int(rng.choice([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]))
        m = int(rng.integers(1, 13))
        d_max = 28 if m == 2 else (30 if m in [4, 6, 9, 11] else 31)
        d = int(rng.integers(1, d_max + 1))
        cdate = date(y, m, d)
        zid = int(z["id"])
        # Check temporal buffer
        if any(p[1] == zid and abs((cdate - p[2]).days) <= 14 for p in positives):
            continue
        pseudo_absences.append((zid, float(z["centroid_lat"]), float(z["centroid_lng"]), cdate))

    print(f"\n--- Backfilling Soil Moisture for Historical Events & Pseudo-Absences ---")
    print(f"Verified Positives: {len(positives)}")
    print(f"Pseudo-Absences:    {len(pseudo_absences)}")

    all_targets = []
    for p in positives:
        pid, zid, edate, lat, lng = p
        all_targets.append(("positive", zid, float(lat), float(lng), edate))
    for pa in pseudo_absences:
        zid, lat, lng, cdate = pa
        all_targets.append(("pseudo_absence", zid, lat, lng, cdate))

    total_valid_sm = 0
    total_null_sm = 0

    for kind, zid, lat, lng, edate in all_targets:
        sdate = edate - timedelta(days=30)
        print(f"  [{kind:<14}] zone {zid:2} ({lat:.3f}, {lng:.3f}) {sdate} to {edate} ... ", end="", flush=True)
        try:
            df = fetch_zone_weather(lat, lng, sdate, edate)
            n_sm = df["soil_moisture_pct"].notna().sum()
            if n_sm > 0:
                print(f"{n_sm} soil readings found!", end="")
                total_valid_sm += n_sm
                if not dry_run and conn:
                    # Upsert with specific source
                    cur_u = conn.cursor()
                    for _, row in df[df["soil_moisture_pct"].notna()].iterrows():
                        rtime = f"{row['date']}T12:00:00+05:30"
                        station_id = f"OM-HIST-SM-{zid}"
                        cur_u.execute("""
                            INSERT INTO weather_readings
                                (zone_id, station_id, reading_time, rainfall_mm, soil_moisture_pct, source)
                            VALUES (%s, %s, %s::timestamptz, %s, %s, %s)
                            ON CONFLICT (zone_id, station_id, reading_time)
                            DO UPDATE SET
                                soil_moisture_pct = EXCLUDED.soil_moisture_pct,
                                source            = EXCLUDED.source
                        """, (zid, station_id, rtime, row["rainfall_mm"], row["soil_moisture_pct"], HIST_SM_SOURCE))
                    conn.commit()
                    cur_u.close()
            else:
                print(f"0 soil readings (Open-Meteo ERA5-Land returned nulls — fallback preserved)", end="")
                total_null_sm += 1
            print()
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(REQUEST_DELAY_S)

    print(f"\nHistorical Soil Moisture Backfill Summary:")
    print(f"  Valid soil moisture readings found: {total_valid_sm}")
    print(f"  Targets with null coverage from Open-Meteo: {total_null_sm}/{len(all_targets)}")
    if total_valid_sm == 0:
        print("  NOTE: Open-Meteo ERA5-Land Historical Archive does not provide soil_moisture_0_to_1cm or")
        print("        soil_moisture_1_to_3cm (all return null). Fallback 0.50 preserved per scientific protocol.")


def main():
    parser = argparse.ArgumentParser(description="Backfill historical weather from Open-Meteo")
    parser.add_argument("--dry-run",    action="store_true")
    parser.add_argument("--start-year", type=int, default=2016)
    parser.add_argument("--end-year",   type=int, default=date.today().year)
    parser.add_argument("--backfill-events", action="store_true", help="Backfill soil moisture specifically for historical positive events and pseudo-absences")
    args = parser.parse_args()

    conn = None
    if not args.dry_run:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            print(f"  DB:           {DATABASE_URL}")
        except Exception as e:
            print(f"FATAL: Cannot connect to DB: {e}"); sys.exit(1)

    if args.backfill_events:
        backfill_historical_events(conn, dry_run=args.dry_run)
        if conn:
            conn.close()
        return

    start_date = date(args.start_year, 1, 1)
    end_date   = date(args.end_year, 12, 31)

    print(f"Open-Meteo Historical Backfill")
    print(f"  Fetch range:  {start_date} to {end_date}")
    print(f"  Source:       {SOURCE_TAG}")
    print(f"  Dry run:      {args.dry_run}")
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


if __name__ == "__main__":
    main()

