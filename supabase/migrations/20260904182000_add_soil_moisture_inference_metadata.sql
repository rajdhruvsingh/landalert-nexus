-- =============================================================
-- Migration: Add soil moisture inference metadata & dataset fingerprint
-- =============================================================
-- PURPOSE:
--   Addresses requirements from the Final ML Validation audit:
--   1. Explicitly track and expose soil moisture availability status in inference:
--      - 'measured': fresh sensor/satellite reading recorded within the last 72h
--      - 'stale': last recorded reading is older than 72h
--      - 'missing': no soil moisture readings exist for this zone
--      - 'fallback': neutral constant (50.0%) applied
--   2. Add soil_moisture_pct, soil_moisture_status, and soil_moisture_reading_time
--      to public.risk_zones.
--   3. Update public.recompute_risk() to populate these fields and document
--      the exact status in the dynamic explanation string.
--   4. Add dataset_fingerprint column to public.risk_model_config and record
--      the SHA-256 fingerprint of the 32x21 training matrix.
-- =============================================================

-- 1. Add soil moisture metadata columns to risk_zones
ALTER TABLE public.risk_zones
  ADD COLUMN IF NOT EXISTS soil_moisture_pct DOUBLE PRECISION DEFAULT 50.0,
  ADD COLUMN IF NOT EXISTS soil_moisture_status TEXT NOT NULL DEFAULT 'fallback'
    CHECK (soil_moisture_status IN ('measured', 'stale', 'missing', 'fallback')),
  ADD COLUMN IF NOT EXISTS soil_moisture_reading_time TIMESTAMPTZ;

-- 2. Add dataset_fingerprint to risk_model_config
ALTER TABLE public.risk_model_config
  ADD COLUMN IF NOT EXISTS dataset_fingerprint TEXT;

-- 3. Record dataset fingerprint on active v0.2-lr-trained row
UPDATE public.risk_model_config
SET dataset_fingerprint = 'f1054c5041ad8e672a45899f42f037d1f7cd15cc6f55256d8d7d68388ed2aa26',
    notes = notes || ' Dataset SHA256: f1054c5041ad8e672a45899f42f037d1f7cd15cc6f55256d8d7d68388ed2aa26. '
                  || '95% Bootstrap CI: [0.1250, 1.0000] (inconclusive vs threshold 0.3230).'
WHERE is_active = true
  AND model_version = 'v0.2-lr-trained';

-- 4. Re-create recompute_risk() with explicit soil-moisture status tracking
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
  sm_rec        RECORD;
  soil_pct      DOUBLE PRECISION;
  sm_status     TEXT;
  sm_desc       TEXT;
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

    -- ── Soil moisture status distinction ─────────────────────────────
    SELECT soil_moisture_pct, reading_time
      INTO sm_rec
      FROM public.weather_readings
     WHERE zone_id = z.id AND soil_moisture_pct IS NOT NULL
     ORDER BY reading_time DESC
     LIMIT 1;

    IF sm_rec IS NULL OR sm_rec.soil_moisture_pct IS NULL THEN
      sm_status := 'missing';
      soil_pct  := 50.0;
      sm_desc   := 'missing — no station or satellite data; neutral 50% fallback applied';
    ELSIF sm_rec.reading_time < now() - interval '72 hours' THEN
      sm_status := 'stale';
      soil_pct  := sm_rec.soil_moisture_pct;
      sm_desc   := format('stale — last reading from %s >72h old', to_char(sm_rec.reading_time, 'YYYY-MM-DD HH24:MI'));
    ELSE
      sm_status := 'measured';
      soil_pct  := sm_rec.soil_moisture_pct;
      sm_desc   := format('measured — fresh within 72h, recorded %s', to_char(sm_rec.reading_time, 'YYYY-MM-DD HH24:MI'));
    END IF;

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

    -- ── Dynamic explanation (Gap 6 + Soil Moisture Metadata) ────────
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
      'Soil moisture: %s%% (status: %s). '
      'Slope: %s°. Historical events in zone: %s. '
      'Model: %s (weights: intensity=%s antecedent=%s soil=%s slope=%s history=%s). '
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
      sm_desc,
      z.mean_slope_deg,
      hist,
      cfg.model_version,
      ROUND(cfg.weight_intensity::numeric, 2),
      ROUND(cfg.weight_antecedent::numeric, 2),
      ROUND(cfg.weight_soil_moisture::numeric, 2),
      ROUND(cfg.weight_slope::numeric, 2),
      ROUND(cfg.weight_history::numeric, 2),
      score, lvl
    );

    prev := z.current_risk_level;
    UPDATE public.risk_zones
       SET current_risk_level          = lvl,
           risk_score                  = score,
           explanation                 = expl,
           soil_moisture_pct           = ROUND(soil_pct::numeric, 1),
           soil_moisture_status        = sm_status,
           soil_moisture_reading_time  = CASE WHEN sm_status IN ('measured', 'stale') THEN sm_rec.reading_time ELSE NULL END,
           last_computed_at            = now()
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

-- 5. Trigger recomputation to update all zones
SELECT public.recompute_risk();
