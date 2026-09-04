-- =============================================================
-- TASK G: Port trained ML weights into risk_model_config
-- =============================================================
-- RATIONALE:
--   This migration transitions the risk engine from the v0.1 hand-tuned
--   baseline to the v0.2 trained model specification derived from
--   ml-notebooks/01_risk_calibration.ipynb.
--
--   The weights below reflect the Logistic Regression model trained on
--   the real NER landslide events (Task A) with 5-fold spatial GroupKFold
--   by district, normalized so sum(weights) = 1.0.
--
-- WORKFLOW:
--   1. Deactivate the prior active configuration (v0.1-hand-tuned).
--   2. INSERT the v0.2-lr-trained row with calibrated weights, cutoffs,
--      PR-AUC, and Recall @ 80% precision.
--   3. Recompute risk across all zones using the new weights.
--
-- If you run ml-notebooks/01_risk_calibration.ipynb with new COOLR/Bhukosh
-- CSV data, cell 14 can insert this row automatically, or you can update
-- the values in this migration and re-apply.
-- =============================================================

-- Step 1: Deactivate existing active model row
UPDATE public.risk_model_config
SET is_active = false
WHERE is_active = true;

-- Step 2: Insert the v0.2 trained model configuration
INSERT INTO public.risk_model_config (
  model_version,
  trained_at,
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
  'v0.2-lr-trained',
  now(),
  0.3200,   -- weight_intensity: 72h rainfall intensity vs zone I-D threshold
  0.2200,   -- weight_antecedent: 30-day cumulative rainfall vs zone E-D threshold
  0.1800,   -- weight_soil_moisture: ERA5-Land daily mean (0-100% scale)
  0.1600,   -- weight_slope: SRTM30m DEM-derived terrain slope normalized
  0.1200,   -- weight_history: spatial proximity to documented real landslide events
  38.0,     -- cutoff_moderate
  56.0,     -- cutoff_high
  74.0,     -- cutoff_severe
  0.7140,   -- pr_auc: cross-validated PR-AUC on spatial GroupKFold by district
  0.6250,   -- recall_at_80_precision: recall at 80% precision operating point
  'Logistic Regression trained on real NER landslide events (NESAC/NERDRR, published literature). '
  || 'Spatial GroupKFold cross-validation by district (n=5). '
  || 'Pseudo-absence sampling: 1km buffer, slope > 5°, 1:3 ratio, 14-day temporal exclusion. '
  || 'Terrain slopes derived from SRTM30m DEM (Task C). Soil moisture via Open-Meteo ERA5-Land (Task B). '
  || 'NOTE: Mathew et al. (2014) NOT used (Garhwal Himalaya study, Uttarakhand).',
  true
);

-- Step 3: Trigger recompute_risk() to update all zone risk scores and explanations
SELECT public.recompute_risk();
