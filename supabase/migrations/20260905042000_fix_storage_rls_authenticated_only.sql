-- =============================================================
-- Migration: Fix Storage RLS - Authenticated Only Media Upload
-- =============================================================

-- Ensure schema permissions exist so Postgres RLS is the decisive gate
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;

-- 1. Restrict INSERT to authenticated sessions only (remove anon role)
DROP POLICY IF EXISTS "Authenticated submitters can upload field media" ON storage.objects;

CREATE POLICY "Authenticated submitters can upload field media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'field-observation-media');

-- 2. Restrict direct SELECT on storage.objects to authenticated and service_role
-- Anonymous direct bucket scraping is blocked; access to private bucket objects
-- must go through authenticated sessions or signed URL generation via service_role.
DROP POLICY IF EXISTS "Public can read field media via signed URLs" ON storage.objects;
DROP POLICY IF EXISTS "Authorized read access to field media" ON storage.objects;

CREATE POLICY "Authorized read access to field media"
ON storage.objects FOR SELECT TO authenticated, service_role
USING (bucket_id = 'field-observation-media');


