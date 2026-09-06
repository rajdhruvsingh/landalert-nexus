-- =============================================================================
-- Migration: 20260906180000_enforce_scientific_gate_revert_v0_3.sql
-- Purpose:   Enforce the authoritative >= 200-event scientific production gate.
--
-- PROBLEM:
--   v0.3-lr-trained was promoted to is_active=TRUE and status='validated'
--   while only 22 verified real rainfall-triggered landslide events exist in
--   the database. The authoritative scientific production gate requires >= 200
--   such events. The previous software gate (PR-AUC >= 0.25) is subordinate
--   and CANNOT authorize scientific production activation.
--
-- ACTION:
--   1. Extend status check constraint to include 'scientifically_blocked'.
--   2. Revoke v0.3 activation: is_active=FALSE, status='scientifically_blocked'
--   3. Restore v0.2 as the sole production-authorized active model.
--   4. Log the correction in risk_model_activation_log.
--
-- SCIENTIFIC STATE AFTER THIS MIGRATION:
--   v0.1-hand-tuned   : is_active=FALSE, status='retired'
--   v0.2-lr-trained   : is_active=TRUE,  status='active'
--                       (software-validated; scientifically data-limited but
--                        authorized as last-known production model pending
--                        accumulation of >= 200 verified events)
--   v0.3-lr-trained   : is_active=FALSE, status='scientifically_blocked'
--                       (software-ready, scientific gate BLOCKED at 22/200)
--
-- NOTE ON v0.2:
--   v0.2 (PR-AUC=0.5934, trained on 8 positives) is also data-limited.
--   Its activation is authorized ONLY because no scientifically-complete
--   model exists and it is the last model with a validated software gate.
--   It is NOT declared scientifically production-ready.
--   Predictions from v0.2 must not be interpreted as statistically robust.
--
-- NOTE ON PR-AUC DISCREPANCY (v0.3):
--   Registered PR-AUC = 0.9399 (cross_val_predict with GroupKFold n=5 on 81
--   samples, no fixed random_state in GroupKFold).
--   Audit pipeline re-run = 0.7109 (same methodology, different fold assignment
--   due to GroupKFold district ordering variance across runs).
--   Neither value is fabricated. With n=22 positives and ~9 districts,
--   5-fold GroupKFold produces highly variable fold compositions.
--   Bootstrap 95% CI = [0.4377, 0.9437]. The correct interpretation:
--   DIRECTIONAL IMPROVEMENT over chance (0.2716) and physics baseline (0.5830),
--   NOT statistical confirmation of production readiness.
-- =============================================================================

BEGIN;

-- 1. Extend status check constraint to allow 'scientifically_blocked'
ALTER TABLE public.risk_model_config
    DROP CONSTRAINT IF EXISTS risk_model_config_status_check;

ALTER TABLE public.risk_model_config
    ADD CONSTRAINT risk_model_config_status_check
    CHECK (status = ANY (ARRAY[
        'candidate'::text,
        'validated'::text,
        'active'::text,
        'retired'::text,
        'scientifically_blocked'::text
    ]));

-- 2. Revoke v0.3 active status
UPDATE public.risk_model_config
SET
    is_active       = false,
    status          = 'scientifically_blocked',
    retired_at      = now()
WHERE model_version = 'v0.3-lr-trained'
  AND is_active = true;

-- 3. Restore v0.2 as active (it was retired when v0.3 was promoted)
UPDATE public.risk_model_config
SET
    is_active       = true,
    status          = 'active',
    activated_at    = now(),
    retired_at      = NULL
WHERE model_version = 'v0.2-lr-trained';

-- 4. Log the scientific gate enforcement correction
INSERT INTO public.risk_model_activation_log
    (model_version, action, previous_active_version, reason)
VALUES
    ('v0.2-lr-trained', 'activated',
     'v0.3-lr-trained',
     'Scientific gate enforcement: v0.3 had is_active=TRUE with only 22/200 verified real '
     'rainfall-triggered events. Scientific production gate requires >= 200 events. '
     'v0.3 reverted to scientifically_blocked. v0.2 restored as sole authorized production model. '
     'v0.2 is also data-limited (8 positives, PR-AUC=0.5934) but authorized as last-known '
     'software-validated model pending accumulation of >= 200 verified events. '
     'Migration: 20260906180000_enforce_scientific_gate_revert_v0_3.sql');

-- 5. Verify exactly one active model
DO $$
DECLARE
    active_count integer;
BEGIN
    SELECT COUNT(*) INTO active_count
    FROM public.risk_model_config
    WHERE is_active = true;

    IF active_count != 1 THEN
        RAISE EXCEPTION
            'Scientific gate migration integrity check failed: expected exactly 1 active model, found %',
            active_count;
    END IF;
END $$;

COMMIT;
