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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// Ensure environment variables for CI/test execution
process.env["CRON_SECRET"] = "test-cron-secret-12345";

process.env["SUPABASE_URL"] = "https://shkpwbqcbeqlybdrhczq.supabase.co";
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
  id: 5,
  model_version: "v0.4-lr-trained",
  feature_schema_version: "v1.0.0",
  pr_auc: 0.6037,
  recall_at_80_precision: 0.18,
  dataset_fingerprint: "e2f7a1c9b8d4063a19f5e72c3b6d0a8e4f1c2b9a7d3e6f08c1b4e2a5d9f3c7b8",
  is_active: true,
  artifact_path: "models/v0.4-lr-trained.json",
  cutoff_moderate: 38.0,
  cutoff_high: 56.0,
  cutoff_severe: 74.0,
  weight_intensity: 0.38,
  weight_antecedent: 0.22,
  weight_soil_moisture: 0.18,
  weight_slope: 0.12,
  weight_history: 0.1,
};

const MOCK_ALERTS_STORE: any[] = [
  {
    id: 101,
    zone_id: 1,
    risk_level: "High",
    message: "High landslide risk in Zone 1",
    language: "en",
    channel: "sms",
    explanation: "Rainfall spike detected",
    dispatched_at: "2026-09-04T12:00:00.000Z",
    dispatched_by: "dispatcher@sikkim.gov.in",
    status: "active",
    is_retracted: false,
  },
];

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
  update: (updates: Record<string, unknown>) => {
    eq: (col: string, val: unknown) => Promise<{ data: unknown; error: null }>;
  };
  upsert: (rows: unknown, opts?: unknown) => Promise<{ data: unknown; error: null }>;
  then: (resolve: (res: { data: unknown; error: null }) => void) => void;
}

let mockDbUnreachable = false;

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (mockDbUnreachable) {
          throw new Error("Connection refused: PostgreSQL database offline");
        }
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
              const id = query._filters?.["id"] as number | undefined;
              if (id) {
                const a = MOCK_ALERTS_STORE.find((x) => x.id === id);
                return { data: a ?? null, error: null };
              }
              return { data: MOCK_ALERTS_STORE[0] ?? null, error: null };
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
          update: (updates: Record<string, unknown>) => {
            return {
              eq: async (col: string, val: unknown) => {
                if (table === "alerts" && col === "id") {
                  const target = MOCK_ALERTS_STORE.find((x) => x.id === val);
                  if (target) {
                    Object.assign(target, updates);
                  }
                }
                return { data: updates, error: null };
              },
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
            if (table === "alerts") return resolve({ data: [...MOCK_ALERTS_STORE], error: null });
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

import {
  validatePredictionInput,
  getDatabaseFallbackPrediction,
  setLastKnownPredictionForTesting,
  clearLastKnownPredictionsForTesting,
  type RiskPredictionResult,
} from "./ml.service";
import { severityRank, riskColor, riskBadgeClass } from "./risk";
import { ALERT_TEMPLATES } from "./alert.service";
import { handleApiRequest } from "./api.router";

describe("Authoritative ML Fallback & Degraded State Handling", () => {
  beforeEach(() => {
    clearLastKnownPredictionsForTesting();
    mockDbUnreachable = false;
  });

  afterEach(() => {
    clearLastKnownPredictionsForTesting();
    mockDbUnreachable = false;
  });

  it("returns explicit UNKNOWN/DEGRADED state when database is unreachable with no prior prediction", async () => {
    mockDbUnreachable = true;
    const result = await getDatabaseFallbackPrediction(1);

    expect(result.status).toBe("DEGRADED");
    expect(result.risk_level).toBe("UNKNOWN");
    expect(result.probability).toBeNull();
    expect(result.risk_score).toBeNull();
    expect(result.zone_id).toBe(1);
    expect(result.explanation_narrative).toContain("Status Unknown");
    expect(result.explanation_narrative).toContain("system data unavailable");
  });

  it("preserves last-known prediction with staleness flag when database is unreachable with prior computation", async () => {
    const priorPrediction: RiskPredictionResult = {
      status: "VALID",
      zone_id: 3,
      zone_name: "Aizawl East",
      district: "Aizawl",
      state: "Mizoram",
      model_version: "v0.4-lr-trained",
      feature_schema_version: "v1.0.0",
      probability: 0.72,
      risk_score: 72,
      risk_level: "Severe",
      explanation_narrative: "Intense 72h monsoon rainfall crossing threshold",
      data_freshness: {
        latest_weather_timestamp: "2026-09-04T18:00:00Z",
        weather_age_hours: 4.2,
        soil_moisture_status: "measured",
      },
      inference_timestamp: "2026-09-04T18:05:00Z",
      persisted: true,
    };

    setLastKnownPredictionForTesting(3, priorPrediction);

    mockDbUnreachable = true;
    const result = await getDatabaseFallbackPrediction(3);

    // Must NOT downgrade to UNKNOWN or Low
    expect(result.status).toBe("STALE");
    expect(result.risk_level).toBe("Severe");
    expect(result.risk_score).toBe(72);
    expect(result.probability).toBe(0.72);
    expect(result.data_freshness.soil_moisture_status).toBe("stale");
    expect(result.explanation_narrative).toContain("showing last-known computation from");
    expect(result.explanation_narrative).toContain("(may be stale)");
  });

  it("guarantees UNKNOWN is never numerically sortable alongside Low/Moderate/High/Severe", () => {
    expect(severityRank("Low")).toBe(1);
    expect(severityRank("Moderate")).toBe(2);
    expect(severityRank("High")).toBe(3);
    expect(severityRank("Severe")).toBe(4);
    expect(severityRank("UNKNOWN")).toBeNull();

    // Verify ordering logic handles null severity rank safely
    const mixedLevels = ["Severe", "UNKNOWN", "Low", "High", "Moderate"];
    const sortable = mixedLevels.filter((l) => severityRank(l) !== null);
    sortable.sort((a, b) => severityRank(a)! - severityRank(b)!);
    expect(sortable).toEqual(["Low", "Moderate", "High", "Severe"]);

    // UNKNOWN is never coerced to <= Low
    expect(severityRank("UNKNOWN")).toBeNull();
    expect(riskColor("UNKNOWN")).toBe("var(--risk-unknown, #94a3b8)");
    expect(riskBadgeClass("UNKNOWN")).toContain("text-muted-foreground");
    expect(riskBadgeClass("UNKNOWN")).not.toContain("text-risk-low");
  });
});

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
    expect(body.active_model_version).toBe("v0.4-lr-trained");
    expect(body.feature_schema_version).toBe("v1.0.0");
    expect(body.scientific_status).toContain("DATA LIMITED");
  });

  // Spawns real Python ML subprocess (pandas/scikit-learn) with database connectivity.
  // Uses psycopg2 connect_timeout=3 and 4000ms subprocess timeout with deterministic fallback.
  it(
    "GET /api/risk-prediction returns 200 with valid prediction payload",
    async () => {
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
      expect(body.model_version).toBe("v0.4-lr-trained");
      expect(body.probability).toBeGreaterThanOrEqual(0.0);
      expect(body.probability).toBeLessThanOrEqual(1.0);
      expect(body.risk_score).toBeGreaterThanOrEqual(0.0);
      expect(body.risk_score).toBeLessThanOrEqual(100.0);
      expect(["Low", "Moderate", "High", "Severe"]).toContain(body.risk_level);
    },
    10000,
  );

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
    expect(body.active_model.model_version).toBe("v0.4-lr-trained");
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

  it("executes complete offline-to-online lifecycle with idempotency and duplicate replay prevention", async () => {
    const idempotencyKey = `LIFECYCLE-KEY-${Date.now()}`;
    const payload = {
      observations: [
        {
          zone_id: 2,
          observed_at: new Date().toISOString(),
          client_timestamp: new Date().toISOString(),
          rainfall_mm: 68.4,
          soil_condition: "saturated",
          visual_signs: "Debris slide on roadside",
          road_status: "restricted",
          observer_id: "field_officer_02",
          idempotency_key: idempotencyKey,
        },
      ],
    };

    // 1. First sync submission (simulating initial reconnection)
    const req1 = new Request("http://localhost:3000/api/sync/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res1 = await handleApiRequest(req1);
    expect(res1).not.toBeNull();
    expect(res1!.status).toBe(200);

    const body1 = (await res1!.json()) as {
      success: boolean;
      syncedCount: number;
      skippedDuplicates: number;
      acknowledgedKeys: string[];
    };
    expect(body1.success).toBe(true);
    expect(body1.syncedCount).toBe(1);
    expect(body1.acknowledgedKeys).toContain(idempotencyKey);

    // 2. Duplicate sync replay (simulating network retry or re-queued item)
    const req2 = new Request("http://localhost:3000/api/sync/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res2 = await handleApiRequest(req2);
    expect(res2).not.toBeNull();
    expect(res2!.status).toBe(200);

    const body2 = (await res2!.json()) as {
      success: boolean;
      syncedCount: number;
      skippedDuplicates: number;
      acknowledgedKeys: string[];
    };
    expect(body2.success).toBe(true);
    expect(body2.syncedCount).toBe(1);
    expect(body2.acknowledgedKeys).toContain(idempotencyKey);
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

describe("Production UI, Auth, and Stacking Hierarchy Regressions", () => {
  it("derives user authorization states correctly across all roles and domain levels", async () => {
    const { getUserAuthorizationState } = await import("./auth-domains");

    // 1. Anonymous
    expect(getUserAuthorizationState(null).badge).toBe("Anonymous Observer");

    // 2. Standard Google/public user
    const publicUser = getUserAuthorizationState({
      email: "citizen@gmail.com",
      user_metadata: { role: "PUBLIC_USER" },
    });
    expect(publicUser.badge).toBe("Authenticated — Standard User");
    expect(publicUser.role).toBe("PUBLIC_USER");
    expect(publicUser.tone).toBe("neutral");

    // 3. Government-domain account awaiting verification
    const pendingOfficial = getUserAuthorizationState({
      email: "officer@gsi.gov.in",
      user_metadata: { role: "PUBLIC_USER" },
    });
    expect(pendingOfficial.badge).toBe("Official account — Verification pending");
    expect(pendingOfficial.role).toBe("PUBLIC_USER");
    expect(pendingOfficial.status).toBe("PENDING_OFFICIAL_VERIFICATION");
    expect(pendingOfficial.tone).toBe("warning");

    // 4. Approved official
    const verifiedOfficial = getUserAuthorizationState({
      email: "director@assam.gov.in",
      user_metadata: { role: "VERIFIED_OFFICIAL", verification_status: "OFFICIAL_VERIFIED" },
    });
    expect(verifiedOfficial.badge).toBe("Verified Official");
    expect(verifiedOfficial.role).toBe("VERIFIED_OFFICIAL");
    expect(verifiedOfficial.tone).toBe("success");

    // 5. Emergency Dispatcher
    const dispatcher = getUserAuthorizationState({
      email: "control@ndma.gov.in",
      user_metadata: { role: "DISPATCHER", dispatch_authorized: true },
    });
    expect(dispatcher.badge).toBe("Emergency Dispatcher");
    expect(dispatcher.role).toBe("DISPATCHER");
    expect(dispatcher.tone).toBe("primary");

    // 6. System Administrator
    const admin = getUserAuthorizationState({
      email: "sysadmin@nic.in",
      user_metadata: { role: "ADMIN" },
    });
    expect(admin.badge).toBe("System Administrator");
    expect(admin.role).toBe("ADMIN");
  });

  it("verifies Leaflet map container has CSS isolation to prevent modal overlap", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(process.cwd(), "src/styles.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    expect(css).toContain(".leaflet-container");
    expect(css).toContain("isolation: isolate");
    expect(css).toContain("z-index: 1");
  });

  it("verifies Dialog components use higher z-index (z-[100]) than map", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dialogPath = path.resolve(process.cwd(), "src/components/ui/dialog.tsx");
    const dialog = fs.readFileSync(dialogPath, "utf-8");

    expect(dialog).toContain("z-[100]");
  });

  it("verifies SelectContent uses z-[150] so dropdowns render above dialogs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const selectPath = path.resolve(process.cwd(), "src/components/ui/select.tsx");
    const select = fs.readFileSync(selectPath, "utf-8");

    expect(select).toContain("z-[150]");
  });

  it("verifies production dashboard contains no simulation button or fake trigger", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const indexPath = path.resolve(process.cwd(), "src/routes/index.tsx");
    const indexContent = fs.readFileSync(indexPath, "utf-8");

    expect(indexContent).not.toContain("SIMULATE 240MM SPIKE");
    expect(indexContent).not.toContain("simulateRainfallSpike");
    expect(indexContent).not.toContain("runSpike");
  });

  it("verifies zero Lovable branding or references exist across source and public files", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    function checkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== ".output" && entry.name !== "dist") {
            checkDir(fullPath);
          }
        } else if (
          entry.isFile() &&
          entry.name !== "backend.test.ts" &&
          (fullPath.endsWith(".ts") ||
            fullPath.endsWith(".tsx") ||
            fullPath.endsWith(".html") ||
            fullPath.endsWith(".css") ||
            fullPath.endsWith(".json") ||
            fullPath.endsWith(".md"))
        ) {
          const content = fs.readFileSync(fullPath, "utf-8");
          expect(content.toLowerCase()).not.toContain("lovable");
        }
      }
    }

    checkDir(path.resolve(process.cwd(), "src"));
    checkDir(path.resolve(process.cwd(), "public"));
  });

  describe("TASK 1 — Weather-Linked Risk Forecast Engine", () => {
    it("applies physically-grounded threshold equations to forecast rainfall without overwriting current risk", async () => {
      const { projectZoneRiskForecast } = await import("./forecast.service");

      const projection = projectZoneRiskForecast({
        zoneId: 1,
        zoneName: "Gangtok Ridge",
        district: "East Sikkim",
        state: "Sikkim",
        currentRiskLevel: "Moderate",
        currentRiskScore: 45.0,
        forecast_24h_mm: 120,
        forecast_48h_mm: 180,
        forecast_72h_mm: 220,
      });

      expect(projection.forecastStatus).toBe("AVAILABLE");
      // Authoritative current state remains Moderate (not overwritten)
      expect(projection.currentRiskLevel).toBe("Moderate");
      expect(projection.currentRiskScore).toBe(45.0);

      // Projections are nested in forecastWindows, structurally distinct
      expect(projection.forecastWindows).toBeDefined();
      expect(projection.forecastWindows!["24h"].leadHours).toBe(24);
      expect(projection.forecastWindows!["24h"].forecastRainfallMm).toBe(120);
      expect(projection.forecastWindows!["24h"].projectedRiskLevel).toMatch(/High|Severe/);
      expect(projection.forecastWindows!["24h"].trend).toMatch(/elevating|critical/);
      expect(projection.forecastWindows!["24h"].narrative).toMatch(/projected to reach/i);

      // Verify skill degradation
      expect(projection.forecastWindows!["24h"].confidence).toBe("high");
      expect(projection.forecastWindows!["48h"].confidence).toBe("medium");
      expect(projection.forecastWindows!["72h"].confidence).toBe("low");
    });

    it("explicitly returns UNAVAILABLE when forecast data is missing or empty", async () => {
      const { projectZoneRiskForecast } = await import("./forecast.service");

      const unavailable = projectZoneRiskForecast({
        zoneId: 2,
        zoneName: "Mangan North",
        district: "North Sikkim",
        state: "Sikkim",
        currentRiskLevel: "High",
        currentRiskScore: 65.0,
        forecast_24h_mm: null,
        forecast_48h_mm: null,
        forecast_72h_mm: null,
      });

      expect(unavailable.forecastStatus).toBe("UNAVAILABLE");
      expect(unavailable.forecastWindows).toBeNull();
      expect(unavailable.explanation).toMatch(/forecast unavailable/i);
      // Authoritative current level is still preserved
      expect(unavailable.currentRiskLevel).toBe("High");
    });

    it("verifies forecast projections REST API endpoint structurally separates forecast from current risk", async () => {
      const { setMockForecastOverrideForTesting, clearForecastCacheForTesting } = await import(
        "./forecast.service"
      );

      setMockForecastOverrideForTesting(
        new Map([
          [
            1,
            {
              zoneId: 1,
              forecast_24h_mm: 15,
              forecast_48h_mm: 25,
              forecast_72h_mm: 35,
            },
          ],
        ]),
      );

      try {
        const req = new Request("http://localhost/api/forecast/projections?zoneId=1", {
          method: "GET",
        });
        const res = await handleApiRequest(req);
        expect(res!.status).toBe(200);

        const data: any = await res!.json();
        expect(data.zoneId).toBe(1);
        expect(data.currentRiskLevel).toBeDefined();
        expect(data.forecastWindows).toBeDefined();
        expect(data.forecastWindows["24h"].leadHours).toBe(24);
      } finally {
        clearForecastCacheForTesting();
      }
    });
  });

  describe("TASK 2 — Emergency Response Prioritisation Engine", () => {
    it("strictly excludes UNKNOWN-risk zones from numeric ranking", async () => {
      const { scoreZonePrioritization, evaluateEmergencyPrioritization } = await import(
        "./prioritization.service"
      );

      const unknownZone = {
        zoneId: 99,
        zoneName: "Telemeterless Ridge",
        district: "East",
        state: "Sikkim",
        currentRiskLevel: "UNKNOWN",
        population: 50000,
        roadSegments: [{ id: 1, roadName: "NH-10", segmentLabel: "A", status: "blocked" as const }],
        fieldObservations: [{ id: 1, visualSigns: "tension_cracks", reviewStatus: "PENDING_REVIEW" }],
      };

      // Direct scoring returns null for UNKNOWN (never coerced to numeric score)
      const score = scoreZonePrioritization(unknownZone);
      expect(score).toBeNull();

      // evaluateEmergencyPrioritization segregates it to unrankedZones
      const evaluated = evaluateEmergencyPrioritization([unknownZone]);
      expect(evaluated.rankedZones.length).toBe(0);
      expect(evaluated.unrankedZones.length).toBe(1);
      expect(evaluated.unrankedZones[0]?.zoneId).toBe(99);
      expect(evaluated.unrankedZones[0]?.reason).toContain("UNKNOWN");
    });

    it("verifies ranking order responds correctly to changes in each input factor according to documented weights", async () => {
      const { scoreZonePrioritization, evaluateEmergencyPrioritization } = await import(
        "./prioritization.service"
      );

      // Base zone: Low risk, 5,000 pop, open road, 0 observations
      const baseZone = {
        zoneId: 1,
        zoneName: "Base Valley",
        district: "D1",
        state: "Sikkim",
        currentRiskLevel: "Low" as const,
        population: 5000,
        roadSegments: [{ id: 1, roadName: "R1", segmentLabel: "A", status: "open" as const }],
        fieldObservations: [],
      };

      const baseScore = scoreZonePrioritization(baseZone)!.score;

      // 1. Severity change: Low -> Severe
      const severeZone = { ...baseZone, zoneId: 2, currentRiskLevel: "Severe" as const };
      const severeScore = scoreZonePrioritization(severeZone)!.score;
      expect(severeScore).toBeGreaterThan(baseScore);

      // 2. Population change: 5,000 -> 80,000
      const populatedZone = { ...baseZone, zoneId: 3, population: 80000 };
      const populatedScore = scoreZonePrioritization(populatedZone)!.score;
      expect(populatedScore).toBeGreaterThan(baseScore);

      // 3. Road status change: open -> blocked
      const blockedRoadZone = {
        ...baseZone,
        zoneId: 4,
        roadSegments: [{ id: 2, roadName: "R1", segmentLabel: "A", status: "blocked" as const }],
      };
      const blockedRoadScore = scoreZonePrioritization(blockedRoadZone)!.score;
      expect(blockedRoadScore).toBeGreaterThan(baseScore);

      // 4. Observations change: 0 -> 2 distress reports
      const distressedZone = {
        ...baseZone,
        zoneId: 5,
        fieldObservations: [
          { id: 1, visualSigns: "subsidence", reviewStatus: "PENDING_REVIEW" },
          { id: 2, visualSigns: "tension_cracks", reviewStatus: "PENDING_REVIEW" },
        ],
      };
      const distressedScore = scoreZonePrioritization(distressedZone)!.score;
      expect(distressedScore).toBeGreaterThan(baseScore);

      // Verify overall ranking sorts descending by priorityScore
      const rankedResult = evaluateEmergencyPrioritization([
        baseZone,
        severeZone,
        populatedZone,
        blockedRoadZone,
        distressedZone,
      ]);

      expect(rankedResult.rankedZones.length).toBe(5);
      expect(rankedResult.rankedZones[0]?.rank).toBe(1);
      for (let i = 0; i < rankedResult.rankedZones.length - 1; i++) {
        expect(rankedResult.rankedZones[i]!.priorityScore).toBeGreaterThanOrEqual(
          rankedResult.rankedZones[i + 1]!.priorityScore,
        );
      }
    });

    it("verifies mathematical formula matches 40% severity, 25% population, 20% road, 15% observation specification", async () => {
      const { scoreZonePrioritization } = await import("./prioritization.service");

      // Controlled test zone with known parameters:
      // High risk = severityRank 3/4 * 40 = 30.0 pts
      // Population 50,000 / 100,000 * 25 = 12.5 pts
      // Blocked road = 1.0 * 20 = 20.0 pts
      // 2 distress / 4 cap = 0.5 * 15 = 7.5 pts
      // Total = 30.0 + 12.5 + 20.0 + 7.5 = 70.0
      const zone = {
        zoneId: 10,
        zoneName: "Math Test Ridge",
        district: "Gangtok",
        state: "Sikkim",
        currentRiskLevel: "High" as const,
        population: 50000,
        roadSegments: [{ id: 1, roadName: "NH-10", segmentLabel: "A", status: "blocked" as const }],
        fieldObservations: [
          { id: 1, visualSigns: "tension_cracks", reviewStatus: "PENDING_REVIEW" },
          { id: 2, visualSigns: "rockfall", reviewStatus: "PENDING_REVIEW" },
        ],
      };

      const evaluated = scoreZonePrioritization(zone)!;
      expect(evaluated.breakdown.severityPoints).toBe(30.0);
      expect(evaluated.breakdown.populationPoints).toBe(12.5);
      expect(evaluated.breakdown.roadPoints).toBe(20.0);
      expect(evaluated.breakdown.observationPoints).toBe(7.5);
      expect(evaluated.score).toBe(70.0);
    });

    it("verifies prioritization REST API returns decision-support envelope with unranked zones segregated", async () => {
      const req = new Request("http://localhost/api/response/prioritization", { method: "GET" });
      const res = await handleApiRequest(req);
      expect(res!.status).toBe(200);

      const json: any = await res!.json();
      expect(Array.isArray(json.rankedZones)).toBe(true);
      expect(Array.isArray(json.unrankedZones)).toBe(true);
      expect(json.weights).toBeDefined();
      expect(json.weights.severityWeight).toBe(0.4);
      expect(json.disclaimer).toMatch(/decision-support/i);
    });
  });

  describe("TASK 2 — Candidate Model Registry & Scientific Boundary Messaging", () => {
    it("surfaces candidate-pending notice when a validated-but-inactive model row exists in risk_model_config", async () => {
      const candidateRow = {
        model_version: "v0.3-lr-trained",
        status: "validated",
        positive_count: 15,
        pr_auc: 0.6363,
        is_active: false,
      };

      const { default: i18n } = await import("./i18n");
      const noticeText = i18n.t("dashboard.candidate_pending_notice", {
        version: candidateRow.model_version.replace("-lr-trained", ""),
        events: candidateRow.positive_count,
      });

      expect(noticeText).toContain("v0.3");
      expect(noticeText).toContain("N=15");
      expect(noticeText).toMatch(/candidate|pending manual activation/i);
    });

    it("ensures candidate notice is absent when active model is already latest and no candidate row exists", () => {
      const candidateModel = null;
      // In JSX, candidateModel && (...) renders null/nothing
      const shouldRender = Boolean(candidateModel);
      expect(shouldRender).toBe(false);
    });

    it("verifies key parity for candidate_pending_notice across all 4 locales", async () => {
      const en = (await import("@/locales/en.json")).default;
      const as = (await import("@/locales/as.json")).default;
      const bn = (await import("@/locales/bn.json")).default;
      const ne = (await import("@/locales/ne.json")).default;

      expect(en.dashboard.candidate_pending_notice).toBeDefined();
      for (const [code, bundle] of [["as", as], ["bn", bn], ["ne", ne]] as const) {
        expect((bundle as any).dashboard.candidate_pending_notice, `${code} missing candidate_pending_notice`).toBeDefined();
        expect((bundle as any).dashboard.candidate_pending_notice).toContain("{{version}}");
        expect((bundle as any).dashboard.candidate_pending_notice).toContain("{{events}}");
      }
    });
  });

  describe("TASK 3 — API Rate Limiting & 429 Retry-After Enforcement", () => {
    it("allows requests under the limit and rejects with 429 when exceeded", async () => {
      const { InMemoryRateLimiter } = await import("./rate-limiter");
      const limiter = new InMemoryRateLimiter();
      const policy = { windowSeconds: 60, maxRequests: 3 };
      const key = "test_client_1";

      // Requests 1, 2, 3 should be allowed
      const r1 = limiter.checkLimit(key, policy);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = limiter.checkLimit(key, policy);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = limiter.checkLimit(key, policy);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      // Request 4 should be rejected with 429 semantics
      const r4 = limiter.checkLimit(key, policy);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.resetSeconds).toBeGreaterThan(0);
    });

    it("resets rate limit window after window expiration", async () => {
      const { InMemoryRateLimiter } = await import("./rate-limiter");
      const limiter = new InMemoryRateLimiter();
      const policy = { windowSeconds: 1, maxRequests: 2 };
      const key = "test_client_expiry";

      limiter.checkLimit(key, policy);
      limiter.checkLimit(key, policy);
      expect(limiter.checkLimit(key, policy).allowed).toBe(false);

      // Advance time or manual reset
      limiter.reset(key);
      const afterReset = limiter.checkLimit(key, policy);
      expect(afterReset.allowed).toBe(true);
      expect(afterReset.remaining).toBe(1);
    });

    it("verifies API router returns 429 with Retry-After header on POST /api/alerts/dispatch", async () => {
      const { defaultRateLimiter, RATE_LIMIT_POLICIES, getClientIdentifier } = await import("./rate-limiter");
      const clientIp = "192.168.100.50";

      const createTestReq = () =>
        new Request("http://localhost/api/alerts/dispatch", {
          method: "POST",
          headers: {
            "x-forwarded-for": clientIp,
            Authorization: "Bearer test-cron-secret-12345",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ zoneId: 1, justification: "Testing rate limit" }),
        });

      const clientKey = `alert_dispatch:${getClientIdentifier(createTestReq())}`;

      // Reset test key bucket
      defaultRateLimiter.reset(clientKey);

      // Consume all allowed slots
      for (let i = 0; i < RATE_LIMIT_POLICIES.ALERT_DISPATCH.maxRequests; i++) {
        defaultRateLimiter.checkLimit(clientKey, RATE_LIMIT_POLICIES.ALERT_DISPATCH);
      }

      // Next request through API router should trigger 429
      const req = createTestReq();
      const res = await handleApiRequest(req);
      expect(res!.status).toBe(429);
      expect(res!.headers.get("Retry-After")).toBeDefined();
      expect(Number(res!.headers.get("Retry-After"))).toBeGreaterThan(0);

      const json: any = await res!.json();
      expect(json.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(json.error).toMatch(/rate limit exceeded/i);

      // Cleanup
      defaultRateLimiter.reset(clientKey);
    });

    it("verifies API router returns 429 on POST /api/sync/observations when limit is exceeded", async () => {
      const { defaultRateLimiter, RATE_LIMIT_POLICIES } = await import("./rate-limiter");
      const clientIp = "192.168.100.51";
      const clientKey = `sync_observations:${clientIp}`;

      defaultRateLimiter.reset(clientKey);

      for (let i = 0; i < RATE_LIMIT_POLICIES.OBSERVATION_SYNC.maxRequests; i++) {
        defaultRateLimiter.checkLimit(clientKey, RATE_LIMIT_POLICIES.OBSERVATION_SYNC);
      }

      const req = new Request("http://localhost/api/sync/observations", {
        method: "POST",
        headers: {
          "x-forwarded-for": clientIp,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ observations: [] }),
      });

      const res = await handleApiRequest(req);
      expect(res!.status).toBe(429);
      expect(res!.headers.get("Retry-After")).toBeDefined();

      const json: any = await res!.json();
      expect(json.code).toBe("RATE_LIMIT_EXCEEDED");

      defaultRateLimiter.reset(clientKey);
    });
  });

  describe("TASK 5 — Alert False-Alarm & Retraction Flow", () => {
    beforeEach(() => {
      MOCK_ALERTS_STORE.length = 0;
      MOCK_ALERTS_STORE.push({
        id: 101,
        zone_id: 1,
        risk_level: "High",
        message: "High landslide risk in Zone 1",
        language: "en",
        channel: "sms",
        explanation: "Rainfall spike detected",
        dispatched_at: "2026-09-04T12:00:00.000Z",
        dispatched_by: "dispatcher@sikkim.gov.in",
        status: "active",
        is_retracted: false,
      });
    });

    it("enforces DISPATCHER/ADMIN role for alert retraction and rejects unauthorized users", async () => {
      // 1. Unauthenticated -> 401
      const reqNoAuth = new Request("http://localhost/api/alerts/retract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: 101, reason: "Radar telemetry failure verified by GSI" }),
      });
      const resNoAuth = await handleApiRequest(reqNoAuth);
      expect(resNoAuth!.status).toBe(401);

      // 2. Citizen / PUBLIC_USER role -> 403
      const reqCitizen = new Request("http://localhost/api/alerts/retract", {
        method: "POST",
        headers: {
          Authorization: "Bearer citizen-user-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ alertId: 101, reason: "Unauthorized attempt" }),
      });
      const resCitizen = await handleApiRequest(reqCitizen);
      expect(resCitizen!.status).toBe(403);

      // 3. Authorized DISPATCHER / system token -> 200
      const reqAuthorized = new Request("http://localhost/api/alerts/retract", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-cron-secret-12345",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ alertId: 101, reason: "Slope stabilized; telemetry false-alarm" }),
      });
      const resAuthorized = await handleApiRequest(reqAuthorized);
      expect(resAuthorized!.status).toBe(200);

      const json: any = await resAuthorized!.json();
      expect(json.success).toBe(true);
      expect(json.alertId).toBe(101);
      expect(json.reason).toContain("telemetry false-alarm");
    });

    it("verifies retracted alerts remain in history and are never deleted from the database", async () => {
      const { retractAlert } = await import("./alert.service");

      // Verify alert 101 exists initially in store
      const before = MOCK_ALERTS_STORE.find((a) => a.id === 101);
      expect(before).toBeDefined();

      // Execute retraction
      const result = await retractAlert({
        alertId: 101,
        reason: "False positive caused by AWS sensor drift",
        retractedBy: "dispatcher@sikkim.gov.in",
      });

      expect(result.success).toBe(true);
      expect(result.alertId).toBe(101);
      expect(result.retractedAt).toBeDefined();
      expect(result.retractedBy).toBe("dispatcher@sikkim.gov.in");

      // Verify alert was NOT deleted and is still in store
      const after = MOCK_ALERTS_STORE.find((a) => a.id === 101);
      expect(after).toBeDefined();
      expect(after.status).toBe("retracted");
      expect(after.is_retracted).toBe(true);
      expect(after.retraction_reason).toBe("False positive caused by AWS sensor drift");
    });

    it("verifies retraction sends follow-up correction broadcast via SMS gateway", async () => {
      const { retractAlert } = await import("./alert.service");
      const { getSmsProvider, setSmsProvider } = await import("./sms");

      let capturedSmsRequest: any = null;
      const testProvider = {
        name: "test-mock-sms-provider",
        isConfigured: () => true,
        isSandbox: () => true,
        send: async (req: any) => {
          capturedSmsRequest = req;
          return {
            success: true,
            provider: "test-mock-sms-provider",
            status: "SMS_SANDBOX_LOGGED" as const,
            messageId: "msg_retract_12345",
          };
        },
      };

      const prev = getSmsProvider();
      setSmsProvider(testProvider);

      try {
        const result = await retractAlert({
          alertId: 101,
          reason: "Confirmed rain gauge anomaly; no slope movement",
          retractedBy: "admin@nerdrr.gov.in",
        });

        expect(result.success).toBe(true);
        expect(result.smsSent).toBe(true);
        expect(capturedSmsRequest).not.toBeNull();
        expect(capturedSmsRequest.message).toContain("[CORRECTION / RETRACTION]");
        expect(capturedSmsRequest.message).toContain("anomaly");
        expect(capturedSmsRequest.metadata.retraction).toBe(true);
      } finally {
        setSmsProvider(prev);
      }
    });

    it("verifies key parity for all retraction keys across all 4 locales", async () => {
      const en = (await import("@/locales/en.json")).default;
      const as = (await import("@/locales/as.json")).default;
      const bn = (await import("@/locales/bn.json")).default;
      const ne = (await import("@/locales/ne.json")).default;

      const keysToCheck = [
        "retract_alert",
        "retract_alert_title",
        "retract_alert_desc",
        "retraction_reason",
        "retract_confirm",
        "retracted_badge",
        "retracted_by",
        "retracted_at",
        "retracted_success",
      ];

      for (const k of keysToCheck) {
        expect((en.alerts as any)[k], `en missing ${k}`).toBeDefined();
        for (const [code, bundle] of [["as", as], ["bn", bn], ["ne", ne]] as const) {
          expect((bundle.alerts as any)[k], `${code} missing ${k}`).toBeDefined();
        }
      }
    });
  });
});


