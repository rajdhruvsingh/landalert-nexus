import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { handleApiRequest } from "./api.router";

const execFileAsync = promisify(execFile);

describe("Task 1: Storage RLS & Media Upload Security Policies", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("asserts an anon INSERT to storage.objects is rejected by Postgres RLS", async () => {
    const dbUrl = process.env["DATABASE_URL"] || "postgresql://localhost/landalert";
    const testAnonName = `test_anon_${Date.now()}.jpg`;

    let failedAsExpected = false;
    let errorMessage = "";

    try {
      await execFileAsync("psql", [
        dbUrl,
        "-c",
        `SET ROLE anon; INSERT INTO storage.objects (bucket_id, name) VALUES ('field-observation-media', '${testAnonName}');`,
      ]);
    } catch (err: any) {
      failedAsExpected = true;
      errorMessage = (err.stderr || err.message || "").toString();
    }

    expect(failedAsExpected).toBe(true);
    expect(errorMessage).toMatch(/violates row-level security policy|permission denied/i);
  });

  it("asserts an authenticated INSERT to storage.objects succeeds and direct anon SELECT is blocked", async () => {
    const dbUrl = process.env["DATABASE_URL"] || "postgresql://localhost/landalert";
    const testAuthName = `test_auth_${Date.now()}.jpg`;

    // 1. Authenticated INSERT succeeds
    const insertResult = await execFileAsync("psql", [
      dbUrl,
      "-c",
      `SET ROLE authenticated; INSERT INTO storage.objects (bucket_id, name) VALUES ('field-observation-media', '${testAuthName}');`,
    ]);
    expect(insertResult.stdout).toContain("INSERT 0 1");

    // 2. Direct anon SELECT sees 0 rows due to RLS
    const selectAnon = await execFileAsync("psql", [
      dbUrl,
      "-t",
      "-c",
      `SET ROLE anon; SELECT count(*) FROM storage.objects WHERE bucket_id = 'field-observation-media' AND name = '${testAuthName}';`,
    ]);
    const anonLines = selectAnon.stdout.trim().split("\n").filter(Boolean);
    expect(anonLines[anonLines.length - 1]?.trim()).toBe("0");

    // 3. Authenticated SELECT can read
    const selectAuth = await execFileAsync("psql", [
      dbUrl,
      "-t",
      "-c",
      `SET ROLE authenticated; SELECT count(*) FROM storage.objects WHERE bucket_id = 'field-observation-media' AND name = '${testAuthName}';`,
    ]);
    const authLines = selectAuth.stdout.trim().split("\n").filter(Boolean);
    expect(authLines[authLines.length - 1]?.trim()).toBe("1");


    // Clean up test row
    await execFileAsync("psql", [
      dbUrl,
      "-c",
      `DELETE FROM storage.objects WHERE name = '${testAuthName}';`,
    ]);
  });
});


