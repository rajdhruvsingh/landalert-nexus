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
    
    // 1. Ensure base table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.field_observations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        zone_id INTEGER NOT NULL,
        observer_id TEXT NOT NULL DEFAULT 'field_worker',
        observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        client_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
        rainfall_mm DOUBLE PRECISION,
        soil_condition TEXT,
        visual_signs TEXT,
        road_status TEXT,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sync_status TEXT NOT NULL DEFAULT 'synced',
        idempotency_key TEXT
      );
    `).catch((err) => console.warn("[PostgreSQL] Table creation notice:", err.message));

    // 2. Ensure each column exists independently to prevent composite failure
    const ddlStatements = [
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT true;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'PENDING_REVIEW';",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}';",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS media_metadata JSONB DEFAULT '[]'::jsonb;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS geo_accuracy_m DOUBLE PRECISION;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS geo_captured_at TIMESTAMPTZ;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING_VERIFICATION';",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS is_training_eligible BOOLEAN DEFAULT false;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'PUBLIC_REPORT';",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS verified_by TEXT;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS verification_notes TEXT;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS evidence_summary JSONB DEFAULT '{}'::jsonb;",
      "ALTER TABLE public.field_observations ADD COLUMN IF NOT EXISTS actionable_dispatch_id BIGINT;",
    ];

    for (const ddl of ddlStatements) {
      await client.query(ddl).catch((err) => {
        console.warn("[PostgreSQL] DDL step notice:", err.message);
      });
    }

    // 3. Unique index and constraint for idempotency
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_field_observations_idempotency_key
        ON public.field_observations (idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_field_observations_idempotency_key'
        ) THEN
          ALTER TABLE public.field_observations
            ADD CONSTRAINT uq_field_observations_idempotency_key UNIQUE (idempotency_key);
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `).catch(() => {});

    // 4. Permissions
    await client.query(`
      GRANT SELECT, INSERT, UPDATE ON public.field_observations TO anon, authenticated;
      GRANT ALL ON public.field_observations TO service_role;
    `).catch(() => {});

    // 5. Explicitly notify PostgREST to reload its schema cache
    await client.query("NOTIFY pgrst, 'reload schema';").catch(() => {});

    schemaEnsured = true;
    return true;
  } catch (err: any) {
    console.warn("[PostgreSQL] Schema verification notice:", err.message);
    return false;
  } finally {
    if (client) client.release();
  }
}
