-- =============================================================
-- Migration: Add risk_predictions, field_observations, and alert delivery tracking
-- =============================================================
-- PURPOSE:
--   Supports production backend requirements:
--   1. Authoritative risk prediction persistence with idempotency
--   2. Offline field observations synchronization table
--   3. Alert delivery tracking, status, and deduplication keys
--   4. RLS security hardening on activation logs
-- =============================================================

-- 1. Risk predictions persistence table
CREATE TABLE IF NOT EXISTS public.risk_predictions (
  id BIGSERIAL PRIMARY KEY,
  zone_id INTEGER NOT NULL REFERENCES public.risk_zones(id) ON DELETE CASCADE,
  prediction_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL DEFAULT 'v1.0.0',
  probability DOUBLE PRECISION NOT NULL,
  risk_score DOUBLE PRECISION NOT NULL,
  risk_category TEXT NOT NULL CHECK (risk_category IN ('Low', 'Moderate', 'High', 'Severe')),
  explanation TEXT NOT NULL,
  data_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_predictions_zone_time
  ON public.risk_predictions (zone_id, prediction_time DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_predictions_idempotent
  ON public.risk_predictions (zone_id, prediction_time, model_version);

GRANT SELECT ON public.risk_predictions TO anon, authenticated;
GRANT ALL ON public.risk_predictions TO service_role;
ALTER TABLE public.risk_predictions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'risk_predictions' AND policyname = 'risk predictions are public read') THEN
    CREATE POLICY "risk predictions are public read" ON public.risk_predictions FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

-- 2. Add alert delivery tracking columns
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  ADD COLUMN IF NOT EXISTS recipient_group TEXT NOT NULL DEFAULT 'district_authorities',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_idempotency_key
  ON public.alerts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Offline field observations synchronization table
CREATE TABLE IF NOT EXISTS public.field_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id INTEGER NOT NULL REFERENCES public.risk_zones(id) ON DELETE CASCADE,
  observer_id TEXT NOT NULL DEFAULT 'field_worker',
  observed_at TIMESTAMPTZ NOT NULL,
  client_timestamp TIMESTAMPTZ NOT NULL,
  rainfall_mm DOUBLE PRECISION,
  soil_condition TEXT,
  visual_signs TEXT,
  road_status TEXT CHECK (road_status IN ('open', 'restricted', 'blocked', 'unknown')),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'conflict')),
  idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_field_observations_zone_time
  ON public.field_observations (zone_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_observations_idempotency_key
  ON public.field_observations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

GRANT SELECT, INSERT ON public.field_observations TO anon, authenticated;
GRANT ALL ON public.field_observations TO service_role;
ALTER TABLE public.field_observations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'field_observations' AND policyname = 'observations are public read') THEN
    CREATE POLICY "observations are public read" ON public.field_observations FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'field_observations' AND policyname = 'observations can be inserted') THEN
    CREATE POLICY "observations can be inserted" ON public.field_observations FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

-- 4. Enable RLS on risk_model_activation_log
ALTER TABLE public.risk_model_activation_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'risk_model_activation_log' AND policyname = 'activation log is public read') THEN
    CREATE POLICY "activation log is public read" ON public.risk_model_activation_log FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;
