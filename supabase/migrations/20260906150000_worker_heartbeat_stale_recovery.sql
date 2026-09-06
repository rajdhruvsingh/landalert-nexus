-- 20260906150000_worker_heartbeat_stale_recovery.sql
-- Add last_heartbeat_at column to satellite_processing_jobs for crash detection
-- and stale job recovery.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'satellite_processing_jobs' 
      AND column_name = 'last_heartbeat_at'
  ) THEN
    ALTER TABLE public.satellite_processing_jobs 
    ADD COLUMN last_heartbeat_at TIMESTAMPTZ DEFAULT NULL;
    
    CREATE INDEX IF NOT EXISTS idx_sat_jobs_heartbeat 
    ON public.satellite_processing_jobs(last_heartbeat_at) 
    WHERE status = 'RUNNING';
  END IF;
END $$;
