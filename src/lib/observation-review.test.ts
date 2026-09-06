/**
 * src/lib/observation-review.test.ts
 * ====================================
 * Tests for POST /api/observations/review endpoint and the
 * verifyGroundObservation() service function.
 *
 * Auth pattern mirrors backend.test.ts:
 *   - "test-authenticated-official" token  → VERIFIED_OFFICIAL (authorized)
 *   - "unprivileged_token"                 → PUBLIC_USER (forbidden)
 *   - no Authorization header              → 401
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Env setup ─────────────────────────────────────────────────────────────
process.env["SUPABASE_URL"] = "https://shkpwbqcbeqlybdrhczq.supabase.co";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_secret_test_key_for_testing";

// ── In-memory observation store ───────────────────────────────────────────
const MOCK_OBSERVATIONS: Record<string, any> = {
  "42": {
    id: 42,
    zone_id: 1,
    status: "PENDING_VERIFICATION",
    verified_by: null,
    verified_at: null,
    verification_notes: null,
    is_training_eligible: false,
  },
};

// ── Supabase admin mock ───────────────────────────────────────────────────
vi.mock("@/integrations/supabase/client.server", () => {
  const makeQuery = (table: string) => {
    const state: { filters: Record<string, unknown>; updates?: Record<string, unknown> } = {
      filters: {},
    };

    const query: any = {
      select: (_cols: string) => query,
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return query;
      },
      update: (updates: Record<string, unknown>) => {
        state.updates = updates;
        return query; // returns self so .eq() chain works
      },
      maybeSingle: async () => {
        if (table === "field_observations") {
          const id = String(state.filters["id"] ?? "");
          const row = MOCK_OBSERVATIONS[id] ?? null;
          // Apply updates if this is an update chain
          if (state.updates && row) {
            Object.assign(row, state.updates);
          }
          return { data: row, error: null };
        }
        return { data: null, error: null };
      },
      // Update chain: .update().eq() → returns { data, error }
      then: (resolve: (r: { data: unknown; error: null }) => void) => {
        if (table === "field_observations" && state.updates) {
          const id = String(state.filters["id"] ?? "");
          const row = MOCK_OBSERVATIONS[id];
          if (row) Object.assign(row, state.updates);
          resolve({ data: state.updates, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };

    // Make .update().eq() resolve as a Promise<{data, error}>
    const originalUpdate = query.update.bind(query);
    query.update = (updates: Record<string, unknown>) => {
      state.updates = updates;
      return {
        eq: async (col: string, val: unknown) => {
          state.filters[col] = val;
          const id = String(val);
          const row = MOCK_OBSERVATIONS[id];
          if (row) Object.assign(row, updates);
          return { data: updates, error: null };
        },
      };
    };

    return query;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => makeQuery(table),
      auth: {
        getUser: async (_token: string) => ({ data: { user: null }, error: { message: "not used" } }),
      },
      rpc: async (_fn: string) => ({ data: null, error: null }),
    },
  };
});

// ── Audit log mock (no-op in tests) ───────────────────────────────────────
vi.mock("./audit.service", () => ({
  logAuditEvent: async () => {},
}));

import { handleApiRequest } from "./api.router";
import { verifyGroundObservation } from "./official-auth.service";

// ═══════════════════════════════════════════════════════════════════════════
// API Router: POST /api/observations/review
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/observations/review", () => {
  beforeEach(() => {
    // Reset observation status before each test
    MOCK_OBSERVATIONS["42"].status = "PENDING_VERIFICATION";
    MOCK_OBSERVATIONS["42"].verified_by = null;
    MOCK_OBSERVATIONS["42"].verification_notes = null;
  });

  // ── 401: No authentication ──────────────────────────────────────────────
  it("returns 401 when no Authorization header is provided", async () => {
    const req = new Request("http://localhost/api/observations/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation_id: 42, new_status: "VERIFIED" }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json() as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  // ── 403: Authenticated but insufficient role ────────────────────────────
  it("returns 403 when caller is a PUBLIC_USER (unprivileged)", async () => {
    const req = new Request("http://localhost/api/observations/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer unprivileged_token",
      },
      body: JSON.stringify({ observation_id: 42, new_status: "VERIFIED" }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json() as { code: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  // ── 400: Missing observation_id ─────────────────────────────────────────
  it("returns 400 when observation_id is missing", async () => {
    const req = new Request("http://localhost/api/observations/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authenticated-official",
      },
      body: JSON.stringify({ new_status: "VERIFIED" }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json() as { code: string };
    expect(body.code).toBe("MISSING_OBSERVATION_ID");
  });

  // ── 400: Invalid new_status value ──────────────────────────────────────
  it("returns 400 when new_status is not VERIFIED or REJECTED", async () => {
    const req = new Request("http://localhost/api/observations/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authenticated-official",
      },
      body: JSON.stringify({ observation_id: 42, new_status: "OFFICIAL_VERIFIED" }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json() as { code: string };
    expect(body.code).toBe("INVALID_STATUS");
  });

  // ── 400: REJECTED without a reason ─────────────────────────────────────
  it("returns 400 when rejecting without a reason", async () => {
    const req = new Request("http://localhost/api/observations/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authenticated-official",
      },
      body: JSON.stringify({ observation_id: 42, new_status: "REJECTED", verification_notes: "no" }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json() as { code: string };
    expect(body.code).toBe("MISSING_REJECTION_REASON");
  });

  // ── 200: VERIFIED_OFFICIAL can approve ────────────────────────────────
  it("returns 200 when VERIFIED_OFFICIAL approves an observation", async () => {
    const req = new Request("http://localhost/api/observations/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authenticated-official",
      },
      body: JSON.stringify({
        observation_id: 42,
        new_status: "VERIFIED",
        verification_notes: "Field visit confirmed slope crack at chainage 12+400",
      }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as { ok: boolean; new_status: string; observation_id: string };
    expect(body.ok).toBe(true);
    expect(body.new_status).toBe("VERIFIED");
    expect(body.observation_id).toBe("42");
  });

  // ── 200: VERIFIED_OFFICIAL can reject with a reason ──────────────────
  it("returns 200 when VERIFIED_OFFICIAL rejects an observation with a reason", async () => {
    const req = new Request("http://localhost/api/observations/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authenticated-official",
      },
      body: JSON.stringify({
        observation_id: 42,
        new_status: "REJECTED",
        verification_notes: "No physical evidence found during site inspection.",
      }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as { ok: boolean; new_status: string };
    expect(body.ok).toBe(true);
    expect(body.new_status).toBe("REJECTED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Service: verifyGroundObservation() — status value correctness
// ═══════════════════════════════════════════════════════════════════════════

describe("verifyGroundObservation() — DB status correctness", () => {
  beforeEach(() => {
    MOCK_OBSERVATIONS["42"].status = "PENDING_VERIFICATION";
    MOCK_OBSERVATIONS["42"].verified_by = null;
  });

  it("writes 'VERIFIED' (not 'OFFICIAL_VERIFIED') to the database on approval", async () => {
    const officialProfile = {
      id: "test-official-uuid",
      email: "officer@gsi.gov.in",
      role: "VERIFIED_OFFICIAL" as const,
      verification_status: "VERIFIED" as const,
      dispatch_authorized: false,
    };

    const result = await verifyGroundObservation(officialProfile, "42", {
      status: "VERIFIED",
      verificationNotes: "Confirmed by on-site inspection.",
    });

    expect(result.success).toBe(true);
    // The mock applies the update: check the in-memory record reflects 'VERIFIED'
    expect(MOCK_OBSERVATIONS["42"].status).toBe("VERIFIED");
    expect(MOCK_OBSERVATIONS["42"].verified_by).toBe("test-official-uuid");
  });

  it("writes 'REJECTED' (not 'OFFICIAL_VERIFIED') to the database on rejection", async () => {
    const officialProfile = {
      id: "test-official-uuid",
      email: "officer@gsi.gov.in",
      role: "VERIFIED_OFFICIAL" as const,
      verification_status: "VERIFIED" as const,
      dispatch_authorized: false,
    };

    const result = await verifyGroundObservation(officialProfile, "42", {
      status: "REJECTED",
      verificationNotes: "No evidence found at site.",
    });

    expect(result.success).toBe(true);
    expect(MOCK_OBSERVATIONS["42"].status).toBe("REJECTED");
  });

  it("returns { success: false } for PUBLIC_USER with no audit bypass", async () => {
    const publicProfile = {
      id: "citizen-uuid",
      email: "citizen@gmail.com",
      role: "PUBLIC_USER" as const,
      verification_status: "UNVERIFIED" as const,
      dispatch_authorized: false,
    };

    const result = await verifyGroundObservation(publicProfile, "42", {
      status: "VERIFIED",
      verificationNotes: "I approve this.",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Only verified government officials");
    // Observation must NOT be mutated
    expect(MOCK_OBSERVATIONS["42"].status).toBe("PENDING_VERIFICATION");
  });

  it("returns { success: false } with 'not found' error for non-existent observation", async () => {
    const officialProfile = {
      id: "test-official-uuid",
      email: "officer@gsi.gov.in",
      role: "VERIFIED_OFFICIAL" as const,
      verification_status: "VERIFIED" as const,
      dispatch_authorized: false,
    };

    const result = await verifyGroundObservation(officialProfile, "99999", {
      status: "VERIFIED",
      verificationNotes: "Inspection complete.",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
