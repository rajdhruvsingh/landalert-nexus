import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";

const { Client } = pg;

/**
 * Integration test verifying genuine PostgreSQL Row-Level Security (RLS) on storage.objects.
 *
 * NOTE: True RLS is evaluated and enforced by the PostgreSQL database engine, not application code.
 * If DATABASE_URL is not set or the PostgreSQL instance is unreachable, this test skips gracefully
 * so unit-test pipelines (npm run test:all) remain green. To run this test:
 *   1. Start local Supabase/Postgres: `supabase start`
 *   2. Export DATABASE_URL (e.g. DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres")
 *   3. Run: npx vitest run src/lib/storage-rls.test.ts
 */
describe("Task 1: Storage RLS & Media Upload Security Policies", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function getConnectedClient(dbUrl: string): Promise<pg.Client | null> {
    const client = new Client({
      connectionString: dbUrl,
      connectionTimeoutMillis: 1500,
    });

    try {
      await client.connect();
      return client;
    } catch {
      try {
        await client.end();
      } catch {}
      return null;
    }
  }

  it("asserts an anon INSERT to storage.objects is rejected by Postgres RLS", async (ctx) => {
    const dbUrl = process.env["DATABASE_URL"];
    if (!dbUrl) {
      console.warn(
        "[Storage RLS Test] Skipped: DATABASE_URL is not set.\n" +
          "Real Postgres RLS enforcement requires a live database instance (e.g. `supabase start` or configured DATABASE_URL).",
      );
      ctx.skip();
      return;
    }

    const client = await getConnectedClient(dbUrl);
    if (!client) {
      console.warn(
        `[Storage RLS Test] Skipped: Database at ${dbUrl} is unreachable.\n` +
          "Real Postgres RLS enforcement requires a live database instance (e.g. `supabase start`).",
      );
      ctx.skip();
      return;
    }

    const testAnonName = `test_anon_${Date.now()}.jpg`;
    let failedAsExpected = false;
    let errorMessage = "";

    try {
      await client.query("SET ROLE anon");
      await client.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ('field-observation-media', '${testAnonName}')`,
      );
    } catch (err: any) {
      failedAsExpected = true;
      errorMessage = (err?.message || String(err)).toString();
    } finally {
      try {
        await client.query("RESET ROLE");
      } catch {}
      await client.end();
    }

    expect(failedAsExpected).toBe(true);
    expect(errorMessage).toMatch(/violates row-level security policy|permission denied/i);
  });

  it("asserts an authenticated INSERT to storage.objects succeeds and direct anon SELECT is blocked", async (ctx) => {
    const dbUrl = process.env["DATABASE_URL"];
    if (!dbUrl) {
      console.warn(
        "[Storage RLS Test] Skipped: DATABASE_URL is not set.\n" +
          "Real Postgres RLS enforcement requires a live database instance (e.g. `supabase start` or configured DATABASE_URL).",
      );
      ctx.skip();
      return;
    }

    const client = await getConnectedClient(dbUrl);
    if (!client) {
      console.warn(
        `[Storage RLS Test] Skipped: Database at ${dbUrl} is unreachable.\n` +
          "Real Postgres RLS enforcement requires a live database instance (e.g. `supabase start`).",
      );
      ctx.skip();
      return;
    }

    const testAuthName = `test_auth_${Date.now()}.jpg`;

    try {
      // 1. Authenticated INSERT succeeds
      await client.query("SET ROLE authenticated");
      const insertRes = await client.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ('field-observation-media', '${testAuthName}') RETURNING id`,
      );
      expect(insertRes.rowCount).toBe(1);

      // 2. Direct anon SELECT sees 0 rows due to RLS
      await client.query("SET ROLE anon");
      const selectAnon = await client.query(
        `SELECT count(*) FROM storage.objects WHERE bucket_id = 'field-observation-media' AND name = '${testAuthName}'`,
      );
      expect(Number(selectAnon.rows[0]?.count ?? -1)).toBe(0);

      // 3. Authenticated SELECT can read
      await client.query("SET ROLE authenticated");
      const selectAuth = await client.query(
        `SELECT count(*) FROM storage.objects WHERE bucket_id = 'field-observation-media' AND name = '${testAuthName}'`,
      );
      expect(Number(selectAuth.rows[0]?.count ?? 0)).toBe(1);
    } finally {
      // Clean up test row
      try {
        await client.query("RESET ROLE");
        await client.query(`DELETE FROM storage.objects WHERE name = '${testAuthName}'`);
      } catch {}
      await client.end();
    }
  });
});
