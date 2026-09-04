-- =============================================================
-- Migration: SMS Gateway Support & Provider Status Tracking
-- =============================================================

ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_dispatch_status_check;

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_dispatch_status_check
  CHECK (dispatch_status IN (
    'PENDING_REVIEW',
    'DISPATCH_AUTHORIZED',
    'DISPATCH_REJECTED',
    'SMS_PROVIDER_NOT_CONFIGURED',
    'SMS_SANDBOX_LOGGED',
    'SENT',
    'DELIVERED',
    'FAILED'
  ));

ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_status_check;

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_status_check
  CHECK (status IN (
    'pending',
    'sent',
    'delivered',
    'failed',
    'provider_unconfigured',
    'sandbox_logged'
  ));

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_response JSONB DEFAULT '{}'::jsonb;
