-- =============================================================
-- Migration: Ensure Field Observations Authoritative Schema & Cache
-- =============================================================
-- PURPOSE:
--   1. Ensure all columns required by LandAlert-Nexus exist on public.field_observations.
--   2. Ensure proper defaults, constraints, and data types.
--   3. Ensure unique idempotency key index prevents duplicate records.
--   4. Ensure PostgREST schema cache is reloaded immediately.
--   5. Ensure dedicated field-observation-media storage bucket exists.
-- =============================================================

-- 1. Ensure table exists
CREATE TABLE IF NOT EXISTS public.field_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id INTEGER NOT NULL REFERENCES public.risk_zones(id) ON DELETE CASCADE,
  observer_id TEXT NOT NULL DEFAULT 'field_worker',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  rainfall_mm DOUBLE PRECISION,
  soil_condition TEXT,
  visual_signs TEXT,
  road_status TEXT CHECK (road_status IN ('open', 'restricted', 'blocked', 'unknown')),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'conflict')),
  idempotency_key TEXT
);

-- 2. Add all missing columns idempotently
ALTER TABLE public.field_observations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('SUBMITTED', 'PENDING_VERIFICATION', 'OFFICIAL_VERIFIED', 'VERIFIED', 'REJECTED', 'ACTIONABLE')),
  ADD COLUMN IF NOT EXISTS is_training_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'PUBLIC_REPORT',
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actionable_dispatch_id BIGINT REFERENCES public.alerts(id),
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS media_metadata JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (review_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED'));

-- 3. Idempotent indexes
CREATE INDEX IF NOT EXISTS idx_field_observations_zone_time
  ON public.field_observations (zone_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_observations_idempotency_key
  ON public.field_observations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_field_observations_idempotency_key'
  ) THEN
    ALTER TABLE public.field_observations
      ADD CONSTRAINT uq_field_observations_idempotency_key UNIQUE (idempotency_key);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_field_observations_status
  ON public.field_observations (status);

CREATE INDEX IF NOT EXISTS idx_field_observations_review_status
  ON public.field_observations (review_status);

CREATE INDEX IF NOT EXISTS idx_field_observations_geoloc
  ON public.field_observations (geo_lat, geo_lng)
  WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL;

-- 4. Permissions and RLS
GRANT SELECT, INSERT, UPDATE ON public.field_observations TO anon, authenticated;
GRANT ALL ON public.field_observations TO service_role;
ALTER TABLE public.field_observations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'field_observations' AND policyname = 'observations are public read'
  ) THEN
    CREATE POLICY "observations are public read" ON public.field_observations FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'field_observations' AND policyname = 'observations can be inserted'
  ) THEN
    CREATE POLICY "observations can be inserted" ON public.field_observations FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

-- 5. Ensure Storage Bucket Exists for Observation Evidence
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'field-observation-media',
      'field-observation-media',
      false,
      52428800, -- 50MB
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/webm', 'video/quicktime']
    )
    ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = 52428800,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/webm', 'video/quicktime'];
  END IF;
END $$;

-- 6. Reload Supabase PostgREST schema cache so consent_given and other columns are visible
NOTIFY pgrst, 'reload schema';
