-- supabase/migrations/20260906150000_villages_and_critical_infrastructure.sql
-- =============================================================================
-- Migration: Villages and Critical Infrastructure Layers
-- Fulfills SIH Requirements 9 (Villages) & 10 (Critical Infrastructure)
-- =============================================================================

-- 1. Create public.villages
CREATE TABLE IF NOT EXISTS public.villages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  district TEXT,
  state TEXT,
  population INTEGER,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  zone_id INTEGER REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  distance_km_to_zone DOUBLE PRECISION,
  osm_id BIGINT,
  osm_element_type TEXT NOT NULL DEFAULT 'node',
  osm_place_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT villages_osm_element_type_check CHECK (
    osm_element_type IN ('node', 'way')
  )
);

-- 2. Create public.critical_infrastructure
CREATE TABLE IF NOT EXISTS public.critical_infrastructure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  zone_id INTEGER REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  distance_km_to_zone DOUBLE PRECISION,
  osm_id BIGINT,
  osm_element_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT critical_infrastructure_type_check CHECK (
    type IN ('hospital', 'clinic', 'school', 'bridge', 'power')
  ),
  CONSTRAINT critical_infrastructure_osm_element_type_check CHECK (
    osm_element_type IN ('node', 'way')
  )
);

-- 3. Enable Row Level Security
ALTER TABLE public.villages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.critical_infrastructure ENABLE ROW LEVEL SECURITY;

-- 4. Role Grants (following risk_zones security pattern)
GRANT SELECT ON public.villages TO anon, authenticated;
GRANT ALL ON public.villages TO service_role;
GRANT SELECT ON public.critical_infrastructure TO anon, authenticated;
GRANT ALL ON public.critical_infrastructure TO service_role;

-- 5. RLS Policies
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'villages' AND policyname = 'villages are public'
  ) THEN
    CREATE POLICY "villages are public"
      ON public.villages FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'villages' AND policyname = 'service role full access on villages'
  ) THEN
    CREATE POLICY "service role full access on villages"
      ON public.villages FOR ALL
      TO service_role
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'critical_infrastructure' AND policyname = 'critical infrastructure is public'
  ) THEN
    CREATE POLICY "critical infrastructure is public"
      ON public.critical_infrastructure FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'critical_infrastructure' AND policyname = 'service role full access on critical_infrastructure'
  ) THEN
    CREATE POLICY "service role full access on critical_infrastructure"
      ON public.critical_infrastructure FOR ALL
      TO service_role
      USING (true);
  END IF;
END $$;

-- 6. Foreign Key Performance Indexes
CREATE INDEX IF NOT EXISTS idx_villages_zone_id ON public.villages(zone_id);
CREATE INDEX IF NOT EXISTS idx_critical_infrastructure_zone_id ON public.critical_infrastructure(zone_id);

-- 7. Deduplication & Provenance Indexes for Repeated OSM Ingestion
CREATE UNIQUE INDEX IF NOT EXISTS idx_villages_osm_element_id ON public.villages (osm_element_type, osm_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_critical_infrastructure_osm_element_id ON public.critical_infrastructure (osm_element_type, osm_id);
