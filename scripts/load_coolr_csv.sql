-- =============================================================
-- Load COOLR (NASA) or GSI Bhukosh landslide CSV export into
-- historical_landslides with is_synthetic = false.
--
-- Usage:
--   1. Download COOLR CSV from https://gpm.nasa.gov/landslides/data.html
--      Filter to NER bounding box: lat 20-30°N, lng 88-97°E
--      Save as: data/raw/coolr_ner_export.csv
--
--   2. Run this script:
--      psql $DATABASE_URL -f scripts/load_coolr_csv.sql
--
-- COOLR CSV column names (as of 2024):
--   event_id, location_description, event_date, latitude, longitude,
--   country_name, admin1_name, trigger, landslide_type,
--   fatality_count, injury_count, notes, source_name, source_link
--
-- GSI Bhukosh CSV: adapt the column mapping below as needed.
-- =============================================================

-- 1. Create staging table
CREATE TABLE IF NOT EXISTS staging_coolr_raw (
  event_id          TEXT,
  location_desc     TEXT,
  event_date        TEXT,
  latitude          TEXT,
  longitude         TEXT,
  country_name      TEXT,
  admin1_name       TEXT,
  trigger           TEXT,
  landslide_type    TEXT,
  fatality_count    TEXT,
  injury_count      TEXT,
  notes             TEXT,
  source_name       TEXT,
  source_link       TEXT
);

TRUNCATE staging_coolr_raw;

-- 2. Load CSV (run \copy manually before executing the INSERT below)
-- psql command:
-- \copy staging_coolr_raw FROM 'data/raw/coolr_ner_export.csv' CSV HEADER;

-- 3. Validate staging data
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM staging_coolr_raw
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      AND event_date IS NOT NULL;
  IF n = 0 THEN
    RAISE EXCEPTION 'staging_coolr_raw is empty or has no valid rows — run \copy first';
  END IF;
  RAISE NOTICE 'staging_coolr_raw: % valid rows', n;
END;
$$;

-- 4. Insert into historical_landslides, matched to nearest risk_zone centroid
-- Uses Postgres point type distance operator for zone matching
INSERT INTO public.historical_landslides
  (zone_id, event_date, lat, lng, severity, source, is_synthetic)
SELECT
  rz.id AS zone_id,
  s.event_date::date,
  s.latitude::double precision,
  s.longitude::double precision,
  CASE
    WHEN s.fatality_count ~ '^\d+$' AND s.fatality_count::int > 20 THEN 'Major'
    WHEN s.fatality_count ~ '^\d+$' AND s.fatality_count::int > 5  THEN 'Moderate'
    WHEN s.fatality_count ~ '^\d+$' AND s.fatality_count::int > 0  THEN 'Minor'
    ELSE 'Unknown'
  END AS severity,
  format(
    'COOLR (NASA) event_id=%s; source=%s; link=%s; loaded %s',
    COALESCE(s.event_id, 'unknown'),
    COALESCE(s.source_name, 'not provided'),
    COALESCE(s.source_link, 'not provided'),
    now()::date
  ) AS source,
  false AS is_synthetic
FROM staging_coolr_raw s
CROSS JOIN LATERAL (
  SELECT id
  FROM public.risk_zones
  WHERE
    -- Only match if within 100km of a zone centroid
    point(centroid_lng, centroid_lat) <-> point(s.longitude::float, s.latitude::float) < 1.0
  ORDER BY
    point(centroid_lng, centroid_lat) <-> point(s.longitude::float, s.latitude::float)
  LIMIT 1
) rz
WHERE
  s.latitude IS NOT NULL AND s.longitude IS NOT NULL
  AND s.event_date ~ '^\d{4}-\d{2}-\d{2}'
  AND s.country_name ILIKE '%India%'
ON CONFLICT DO NOTHING;

-- 5. Report results
SELECT
  rz.zone_name,
  rz.state,
  COUNT(*) AS real_events_loaded
FROM public.historical_landslides hl
JOIN public.risk_zones rz ON rz.id = hl.zone_id
WHERE hl.is_synthetic = false
  AND hl.source ILIKE 'COOLR%'
GROUP BY rz.zone_name, rz.state
ORDER BY real_events_loaded DESC;

-- 6. Cleanup staging
DROP TABLE IF EXISTS staging_coolr_raw;
