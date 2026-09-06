#!/usr/bin/env python3
"""
scripts/sync_live_weather.py
============================
Synchronizes live meteorological observations and surface soil moisture from
Open-Meteo's live NWP forecast endpoint for all 15 Northeast India monitored zones.
Upserts into public.weather_readings and updates public.risk_zones metadata to
maintain zero-latency data freshness for production ML inference.
"""

import os
import sys
import time
import requests
import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL is not set.")
    sys.exit(1)

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
SOIL_SATURATION_CAPACITY = 0.55  # m3/m3 capacity for mountain clay loam
SOURCE_TAG = "Open-Meteo Live NWP Forecast"


def sync_live_weather_for_all_zones(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, zone_name, centroid_lat, centroid_lng FROM public.risk_zones ORDER BY id;")
    zones = cur.fetchall()

    print(f"Syncing live weather and soil moisture for {len(zones)} zones from Open-Meteo...")
    total_upserted = 0

    for zid, zname, clat, clng in zones:
        params = {
            "latitude": clat,
            "longitude": clng,
            "past_days": 7,
            "forecast_days": 1,
            "daily": "precipitation_sum",
            "hourly": "soil_moisture_0_to_7cm",
            "timezone": "Asia/Kolkata",
        }

        try:
            resp = requests.get(OPEN_METEO_FORECAST_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            daily = data.get("daily", {})
            dates = daily.get("time", [])
            precips = daily.get("precipitation_sum", [])

            hourly = data.get("hourly", {})
            h_times = hourly.get("time", [])
            h_sm = hourly.get("soil_moisture_0_to_7cm", [])

            sm_series = pd.Series(
                [float(v) if v is not None else np.nan for v in h_sm],
                index=pd.to_datetime(h_times),
            )
            daily_sm = sm_series.resample("D").mean()

            latest_today_sm_pct = None

            for d_str, p_val in zip(dates, precips):
                rain_mm = float(p_val) if p_val is not None else 0.0
                sm_raw = daily_sm.get(pd.Timestamp(d_str), np.nan)
                soil_pct = None
                if not pd.isna(sm_raw):
                    soil_pct = round(min((float(sm_raw) / SOIL_SATURATION_CAPACITY) * 100.0, 100.0), 1)
                    latest_today_sm_pct = soil_pct

                rtime = f"{d_str}T12:00:00+05:30"
                station_id = f"OM-LIVE-{zid}"

                cur.execute("""
                    INSERT INTO public.weather_readings (
                        zone_id, station_id, reading_time, rainfall_mm, soil_moisture_pct, source
                    ) VALUES (%s, %s, %s::timestamptz, %s, %s, %s)
                    ON CONFLICT (zone_id, station_id, reading_time) DO UPDATE
                    SET rainfall_mm = EXCLUDED.rainfall_mm,
                        soil_moisture_pct = EXCLUDED.soil_moisture_pct,
                        source = EXCLUDED.source;
                """, (zid, station_id, rtime, rain_mm, soil_pct, SOURCE_TAG))
                total_upserted += 1

            # Update zone real-time cache
            if latest_today_sm_pct is not None:
                cur.execute("""
                    UPDATE public.risk_zones
                    SET soil_moisture_pct = %s,
                        soil_moisture_status = 'measured',
                        soil_moisture_reading_time = NOW()
                    WHERE id = %s;
                """, (latest_today_sm_pct, zid))

            conn.commit()
            print(f"  ✓ Zone {zid:2} ({zname:<25}): updated {len(dates)} days (latest soil moisture: {latest_today_sm_pct}%)")

        except Exception as e:
            print(f"  ✗ Zone {zid:2} ({zname}) failed: {e}")

        time.sleep(0.5)

    cur.close()
    print(f"\nLive weather synchronization complete: {total_upserted} records upserted across {len(zones)} zones.")


if __name__ == "__main__":
    conn = psycopg2.connect(DATABASE_URL)
    sync_live_weather_for_all_zones(conn)
    conn.close()
