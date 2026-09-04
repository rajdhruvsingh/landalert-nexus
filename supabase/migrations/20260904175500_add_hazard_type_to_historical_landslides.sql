-- =============================================================
-- Migration: Add hazard_type column to historical_landslides
-- =============================================================
-- Categorizes events into:
--   - 'rainfall_slope_failure': precipitation / antecedent moisture driven
--   - 'glof_triggered': glacial lake outburst flood induced failure
--   - 'other': seismic, construction-induced, or other causes
--
-- RATIONALE:
--   The Teesta Valley event (zone 11, 2023-10-04) was initiated by the
--   South Lhonak Glacial Lake Outburst Flood (GLOF), destroying the
--   Teesta III Dam and destabilizing valley slopes. It was NOT a
--   rainfall-threshold event and must not calibrate the rainfall
--   risk engine.
-- =============================================================

ALTER TABLE public.historical_landslides
  ADD COLUMN IF NOT EXISTS hazard_type TEXT NOT NULL DEFAULT 'rainfall_slope_failure'
  CONSTRAINT valid_hazard_type CHECK (hazard_type IN ('rainfall_slope_failure', 'glof_triggered', 'other'));

-- Backfill Teesta GLOF event as 'glof_triggered'
UPDATE public.historical_landslides
SET hazard_type = 'glof_triggered'
WHERE zone_id = 11 AND event_date = '2023-10-04' AND is_synthetic = false;

-- Ensure all other documented real events are marked 'rainfall_slope_failure'
UPDATE public.historical_landslides
SET hazard_type = 'rainfall_slope_failure'
WHERE is_synthetic = false AND NOT (zone_id = 11 AND event_date = '2023-10-04');
