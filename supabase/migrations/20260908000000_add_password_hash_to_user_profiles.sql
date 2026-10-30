-- supabase/migrations/20260908000000_add_password_hash_to_user_profiles.sql
-- Native PostgreSQL Authentication Support: Add password_hash column to user_profiles

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS password_hash text;

