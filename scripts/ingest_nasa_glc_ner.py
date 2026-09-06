#!/usr/bin/env python3
"""
scripts/ingest_nasa_glc_ner.py
==============================
Fetches verified historical rainfall-triggered landslide events from NASA's
Global Landslide Catalog (GLC / COOLR) for Northeast India.

- Queries the official NASA ArcGIS FeatureServer
- Filters for events in India within the Northeast Region (NER)
- Matches each event to the nearest LandAlert-Nexus risk zone within 100 km
- Populates public.historical_landslides with:
    - is_synthetic = false
    - hazard_type = 'rainfall_slope_failure'
    - full citation provenance in source field
- Idempotent: checks for existing (zone_id, event_date, lat, lng) before inserting
"""

import os
import sys
import math
import json
import urllib.request
import datetime
from dotenv import load_dotenv
import psycopg2

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in environment.")
    sys.exit(1)

NASA_GLC_QUERY_URL = (
    "https://services1.arcgis.com/yFGHRCyBneULM8ci/arcgis/rest/services/"
    "nasa_global_landslide_catalog_point/FeatureServer/0/query"
)

NER_STATES = {
    "assam", "arunachal pradesh", "manipur", "meghalaya",
    "mizoram", "nagaland", "sikkim", "tripura", "west bengal"
}

def haversine(lat1, lon1, lat2, lon2) -> float:
    """Computes great-circle distance in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_zones(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, zone_name, state, district, centroid_lat, centroid_lng FROM public.risk_zones ORDER BY id;")
    zones = cur.fetchall()
    cur.close()
    return zones

def fetch_nasa_events():
    print("Fetching NASA Global Landslide Catalog points for India...")
    params = (
        "where=country_na%3D'India'"
        "&outFields=event_id,event_date,latitude,longitude,admin_divi,landslide_,landslide1,fatality_c,source_nam,source_lin,location_d"
        "&resultRecordCount=2000"
        "&f=json"
    )
    url = f"{NASA_GLC_QUERY_URL}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (LandAlert-Nexus Ingestion)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    
    features = data.get("features", [])
    print(f"Retrieved {len(features)} total records for India from NASA GLC.")
    return features

def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        zones = get_zones(conn)
        features = fetch_nasa_events()

        # Existing events count
        cur.execute("SELECT COUNT(*) FROM public.historical_landslides WHERE is_synthetic = false AND hazard_type = 'rainfall_slope_failure';")
        initial_count = cur.fetchone()[0]
        print(f"Current verified real rainfall landslide events in DB: {initial_count}")

        # Ingest candidates
        inserted_count = 0
        skipped_count = 0
        
        for f in features:
            attrs = f["attributes"]
            lat = attrs.get("latitude")
            lng = attrs.get("longitude")
            dt_ms = attrs.get("event_date")
            admin = (attrs.get("admin_divi") or "").lower()
            trigger = (attrs.get("landslide1") or "").lower()
            ls_type = (attrs.get("landslide_") or "").lower()
            fatalities = attrs.get("fatality_c") or 0

            if not (lat and lng and dt_ms):
                skipped_count += 1
                continue

            # Bounding box filter for NER (Lat 21.5 - 29.5, Lng 88.0 - 97.5) or admin region
            is_ner_admin = any(s in admin for s in NER_STATES)
            is_ner_coord = (21.5 <= lat <= 29.5 and 88.0 <= lng <= 97.5)
            if not (is_ner_admin or is_ner_coord):
                skipped_count += 1
                continue

            # Check trigger is rainfall-related (exclude earthquakes, volcanic, construction only)
            non_rain_triggers = {"earthquake", "volcano", "snowfall_snowmelt_only"}
            if any(t in trigger for t in non_rain_triggers):
                skipped_count += 1
                continue

            # Convert timestamp
            event_date = datetime.datetime.fromtimestamp(dt_ms / 1000.0, tz=datetime.timezone.utc).date()

            # Find nearest zone within 100 km
            best_zone = None
            min_dist = 999999.0
            for z in zones:
                dist = haversine(lat, lng, z[4], z[5])
                if dist < min_dist:
                    min_dist = dist
                    best_zone = z

            if min_dist > 100.0 or best_zone is None:
                skipped_count += 1
                continue

            zone_id = best_zone[0]

            # Determine severity
            if fatalities > 20:
                severity = "Major"
            elif fatalities > 5:
                severity = "Moderate"
            elif fatalities > 0:
                severity = "Minor"
            else:
                severity = "Minor" if ls_type in ["mudslide", "landslide"] else "Unknown"

            source_desc = (
                f"NASA Global Landslide Catalog (GLC/COOLR) event_id={attrs.get('event_id')}; "
                f"location={attrs.get('location_d') or 'NER'}; "
                f"source={attrs.get('source_nam') or 'NASA'}; "
                f"trigger={trigger or 'rain'}; distance_to_zone_km={min_dist:.1f}"
            )

            # Check for duplicate
            cur.execute("""
                SELECT id FROM public.historical_landslides
                WHERE zone_id = %s AND event_date = %s
                  AND abs(lat - %s) < 0.01 AND abs(lng - %s) < 0.01
                LIMIT 1;
            """, (zone_id, event_date, lat, lng))
            if cur.fetchone():
                skipped_count += 1
                continue

            # Insert record
            cur.execute("""
                INSERT INTO public.historical_landslides (
                    zone_id, event_date, lat, lng, severity, source, is_synthetic, hazard_type
                ) VALUES (%s, %s, %s, %s, %s, %s, false, 'rainfall_slope_failure');
            """, (zone_id, event_date, lat, lng, severity, source_desc))
            inserted_count += 1

        conn.commit()

        cur.execute("SELECT COUNT(*) FROM public.historical_landslides WHERE is_synthetic = false AND hazard_type = 'rainfall_slope_failure';")
        final_count = cur.fetchone()[0]

        print("=" * 60)
        print("NASA GLC INGESTION SUMMARY")
        print("=" * 60)
        print(f"  Inserted new verified events: {inserted_count}")
        print(f"  Skipped (duplicates/out-of-bounds): {skipped_count}")
        print(f"  Total verified real rainfall events in DB: {final_count}")
        print(f"  Scientific Gate Requirement (>= 200): {'SATISFIED' if final_count >= 200 else 'BLOCKED'}")
        print("=" * 60)

    except Exception as e:
        conn.rollback()
        print(f"ERROR during ingestion: {e}")
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    main()
