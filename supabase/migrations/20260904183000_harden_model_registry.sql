-- =============================================================
-- Migration: Harden model registry with lifecycle status & audit columns
-- =============================================================
-- PURPOSE:
--   Supports Phase 13 & Phase 28:
--   - Adds status column: 'candidate', 'validated', 'active', 'retired'
--   - Adds artifact_path and feature_schema_version
--   - Adds lifecycle timestamps: activated_at, retired_at
--   - Preserves partial unique index ensuring exactly 1 active model
-- =============================================================

ALTER TABLE public.risk_model_config
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'validated', 'active', 'retired')),
  ADD COLUMN IF NOT EXISTS artifact_path TEXT,
  ADD COLUMN IF NOT EXISTS feature_schema_version TEXT DEFAULT 'v1.0.0',
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

-- Sync current rows with status column
UPDATE public.risk_model_config
SET status = 'active',
    artifact_path = 'models/v0.2-lr-trained.json',
    feature_schema_version = 'v1.0.0',
    activated_at = COALESCE(trained_at, now())
WHERE is_active = true;

UPDATE public.risk_model_config
SET status = 'retired',
    artifact_path = NULL,
    feature_schema_version = 'v1.0.0',
    retired_at = now()
WHERE is_active = false;

-- Create audit log table for model activation & rollback history
CREATE TABLE IF NOT EXISTS public.risk_model_activation_log (
  id SERIAL PRIMARY KEY,
  model_version TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('activated', 'deactivated', 'rolled_back', 'rejected')),
  previous_active_version TEXT,
  actor TEXT NOT NULL DEFAULT 'ml_registry',
  reason TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log current active model
INSERT INTO public.risk_model_activation_log (model_version, action, previous_active_version, reason)
VALUES ('v0.2-lr-trained', 'activated', 'v0.1-hand-tuned', 'Initial baseline verified trained model activation')
ON CONFLICT DO NOTHING;
