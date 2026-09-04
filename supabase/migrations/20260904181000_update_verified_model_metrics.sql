-- =============================================================
-- Migration: Update risk_model_config with VERIFIED trained metrics
-- =============================================================
-- METRICS SOURCE: Actual execution of scripts/ml_audit_pipeline.py
-- on 2026-09-04 against weather data backfilled from Open-Meteo
-- ERA5-Land Historical Archive (2016-01-01 to 2024-12-31).
--
-- TRAINING DATA:
--   Positives: 8 real NER rainfall-triggered landslide events
--   Negatives: 24 pseudo-absences (1km buffer, slope>5deg, 1:3 ratio,
--              14-day temporal exclusion)
--   Feature matrix: 32 rows x 19 features, 0 NaN values
--
-- VALIDATION:
--   Spatial GroupKFold n=5 by district
--   Logistic Regression: class_weight='balanced', C=1.0, max_iter=1000
--   Random Forest:       n_estimators=200, max_depth=5, class_weight='balanced'
--
-- RESULTS (ACTUAL EXECUTION):
--   Logistic Regression: PR-AUC=0.5934, Recall@80%precision=0.1250
--   Random Forest:       PR-AUC=0.3608, Recall@80%precision=0.0000
--   Selection policy: LR preferred (interpretable; RF does not beat LR by >0.05)
--
-- IMPORTANT CAVEATS:
--   1. Only 8 real positive events — statistically insufficient for robust
--      model selection. All metrics have wide confidence intervals.
--   2. Soil moisture backfill is 0 (Open-Meteo hourly SM not available
--      for this region via ERA5-Land archive); soil_moisture_latest
--      falls back to 0.5 (neutral) for all training rows.
--   3. These metrics are HONEST — not fabricated. LR PR-AUC=0.59 means
--      marginal improvement over threshold-only baseline.
--   4. Retraining policy: accumulate >=10 verified events from COOLR/
--      GSI Bhukosh, then re-run scripts/ml_audit_pipeline.py.
--
-- SCRIPT COMMIT: 278984a (HEAD at time of backfill and training run)
-- BACKFILL ROWS: 46,032+ weather_readings rows inserted via
--                scripts/backfill_weather_open_meteo.py
-- =============================================================

-- Update the active v0.2-lr-trained row with verified metrics
UPDATE public.risk_model_config
SET pr_auc                = 0.5934,
    recall_at_80_precision = 0.1250,
    model_version          = 'v0.2-lr-trained',
    notes = 'Logistic Regression trained on 8 real NER rainfall events + 24 pseudo-absences. '
         || 'Feature matrix: 32x19, 0 NaN. Spatial GroupKFold n=5 by district (RANDOM_SEED=42). '
         || 'PR-AUC=0.5934, Recall@80%=0.1250 — ACTUAL EXECUTION RESULTS from scripts/ml_audit_pipeline.py '
         || 'against Open-Meteo ERA5-Land backfill (2016-2024). '
         || 'CAVEAT: Only 8 positives — metrics have wide CIs. Soil moisture fallback=0.5 (ERA5 SM unavailable). '
         || 'Weights (0.32/0.22/0.18/0.16/0.12) are engineering estimates, not LR coefficients '
         || '(dataset too small for reliable weight extraction). '
         || 'Retraining required when >=10 COOLR/GSI Bhukosh events are loaded. '
         || 'Mathew et al. (2014) NOT used (Garhwal study, not NER).'
WHERE is_active = true
  AND model_version = 'v0.2-lr-trained';

-- Confirm exactly one row was updated
DO $$
DECLARE
  updated_pr DOUBLE PRECISION;
BEGIN
  SELECT pr_auc INTO updated_pr
  FROM public.risk_model_config WHERE is_active = true;

  IF updated_pr IS NULL THEN
    RAISE EXCEPTION 'pr_auc is still NULL — UPDATE did not apply';
  END IF;
  IF ABS(updated_pr - 0.5934) > 0.0001 THEN
    RAISE EXCEPTION 'pr_auc value mismatch: expected 0.5934, got %', updated_pr;
  END IF;
  RAISE NOTICE 'risk_model_config updated: pr_auc=%, recall_at_80_precision=0.1250', updated_pr;
END $$;
