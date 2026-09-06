-- Migration: 20260906010000_observation_review_rls.sql
-- =======================================================
-- Adds a defense-in-depth UPDATE RLS policy so that only the
-- service_role (used by supabaseAdmin in the API layer) can
-- change the review fields on field_observations.
--
-- The API layer (POST /api/observations/review) is the PRIMARY
-- enforcement gate (role check via authenticateToken + verifyGroundObservation).
-- This policy provides database-level protection as a second layer.
--
-- Existing policies on field_observations:
--   SELECT: anon + authenticated (public read, set in first migration)
--   INSERT: authenticated (field reporters can submit)
-- New:
--   UPDATE: service_role only (only the server backend can change status)

-- Ensure RLS is enabled (idempotent — safe to re-apply)
ALTER TABLE public.field_observations ENABLE ROW LEVEL SECURITY;

-- Drop the old policy if it somehow exists already (idempotent re-run safety)
DROP POLICY IF EXISTS "service_role can update observation review fields" ON public.field_observations;

-- Only service_role may UPDATE field_observations rows.
-- Authenticated users (field reporters) may not modify their own submissions
-- once filed — that prevents self-approval or status tampering from the client.
CREATE POLICY "service_role can update observation review fields"
  ON public.field_observations
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Grant UPDATE privilege to service_role on the table (may already be granted,
-- but explicit GRANT is idempotent and prevents accidental revocation).
GRANT UPDATE ON public.field_observations TO service_role;

-- Comment documenting the lifecycle intent
COMMENT ON COLUMN public.field_observations.status IS
  'Observation lifecycle status. Valid values: SUBMITTED, PENDING_VERIFICATION, VERIFIED, REJECTED, ACTIONABLE. '
  'Only the API layer (service_role / backend) may change this column after initial submission.';
