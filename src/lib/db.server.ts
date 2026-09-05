/**
 * src/lib/db.server.ts
 * ====================
 * Authoritative Server-Side PostgreSQL Database Connection & Schema Migration.
 * 
 * Provides:
 * - Robust connection management for PostgreSQL with SSL support for cloud databases (Render, Supabase)
 * - Automated idempotent schema synchronization for field_observations
 * - PostgREST schema cache reload notification
 * - Safe production database execution with zero unsafe fallbacks to localhost
 */

import { Pool, type PoolClient } from "pg";

let globalPool: Pool | null = null;
let schemaEnsured = false;

export function isProductionEnvironment(): boolean {
  return (
    process.env["NODE_ENV"] === "production" ||
    Boolean(process.env["RENDER"]) ||
    Boolean(process.env["VERCEL"])
  );
}

export function getDatabaseUrl(): string | null {
  const url = process.env["DATABASE_URL"];
  if (url && typeof url === "string" && url.trim().length > 0) {
    return url.trim();
  }
  return null;
}

export function getPostgresPool(): Pool | null {
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    if (isProductionEnvironment()) {
      console.warn("[PostgreSQL] Production DATABASE_URL is not configured.");
    }
    return null;
  }

  if (!globalPool) {
    // Determine SSL requirements
    const isLocalhost = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
    const requireSsl = !isLocalhost || dbUrl.includes("sslmode=require");

    globalPool = new Pool({
      connectionString: dbUrl,
      ssl: requireSsl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    globalPool.on("error", (err) => {
      console.error("[PostgreSQL Pool Error]", err.message);
    });
  }

  return globalPool;
}

export async function ensureFieldObservationsSchema(): Promise<boolean> {
  if (schemaEnsured) return true;
  const pool = getPostgresPool();
  if (!pool) return false;

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.field_observations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        zone_id INTEGER NOT NULL REFERENCES public.risk_zones(id) ON DELETE CASCADE,
        observer_id TEXT NOT NULL DEFAULT 'field_worker',
        observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        client_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
        rainfall_mm DOUBLE PRECISION,
        soil_condition TEXT,
        visual_signs TEXT,
        road_status TEXT CHECK (road_status IN ('open', 'restricted', 'blocked', 'unknown')),
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'conflict')),
        idempotency_key TEXT
      );

      ALTER TABLE public.field_observations
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
          CHECK (status IN ('SUBMITTED', 'PENDING_VERIFICATION', 'OFFICIAL_VERIFIED', 'VERIFIED', 'REJECTED', 'ACTIONABLE')),
        ADD COLUMN IF NOT EXISTS is_training_eligible BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'PUBLIC_REPORT',
        ADD COLUMN IF NOT EXISTS verified_by TEXT,
        ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS verification_notes TEXT,
        ADD COLUMN IF NOT EXISTS evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS actionable_dispatch_id BIGINT REFERENCES public.alerts(id),
        ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS media_metadata JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS geo_accuracy_m DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS geo_captured_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
          CHECK (review_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED'));

      CREATE UNIQUE INDEX IF NOT EXISTS idx_field_observations_idempotency_key
        ON public.field_observations (idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_field_observations_status
        ON public.field_observations (status);

      CREATE INDEX IF NOT EXISTS idx_field_observations_review_status
        ON public.field_observations (review_status);

      CREATE INDEX IF NOT EXISTS idx_field_observations_zone_time
        ON public.field_observations (zone_id, observed_at DESC);

      CREATE INDEX IF NOT EXISTS idx_field_observations_geoloc
        ON public.field_observations (geo_lat, geo_lng)
        WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL;

      GRANT SELECT, INSERT, UPDATE ON public.field_observations TO anon, authenticated;
      GRANT ALL ON public.field_observations TO service_role;

      NOTIFY pgrst, 'reload schema';
    `);

    schemaEnsured = true;
    return true;
  } catch (err: any) {
    console.warn("[PostgreSQL] Schema verification notice:", err.message);
    return false;
  } finally {
    if (client) client.release();
  }
}
