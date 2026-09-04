-- =============================================================
-- GAP 2: Add soil_moisture_pct as a scored input to recompute_risk()
-- GAP 6: Replace fixed-order explanation with dynamic factor ranking
-- =============================================================
--
-- GAP 2 PROBLEM: weather_readings.soil_moisture_pct is ingested
-- and stored but was never referenced inside recompute_risk().
--
-- GAP 6 PROBLEM: The explanation always listed all factors in the
-- same fixed order regardless of which one actually drove the score.
--
-- COMBINED FIX:
--   - Rebalanced weights (Gap 2):
--       0.35  72-hr rainfall intensity vs zone I-D threshold
--       0.20  30-day antecedent rainfall vs zone E threshold
--       0.15  terrain slope
--       0.10  historical landslide count
--       0.20  latest soil_moisture_pct (normalized 0-100 → 0-1)
--
--   - Dynamic explanation (Gap 6):
--       Each factor's contribution is computed as a variable.
--       Factors are sorted by magnitude (largest first).
--       The explanation string names the dominant factor first,
--       then secondary contributors — this is a legitimate
--       linear-model feature attribution (no SHAP required for a
--       weighted-sum formula; the ranking IS the attribution).
--
-- NOTE: Gap 5 will move the weights and cutoffs into the
--       risk_model_config table; this migration is the interim step.
-- =============================================================

CREATE OR REPLACE FUNCTION public.recompute_risk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  z             RECORD;
  r72           DOUBLE PRECISION;  -- 72-hr cumulative rainfall (mm)
  r30           DOUBLE PRECISION;  -- 30-day cumulative rainfall (mm)
  soil_pct      DOUBLE PRECISION;  -- latest soil_moisture_pct (0-100)
  i_obs         DOUBLE PRECISION;  -- observed 72-hr intensity (mm/day)
  i_thr         DOUBLE PRECISION;  -- zone I-D threshold at D=3 days (mm/day)
  e_thr         DOUBLE PRECISION;  -- zone 30-day E threshold (mm)
  hist          INTEGER;           -- historical landslide count

  -- Individual factor contributions to the 0-1 score (before multiplying by weight)
  f_intensity   DOUBLE PRECISION;  -- rainfall intensity ratio (0-1)
  f_antecedent  DOUBLE PRECISION;  -- antecedent rainfall ratio (0-1)
  f_slope       DOUBLE PRECISION;  -- slope component (0-1)
  f_history     DOUBLE PRECISION;  -- historical density component (0-1)
  f_soil        DOUBLE PRECISION;  -- soil moisture component (0-1)

  -- Weighted contributions (factor × weight) — used for ranking
  c_intensity   DOUBLE PRECISION;
  c_antecedent  DOUBLE PRECISION;
  c_slope       DOUBLE PRECISION;
  c_history     DOUBLE PRECISION;
  c_soil        DOUBLE PRECISION;

  score         DOUBLE PRECISION;
  lvl           TEXT;
  expl          TEXT;
  prev          TEXT;

  -- For sorting factors by magnitude
  factor_names  TEXT[];
  factor_vals   DOUBLE PRECISION[];
  sorted_names  TEXT[];
  sorted_vals   DOUBLE PRECISION[];
  i             INTEGER;
  j             INTEGER;
  tmp_name      TEXT;
  tmp_val       DOUBLE PRECISION;
  top_factor    TEXT;
  secondary     TEXT;
  pct_str       TEXT;
BEGIN
  FOR z IN SELECT * FROM public.risk_zones LOOP

    -- ── Rainfall aggregates ──────────────────────────────────────────
    SELECT COALESCE(SUM(rainfall_mm), 0) INTO r72
      FROM public.weather_readings
     WHERE zone_id = z.id AND reading_time > now() - interval '3 days';

    SELECT COALESCE(SUM(rainfall_mm), 0) INTO r30
      FROM public.weather_readings
     WHERE zone_id = z.id AND reading_time > now() - interval '30 days';

    -- Latest soil moisture reading (most recent non-null value)
    SELECT COALESCE(soil_moisture_pct, 50.0) INTO soil_pct
      FROM public.weather_readings
     WHERE zone_id = z.id AND soil_moisture_pct IS NOT NULL
     ORDER BY reading_time DESC
     LIMIT 1;

    SELECT COUNT(*) INTO hist
      FROM public.historical_landslides
     WHERE zone_id = z.id;

    -- ── Threshold values (Gap 1 — per-zone) ─────────────────────────
    e_thr := z.threshold_e_mm;
    i_obs := r72 / 3.0;
    i_thr := z.threshold_i_coefficient * power(3.0, z.threshold_i_exponent);

    -- ── Factor components (all clamped 0-1) ─────────────────────────
    f_intensity  := LEAST(r72  / NULLIF(i_thr * 3.0, 0), 2.5) / 2.5;
    f_antecedent := LEAST(r30  / NULLIF(e_thr,        0), 2.0) / 2.0;
    f_slope      := LEAST(z.mean_slope_deg / 45.0,        1.0);
    f_history    := LEAST(hist / 4.0,                     1.0);
    f_soil       := LEAST(soil_pct / 100.0,               1.0);   -- 0-100 → 0-1

    -- ── WEIGHTS (Gap 2 rebalance) ────────────────────────────────────
    -- Rationale: soil moisture accounts for pre-wetting state of the
    -- hillslope, which mediates how quickly additional rainfall reaches
    -- the failure threshold.  Antecedent rainfall weight reduced to
    -- make room; intensity stays dominant since it's the most direct
    -- trigger signal.
    --   0.35  intensity (primary trigger)
    --   0.20  antecedent E threshold (precondition)
    --   0.20  soil moisture (precondition, orthogonal to antecedent)
    --   0.15  slope (static terrain factor)
    --   0.10  historical density (proxy for lithology/susceptibility)
    -- NOTE: Gap 5 will load these from risk_model_config; see that
    -- migration for the transition to a config-table-driven approach.
    c_intensity  := 0.35 * f_intensity;
    c_antecedent := 0.20 * f_antecedent;
    c_slope      := 0.15 * f_slope;
    c_history    := 0.10 * f_history;
    c_soil       := 0.20 * f_soil;

    score := ROUND(((c_intensity + c_antecedent + c_slope + c_history + c_soil) * 100)::numeric, 1);

    -- ── Risk level ───────────────────────────────────────────────────
    lvl := CASE WHEN score >= 72 THEN 'Severe'
                WHEN score >= 58 THEN 'High'
                WHEN score >= 42 THEN 'Moderate'
                ELSE 'Low' END;

    -- ── Gap 6: Dynamic factor ranking ───────────────────────────────
    -- Build parallel arrays of factor names and their weighted contributions.
    -- Bubble-sort descending so the largest driver appears first.
    factor_names := ARRAY['72-hr rainfall intensity',
                          '30-day antecedent rainfall',
                          'soil moisture',
                          'terrain slope',
                          'historical landslide density'];
    factor_vals  := ARRAY[c_intensity, c_antecedent, c_soil, c_slope, c_history];
    sorted_names := factor_names;
    sorted_vals  := factor_vals;

    -- Simple insertion sort (5 elements — no overhead concern in PL/pgSQL)
    FOR i IN 2..5 LOOP
      j := i;
      WHILE j > 1 AND sorted_vals[j] > sorted_vals[j-1] LOOP
        tmp_val          := sorted_vals[j-1];
        sorted_vals[j-1] := sorted_vals[j];
        sorted_vals[j]   := tmp_val;
        tmp_name          := sorted_names[j-1];
        sorted_names[j-1] := sorted_names[j];
        sorted_names[j]   := tmp_name;
        j := j - 1;
      END LOOP;
    END LOOP;

    top_factor := sorted_names[1];
    -- Collect secondary factors (all except the top, skip zeros)
    secondary := '';
    FOR i IN 2..5 LOOP
      IF sorted_vals[i] > 0.001 THEN
        IF secondary = '' THEN
          secondary := sorted_names[i];
        ELSE
          secondary := secondary || ', ' || sorted_names[i];
        END IF;
      END IF;
    END LOOP;
    -- Express top factor contribution as % of total score for context
    pct_str := CASE WHEN score > 0
               THEN ROUND((sorted_vals[1] * 100 / (score / 100.0))::numeric, 0)::text || '%'
               ELSE '—' END;

    -- Build explanation with dominant factor first
    expl := format(
      'Main driver: %s (%s of total risk score). '
      'Secondary contributors: %s. '
      'Detail — 72-hr rainfall: %smm (intensity %s mm/day vs zone threshold %s mm/day; '
      'threshold source: %s). '
      '30-day antecedent: %smm vs zone E-threshold %smm. '
      'Soil moisture: %s%%. '
      'Slope: %s°. Historical events in zone: %s. '
      'Combined score: %s/100 → %s.',
      top_factor,
      pct_str,
      CASE WHEN secondary = '' THEN 'none significant' ELSE secondary END,
      ROUND(r72::numeric, 1),
      ROUND(i_obs::numeric, 1),
      ROUND(i_thr::numeric, 1),
      z.threshold_source,
      ROUND(r30::numeric, 1),
      ROUND(e_thr::numeric, 1),
      ROUND(soil_pct::numeric, 1),
      z.mean_slope_deg,
      hist,
      score,
      lvl
    );

    prev := z.current_risk_level;
    UPDATE public.risk_zones
       SET current_risk_level = lvl,
           risk_score         = score,
           explanation        = expl,
           last_computed_at   = now()
     WHERE id = z.id;

    IF lvl IN ('High', 'Severe') AND (prev IS DISTINCT FROM lvl) THEN
      INSERT INTO public.alerts (zone_id, risk_level, message, language, channel, explanation)
      VALUES (
        z.id, lvl,
        format('%s LANDSLIDE RISK for %s, %s. Avoid slope-cut roads and report cracks or slumping immediately.',
               upper(lvl), z.zone_name, z.state),
        'en', 'both', expl
      );
    END IF;

  END LOOP;
END;
$$;

-- Re-run immediately so scores reflect the new weights and explanation format
SELECT public.recompute_risk();
