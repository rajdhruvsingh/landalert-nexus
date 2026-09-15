"""
src/lib/ml/ingest_shapefiles.py
================================
Ingests landslide event shapefiles into historical_landslides.

Handles:
  1. Zenodo Heijenk 2023 dataset (Gangtok basin, Sikkim)
     Path: ~/Downloads/landslide/data/raw/zenodo_heijenk_2023/
     → Google_Earth_landslides_point_21Dec2021.shp  (185 points)
     → Google_Earth_landslides_polygon_21Dec2021.shp (255 polygons → centroids)

  2. GeoDataIndia LANDSLIDE_POINT / LANDSLIDE_POLYGON shapefiles
     Path: ~/Downloads/  (any ZIP containing LANDSLIDE_POINT or LANDSLIDE_POLYGON)
     Auto-discovered from Downloads folder.

  3. Any *.shp dropped into data/external/shapefiles/

Usage:
    python3 -m src.lib.ml.ingest_shapefiles           # ingest all found
    python3 -m src.lib.ml.ingest_shapefiles --dry-run  # preview only
"""

import os
import sys
import math
import zipfile
import tempfile
import argparse
import warnings
from datetime import date
from pathlib import Path
from collections import Counter
from typing import Optional

warnings.filterwarnings("ignore")

import pandas as pd
import geopandas as gpd
import psycopg2
import psycopg2.extras

# ── Env ───────────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    for line in Path(".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ[k.strip()] = v.strip().strip('"').strip("'")

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()

# ── Config ────────────────────────────────────────────────────────────────────
BBOX         = (86.0, 20.0, 99.0, 31.0)
MAX_ZONE_KM  = 100.0
DEDUP_DAYS   = 7
DEDUP_KM     = 5.0
DOWNLOADS    = Path.home() / "Downloads"
EXTERNAL_SHP = Path("data/external/shapefiles")

# Known source paths
ZENODO_DIR   = DOWNLOADS / "landslide/data/raw/zenodo_heijenk_2023"


# ── Utility ───────────────────────────────────────────────────────────────────

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2-lat1)/2)**2
         + math.cos(phi1)*math.cos(phi2)*math.sin(math.radians(lon2-lon1)/2)**2)
    return 2*R*math.asin(math.sqrt(a))


def in_bbox(lat, lon):
    w, s, e, n = BBOX
    return s <= lat <= n and w <= lon <= e


def assign_zone(lat, lon, zones):
    best_id, best_d = None, float("inf")
    for z in zones:
        d = haversine_km(lat, lon, z["centroid_lat"], z["centroid_lng"])
        if d < best_d:
            best_d, best_id = d, z["id"]
    return (best_id, best_d) if best_d <= MAX_ZONE_KM else (None, best_d)


def parse_year_date(val) -> Optional[date]:
    """Parse dates from messy text: '3/12/2012', '2011', 'Image 10/5/2011', etc."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    val = str(val).strip()
    # Extract trailing date/year token
    token = val.split()[-1] if val.split() else val
    for fmt in ["%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"]:
        try:
            return pd.to_datetime(token, format=fmt).date()
        except Exception:
            pass
    # Year only → use July 15 (mid-monsoon proxy)
    try:
        yr = int(token.split("/")[-1] if "/" in token else token)
        if 1990 <= yr <= 2025:
            return date(yr, 7, 15)
    except Exception:
        pass
    return None


def centroid_of_geometry(geom):
    """Return (lat, lon) centroid for any geometry type."""
    c = geom.centroid
    return c.y, c.x


def dedup_against_existing(new_events, existing):
    exist_map = {}
    for ev in existing:
        key = (ev["zone_id"], ev["event_date"])
        exist_map.setdefault(key, []).append((ev["lat"], ev["lng"]))
    kept = []
    for ev in new_events:
        is_dup = False
        for delta in range(-DEDUP_DAYS, DEDUP_DAYS+1):
            key = (ev["zone_id"],
                   (pd.Timestamp(ev["event_date"]) + pd.Timedelta(days=delta)).date())
            for elat, elng in exist_map.get(key, []):
                if haversine_km(ev["lat"], ev["lng"], elat, elng) <= DEDUP_KM:
                    is_dup = True; break
            if is_dup: break
        if not is_dup:
            kept.append(ev)
    return kept


def dedup_within(events):
    kept = []
    for ev in events:
        is_dup = False
        for i, k in enumerate(kept):
            if k["zone_id"] != ev["zone_id"]: continue
            if abs((pd.Timestamp(ev["event_date"]) - pd.Timestamp(k["event_date"])).days) > DEDUP_DAYS: continue
            if haversine_km(ev["lat"], ev["lng"], k["lat"], k["lng"]) <= DEDUP_KM:
                if ev.get("_dist_km", 999) < k.get("_dist_km", 999):
                    kept[i] = ev
                is_dup = True; break
        if not is_dup:
            kept.append(ev)
    return kept


# ── DB helpers ────────────────────────────────────────────────────────────────

def load_zones(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, district, state, centroid_lat, centroid_lng FROM risk_zones")
    return [dict(r) for r in cur.fetchall()]


def load_existing(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT zone_id, event_date, lat, lng FROM historical_landslides WHERE is_synthetic=false")
    return [{"zone_id": r["zone_id"], "event_date": r["event_date"],
             "lat": r["lat"], "lng": r["lng"]} for r in cur.fetchall()]


def insert_events(conn, events, dry_run=False):
    if not events: return 0
    cur = conn.cursor()
    inserted = 0
    for ev in events:
        if dry_run:
            inserted += 1; continue
        try:
            cur.execute("""
                INSERT INTO historical_landslides
                    (zone_id, event_date, lat, lng, severity, source, is_synthetic, hazard_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (ev["zone_id"], ev["event_date"], ev["lat"], ev["lng"],
                  ev["severity"], ev["source"], False, "rainfall_slope_failure"))
            inserted += cur.rowcount
        except Exception as e:
            print(f"  [INSERT] {e}")
            conn.rollback(); cur = conn.cursor()
    if not dry_run:
        conn.commit()
    return inserted


# ── Source: Process a single GeoDataFrame ─────────────────────────────────────

def gdf_to_events(gdf: gpd.GeoDataFrame, source_name: str, zones: list,
                  date_col: str = None, fallback_year: int = None) -> list:
    """
    Convert a GeoDataFrame (points or polygons) to event dicts.
    Extracts centroids for polygons, tries to parse date from any text column.
    """
    events = []
    skipped_bbox = skipped_date = skipped_zone = 0

    # Try to find a date column automatically
    date_candidates = []
    if date_col and date_col in gdf.columns:
        date_candidates = [date_col]
    else:
        for c in gdf.columns:
            cl = c.lower()
            if any(k in cl for k in ["date","year","descriptio","time","desc","remark"]):
                date_candidates.append(c)

    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            skipped_bbox += 1; continue

        lat, lon = centroid_of_geometry(geom)
        if not in_bbox(lat, lon):
            skipped_bbox += 1; continue

        # Parse date
        ev_date = None
        for dcol in date_candidates:
            ev_date = parse_year_date(row.get(dcol))
            if ev_date:
                break
        if ev_date is None:
            if fallback_year:
                ev_date = date(fallback_year, 7, 15)
            else:
                skipped_date += 1; continue

        zone_id, dist_km = assign_zone(lat, lon, zones)
        if zone_id is None:
            skipped_zone += 1; continue

        # Severity from area if available
        severity = "Moderate"
        if "Area" in row.index or "area" in row.index:
            area_col = "Area" if "Area" in row.index else "area"
            try:
                area = float(row[area_col])
                if area > 500000:
                    severity = "High"
                elif area < 5000:
                    severity = "Low"
            except Exception:
                pass

        # Extra attributes for source string
        extras = []
        for c in ["Name","Type","Descriptio","Remark","Geology","Slope","layer","Extent"]:
            if c in row.index and not pd.isna(row.get(c)):
                extras.append(f"{c}={str(row[c])[:30]}")

        events.append({
            "zone_id": zone_id, "event_date": ev_date, "lat": lat, "lng": lon,
            "severity": severity,
            "source": f"{source_name}; {'; '.join(extras[:4])}; dist_to_zone={dist_km:.1f}km",
            "is_synthetic": False, "hazard_type": "rainfall_slope_failure",
            "_src_key": source_name, "_dist_km": dist_km,
        })

    print(f"    Usable: {len(events)}  (bbox_skip={skipped_bbox} date_skip={skipped_date} zone_skip={skipped_zone})")
    return events


# ── Source extractors ─────────────────────────────────────────────────────────

def ingest_zenodo(zones) -> list:
    if not ZENODO_DIR.exists():
        print(f"  [Zenodo] Not found at {ZENODO_DIR}"); return []

    print(f"\n[Zenodo] Heijenk 2023 — Gangtok basin, Sikkim")
    all_events = []

    # Points
    point_shp = ZENODO_DIR / "Google_Earth_landslides_point_21Dec2021.shp"
    if point_shp.exists():
        gdf = gpd.read_file(point_shp)
        print(f"  Points: {len(gdf)} features")
        ev = gdf_to_events(gdf, "Zenodo Heijenk2023 GE-points Sikkim", zones,
                           date_col="descriptio")
        all_events.extend(ev)

    # Polygons → centroid
    poly_shp = ZENODO_DIR / "Google_Earth_landslides_polygon_21Dec2021.shp"
    if poly_shp.exists():
        gdf = gpd.read_file(poly_shp)
        print(f"  Polygons→centroids: {len(gdf)} features")
        ev = gdf_to_events(gdf, "Zenodo Heijenk2023 GE-polygons Sikkim", zones,
                           date_col="descriptio")
        all_events.extend(ev)

    return all_events


def gdf_geodataindia(gdf: gpd.GeoDataFrame, source_name: str, zones: list) -> list:
    """
    Optimised extractor for GeoDataIndia LANDSLIDE_POLYGON shapefiles.
    Uses pre-computed cent_x/cent_y columns directly.
    Assigns a monsoon-peak proxy date (July 15) since no event dates exist.
    Preserves district, landslide type, material, LULC in source string.
    """
    events = []
    skipped_bbox = skipped_zone = 0

    # GeoDataIndia doesn't have event dates — use a per-district monsoon proxy
    # based on the year field if present, else default 2017 (monsoon data year)
    default_year = 2017

    for _, row in gdf.iterrows():
        try:
            lon = float(row["cent_x"])
            lat = float(row["cent_y"])
        except Exception:
            skipped_bbox += 1; continue

        if not in_bbox(lat, lon):
            skipped_bbox += 1; continue

        zone_id, dist_km = assign_zone(lat, lon, zones)
        if zone_id is None:
            skipped_zone += 1; continue

        ev_date = date(default_year, 7, 15)

        # Build rich source string
        district  = str(row.get("district", "")).strip()
        state_val = str(row.get("state", "")).strip()
        ls_type   = str(row.get("landslide_", "") or row.get("landslide_type", "")).strip()
        material  = str(row.get("material_t", "") or row.get("material_type", "")).strip()
        lulc      = str(row.get("lulc", "")).strip()
        area      = row.get("shape_area", 0) or 0

        severity = "High" if float(area) > 50000 else ("Low" if float(area) < 500 else "Moderate")

        src = (f"{source_name}; district={district}; state={state_val}; "
               f"type={ls_type}; material={material}; lulc={lulc}; "
               f"area_m2={float(area):.0f}; dist_to_zone={dist_km:.1f}km")

        events.append({
            "zone_id": zone_id, "event_date": ev_date, "lat": lat, "lng": lon,
            "severity": severity, "source": src[:500],
            "is_synthetic": False, "hazard_type": "rainfall_slope_failure",
            "_src_key": source_name, "_dist_km": dist_km,
        })

    print(f"    Usable: {len(events)}  (bbox_skip={skipped_bbox} zone_skip={skipped_zone})")
    return events


def ingest_geodataindia_zips(zones) -> list:
    """
    Auto-discovers any ZIPs in Downloads that contain LANDSLIDE_POINT
    or LANDSLIDE_POLYGON shapefiles (GeoDataIndia format).
    """
    print(f"\n[GeoDataIndia] Scanning {DOWNLOADS} for LANDSLIDE_POINT/POLYGON ZIPs...")
    all_events = []

    NE_STATES = {"ARUNACHAL","ASSAM","MANIPUR","MEGHALAYA","MIZORAM",
                 "NAGALAND","SIKKIM","TRIPURA"}
    for zip_path in DOWNLOADS.glob("*.zip"):
        name = zip_path.name.upper()
        # GeoDataIndia outer ZIPs: base64_STATE_<STATENAME>_<id>.zip
        # Inner ZIPs: LANDSLIDE_POLYGON_STATE_<STATENAME>.zip
        is_ls = ("LANDSLIDE_POINT" in name or "LANDSLIDE_POLYGON" in name
                 or ("STATE_" in name and any(s in name for s in NE_STATES)))
        if not is_ls:
            continue

        print(f"  Found: {zip_path.name}")
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                with zipfile.ZipFile(zip_path) as zf:
                    zf.extractall(tmpdir)
                # Double-unzip if needed
                inner_zips = list(Path(tmpdir).glob("*.zip"))
                if inner_zips:
                    with zipfile.ZipFile(inner_zips[0]) as zf2:
                        zf2.extractall(tmpdir)
                shps = list(Path(tmpdir).rglob("*.shp"))
                for shp in shps:
                    print(f"    SHP: {shp.name}")
                    try:
                        gdf = gpd.read_file(shp)
                        print(f"    Features: {len(gdf)}  cols: {list(gdf.columns)}")
                        if len(gdf) == 0:
                            continue
                        state = zip_path.name.upper().split("_STATE_")[-1].split("_")[0] if "_STATE_" in zip_path.name.upper() else "UNKNOWN"
                        # GeoDataIndia polygons have pre-computed cent_x/cent_y
                        # Use those directly instead of computing polygon centroid
                        if "cent_x" in gdf.columns and "cent_y" in gdf.columns:
                            ev = gdf_geodataindia(gdf, f"GeoDataIndia {shp.stem} {state}", zones)
                        else:
                            ev = gdf_to_events(gdf, f"GeoDataIndia {shp.stem} {state}",
                                               zones, fallback_year=2017)
                        all_events.extend(ev)
                    except Exception as e:
                        print(f"    Error reading {shp.name}: {e}")
            except Exception as e:
                print(f"  Error extracting {zip_path.name}: {e}")

    return all_events


def ingest_external_shapefiles(zones) -> list:
    """Reads any .shp dropped into data/external/shapefiles/"""
    EXTERNAL_SHP.mkdir(parents=True, exist_ok=True)
    shps = list(EXTERNAL_SHP.rglob("*.shp"))
    if not shps:
        print(f"\n[External SHP] No files in {EXTERNAL_SHP}/")
        return []
    print(f"\n[External SHP] Found {len(shps)} file(s)")
    all_events = []
    for shp in shps:
        try:
            gdf = gpd.read_file(shp)
            print(f"  {shp.name}: {len(gdf)} features")
            ev = gdf_to_events(gdf, f"External SHP: {shp.stem}", zones)
            all_events.extend(ev)
        except Exception as e:
            print(f"  Error: {shp.name} — {e}")
    return all_events


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Ingest landslide shapefiles into LandAlert-Nexus")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 65)
    print("  LandAlert-Nexus — Shapefile Ingestion")
    if args.dry_run:
        print("  *** DRY RUN ***")
    print("=" * 65)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set"); sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL, connect_timeout=15)
    zones    = load_zones(conn)
    existing = load_existing(conn)
    print(f"[DB] {len(zones)} zones | {len(existing)} existing real events")

    all_new = []
    all_new.extend(ingest_zenodo(zones))
    all_new.extend(ingest_geodataindia_zips(zones))
    all_new.extend(ingest_external_shapefiles(zones))

    print(f"\n[Dedup] Raw candidates: {len(all_new)}")
    all_new = dedup_within(all_new)
    print(f"[Dedup] After cross-source: {len(all_new)}")
    net_new = dedup_against_existing(all_new, existing)
    print(f"[Dedup] Net-new vs DB: {len(net_new)}")

    zone_map = {z["id"]: z["district"] for z in zones}
    if net_new:
        print("\n[Summary] Net-new by district:")
        for dist, cnt in sorted(Counter(zone_map.get(e["zone_id"],"?") for e in net_new).items(), key=lambda x: -x[1]):
            print(f"  {dist:25s}: {cnt}")

    inserted = insert_events(conn, net_new, dry_run=args.dry_run)
    conn.close()

    action = "Would insert" if args.dry_run else "Inserted"
    print(f"\n[DB] {action}: {inserted} new events  (DB now has {len(existing)+inserted} real events)")
    if not args.dry_run and inserted > 0:
        print("Next: python3 -m src.lib.ml.train_v05")
    print("=" * 65)


if __name__ == "__main__":
    main()
