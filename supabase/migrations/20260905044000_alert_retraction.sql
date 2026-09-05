-- =============================================================
-- Migration: Add alert retraction audit columns to public.alerts
-- =============================================================
-- PURPOSE:
--   Supports false-alarm and correction flows (Task 5).
--   Alerts are NEVER deleted from history; instead they are marked
--   as 'retracted' with immutable audit fields:
--   - status: 'active' | 'retracted'
--   - is_retracted: boolean
--   - retracted_at: timestamp
--   - retracted_by: operator user/email
--   - retraction_reason: mandatory operational explanation
-- =============================================================

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retracted')),
  ADD COLUMN IF NOT EXISTS is_retracted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retracted_by TEXT,
  ADD COLUMN IF NOT EXISTS retraction_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_alerts_status ON public.alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_retracted ON public.alerts (is_retracted);

-- Grant UPDATE privileges to authenticated users (role-enforced at application layer)
GRANT UPDATE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
