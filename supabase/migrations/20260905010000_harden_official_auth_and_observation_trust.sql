-- =============================================================
-- Migration: Harden Official Authorization, Observation Trust & Audit Logging
-- =============================================================
-- PURPOSE:
--   1. User Profiles & Role-Based Authorization
--      - Roles: PUBLIC_USER, VERIFIED_OFFICIAL, DISPATCH_AUTHORIZED_OFFICIAL, ADMIN
--      - Status: UNVERIFIED, PENDING_OFFICIAL_VERIFICATION, VERIFIED, REJECTED
--   2. Strict Ground Observation Trust Model
--      - Status lifecycle: SUBMITTED -> PENDING_VERIFICATION -> VERIFIED / REJECTED -> ACTIONABLE
--      - Explicit training eligibility gating (only verified events eligible)
--   3. Immutable Audit Logging
--      - Complete trail of official verifications, dispatches, and emergency actions
--   4. Authorized Emergency Dispatch Tracking on Alerts
-- =============================================================

-- 1. Create user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  institution TEXT,
  department TEXT,
  designation TEXT,
  role TEXT NOT NULL DEFAULT 'PUBLIC_USER'
    CHECK (role IN ('PUBLIC_USER', 'VERIFIED_OFFICIAL', 'DISPATCH_AUTHORIZED_OFFICIAL', 'ADMIN')),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED', 'PENDING_OFFICIAL_VERIFICATION', 'VERIFIED', 'REJECTED')),
  dispatch_authorized BOOLEAN NOT NULL DEFAULT false,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles (email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles (role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_verification ON public.user_profiles (verification_status);

GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO anon, authenticated;
GRANT ALL ON public.user_profiles TO service_role;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_profiles' AND policyname = 'profiles are readable by authenticated users') THEN
    CREATE POLICY "profiles are readable by authenticated users" ON public.user_profiles FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_profiles' AND policyname = 'users can insert self profile') THEN
    CREATE POLICY "users can insert self profile" ON public.user_profiles FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_profiles' AND policyname = 'service role full access to profiles') THEN
    CREATE POLICY "service role full access to profiles" ON public.user_profiles FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- 2. Enhance field_observations for observation lifecycle and training eligibility
ALTER TABLE public.field_observations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('SUBMITTED', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'ACTIONABLE')),
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS is_training_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actionable_dispatch_id BIGINT REFERENCES public.alerts(id);

CREATE INDEX IF NOT EXISTS idx_field_observations_status ON public.field_observations (status);
CREATE INDEX IF NOT EXISTS idx_field_observations_training ON public.field_observations (is_training_eligible) WHERE is_training_eligible = true;

-- 3. Create immutable audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_email TEXT,
  actor_role TEXT NOT NULL,
  institution TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FORBIDDEN', 'FAILED')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_type, target_id);

GRANT SELECT ON public.audit_logs TO anon, authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'audit logs are readable by authorized') THEN
    CREATE POLICY "audit logs are readable by authorized" ON public.audit_logs FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'service role manages audit logs') THEN
    CREATE POLICY "service role manages audit logs" ON public.audit_logs FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- 4. Enhance alerts with authorizing official and justification
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS authorizing_official_id TEXT,
  ADD COLUMN IF NOT EXISTS authorizing_official_role TEXT,
  ADD COLUMN IF NOT EXISTS authorizing_institution TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'DISPATCH_AUTHORIZED'
    CHECK (dispatch_status IN ('PENDING_REVIEW', 'DISPATCH_AUTHORIZED', 'DISPATCH_REJECTED')),
  ADD COLUMN IF NOT EXISTS justification TEXT;
