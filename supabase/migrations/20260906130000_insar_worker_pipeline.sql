-- supabase/migrations/20260906130000_insar_worker_pipeline.sql
-- =========================================================================
-- InSAR Asynchronous Dedicated Worker Pipeline & Granular Stage Tracking
-- =========================================================================

-- 1. Extend satellite_processing_jobs with granular processing stages and idempotency fingerprints
ALTER TABLE public.satellite_processing_jobs 
  DROP CONSTRAINT IF EXISTS satellite_processing_jobs_status_check;

ALTER TABLE public.satellite_processing_jobs 
  ADD CONSTRAINT satellite_processing_jobs_status_check 
  CHECK (status IN (
    'QUEUED',
    'RUNNING',
    'DOWNLOADING',
    'PREPROCESSING',
    'COREGISTERING',
    'INTERFEROGRAM',
    'UNWRAPPING',
    'ATMOSPHERIC_CORRECTION',
    'TIMESERIES',
    'QUALITY_CONTROL',
    'AGGREGATING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'STALE'
  ));

-- Add worker orchestration columns if they do not already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'satellite_processing_jobs' AND column_name = 'job_fingerprint') THEN
    ALTER TABLE public.satellite_processing_jobs ADD COLUMN job_fingerprint TEXT UNIQUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'satellite_processing_jobs' AND column_name = 'stage') THEN
    ALTER TABLE public.satellite_processing_jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'QUEUED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'satellite_processing_jobs' AND column_name = 'retry_count') THEN
    ALTER TABLE public.satellite_processing_jobs ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'satellite_processing_jobs' AND column_name = 'max_retries') THEN
    ALTER TABLE public.satellite_processing_jobs ADD COLUMN max_retries INT NOT NULL DEFAULT 3;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'satellite_processing_jobs' AND column_name = 'qc_metrics') THEN
    ALTER TABLE public.satellite_processing_jobs ADD COLUMN qc_metrics JSONB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'satellite_processing_jobs' AND column_name = 'storage_path') THEN
    ALTER TABLE public.satellite_processing_jobs ADD COLUMN storage_path TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sat_jobs_fingerprint ON public.satellite_processing_jobs(job_fingerprint);
CREATE INDEX IF NOT EXISTS idx_sat_jobs_stage ON public.satellite_processing_jobs(stage);
