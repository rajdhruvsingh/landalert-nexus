-- =============================================================================
-- Migration: 20260906190000_register_and_activate_v0_4.sql
-- Purpose:   Register and activate v0.4-lr-trained after satisfying the authoritative
--            scientific gate (>= 200 real verified events, current count = 549).
-- =============================================================================

BEGIN;

-- 1. Ensure unique constraint on model_version if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'risk_model_config_model_version_unique'
    ) THEN
        ALTER TABLE public.risk_model_config
            ADD CONSTRAINT risk_model_config_model_version_unique UNIQUE (model_version);
    END IF;
END $$;

-- 2. Insert or update v0.4-lr-trained in public.risk_model_config
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
    is_active,
    status,
    artifact_path,
    feature_schema_version,
    dataset_fingerprint
) VALUES (
    'v0.4-lr-trained',
    '2026-09-06T17:12:55Z',
    0.3000,
    0.2200,
    0.2000,
    0.1600,
    0.1200,
    38.0,
    56.0,
    74.0,
    0.6037,
    0.0086,
    'Production model v0.4-lr-trained. Trained on 467 real NER rainfall-triggered landslides and 1401 pseudo-absences. Validation method: Spatial GroupKFold n=5 by district. Soil moisture incorporates measured ERA5-Land data (0-7cm daily mean) where available. ACTUAL EXECUTION: Spatial GroupKFold CV PR-AUC = 0.6037, Recall@80% = 0.0086. COOLR / GSI retraining trigger: re-evaluate when >= 200 new events are ingested.',
    false,
    'candidate',
    'models/v0.4-lr-trained.json',
    'v1.0.0',
    '89e2184ce12c0bb6f123a70a32053749d4ae02af06d0be87582a2fb20e6a2166'
)
ON CONFLICT (model_version) DO UPDATE
SET
    trained_at = EXCLUDED.trained_at,
    pr_auc = EXCLUDED.pr_auc,
    recall_at_80_precision = EXCLUDED.recall_at_80_precision,
    notes = EXCLUDED.notes,
    artifact_path = EXCLUDED.artifact_path,
    dataset_fingerprint = EXCLUDED.dataset_fingerprint;

-- 3. Retire currently active model (v0.2-lr-trained)
UPDATE public.risk_model_config
SET
    is_active = false,
    status = 'retired',
    retired_at = now()
WHERE is_active = true;

-- 4. Promote v0.4-lr-trained to active
UPDATE public.risk_model_config
SET
    is_active = true,
    status = 'active',
    activated_at = now(),
    retired_at = NULL
WHERE model_version = 'v0.4-lr-trained';

-- 5. Log activation in risk_model_activation_log
INSERT INTO public.risk_model_activation_log
    (model_version, action, previous_active_version, reason)
VALUES
    ('v0.4-lr-trained', 'activated', 'v0.2-lr-trained',
     'Scientific gate satisfied: database contains 549 verified real rainfall-triggered events '
     '(authoritative requirement >= 200). Trained on 467 positive feature vectors with backfilled '
     'ERA5-Land soil moisture and 1,401 pseudo-absences. Spatial GroupKFold CV PR-AUC = 0.6037. '
     'Migration: 20260906190000_register_and_activate_v0_4.sql');

-- 6. Invariant check: exactly one active model
DO $$
DECLARE
    active_count integer;
BEGIN
    SELECT COUNT(*) INTO active_count
    FROM public.risk_model_config
    WHERE is_active = true;

    IF active_count != 1 THEN
        RAISE EXCEPTION
            'Model activation integrity check failed: expected exactly 1 active model, found %',
            active_count;
    END IF;
END $$;

COMMIT;
