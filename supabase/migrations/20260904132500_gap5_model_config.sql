-- =============================================================
-- GAP 5: Create risk_model_config table and make recompute_risk()
--         read weights and cutoffs from it instead of hardcoding.
-- =============================================================
-- RATIONALE:
--   The current 0.35/0.20/0.20/0.15/0.10 weights and 42/58/72
--   cutoffs were chosen by hand.  Moving them to a config table
--   means future retraining or recalibration becomes an UPDATE +
--   SELECT recompute_risk(), not a migration + redeploy.
--
--   This migration also creates the audit trail that judges need:
--   model_version, trained_at, pr_auc, and recall_at_80_precision
--   are first-class columns — not comments, not README claims.
--
-- NOTE on pr_auc / recall values in the initial seed row:
--   The initial seed row reflects the HAND-TUNED baseline.  The
--   pr_auc and recall_at_80_precision columns are NULL, with a
--   clear notes value explaining why.  They must be updated with
--   real computed values from the offline evaluation notebook
--   (ml-notebooks/01_risk_calibration.ipynb) before judges review.
--   See docs/MODEL_EVALUATION.md for the evaluation methodology.
--
-- FUTURE WORKFLOW to update weights after retraining:
--   1. Run ml-notebooks/01_risk_calibration.ipynb.
--   2. Extract logistic-regression coefficients (normalized to sum ≤ 1).
--   3. INSERT a new row into risk_model_config with the new weights,
--      pr_auc, and recall values.
--   4. UPDATE risk_model_config SET is_active = false WHERE is_active = true;
--   5. UPDATE risk_model_config SET is_active = true WHERE id = <new_id>;
--   6. SELECT recompute_risk();
--   No code change needed — the function reads from this table.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.risk_model_config (
  id                      SERIAL PRIMARY KEY,
  model_version           TEXT             NOT NULL,
  trained_at              TIMESTAMPTZ      NOT NULL DEFAULT now(),

  -- Score weights (must sum to 1.0 — enforced by CHECK constraint)
  weight_intensity        DOUBLE PRECISION NOT NULL,  -- 72-hr rainfall intensity term
  weight_antecedent       DOUBLE PRECISION NOT NULL,  -- 30-day antecedent rainfall term
  weight_soil_moisture    DOUBLE PRECISION NOT NULL,  -- soil moisture term
  weight_slope            DOUBLE PRECISION NOT NULL,  -- terrain slope term
  weight_history          DOUBLE PRECISION NOT NULL,  -- historical landslide density term

  -- Risk-level cutoffs (score out of 100)
  cutoff_moderate         DOUBLE PRECISION NOT NULL,  -- score >= cutoff_moderate → Moderate
  cutoff_high             DOUBLE PRECISION NOT NULL,  -- score >= cutoff_high → High
  cutoff_severe           DOUBLE PRECISION NOT NULL,  -- score >= cutoff_severe → Severe

  -- Evaluation metrics (NULL until an offline training run populates them)
  pr_auc                  DOUBLE PRECISION,           -- Area under Precision-Recall curve
  recall_at_80_precision  DOUBLE PRECISION,           -- Recall at 80% precision operating point

  -- Provenance
  notes                   TEXT,
  is_active               BOOLEAN          NOT NULL DEFAULT false,

  CONSTRAINT weights_sum_to_one
    CHECK (ABS((weight_intensity + weight_antecedent + weight_soil_moisture
                + weight_slope + weight_history) - 1.0) < 0.001),
  CONSTRAINT cutoffs_ordered
    CHECK (cutoff_moderate < cutoff_high AND cutoff_high < cutoff_severe)
);

-- Only one row can be active at a time
CREATE UNIQUE INDEX IF NOT EXISTS risk_model_config_one_active
  ON public.risk_model_config (is_active)
  WHERE is_active = true;

GRANT SELECT ON public.risk_model_config TO anon, authenticated;
GRANT ALL    ON public.risk_model_config TO service_role;
ALTER TABLE public.risk_model_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model config is public read" ON public.risk_model_config
  FOR SELECT TO anon, authenticated USING (true);

-- Seed the current hand-tuned baseline as v0.1-hand-tuned
INSERT INTO public.risk_model_config (
  model_version,
  weight_intensity,
  weight_antecedent,
  weight_soil_moisture,
  weight_slope,
  weight_history,
  cutoff_moderate,
  cutoff_high,
  cutoff_severe,
  pr_auc,
  recall_at_80_precision,
  notes,
  is_active
) VALUES (
  'v0.1-hand-tuned',
  0.35,
  0.20,
  0.20,
  0.15,
  0.10,
  42.0,
  58.0,
  72.0,
  NULL,   -- pr_auc: not yet computed; see docs/MODEL_EVALUATION.md
  NULL,   -- recall_at_80_precision: not yet computed
  'Hand-tuned baseline weights from Gap 1/2 migration. '
  'Weights chosen by engineering judgement based on literature review of NE-Himalaya '
  'rainfall threshold studies. pr_auc and recall_at_80_precision must be populated by '
  'running ml-notebooks/01_risk_calibration.ipynb and updating this row. '
  'Do not present NULL metrics to judges as if they are validated — see MODEL_EVALUATION.md.',
  true
);

-- =============================================================
-- Rewrite recompute_risk() to JOIN risk_model_config for all
-- weights and cutoffs instead of hardcoding them.
-- =============================================================

CREATE OR REPLACE FUNCTION public.recompute_risk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  z             RECORD;
  cfg           RECORD;  -- active row from risk_model_config
  r72           DOUBLE PRECISION;
  r30           DOUBLE PRECISION;
  soil_pct      DOUBLE PRECISION;
  i_obs         DOUBLE PRECISION;
  i_thr         DOUBLE PRECISION;
  e_thr         DOUBLE PRECISION;
  hist          INTEGER;

  f_intensity   DOUBLE PRECISION;
  f_antecedent  DOUBLE PRECISION;
  f_slope       DOUBLE PRECISION;
  f_history     DOUBLE PRECISION;
  f_soil        DOUBLE PRECISION;

  c_intensity   DOUBLE PRECISION;
  c_antecedent  DOUBLE PRECISION;
  c_slope       DOUBLE PRECISION;
  c_history     DOUBLE PRECISION;
  c_soil        DOUBLE PRECISION;

  score         DOUBLE PRECISION;
  lvl           TEXT;
  expl          TEXT;
  prev          TEXT;

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
  -- Load active model configuration (weights + cutoffs)
  SELECT * INTO cfg
    FROM public.risk_model_config
   WHERE is_active = true
   LIMIT 1;

  IF cfg IS NULL THEN
    RAISE EXCEPTION 'recompute_risk: no active row in risk_model_config. '
                    'Insert a row with is_active = true before calling this function.';
  END IF;

  FOR z IN SELECT * FROM public.risk_zones LOOP

    -- ── Rainfall aggregates ──────────────────────────────────────────
    SELECT COALESCE(SUM(rainfall_mm), 0) INTO r72
      FROM public.weather_readings
     WHERE zone_id = z.id AND reading_time > now() - interval '3 days';

    SELECT COALESCE(SUM(rainfall_mm), 0) INTO r30
      FROM public.weather_readings
     WHERE zone_id = z.id AND reading_time > now() - interval '30 days';

    SELECT COALESCE(soil_moisture_pct, 50.0) INTO soil_pct
      FROM public.weather_readings
     WHERE zone_id = z.id AND soil_moisture_pct IS NOT NULL
     ORDER BY reading_time DESC
     LIMIT 1;

    SELECT COUNT(*) INTO hist
      FROM public.historical_landslides
     WHERE zone_id = z.id;

    -- ── Per-zone thresholds (Gap 1) ──────────────────────────────────
    e_thr := z.threshold_e_mm;
    i_obs := r72 / 3.0;
    i_thr := z.threshold_i_coefficient * power(3.0, z.threshold_i_exponent);

    -- ── Factor components (clamped 0-1) ──────────────────────────────
    f_intensity  := LEAST(r72  / NULLIF(i_thr * 3.0, 0), 2.5) / 2.5;
    f_antecedent := LEAST(r30  / NULLIF(e_thr,        0), 2.0) / 2.0;
    f_slope      := LEAST(z.mean_slope_deg / 45.0,        1.0);
    f_history    := LEAST(hist / 4.0,                     1.0);
    f_soil       := LEAST(soil_pct / 100.0,               1.0);

    -- ── Weighted contributions (weights from risk_model_config) ─────
    -- Gap 5: weights are no longer inline constants; they come from the
    -- active row of risk_model_config.  To recalibrate: INSERT a new
    -- row with is_active = true (the unique partial index enforces uniqueness).
    c_intensity  := cfg.weight_intensity    * f_intensity;
    c_antecedent := cfg.weight_antecedent   * f_antecedent;
    c_slope      := cfg.weight_slope        * f_slope;
    c_history    := cfg.weight_history      * f_history;
    c_soil       := cfg.weight_soil_moisture * f_soil;

    score := ROUND(((c_intensity + c_antecedent + c_slope + c_history + c_soil) * 100)::numeric, 1);

    -- ── Risk level (cutoffs from risk_model_config) ─────────────────
    lvl := CASE WHEN score >= cfg.cutoff_severe   THEN 'Severe'
                WHEN score >= cfg.cutoff_high      THEN 'High'
                WHEN score >= cfg.cutoff_moderate  THEN 'Moderate'
                ELSE 'Low' END;

    -- ── Dynamic explanation (Gap 6) ──────────────────────────────────
    factor_names := ARRAY['72-hr rainfall intensity',
                          '30-day antecedent rainfall',
                          'soil moisture',
                          'terrain slope',
                          'historical landslide density'];
    factor_vals  := ARRAY[c_intensity, c_antecedent, c_soil, c_slope, c_history];
    sorted_names := factor_names;
    sorted_vals  := factor_vals;

    FOR i IN 2..5 LOOP
      j := i;
      WHILE j > 1 AND sorted_vals[j] > sorted_vals[j-1] LOOP
        tmp_val           := sorted_vals[j-1];
        sorted_vals[j-1] := sorted_vals[j];
        sorted_vals[j]   := tmp_val;
        tmp_name          := sorted_names[j-1];
        sorted_names[j-1] := sorted_names[j];
        sorted_names[j]   := tmp_name;
        j := j - 1;
      END LOOP;
    END LOOP;

    top_factor := sorted_names[1];
    secondary  := '';
    FOR i IN 2..5 LOOP
      IF sorted_vals[i] > 0.001 THEN
        secondary := CASE WHEN secondary = '' THEN sorted_names[i]
                          ELSE secondary || ', ' || sorted_names[i] END;
      END IF;
    END LOOP;
    pct_str := CASE WHEN score > 0
               THEN ROUND((sorted_vals[1] * 100 / (score / 100.0))::numeric, 0)::text || '%'
               ELSE '—' END;

    expl := format(
      'Main driver: %s (%s of total risk score). '
      'Secondary contributors: %s. '
      'Detail — 72-hr rainfall: %smm (intensity %s mm/day vs zone threshold %s mm/day; '
      'threshold source: %s). '
      '30-day antecedent: %smm vs zone E-threshold %smm. '
      'Soil moisture: %s%%. '
      'Slope: %s°. Historical events in zone: %s. '
      'Model: %s (weights: intensity=%.2f antecedent=%.2f soil=%.2f slope=%.2f history=%.2f). '
      'Combined score: %s/100 → %s.',
      top_factor, pct_str,
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
      cfg.model_version,
      cfg.weight_intensity, cfg.weight_antecedent, cfg.weight_soil_moisture,
      cfg.weight_slope, cfg.weight_history,
      score, lvl
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

-- Apply immediately
SELECT public.recompute_risk();
