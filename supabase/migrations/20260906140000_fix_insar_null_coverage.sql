-- supabase/migrations/20260906140000_fix_insar_null_coverage.sql
-- =========================================================================
-- Enforce NULL spatial_coverage_pct for UNAVAILABLE InSAR deformation products
-- =========================================================================

ALTER TABLE public.insar_deformation_products 
  ALTER COLUMN spatial_coverage_pct DROP DEFAULT;

ALTER TABLE public.insar_deformation_products 
  ALTER COLUMN spatial_coverage_pct SET DEFAULT NULL;

-- Remediate any historical records where unavailable was saved with 0.00 coverage
UPDATE public.insar_deformation_products 
SET spatial_coverage_pct = NULL 
WHERE status = 'UNAVAILABLE';
