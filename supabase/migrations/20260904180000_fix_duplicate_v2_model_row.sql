-- =============================================================
-- Migration: Fix duplicate v0.2-lr-trained row in risk_model_config
-- =============================================================
-- PROBLEM DISCOVERED BY AUDIT (scripts/ml_audit_pipeline.py):
--
--   After applying migrations 20260904132500 (gap5_model_config),
--   20260904141000 (task_g_trained_weights), and 20260904175000
--   (reset_unverified_model_metrics) in sequence, the local DB contains
--   TWO rows with model_version='v0.2-lr-trained':
--
--   id=2  is_active=false  (created by gap5_model_config as 'v0.2-lr-trained'
--                            accidentally, then deactivated by task_g)
--   id=4  is_active=true   (created by task_g INSERT, then metrics reset to NULL)
--
--   The reset migration hit BOTH rows (WHERE model_version = 'v0.2-lr-trained')
--   which is correct, but the stale id=2 row is misleading.
--
-- FIX: Delete the stale inactive duplicate (id=2).
--      id=4 is the intended active row (inserted by task_g with correct weights).
--
-- SAFETY: This delete is idempotent — if id=2 does not exist (clean Supabase
--         environment where migrations run in order), this is a no-op.
-- =============================================================

-- Remove the stale inactive v0.2-lr-trained duplicate.
-- The correct active row was inserted by task_g (higher id).
DELETE FROM public.risk_model_config
WHERE model_version = 'v0.2-lr-trained'
  AND is_active = false
  AND id = (
      SELECT MIN(id) FROM public.risk_model_config
      WHERE model_version = 'v0.2-lr-trained'
  );

-- Verify exactly one active row remains
DO $$
DECLARE
  active_count INTEGER;
  v2_count     INTEGER;
BEGIN
  SELECT COUNT(*) INTO active_count
  FROM public.risk_model_config WHERE is_active = true;

  SELECT COUNT(*) INTO v2_count
  FROM public.risk_model_config WHERE model_version = 'v0.2-lr-trained';

  IF active_count != 1 THEN
    RAISE EXCEPTION 'Expected 1 active risk_model_config row, found %', active_count;
  END IF;

  IF v2_count != 1 THEN
    RAISE EXCEPTION 'Expected 1 v0.2-lr-trained row, found %', v2_count;
  END IF;

  RAISE NOTICE 'risk_model_config deduplication OK: % active row, % v0.2 rows', active_count, v2_count;
END $$;
