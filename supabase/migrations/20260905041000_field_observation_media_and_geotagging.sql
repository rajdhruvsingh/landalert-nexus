-- =============================================================
-- Migration: Field Observation Geo-tagged Media Upload & RLS
-- =============================================================

-- 1. Enhance field_observations table for media references and high-precision GPS
ALTER TABLE public.field_observations
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS media_metadata JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (review_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED'));

CREATE INDEX IF NOT EXISTS idx_field_observations_review_status 
  ON public.field_observations (review_status);

CREATE INDEX IF NOT EXISTS idx_field_observations_geoloc 
  ON public.field_observations (geo_lat, geo_lng) 
  WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL;

-- 2. Setup Supabase Storage schema, buckets, and policies
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'field-observation-media',
  'field-observation-media',
  false,
  52428800, -- 50MB hard max per file (10MB for image, 50MB for video)
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'video/mp4',
      'video/webm',
      'video/quicktime'
    ];

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated submitters can upload field media'
  ) THEN
    CREATE POLICY "Authenticated submitters can upload field media"
    ON storage.objects FOR INSERT TO authenticated, anon
    WITH CHECK (bucket_id = 'field-observation-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Service role full access to field media'
  ) THEN
    CREATE POLICY "Service role full access to field media"
    ON storage.objects FOR ALL TO service_role
    USING (bucket_id = 'field-observation-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public can read field media via signed URLs'
  ) THEN
    CREATE POLICY "Public can read field media via signed URLs"
    ON storage.objects FOR SELECT TO authenticated, anon
    USING (bucket_id = 'field-observation-media');
  END IF;
END $$;
