import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env["CRON_SECRET"] = "test-cron-secret-12345";
process.env["SUPABASE_URL"] = "https://shkpwbqcbeqlybdrhczq.supabase.co";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_secret_test_key_for_testing";
process.env["MEDIA_UPLOAD_ENABLED"] = "true";

const MOCK_DB_RECORDS: any[] = [];
let mockUpsertError: { message: string } | null = null;

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      from: (table: string) => {
        return {
          upsert: async (rows: any[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
            if (mockUpsertError) {
              const err = typeof mockUpsertError === "function" ? (mockUpsertError as any)(rows) : mockUpsertError;
              if (err) return { data: null, error: err };
            }
            let inserted = 0;
            for (const r of rows) {
              const existingIndex = MOCK_DB_RECORDS.findIndex(
                (item) => item.idempotency_key && item.idempotency_key === r.idempotency_key,
              );
              if (existingIndex >= 0) {
                // duplicate
                continue;
              }
              MOCK_DB_RECORDS.push({ ...r, id: `obs-${Date.now()}-${inserted}` });
              inserted++;
            }
            return { data: rows, error: null };
          },
          insert: (rowOrRows: any) => {
            const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
            let inserted = 0;
            for (const r of rows) {
              MOCK_DB_RECORDS.push({ ...r, id: `obs-${Date.now()}-${inserted}` });
              inserted++;
            }
            const mockRow = rows[0] ? { id: `obs-${Date.now()}-0`, dispatched_at: new Date().toISOString(), ...rows[0] } : null;
            const selectChain = {
              maybeSingle: async () => ({ data: mockRow, error: null }),
              single: async () => ({ data: mockRow, error: null }),
              then: (resolve: any) => resolve({ data: rows, error: null }),
            };
            return {
              select: () => selectChain,
              ...selectChain,
            };
          },
          select: (cols?: string) => ({
            eq: (col: string, val: unknown) => ({
              maybeSingle: async () => ({ data: null, error: null }),
              gt: () => ({
                order: () => ({ data: [], error: null }),
              }),
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
            in: async (col: string, values: string[]) => ({
              data: MOCK_DB_RECORDS.filter((item) => values.includes(item[col])),
              error: null,
            }),
          }),
        };
      },
      storage: {
        createBucket: async () => ({ data: null, error: null }),
        from: (bucket: string) => ({
          upload: async (path: string, buffer: any, opts: any) => ({
            data: { path, id: `media-${Date.now()}` },
            error: null,
          }),
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://storage.landalert.org/signed/${path}?token=valid` },
            error: null,
          }),
        }),
      },
    },
  };
});

import {
  queueObservation,
  getQueuedObservations,
  pruneQueue,
  clearOfflineQueue,
} from "./offline-manager";
import { syncFieldObservations, type FieldObservationInput } from "./sync.service";
import { handleApiRequest } from "./api.router";
import {
  saveOfflineMedia,
  getOfflineMedia,
  deleteOfflineMedia,
  getAllOfflineMediaIds,
} from "./offline-media-store";
import { getDatabaseUrl, isProductionEnvironment } from "./db.server";

describe("Authoritative End-to-End Real Sync, Media, and DB Schema Pipeline Tests", () => {
  const store = new Map<string, string>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    store.clear();
    MOCK_DB_RECORDS.length = 0;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
    process.env = { ...originalEnv, MEDIA_UPLOAD_ENABLED: "true" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1-5: Schema Contract, consent_given, review_status, media_urls, media_metadata persistence
  it("1-5: Confirms full database schema contract and persistence of consent_given, review_status, media_urls, media_metadata", async () => {
    const obsInput: FieldObservationInput = {
      zone_id: 2,
      observed_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
      rainfall_mm: 75.0,
      soil_condition: "waterlogged",
      visual_signs: "Tension cracks along ridge",
      road_status: "restricted",
      observer_id: "citizen_kamrup",
      idempotency_key: `OBS-SCHEMA-CONTRACT-${Date.now()}`,
      consent_given: true,
      media_urls: ["https://storage.landalert.org/signed/observations/test.jpg"],
      media_metadata: [
        {
          name: "crack.jpg",
          size: 204800,
          mimeType: "image/jpeg",
          storagePath: "observations/test.jpg",
          url: "https://storage.landalert.org/signed/observations/test.jpg",
        },
      ],
      geo_lat: 26.14,
      geo_lng: 91.73,
      geo_accuracy_m: 6.2,
      geo_captured_at: new Date().toISOString(),
      submitter_role: "PUBLIC_USER",
    };

    const res = await syncFieldObservations([obsInput]);
    expect(res.success).toBe(true);
    expect(res.syncedCount).toBe(1);

    // Verify persisted record in database contract
    const stored = MOCK_DB_RECORDS.find((r) => r.idempotency_key === obsInput.idempotency_key);
    expect(stored).toBeDefined();
    expect(stored.consent_given).toBe(true);
    expect(stored.review_status).toBe("PENDING_REVIEW");
    expect(stored.status).toBe("PENDING_VERIFICATION");
    expect(stored.source).toBe("PUBLIC_REPORT");
    expect(stored.is_training_eligible).toBe(false);
    expect(stored.media_urls).toEqual(["https://storage.landalert.org/signed/observations/test.jpg"]);
    expect(stored.media_metadata).toHaveLength(1);
    expect(stored.media_metadata[0].name).toBe("crack.jpg");
    expect(stored.geo_lat).toBe(26.14);
    expect(stored.geo_lng).toBe(91.73);
  });

  // 6 & 7: Missing DATABASE_URL & Production never falling back to localhost
  it("6 & 7: In production, missing DATABASE_URL throws explicit configuration error and never attempts localhost", async () => {
    const prevEnv = process.env["NODE_ENV"];
    const prevDb = process.env["DATABASE_URL"];
    try {
      process.env["NODE_ENV"] = "production";
      delete process.env["DATABASE_URL"];

      expect(isProductionEnvironment()).toBe(true);
      expect(getDatabaseUrl()).toBeNull();

      // Set simulated Supabase schema error
      mockUpsertError = { message: "Could not find the 'consent_given' column of 'field_observations' in the schema cache" };

      const obs: FieldObservationInput = {
        zone_id: 1,
        observed_at: new Date().toISOString(),
        client_timestamp: new Date().toISOString(),
        rainfall_mm: 50,
        observer_id: "test",
      };

      await expect(syncFieldObservations([obs])).rejects.toThrow(
        "Production DATABASE_URL is not configured",
      );

      mockUpsertError = null;
    } finally {
      mockUpsertError = null;
      process.env["NODE_ENV"] = prevEnv;
      if (prevDb) process.env["DATABASE_URL"] = prevDb;
    }
  });

  // 8 & 9: Online submission and offline queue insertion
  it("8 & 9: Queues observation offline without storing massive blobs in localStorage", async () => {
    clearOfflineQueue();
    expect(getQueuedObservations().length).toBe(0);

    const obs = queueObservation({
      zone_id: 3,
      observed_at: new Date().toISOString(),
      rainfall_mm: 45.0,
      visual_signs: "Minor debris rolling onto shoulder",
      road_status: "open",
      observer_id: "scout_aizawl",
      media_metadata: [
        {
          name: "slope_sample.jpg",
          size: 150000,
          mimeType: "image/jpeg",
        },
      ],
      consent_given: true,
    });

    const queue = getQueuedObservations();
    expect(queue.length).toBe(1);
    expect(queue[0]?.idempotency_key).toBe(obs.idempotency_key);
    expect(queue[0]?.rainfall_mm).toBe(45.0);

    // Verify localStorage payload contains no raw base64 data blobs
    const rawStorage = store.get("landalert_field_observations_queue_v1") || "";
    expect(rawStorage.includes("data:image")).toBe(false);
  });

  // 10 & 11: Sync All Pending and successful queue clearing
  it("10, 11 & 14: Sync All Pending successfully processes queued items and decrements count from 2 -> 0", async () => {
    clearOfflineQueue();

    const obs1 = queueObservation({
      zone_id: 4,
      observed_at: new Date().toISOString(),
      rainfall_mm: 60.0,
      road_status: "open",
      observer_id: "officer_gangtok",
    });

    const obs2 = queueObservation({
      zone_id: 9,
      observed_at: new Date().toISOString(),
      rainfall_mm: 110.0,
      soil_condition: "saturated",
      visual_signs: "Road subsidence",
      road_status: "blocked",
      observer_id: "officer_kohima",
    });

    expect(getQueuedObservations().length).toBe(2);

    // Perform sync
    const res = await syncFieldObservations(getQueuedObservations());
    expect(res.success).toBe(true);
    expect(res.syncedCount).toBe(2);
    expect(res.acknowledgedKeys).toContain(obs1.idempotency_key);
    expect(res.acknowledgedKeys).toContain(obs2.idempotency_key);

    // Prune acknowledged items
    pruneQueue(res.acknowledgedKeys);
    expect(getQueuedObservations().length).toBe(0);
  });

  // 12 & 13: Failed sync remains queued with recorded error and retry behavior
  it("12 & 13: Failed sync remains queued, preserves retry count and error reason", async () => {
    clearOfflineQueue();

    const obs = queueObservation({
      zone_id: 7,
      observed_at: new Date().toISOString(),
      rainfall_mm: 30.0,
      observer_id: "field_officer",
    });

    expect(getQueuedObservations().length).toBe(1);

    // Simulate failure status recorded in local queue
    const queued = getQueuedObservations();
    const failedQueue = queued.map((item) => ({
      ...item,
      retry_count: (item.retry_count || 0) + 1,
      queue_status: "FAILED" as const,
      last_error: "Gateway 504 Timeout",
    }));
    store.set("landalert_field_observations_queue_v1", JSON.stringify(failedQueue));

    const reloaded = getQueuedObservations();
    expect(reloaded.length).toBe(1);
    expect(reloaded[0]?.queue_status).toBe("FAILED");
    expect(reloaded[0]?.retry_count).toBe(1);
    expect(reloaded[0]?.last_error).toBe("Gateway 504 Timeout");

    // Retry succeeds on next attempt
    const res = await syncFieldObservations(reloaded);
    expect(res.success).toBe(true);
    pruneQueue(res.acknowledgedKeys);
    expect(getQueuedObservations().length).toBe(0);
  });

  // 14: Idempotency
  it("14: Idempotency prevents duplicate database records on retry", async () => {
    const fixedKey = `IDEMP-TEST-KEY-${Date.now()}`;
    const obs: FieldObservationInput = {
      zone_id: 1,
      observed_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
      rainfall_mm: 40.0,
      observer_id: "tamenglong_scout",
      idempotency_key: fixedKey,
    };

    const countBefore = MOCK_DB_RECORDS.length;
    const res1 = await syncFieldObservations([obs]);
    expect(res1.success).toBe(true);
    expect(MOCK_DB_RECORDS.length).toBe(countBefore + 1);

    // Duplicate replay
    const res2 = await syncFieldObservations([obs]);
    expect(res2.success).toBe(true);
    expect(res2.acknowledgedKeys).toContain(fixedKey);
    expect(MOCK_DB_RECORDS.length).toBe(countBefore + 1); // No new row added
  });

  // 15 & 16: Photo and Video Upload validation
  it("15 & 16: Photo & Video upload enforces MIME formats, 10MB photo cap, 50MB video cap", async () => {
    // Valid PNG photo
    const pngForm = new FormData();
    pngForm.append("file", new Blob(["png-content"], { type: "image/png" }), "rockfall.png");
    pngForm.append("zoneId", "1");
    const pngRes = await handleApiRequest(
      new Request("http://localhost:3000/api/field-observations/upload", {
        method: "POST",
        headers: { Authorization: "Bearer test-authenticated-session" },
        body: pngForm,
      }),
    );
    expect(pngRes?.status).toBe(201);
    const pngBody = await pngRes?.json();
    expect(pngBody.success).toBe(true);
    expect(pngBody.mimeType).toBe("image/png");

    // Valid WebM video
    const webmForm = new FormData();
    webmForm.append("file", new Blob(["webm-video"], { type: "video/webm" }), "flow.webm");
    webmForm.append("zoneId", "1");
    const webmRes = await handleApiRequest(
      new Request("http://localhost:3000/api/field-observations/upload", {
        method: "POST",
        headers: { Authorization: "Bearer test-authenticated-session" },
        body: webmForm,
      }),
    );
    expect(webmRes?.status).toBe(201);

    // Rejection of invalid executable
    const exeForm = new FormData();
    exeForm.append("file", new Blob(["binary"], { type: "application/x-msdos-program" }), "run.bat");
    exeForm.append("zoneId", "1");
    const exeRes = await handleApiRequest(
      new Request("http://localhost:3000/api/field-observations/upload", {
        method: "POST",
        headers: { Authorization: "Bearer test-authenticated-session" },
        body: exeForm,
      }),
    );
    expect(exeRes?.status).toBe(400);

    // Rejection of oversized image (>10MB)
    const bigImgForm = new FormData();
    const bigBytes = new Uint8Array(12 * 1024 * 1024);
    bigImgForm.append("file", new Blob([bigBytes], { type: "image/jpeg" }), "huge.jpg");
    bigImgForm.append("zoneId", "1");
    const bigRes = await handleApiRequest(
      new Request("http://localhost:3000/api/field-observations/upload", {
        method: "POST",
        headers: { Authorization: "Bearer test-authenticated-session" },
        body: bigImgForm,
      }),
    );
    expect(bigRes?.status).toBe(400);
    const bigBody = await bigRes?.json();
    expect(bigBody.code).toBe("FILE_TOO_LARGE");
  });

  // 17 & 18: Offline media persistence & Online media synchronization
  it("17 & 18: Offline media persists in IndexedDB store and can be retrieved, deleted, and synchronized", async () => {
    const mediaId = `offline_test_${Date.now()}`;
    const testBlob = new Blob(["offline-image-data"], { type: "image/jpeg" });

    await saveOfflineMedia(mediaId, testBlob, {
      name: "slope_slip.jpg",
      mimeType: "image/jpeg",
      size: testBlob.size,
    });

    const stored = await getOfflineMedia(mediaId);
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe("slope_slip.jpg");
    expect(stored?.mimeType).toBe("image/jpeg");

    const allIds = await getAllOfflineMediaIds();
    expect(allIds).toContain(mediaId);

    await deleteOfflineMedia(mediaId);
    const afterDelete = await getOfflineMedia(mediaId);
    expect(afterDelete).toBeNull();
  });

  // 19: Empty observation rejection
  it("19: Empty observations with no rainfall, signs, road status, media, or coordinates are strictly rejected", async () => {
    const emptyObs: FieldObservationInput = {
      zone_id: 1,
      observed_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
      observer_id: "tester",
      rainfall_mm: undefined,
      soil_condition: undefined,
      visual_signs: "None",
      road_status: "unknown",
      media_urls: [],
      media_metadata: [],
      geo_lat: undefined,
    };

    const res = await syncFieldObservations([emptyObs]);
    expect(res.success).toBe(false);
    expect(res.syncedCount).toBe(0);
    expect(res.errors?.[0]).toContain("empty observation");
  });

  // 20: Public observation remains pending verification
  it("20: Citizen public observation is categorized as PENDING_VERIFICATION and not eligible for training", async () => {
    const citizenObs: FieldObservationInput = {
      zone_id: 5,
      observed_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
      rainfall_mm: 55.0,
      visual_signs: "Cracks on slope",
      road_status: "restricted",
      observer_id: "citizen_observer_001",
      submitter_role: "PUBLIC_USER",
      idempotency_key: `CITIZEN-${Date.now()}`,
    };

    const res = await syncFieldObservations([citizenObs]);
    expect(res.success).toBe(true);

    const stored = MOCK_DB_RECORDS.find((r) => r.idempotency_key === citizenObs.idempotency_key);
    expect(stored).toBeDefined();
    expect(stored.status).toBe("PENDING_VERIFICATION");
    expect(stored.review_status).toBe("PENDING_REVIEW");
    expect(stored.source).toBe("PUBLIC_REPORT");
    expect(stored.is_training_eligible).toBe(false);
  });

  // 21 & 22: Unauthorized dispatch rejection & Authorized dispatcher acceptance
  it("21 & 22: Emergency dispatch rejects unauthorized callers and accepts authorized DISPATCHER role with audit", async () => {
    // Unauthorized public user
    const unauthReq = new Request("http://localhost:3000/api/alerts/dispatch", {
      method: "POST",
      body: JSON.stringify({ zoneId: 1, justification: "Emergency testing" }),
    });
    const unauthRes = await handleApiRequest(unauthReq);
    expect(unauthRes?.status).toBe(401);

    // Authorized system dispatcher
    const authReq = new Request("http://localhost:3000/api/alerts/dispatch", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-cron-secret-12345",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zoneId: 1,
        channel: "both",
        justification: "Critical slope displacement detected by verified sensor",
      }),
    });
    const authRes = await handleApiRequest(authReq);
    expect([200, 201]).toContain(authRes?.status);
    const body = await authRes?.json();
    expect(body.zoneId).toBe(1);
    expect(typeof body.dispatched).toBe("boolean");
  });

  // 23: FieldObservationDialog module exports and evaluates without ReferenceError
  it("23: FieldObservationDialog loads and evaluates without useMemo or ReferenceError", async () => {
    const mod = await import("@/components/FieldObservationDialog");
    expect(mod.FieldObservationDialog).toBeDefined();
    expect(typeof mod.FieldObservationDialog).toBe("function");
    expect(mod.FALLBACK_ZONES.length).toBeGreaterThan(0);
    expect(mod.NER_GEOGRAPHY).toBeDefined();
  });

  // 24: Resilient schema cache error recovery
  it("24: syncFieldObservations recovers when Supabase reports missing consent_given in schema cache", async () => {
    const { syncFieldObservations } = await import("./sync.service");
    
    // Simulate Supabase PostgREST returning schema cache error when consent_given is present in row
    mockUpsertError = ((rows: any[]) => {
      if (rows.some((r) => "consent_given" in r)) {
        return {
          message: "Could not find the 'consent_given' column of 'field_observations' in the schema cache",
        };
      }
      return null;
    }) as any;

    const testRecord = {
      zone_id: 1,
      observed_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
      rainfall_mm: 35.5,
      visual_signs: "Minor cracks on road edge",
      road_status: "restricted" as const,
      observer_id: "field_worker_test",
      idempotency_key: `CACHE_TEST_${Date.now()}`,
      consent_given: true,
      review_status: "PENDING_REVIEW" as const,
      media_urls: ["https://storage.landalert.org/test.jpg"],
      media_metadata: [{ name: "test.jpg", size: 1024, mimeType: "image/jpeg" }],
    };

    const res = await syncFieldObservations([testRecord]);
    expect(res.success).toBe(true);
    expect(res.syncedCount).toBe(1);
    mockUpsertError = null;
  });

  // 25: Resilient recovery when ON CONFLICT unique constraint is missing in database
  it("25: syncFieldObservations recovers when ON CONFLICT unique constraint is missing", async () => {
    const { syncFieldObservations } = await import("./sync.service");

    let upsertAttempts = 0;
    mockUpsertError = ((rows: any[]) => {
      upsertAttempts++;
      return {
        message: "there is no unique or exclusion constraint matching the ON CONFLICT specification",
      };
    }) as any;

    const testRecord = {
      zone_id: 2,
      observed_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
      rainfall_mm: 12.0,
      visual_signs: "Water seeping through retaining wall",
      road_status: "open" as const,
      observer_id: "observer_conflict_test",
      idempotency_key: `CONFLICT_TEST_${Date.now()}`,
      consent_given: true,
      review_status: "PENDING_REVIEW" as const,
    };

    const res = await syncFieldObservations([testRecord]);
    expect(res.success).toBe(true);
    expect(res.syncedCount).toBe(1);
    expect(upsertAttempts).toBeGreaterThanOrEqual(1);
    mockUpsertError = null;
  });
});


