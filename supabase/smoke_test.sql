-- =============================================================
-- SQL smoke test / regression guard for recompute_risk()
--
-- Purpose: Insert a known synthetic rainfall spike for zone 1
-- (Tamenglong, Manipur), call recompute_risk(), and assert that
-- the resulting risk_level and score fall within expected ranges.
--
-- This test must run clean against a local Supabase instance that
-- has had all migrations applied (including Gap 1 and Gap 2).
--
-- Usage:
--   psql $DATABASE_URL -f supabase/smoke_test.sql
--   # Or via supabase CLI:
--   supabase db reset && psql $DATABASE_URL -f supabase/smoke_test.sql
--
-- Exit codes: 0 = all assertions passed; non-zero = failure (via RAISE)
-- =============================================================

BEGIN;

-- ── Setup ────────────────────────────────────────────────────────────────────
-- Record baseline state of zone 1 (Tamenglong, Manipur)
DO $$
DECLARE
  zone_id_under_test  INTEGER := 1;
  inserted_count      INTEGER;
  result_level        TEXT;
  result_score        DOUBLE PRECISION;
  min_expected_score  DOUBLE PRECISION := 58.0;   -- Must reach High or Severe
  expected_levels     TEXT[]           := ARRAY['High', 'Severe'];
BEGIN

  -- ── Inject a 300mm rainfall spike distributed over the last 3 days ──────
  -- This simulates an extreme monsoon event.
  -- 300mm in 3 days = 100 mm/day intensity.
  -- For zone 1 (Manipur): i_thr ≈ 36.0 * 3^-0.72 ≈ 14.4 mm/day.
  -- So intensity ratio = 100/14.4 ≈ 6.9, clamped at 2.5.
  -- The intensity term alone would be 0.35 * 1.0 = 0.35 (35 points).
  -- Combined with slope (mean_slope_deg=31.4 → 0.15*(31.4/45)≈0.105),
  -- soil moisture (fixture ≈ 50% → 0.20*0.5=0.10), antecedent and history,
  -- total should comfortably exceed 58 (High threshold).

  INSERT INTO public.weather_readings (zone_id, station_id, reading_time, rainfall_mm, soil_moisture_pct, source)
  VALUES
    (zone_id_under_test, 'SMOKE-TEST-1', now() - interval '1 day', 100.0, 85.0, 'smoke_test'),
    (zone_id_under_test, 'SMOKE-TEST-1', now() - interval '2 days', 100.0, 80.0, 'smoke_test'),
    (zone_id_under_test, 'SMOKE-TEST-1', now() - interval '3 days', 100.0, 75.0, 'smoke_test');

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count <> 3 THEN
    RAISE EXCEPTION 'SMOKE TEST FAIL: Expected 3 rows inserted, got %', inserted_count;
  END IF;

  -- ── Run recompute_risk() ─────────────────────────────────────────────────
  PERFORM public.recompute_risk();

  -- ── Read result ──────────────────────────────────────────────────────────
  SELECT current_risk_level, risk_score
    INTO result_level, result_score
    FROM public.risk_zones
   WHERE id = zone_id_under_test;

  -- ── Assertions ───────────────────────────────────────────────────────────

  -- Assertion 1: risk_level must be High or Severe
  IF result_level <> ALL(expected_levels) THEN
    RAISE EXCEPTION
      'SMOKE TEST FAIL [assertion 1]: zone 1 risk_level should be High or Severe after 300mm spike, got "%". Score: %',
      result_level, result_score;
  END IF;
  RAISE NOTICE 'PASS [assertion 1]: risk_level = % ✓', result_level;

  -- Assertion 2: score must be >= 58.0
  IF result_score < min_expected_score THEN
    RAISE EXCEPTION
      'SMOKE TEST FAIL [assertion 2]: zone 1 risk_score should be >= % after 300mm spike, got %',
      min_expected_score, result_score;
  END IF;
  RAISE NOTICE 'PASS [assertion 2]: risk_score = % (>= %) ✓', result_score, min_expected_score;

  -- Assertion 3: explanation must not be NULL or empty
  IF (SELECT explanation FROM public.risk_zones WHERE id = zone_id_under_test) IS NULL
     OR (SELECT explanation FROM public.risk_zones WHERE id = zone_id_under_test) = '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAIL [assertion 3]: explanation is NULL or empty';
  END IF;
  RAISE NOTICE 'PASS [assertion 3]: explanation is non-empty ✓';

  -- Assertion 4: an alert should have been inserted (High or Severe escalation)
  IF NOT EXISTS (
    SELECT 1 FROM public.alerts
     WHERE zone_id = zone_id_under_test
       AND risk_level = result_level
       AND dispatched_at > now() - interval '5 minutes'
  ) THEN
    RAISE WARNING
      'SMOKE TEST WARNING [assertion 4]: no alert inserted for zone 1 — this may be expected if risk level did not change from a previous run';
  ELSE
    RAISE NOTICE 'PASS [assertion 4]: alert dispatched for zone 1 ✓';
  END IF;

  -- ── Cleanup smoke test data ───────────────────────────────────────────────
  DELETE FROM public.weather_readings WHERE station_id = 'SMOKE-TEST-1';
  RAISE NOTICE 'Smoke test readings cleaned up.';

  RAISE NOTICE '──────────────────────────────────────────────';
  RAISE NOTICE 'ALL SMOKE TEST ASSERTIONS PASSED for zone 1 (Tamenglong, Manipur)';
  RAISE NOTICE 'risk_level: %   risk_score: %', result_level, result_score;
  RAISE NOTICE '──────────────────────────────────────────────';

END;
$$;

-- Roll back the smoke test so it doesn't leave side-effects on a shared DB.
-- Comment out this ROLLBACK if you want the spike to persist for manual inspection.
ROLLBACK;
