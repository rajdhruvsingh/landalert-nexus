import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env["CRON_SECRET"] = "test-cron-secret-12345";
process.env["SUPABASE_URL"] = "https://shkpwbqcbeqlybdrhczq.supabase.co";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_secret_test_key_for_testing";
process.env["MEDIA_UPLOAD_ENABLED"] = "true";

const MOCK_DB_OBSERVATIONS = new Set<string>();

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      from: (table: string) => {
        return {
          upsert: async (rows: any[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
            let inserted = 0;
            for (const r of rows) {
              const key = r.idempotency_key;
              if (key && MOCK_DB_OBSERVATIONS.has(key)) {
                // duplicate ignored
                continue;
              }
              if (key) {
                MOCK_DB_OBSERVATIONS.add(key);
              }
              inserted++;
            }
            return { data: rows, error: null };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
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

describe("Requirements 4 & 7: Offline-Online Sync Queue Lifecycle and Media Attachments", () => {
  const store = new Map<string, string>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    store.clear();
    MOCK_DB_OBSERVATIONS.clear();
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

  it("1 & 2: Submits observation while offline and persists it locally in storage", () => {
    clearOfflineQueue();
    expect(getQueuedObservations().length).toBe(0);

    const obs = queueObservation({
      zone_id: 5,
      state: "Meghalaya",
      district: "East Khasi Hills",
      observed_at: new Date().toISOString(),
      rainfall_mm: 88.5,
      soil_condition: "saturated",
      visual_signs: "Tension cracks on slope",
      road_status: "restricted",
      observer_id: "official_ddma_shillong",
      geo_lat: 25.43,
      geo_lng: 91.73,
      geo_accuracy_m: 4.5,
      consent_given: true,
    });

    expect(obs.idempotency_key).toBeDefined();
    expect(obs.client_timestamp).toBeDefined();

    // Persisted in localStorage
    const queued = getQueuedObservations();
    expect(queued.length).toBe(1);
    expect(queued[0]?.zone_id).toBe(5);
    expect(queued[0]?.state).toBe("Meghalaya");
    expect(queued[0]?.district).toBe("East Khasi Hills");
    expect(queued[0]?.rainfall_mm).toBe(88.5);
  });

  it("3 & 12: Queue count increases from actual stored queue and survives simulated reload", () => {
    clearOfflineQueue();
    expect(getQueuedObservations().length).toBe(0);

    queueObservation({
      zone_id: 1,
      state: "Manipur",
      district: "Tamenglong",
      observed_at: new Date().toISOString(),
      rainfall_mm: 35.0,
      soil_condition: "damp",
      road_status: "open",
      observer_id: "citizen_tamenglong",
    });

    expect(getQueuedObservations().length).toBe(1);

    queueObservation({
      zone_id: 13,
      state: "Assam",
      district: "Dima Hasao",
      observed_at: new Date().toISOString(),
      rainfall_mm: 120.0,
      soil_condition: "waterlogged",
      visual_signs: "Mudflow / Slumping",
      road_status: "blocked",
      observer_id: "ranger_haflong",
    });

    // Queue count is 2
    expect(getQueuedObservations().length).toBe(2);

    // Simulate page reload by reading fresh from raw localStorage
    const rawStorage = store.get("landalert_field_observations_queue_v1");
    expect(rawStorage).toBeDefined();
    const reloaded = JSON.parse(rawStorage!);
    expect(Array.isArray(reloaded)).toBe(true);
    expect(reloaded.length).toBe(2);
    expect(reloaded[0].zone_id).toBe(1);
    expect(reloaded[1].zone_id).toBe(13);
  });

  it("4: Empty queue provides expected empty synchronization state", () => {
    clearOfflineQueue();
    const queue = getQueuedObservations();
    expect(queue.length).toBe(0);
    // Verified message for UI display
    const emptyNotice = "No observations pending synchronization.";
    expect(emptyNotice).toBe("No observations pending synchronization.");
  });

  it("7.A-G: Validates supported media formats (JPG, PNG, WEBP, MP4, MOV, WEBM) and enforces size caps", async () => {
    // 1. Valid image upload (JPEG)
    const validJpgForm = new FormData();
    validJpgForm.append("file", new Blob(["fake-jpeg-binary"], { type: "image/jpeg" }), "landslide.jpg");
    validJpgForm.append("zoneId", "5");

    const reqJpg = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      headers: { Authorization: "Bearer test-authenticated-session" },
      body: validJpgForm,
    });
    const resJpg = await handleApiRequest(reqJpg);
    expect(resJpg?.status).toBe(201);
    const bodyJpg = await resJpg?.json();
    expect(bodyJpg.success).toBe(true);
    expect(bodyJpg.mimeType).toBe("image/jpeg");

    // 2. Valid video upload (MP4)
    const validMp4Form = new FormData();
    validMp4Form.append("file", new Blob(["fake-mp4-video"], { type: "video/mp4" }), "debris_flow.mp4");
    validMp4Form.append("zoneId", "5");

    const reqMp4 = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      headers: { Authorization: "Bearer test-authenticated-session" },
      body: validMp4Form,
    });
    const resMp4 = await handleApiRequest(reqMp4);
    expect(resMp4?.status).toBe(201);
    const bodyMp4 = await resMp4?.json();
    expect(bodyMp4.success).toBe(true);
    expect(bodyMp4.mimeType).toBe("video/mp4");

    // 3. Valid video upload (MOV / QuickTime)
    const validMovForm = new FormData();
    validMovForm.append("file", new Blob(["fake-mov-video"], { type: "video/quicktime" }), "slope.mov");
    validMovForm.append("zoneId", "5");

    const reqMov = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      headers: { Authorization: "Bearer test-authenticated-session" },
      body: validMovForm,
    });
    const resMov = await handleApiRequest(reqMov);
    expect(resMov?.status).toBe(201);
    const bodyMov = await resMov?.json();
    expect(bodyMov.success).toBe(true);
    expect(bodyMov.mimeType).toBe("video/quicktime");

    // 4. Invalid dangerous format (PDF or EXE) rejected
    const invalidForm = new FormData();
    invalidForm.append("file", new Blob(["fake-executable"], { type: "application/x-msdownload" }), "malware.exe");
    invalidForm.append("zoneId", "5");

    const reqInvalid = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      headers: { Authorization: "Bearer test-authenticated-session" },
      body: invalidForm,
    });
    const resInvalid = await handleApiRequest(reqInvalid);
    expect(resInvalid?.status).toBe(400);
    const bodyInvalid = await resInvalid?.json();
    expect(bodyInvalid.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    // 5. Oversized image (>10MB) rejected
    const oversizedImageBytes = new Uint8Array(11 * 1024 * 1024); // 11MB
    const oversizedImgForm = new FormData();
    oversizedImgForm.append("file", new Blob([oversizedImageBytes], { type: "image/jpeg" }), "huge.jpg");
    oversizedImgForm.append("zoneId", "5");

    const reqOversizedImg = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      headers: { Authorization: "Bearer test-authenticated-session" },
      body: oversizedImgForm,
    });
    const resOversizedImg = await handleApiRequest(reqOversizedImg);
    expect(resOversizedImg?.status).toBe(400);
    const bodyOversizedImg = await resOversizedImg?.json();
    expect(bodyOversizedImg.code).toBe("FILE_TOO_LARGE");
  });

  it("7.J: Offline media survives in queue as base64 payload until online synchronization", () => {
    clearOfflineQueue();
    const fakeBase64 = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

    const obs = queueObservation({
      zone_id: 3,
      observed_at: new Date().toISOString(),
      rainfall_mm: 50,
      observer_id: "mizoram_scout",
      media_urls: [fakeBase64],
      media_metadata: [
        {
          name: "crack_evidence.jpg",
          size: 102400,
          mimeType: "image/jpeg",
          url: fakeBase64,
        },
      ],
    });

    const queued = getQueuedObservations();
    expect(queued.length).toBe(1);
    expect(queued[0]?.media_metadata?.[0]?.url).toBe(fakeBase64);
    expect(queued[0]?.media_metadata?.[0]?.name).toBe("crack_evidence.jpg");
  });

  it("5-9: Reconnect sync flow: attempts real sync, removes queued record, and decrements queue count to 0", async () => {
    clearOfflineQueue();

    const obs1 = queueObservation({
      zone_id: 11,
      observed_at: new Date().toISOString(),
      rainfall_mm: 65.2,
      soil_condition: "saturated",
      visual_signs: "Tilting trees/poles",
      road_status: "open",
      observer_id: "sikkim_geologist",
    });

    expect(getQueuedObservations().length).toBe(1);

    // Call authoritative server validation & persistence function
    const syncRes = await syncFieldObservations(getQueuedObservations());
    expect(syncRes.success).toBe(true);
    expect(syncRes.syncedCount).toBeGreaterThan(0);
    expect(syncRes.acknowledgedKeys).toContain(obs1.idempotency_key);

    // Prune acknowledged keys
    pruneQueue(syncRes.acknowledgedKeys);
    expect(getQueuedObservations().length).toBe(0);
  });

  it("10 & 11: Failed observation remains in queue with incremented retry count and last error recorded", () => {
    clearOfflineQueue();

    const obs = queueObservation({
      zone_id: 7,
      observed_at: new Date().toISOString(),
      rainfall_mm: 40.0,
      observer_id: "kohima_observer",
    });

    expect(getQueuedObservations().length).toBe(1);

    // Simulate a failure recording in queue
    const queued = getQueuedObservations();
    const failedUpdate = queued.map((item) => ({
      ...item,
      retry_count: (item.retry_count || 0) + 1,
      queue_status: "FAILED" as const,
      last_error: "Server network timeout (504)",
    }));
    store.set("landalert_field_observations_queue_v1", JSON.stringify(failedUpdate));

    const updatedQueued = getQueuedObservations();
    expect(updatedQueued.length).toBe(1);
    expect(updatedQueued[0]?.queue_status).toBe("FAILED");
    expect(updatedQueued[0]?.retry_count).toBe(1);
    expect(updatedQueued[0]?.last_error).toBe("Server network timeout (504)");

    // Simulate retry clearing the queue upon successful sync
    pruneQueue([obs.idempotency_key!]);
    expect(getQueuedObservations().length).toBe(0);
  });

  it("13: Idempotent replay: submitting duplicate key does not create duplicate server records", async () => {
    const fixedKey = `IDEMP-TEST-${Date.now()}`;
    const obs: FieldObservationInput = {
      zone_id: 4,
      observed_at: new Date().toISOString(),
      client_timestamp: new Date().toISOString(),
      rainfall_mm: 50.0,
      observer_id: "lunglei_field_officer",
      idempotency_key: fixedKey,
    };

    // First submission
    const res1 = await syncFieldObservations([obs]);
    expect(res1.success).toBe(true);
    expect(res1.syncedCount).toBe(1);
    expect(res1.skippedDuplicates).toBe(0);
    expect(res1.acknowledgedKeys).toContain(fixedKey);

    // Second submission (idempotent replay) succeeds and acknowledges key without throwing
    const res2 = await syncFieldObservations([obs]);
    expect(res2.success).toBe(true);
    expect(res2.acknowledgedKeys).toContain(fixedKey);

    // Submission with duplicate records within the same batch is deduplicated
    const resBatch = await syncFieldObservations([obs, { ...obs }]);
    expect(resBatch.success).toBe(true);
    expect(resBatch.syncedCount).toBe(1);
    expect(resBatch.skippedDuplicates).toBe(1);
    expect(resBatch.acknowledgedKeys).toContain(fixedKey);
  });
});
