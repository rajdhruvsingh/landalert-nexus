/**
 * src/lib/backend.test.ts
 * =======================
 * Comprehensive unit and integration test suite for LandAlert-Nexus Backend & ML Integration.
 * Verifies:
 * - Prediction input validation
 * - Alert templates & telemetry advisories
 * - API router request handling, status codes, and error envelopes
 * - Security & authorization guards (cron bearer auth)
 * - Offline sync package & observation ingestion
 * - GIS GeoJSON geometry standards
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// Ensure environment variables for CI/test execution
process.env["CRON_SECRET"] = "test-cron-secret-12345";

process.env["SUPABASE_URL"] = "https://dfgapfiwdwdvdcxtxqmm.supabase.co";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_secret_test_key_for_testing";

// Realistic deterministic mock data for 15 NER zones
const MOCK_ZONES = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1,
  zone_name: `Zone ${i + 1}`,
  district: `District ${i + 1}`,
  state: i < 5 ? "Sikkim" : i < 10 ? "Meghalaya" : "Assam",
  centroid_lat: 25.0 + i * 0.2,
  centroid_lng: 92.0 + i * 0.2,
  mean_slope_deg: 25.0 + i,
  population: 20000 + i * 5000,
  current_risk_level: i === 0 ? "High" : i === 1 ? "Severe" : "Moderate",
  risk_score: 40.0 + i * 2.5,
  soil_moisture_pct: 52.0,
  soil_moisture_status: "measured",
  explanation: `Main driver: rainfall intensity. Detail — Zone ${i + 1}`,
  last_computed_at: new Date().toISOString(),
}));

const MOCK_ROADS = [
  {
    id: 1,
    zone_id: 1,
    road_name: "NH-10",
    segment_label: "Corridor A",
    status: "open",
    length_km: 14.2,
  },
  {
    id: 2,
    zone_id: 2,
    road_name: "NH-29",
    segment_label: "Corridor B",
    status: "restricted",
    length_km: 8.5,
  },
];

const MOCK_MODEL_CONFIG = {
  id: 4,
  model_version: "v0.2-lr-trained",
  feature_schema_version: "v1.0.0",
  pr_auc: 0.5934,
  recall_at_80_precision: 0.125,
  dataset_fingerprint: "f1054c5041ad8e672a45899f42f037d1f7cd15cc6f55256d8d7d68388ed2aa26",
  is_active: true,
  artifact_path: "models/v0.2-lr-trained.json",
  cutoff_moderate: 38.0,
  cutoff_high: 56.0,
  cutoff_severe: 74.0,
  weight_intensity: 0.38,
  weight_antecedent: 0.22,
  weight_soil_moisture: 0.18,
  weight_slope: 0.12,
  weight_history: 0.1,
};

interface MockQuery {
  _filters?: Record<string, unknown>;
  select: (cols: string) => MockQuery;
  order: (col: string, opt?: { ascending: boolean }) => MockQuery;
  eq: (col: string, val: unknown) => MockQuery;
  gt: (col: string, val: unknown) => MockQuery;
  limit: (n: number) => MockQuery;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  insert: (data: unknown) => {
    select: () => {
      maybeSingle: () => Promise<{ data: { id: number; dispatched_at: string }; error: null }>;
    };
    then: (resolve: (res: { data: unknown; error: null }) => void) => void;
  };
  upsert: (rows: unknown, opts?: unknown) => Promise<{ data: unknown; error: null }>;
  then: (resolve: (res: { data: unknown; error: null }) => void) => void;
}

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      from: (table: string) => {
        const query: MockQuery = {
          select: (_cols: string) => query,
          order: (_col: string, _opt?: { ascending: boolean }) => query,
          eq: (col: string, val: unknown) => {
            query._filters = query._filters || {};
            query._filters[col] = val;
            return query;
          },
          gt: (_col: string, _val: unknown) => query,
          limit: (_n: number) => query,
          maybeSingle: async () => {
            if (table === "risk_model_config") {
              return { data: MOCK_MODEL_CONFIG, error: null };
            }
            if (table === "risk_zones") {
              const id = (query._filters?.["id"] as number) ?? 1;
              const z = MOCK_ZONES.find((x) => x.id === id);
              return { data: z ?? null, error: null };
            }
            if (table === "alerts") {
              return { data: null, error: null };
            }
            return { data: null, error: null };
          },
          insert: (data: unknown) => {
            return {
              select: () => ({
                maybeSingle: async () => ({
                  data: { id: 999, dispatched_at: new Date().toISOString() },
                  error: null,
                }),
              }),
              then: (resolve: (res: { data: unknown; error: null }) => void) =>
                resolve({ data, error: null }),
            };
          },
          upsert: async (rows: unknown, _opts?: unknown) => {
            return { data: rows, error: null };
          },
          then: (resolve: (res: { data: unknown; error: null }) => void) => {
            if (table === "risk_zones") return resolve({ data: MOCK_ZONES, error: null });
            if (table === "road_segments") return resolve({ data: MOCK_ROADS, error: null });
            if (table === "risk_model_config")
              return resolve({ data: [MOCK_MODEL_CONFIG], error: null });
            if (table === "alerts") return resolve({ data: [], error: null });
            if (table === "historical_landslides") return resolve({ data: [], error: null });
            return resolve({ data: [], error: null });
          },
        };
        return query;
      },
      rpc: async (_fn: string) => {
        return { data: null, error: null };
      },
    },
  };
});

import { validatePredictionInput } from "./ml.service";
import { ALERT_TEMPLATES } from "./alert.service";
import { handleApiRequest } from "./api.router";

describe("ML Service Input Validation", () => {
  it("accepts valid zone IDs between 1 and 15", () => {
    for (let id = 1; id <= 15; id++) {
      const res = validatePredictionInput(id);
      expect(res.valid).toBe(true);
      expect(res.zoneId).toBe(id);
    }
  });

  it("rejects out-of-range or non-integer zone IDs", () => {
    expect(validatePredictionInput(0).valid).toBe(false);
    expect(validatePredictionInput(16).valid).toBe(false);
    expect(validatePredictionInput(-5).valid).toBe(false);
    expect(validatePredictionInput(3.14).valid).toBe(false);
    expect(validatePredictionInput("abc").valid).toBe(false);
    expect(validatePredictionInput(null).valid).toBe(false);
  });

  it("accepts valid historical ISO 8601 asOfDate", () => {
    const res = validatePredictionInput(1, "2024-06-15T00:00:00Z");
    expect(res.valid).toBe(true);
    expect(res.asOfDate).toBe("2024-06-15T00:00:00.000Z");
  });

  it("rejects malformed date strings", () => {
    const res = validatePredictionInput(1, "not-a-valid-date");
    expect(res.valid).toBe(false);
    expect(res.code).toBe("INVALID_DATE");
  });

  it("rejects dates far in the future (>24h)", () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    const res = validatePredictionInput(1, futureDate);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("FUTURE_DATE_NOT_ALLOWED");
  });
});

describe("Alert Templates & Telemetry Warnings", () => {
  it("renders all 4 supported languages with zone and severity", () => {
    const languages = ["en", "as", "bn", "ne"];
    for (const lang of languages) {
      expect(ALERT_TEMPLATES[lang]).toBeDefined();
      const msg = ALERT_TEMPLATES[lang]!.render("Gangtok, Sikkim", "Severe");
      expect(msg).toContain("Gangtok");
      expect(msg.length).toBeGreaterThan(20);
    }
  });

  it("attaches data telemetry advisory when provided", () => {
    const advisory = "DATA ADVISORY: Weather telemetry >72h old";
    const msg = ALERT_TEMPLATES["en"]!.render("Mangan, Sikkim", "High", advisory);
    expect(msg).toContain(advisory);
  });
});

describe("REST API Router (/api/*)", () => {
  it("returns null for non-API routes so TanStack Start SSR handles them", async () => {
    const req = new Request("http://localhost:3000/alerts");
    const res = await handleApiRequest(req);
    expect(res).toBeNull();
  });

  it("GET /api/health returns 200 with system component statuses", async () => {
    const req = new Request("http://localhost:3000/api/health");
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const body = (await res!.json()) as {
      status: string;
      components: {
        api: { status: string };
        database: { status: string };
        ml_model: { status: string };
      };
    };
    expect(["healthy", "degraded"]).toContain(body.status);
    expect(body.components.api.status).toBe("healthy");
    expect(body.components.ml_model.status).toBe("healthy");
  });

  it("GET /api/ml/health returns 200 with active model metadata", async () => {
    const req = new Request("http://localhost:3000/api/ml/health");
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const body = (await res!.json()) as {
      active_model_version: string;
      feature_schema_version: string;
      scientific_status: string;
    };
    expect(body.active_model_version).toBe("v0.2-lr-trained");
    expect(body.feature_schema_version).toBe("v1.0.0");
    expect(body.scientific_status).toContain("DATA LIMITED");
  });

  it("GET /api/risk-prediction returns 200 with valid prediction payload", async () => {
    const req = new Request("http://localhost:3000/api/risk-prediction?zoneId=1");
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const body = (await res!.json()) as {
      status: string;
      zone_id: number;
      model_version: string;
      probability: number;
      risk_score: number;
      risk_level: string;
      data_freshness: { soil_moisture_status: string };
    };
    expect(body.zone_id).toBe(1);
    expect(body.model_version).toBe("v0.2-lr-trained");
    expect(body.probability).toBeGreaterThanOrEqual(0.0);
    expect(body.probability).toBeLessThanOrEqual(1.0);
    expect(body.risk_score).toBeGreaterThanOrEqual(0.0);
    expect(body.risk_score).toBeLessThanOrEqual(100.0);
    expect(["Low", "Moderate", "High", "Severe"]).toContain(body.risk_level);
  });

  it("GET /api/risk-prediction rejects invalid zoneId with 400", async () => {
    const req = new Request("http://localhost:3000/api/risk-prediction?zoneId=99");
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);

    const body = (await res!.json()) as { error: string; code: string };
    expect(body.code).toBe("INVALID_ZONE_ID");
  });

  it("POST /api/ingest-weather rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost:3000/api/ingest-weather", {
      method: "POST",
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("POST /api/recompute rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost:3000/api/recompute", {
      method: "POST",
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("POST /api/recompute succeeds with 200 when bearer auth provided", async () => {
    const req = new Request("http://localhost:3000/api/recompute", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret-12345" },
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const body = (await res!.json()) as { ok: boolean; timestamp: string };
    expect(body.ok).toBe(true);
  });

  it("GET /api/sync/package returns complete offline bundle with cache policy", async () => {
    const req = new Request("http://localhost:3000/api/sync/package");
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const body = (await res!.json()) as {
      zones: Array<{ id: number; name: string; polygon: number[][] }>;
      active_model: {
        model_version: string;
        cutoffs: { moderate: number; high: number; severe: number };
      };
      cache_policy: { max_age_hours: number; is_expired: boolean };
    };
    expect(body.zones.length).toBe(15);
    expect(body.active_model.model_version).toBe("v0.2-lr-trained");
    expect(body.active_model.cutoffs.moderate).toBe(38.0);
    expect(body.active_model.cutoffs.high).toBe(56.0);
    expect(body.active_model.cutoffs.severe).toBe(74.0);
    expect(body.cache_policy.max_age_hours).toBe(24);
    expect(body.cache_policy.is_expired).toBe(false);
  });

  it("GET /api/gis/zones.geojson returns RFC 7946 GeoJSON FeatureCollection", async () => {
    const req = new Request("http://localhost:3000/api/gis/zones.geojson");
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toContain("application/geo+json");

    const body = (await res!.json()) as {
      type: string;
      features: Array<{
        type: string;
        id: number;
        geometry: { type: string; coordinates: number[][][] };
        properties: { zone_name: string; risk_score: number; active_model_version: string };
      }>;
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features.length).toBe(15);

    // Verify polygon closure (first coord == last coord)
    const firstPoly = body.features[0]!.geometry.coordinates[0]!;
    expect(firstPoly.length).toBeGreaterThanOrEqual(4);
    expect(firstPoly[0]![0]).toBeCloseTo(firstPoly[firstPoly.length - 1]![0]!, 6);
    expect(firstPoly[0]![1]).toBeCloseTo(firstPoly[firstPoly.length - 1]![1]!, 6);
  });

  it("POST /api/sync/observations processes valid offline observation batch", async () => {
    const idempotencyKey = `TEST-OBS-1-${Date.now()}`;
    const req = new Request("http://localhost:3000/api/sync/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observations: [
          {
            zone_id: 1,
            observed_at: new Date().toISOString(),
            client_timestamp: new Date().toISOString(),
            rainfall_mm: 35.5,
            road_status: "open",
            observer_id: "test_suite_runner",
            idempotency_key: idempotencyKey,
          },
        ],
      }),
    });

    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const body = (await res!.json()) as {
      success: boolean;
      syncedCount: number;
      acknowledgedKeys: string[];
    };
    expect(body.success).toBe(true);
    expect(body.syncedCount).toBe(1);
    expect(body.acknowledgedKeys).toContain(idempotencyKey);
  });

  it("GET /api/unknown-route returns 404 NOT_FOUND", async () => {
    const req = new Request("http://localhost:3000/api/unknown-route");
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);

    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  it("POST /api/alerts/dispatch rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost:3000/api/alerts/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zoneId: 1, justification: "Heavy rain causing debris" }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("POST /api/alerts/dispatch rejects unauthorized users with 403", async () => {
    const req = new Request("http://localhost:3000/api/alerts/dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer unprivileged_token",
      },
      body: JSON.stringify({ zoneId: 1, justification: "Heavy rain causing debris" }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("POST /api/alerts/dispatch succeeds with system cron secret and justification", async () => {
    const cronSecret = process.env["CRON_SECRET"] || "test-cron-secret";
    process.env["CRON_SECRET"] = cronSecret;

    const req = new Request("http://localhost:3000/api/alerts/dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        zoneId: 1,
        language: "en",
        channel: "both",
        justification: "Critical slope deformation verified on NH-10 corridor",
      }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    // Dispatched 201 or Cooldown 200
    expect([200, 201]).toContain(res!.status);
  });

  it("POST /api/simulate is disabled by default in production", async () => {
    delete process.env["ENABLE_SIMULATION"];
    const req = new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zoneId: 1, rainfallMm: 240 }),
    });
    const res = await handleApiRequest(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe("SIMULATION_DISABLED");
  });
});

import {
  evaluateEmailDomain,
  verifyDispatcherAuthorization,
  TRUSTED_INSTITUTIONAL_DOMAINS,
} from "./official-auth.service";

describe("Official Government Authentication & Observation Trust", () => {
  it("recognizes official institutional domains as PENDING_OFFICIAL_VERIFICATION and PUBLIC_USER", () => {
    const testCases = [
      "geologist@gsi.gov.in",
      "scientist@nesac.gov.in",
      "director@ndma.gov.in",
      "officer@nic.in",
      "responder@assam.gov.in",
      "control@mizoram.gov.in",
      "officer@meghalaya.gov.in",
      "coordinator@nagaland.gov.in",
      "admin@sikkim.gov.in",
    ];

    for (const email of testCases) {
      const evalResult = evaluateEmailDomain(email);
      expect(evalResult.isInstitutional).toBe(true);
      expect(evalResult.suggestedStatus).toBe("PENDING_OFFICIAL_VERIFICATION");
      // Domain alone MUST NOT grant privileges
      expect(evalResult.suggestedRole).toBe("PUBLIC_USER");
    }
  });

  it("classifies commercial webmail and unlisted domains as UNVERIFIED PUBLIC_USER", () => {
    const publicEmails = [
      "citizen@gmail.com",
      "reporter@yahoo.com",
      "user@outlook.com",
      "someone@custom-domain.org",
    ];

    for (const email of publicEmails) {
      const evalResult = evaluateEmailDomain(email);
      expect(evalResult.isInstitutional).toBe(false);
      expect(evalResult.suggestedStatus).toBe("UNVERIFIED");
      expect(evalResult.suggestedRole).toBe("PUBLIC_USER");
    }
  });

  it("enforces that emergency dispatch requires DISPATCHER or ADMIN role", async () => {
    // 1. Public user without dispatch authority
    const publicResult = await verifyDispatcherAuthorization(
      {
        userId: "pub-123",
        email: "citizen@gmail.com",
        role: "PUBLIC_USER",
        dispatchAuthorized: false,
      },
      1,
      "Valid justification text here",
    );
    expect(publicResult.authorized).toBe(false);
    expect(publicResult.reason).toContain("Emergency dispatch requires");

    // 2. Verified official without explicit dispatch authority
    const officialResult = await verifyDispatcherAuthorization(
      {
        userId: "off-456",
        email: "geologist@gsi.gov.in",
        role: "VERIFIED_OFFICIAL",
        dispatchAuthorized: false,
      },
      1,
      "Valid justification text here",
    );
    expect(officialResult.authorized).toBe(false);

    // 3. Authorized dispatcher
    const dispatcherResult = await verifyDispatcherAuthorization(
      {
        userId: "disp-789",
        email: "controller@ndma.gov.in",
        role: "DISPATCHER",
        dispatchAuthorized: true,
      },
      1,
      "Valid justification text exceeding 8 characters",
    );
    expect(dispatcherResult.authorized).toBe(true);

    // 4. Admin
    const adminResult = await verifyDispatcherAuthorization(
      {
        userId: "adm-001",
        email: "admin@nic.in",
        role: "ADMIN",
        dispatchAuthorized: true,
      },
      1,
      "Emergency threshold crossed on NH-29",
    );
    expect(adminResult.authorized).toBe(true);
  });

  it("rejects dispatch requests lacking sufficient operational justification", async () => {
    const noJustification = await verifyDispatcherAuthorization(
      {
        userId: "disp-789",
        role: "DISPATCHER",
        dispatchAuthorized: true,
      },
      1,
      "short",
    );
    expect(noJustification.authorized).toBe(false);
    expect(noJustification.reason).toContain("operational justification");
  });
});
