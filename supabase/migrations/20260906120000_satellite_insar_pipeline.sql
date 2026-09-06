-- supabase/migrations/20260906120000_satellite_insar_pipeline.sql
-- =========================================================================
-- Satellite Sentinel-1 SAR Acquisition & Asynchronous InSAR Processing Schema
-- =========================================================================

-- 1. Satellite Acquisitions (Official Copernicus Sentinel-1 Scenes)
CREATE TABLE IF NOT EXISTS public.satellite_acquisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id TEXT UNIQUE NOT NULL,
  satellite TEXT NOT NULL DEFAULT 'Sentinel-1A',
  sensor TEXT NOT NULL DEFAULT 'C-SAR',
  mode TEXT NOT NULL DEFAULT 'IW',
  polarization TEXT NOT NULL DEFAULT 'VV+VH',
  product_type TEXT NOT NULL DEFAULT 'SLC',
  orbit_direction TEXT NOT NULL CHECK (orbit_direction IN ('ASCENDING', 'DESCENDING')),
  relative_orbit INT,
  sensing_start TIMESTAMPTZ NOT NULL,
  sensing_stop TIMESTAMPTZ NOT NULL,
  footprint_geojson JSONB NOT NULL,
  download_url TEXT,
  checksum_sha256 TEXT,
  source TEXT NOT NULL DEFAULT 'Copernicus Data Space Ecosystem (CDSE)',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sat_acq_sensing_start ON public.satellite_acquisitions(sensing_start);
CREATE INDEX IF NOT EXISTS idx_sat_acq_orbit ON public.satellite_acquisitions(orbit_direction, relative_orbit);

-- 2. Satellite Processing Jobs (Asynchronous InSAR Worker Queue)
CREATE TABLE IF NOT EXISTS public.satellite_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL DEFAULT 'INSAR_DEFORMATION',
  cell_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'STALE')) DEFAULT 'QUEUED',
  progress_pct INT NOT NULL DEFAULT 0,
  master_scene_id TEXT REFERENCES public.satellite_acquisitions(scene_id),
  slave_scene_id TEXT REFERENCES public.satellite_acquisitions(scene_id),
  temporal_baseline_days INT,
  perpendicular_baseline_m NUMERIC(8,2),
  worker_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sat_jobs_status ON public.satellite_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sat_jobs_cell ON public.satellite_processing_jobs(cell_id);

-- 3. InSAR Deformation Products (Cell-level georeferenced deformation stats)
CREATE TABLE IF NOT EXISTS public.insar_deformation_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'UNAVAILABLE', 'PROCESSING', 'FAILED', 'STALE')),
  los_velocity_mean_mm_year NUMERIC(6,2),
  los_velocity_max_mm_year NUMERIC(6,2),
  cumulative_displacement_mm NUMERIC(6,2),
  temporal_trend TEXT CHECK (temporal_trend IN ('STABLE', 'NO_CLEAR_TREND', 'INCREASING_DEFORMATION', 'DECREASING_DEFORMATION', 'INSUFFICIENT_DATA')) DEFAULT 'INSUFFICIENT_DATA',
  observation_start DATE,
  observation_end DATE,
  temporal_baseline_days INT,
  coherence_mean NUMERIC(4,3),
  spatial_coverage_pct NUMERIC(5,2) DEFAULT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('HIGH', 'MODERATE', 'LOW', 'UNAVAILABLE')),
  unavailable_reason TEXT,
  sensor TEXT NOT NULL DEFAULT 'Sentinel-1 C-SAR',
  orbit_pass TEXT,
  processing_pipeline TEXT NOT NULL DEFAULT 'PS-InSAR / SBAS Multi-temporal Interferometry',
  processing_job_id UUID REFERENCES public.satellite_processing_jobs(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insar_prod_cell ON public.insar_deformation_products(cell_id);
CREATE INDEX IF NOT EXISTS idx_insar_prod_status ON public.insar_deformation_products(status);

-- 4. InSAR Displacement Time-Series (Multi-temporal interferometric observations)
CREATE TABLE IF NOT EXISTS public.insar_displacement_timeseries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id TEXT NOT NULL REFERENCES public.insar_deformation_products(cell_id) ON DELETE CASCADE,
  observation_date DATE NOT NULL,
  displacement_mm NUMERIC(6,2) NOT NULL,
  coherence NUMERIC(4,3) NOT NULL,
  is_outlier BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_cell_date UNIQUE (cell_id, observation_date)
);

CREATE INDEX IF NOT EXISTS idx_insar_ts_cell_date ON public.insar_displacement_timeseries(cell_id, observation_date);

-- Enable RLS
ALTER TABLE public.satellite_acquisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satellite_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insar_deformation_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insar_displacement_timeseries ENABLE ROW LEVEL SECURITY;

-- Permissions and RLS
GRANT SELECT ON public.satellite_acquisitions TO anon, authenticated;
GRANT ALL ON public.satellite_acquisitions TO service_role;
GRANT SELECT ON public.satellite_processing_jobs TO anon, authenticated;
GRANT ALL ON public.satellite_processing_jobs TO service_role;
GRANT SELECT ON public.insar_deformation_products TO anon, authenticated;
GRANT ALL ON public.insar_deformation_products TO service_role;
GRANT SELECT ON public.insar_displacement_timeseries TO anon, authenticated;
GRANT ALL ON public.insar_displacement_timeseries TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'satellite_acquisitions' AND policyname = 'Allow public read on satellite_acquisitions') THEN
    CREATE POLICY "Allow public read on satellite_acquisitions" ON public.satellite_acquisitions FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'satellite_processing_jobs' AND policyname = 'Allow public read on satellite_processing_jobs') THEN
    CREATE POLICY "Allow public read on satellite_processing_jobs" ON public.satellite_processing_jobs FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'insar_deformation_products' AND policyname = 'Allow public read on insar_deformation_products') THEN
    CREATE POLICY "Allow public read on insar_deformation_products" ON public.insar_deformation_products FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'insar_displacement_timeseries' AND policyname = 'Allow public read on insar_displacement_timeseries') THEN
    CREATE POLICY "Allow public read on insar_displacement_timeseries" ON public.insar_displacement_timeseries FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'satellite_acquisitions' AND policyname = 'Allow service_role full access on satellite_acquisitions') THEN
    CREATE POLICY "Allow service_role full access on satellite_acquisitions" ON public.satellite_acquisitions FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'satellite_processing_jobs' AND policyname = 'Allow service_role full access on satellite_processing_jobs') THEN
    CREATE POLICY "Allow service_role full access on satellite_processing_jobs" ON public.satellite_processing_jobs FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'insar_deformation_products' AND policyname = 'Allow service_role full access on insar_deformation_products') THEN
    CREATE POLICY "Allow service_role full access on insar_deformation_products" ON public.insar_deformation_products FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'insar_displacement_timeseries' AND policyname = 'Allow service_role full access on insar_displacement_timeseries') THEN
    CREATE POLICY "Allow service_role full access on insar_displacement_timeseries" ON public.insar_displacement_timeseries FOR ALL TO service_role USING (true);
  END IF;
END $$;
