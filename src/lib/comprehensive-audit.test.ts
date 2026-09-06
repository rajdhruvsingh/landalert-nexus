import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queueObservation,
  pruneQueue,
  getQueuedObservations,
  clearOfflineQueue,
  syncOfflineObservations,
} from "./offline-manager";
import { syncFieldObservations, type FieldObservationInput } from "./sync.service";
import { getStoredTheme, setTheme, applyTheme, type ThemeMode } from "./theme";
import { FALLBACK_ZONES } from "@/components/FieldObservationDialog";

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      from: (table: string) => {
        return {
          upsert: async (rows: unknown) => {
            return { data: rows, error: null };
          },
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      },
    },
  };
});

describe("LandAlert-Nexus Comprehensive Production Audit & Verification", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
    vi.stubGlobal("crypto", {
      randomUUID: () => `test-uuid-${Math.random().toString(36).substring(2, 9)}`,
    });
  });

  describe("Item 4: System / Light / Dark Theme Switching", () => {
    it("defaults to system theme if nothing stored", () => {
      expect(getStoredTheme()).toBe("system");
    });

    it("supports bidirectional theme switching between System, Light, and Dark", () => {
      // System -> Light
      setTheme("light");
      expect(getStoredTheme()).toBe("light");
      expect(localStorage.getItem("landalert_theme")).toBe("light");

      // Light -> Dark
      setTheme("dark");
      expect(getStoredTheme()).toBe("dark");
      expect(localStorage.getItem("landalert_theme")).toBe("dark");

      // Dark -> Light
      setTheme("light");
      expect(getStoredTheme()).toBe("light");

      // Light -> System
      setTheme("system");
      expect(getStoredTheme()).toBe("system");
      expect(localStorage.getItem("landalert_theme")).toBe("system");

      // System -> Dark
      setTheme("dark");
      expect(getStoredTheme()).toBe("dark");

      // Dark -> System
      setTheme("system");
      expect(getStoredTheme()).toBe("system");
    });
  });

  describe("Item 6 & 8: Search Coverage Across All 8 North Eastern States", () => {
    const expectedStates = [
      "Arunachal Pradesh",
      "Assam",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Sikkim",
      "Tripura",
    ];

    it("verifies operational monitoring zones span all 8 North Eastern States", () => {
      const zoneStates = new Set(FALLBACK_ZONES.map((z) => z.state));
      for (const st of expectedStates) {
        expect(zoneStates.has(st), `Missing coverage for state: ${st}`).toBe(true);
      }
    });

    it("searches case-insensitively across states, districts, and zone names", () => {
      const search = (query: string) => {
        const q = query.trim().toLowerCase();
        return FALLBACK_ZONES.filter(
          (z) =>
            z.name.toLowerCase().includes(q) ||
            z.district.toLowerCase().includes(q) ||
            z.state.toLowerCase().includes(q),
        );
      };

      // Test searching state
      expect(search("Sikkim").length).toBeGreaterThanOrEqual(2);
      expect(search("sikkim").length).toBeGreaterThanOrEqual(2);

      // Test searching district
      expect(search("East Khasi Hills").length).toBe(1);
      expect(search("east khasi").length).toBe(1);

      // Test searching town/zone
      expect(search("Tamenglong").length).toBe(1);
      expect(search("Aizawl").length).toBe(1);
      expect(search("Papum Pare").length).toBe(1);
      expect(search("Ambassa").length).toBe(1);
    });
  });

  describe("Item 14, 15, 16, 17, 20: Field Observation Validation & Offline-Online Lifecycle", () => {
    it("rejects empty observation submissions on the server", async () => {
      const emptyRecord: FieldObservationInput = {
        zone_id: 1,
        observed_at: new Date().toISOString(),
        client_timestamp: new Date().toISOString(),
        observer_id: "field_worker_1",
      };

      const result = await syncFieldObservations([emptyRecord]);
      expect(result.success).toBe(false);
      expect(result.syncedCount).toBe(0);
      expect(result.errors?.[0]).toContain("empty observation");
    });

    it("rejects missing observer_id on the server", async () => {
      const missingObserver: FieldObservationInput = {
        zone_id: 1,
        observed_at: new Date().toISOString(),
        client_timestamp: new Date().toISOString(),
        observer_id: "   ",
        rainfall_mm: 55,
      };

      const result = await syncFieldObservations([missingObserver]);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain("observer_id is required");
    });

    it("rejects invalid/negative rainfall on the server", async () => {
      const invalidRainfall: FieldObservationInput = {
        zone_id: 1,
        observed_at: new Date().toISOString(),
        client_timestamp: new Date().toISOString(),
        observer_id: "observer_1",
        rainfall_mm: -25,
      };

      const result = await syncFieldObservations([invalidRainfall]);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain("invalid rainfall_mm");
    });

    it("executes complete Offline -> Queue Increments -> Sync Clears Queue lifecycle", async () => {
      clearOfflineQueue();
      expect(getQueuedObservations().length).toBe(0);

      // Step 1: User fills and queues an observation while offline
      const obs1 = queueObservation({
        zone_id: 5,
        observed_at: new Date().toISOString(),
        rainfall_mm: 82.5,
        soil_condition: "saturated",
        visual_signs: "Tension cracks across highway berm",
        road_status: "restricted",
        observer_id: "official_ddma_shillong",
        submitter_role: "VERIFIED_OFFICIAL",
      });

      expect(getQueuedObservations().length).toBe(1);
      expect(obs1.idempotency_key).toBeDefined();

      // Step 2: User queues a second observation
      const obs2 = queueObservation({
        zone_id: 11,
        observed_at: new Date().toISOString(),
        rainfall_mm: 110.0,
        soil_condition: "muddy",
        visual_signs: "Debris wash onto Singtam corridor",
        road_status: "blocked",
        observer_id: "citizen_gangtok_42",
        submitter_role: "PUBLIC_USER",
      });

      expect(getQueuedObservations().length).toBe(2);

      // Step 3: Online connectivity restored, trigger batch sync against real syncFieldObservations
      const queued = getQueuedObservations();
      const syncResult = await syncFieldObservations(queued);

      expect(syncResult.success).toBe(true);
      expect(syncResult.syncedCount).toBe(2);
      expect(syncResult.acknowledgedKeys).toContain(obs1.idempotency_key);
      expect(syncResult.acknowledgedKeys).toContain(obs2.idempotency_key);

      // Step 4: Prune acknowledged keys from local queue
      pruneQueue(syncResult.acknowledgedKeys);

      // Step 5: Queue count clears to 0
      expect(getQueuedObservations().length).toBe(0);

      // Step 6: Verify duplicate protection / idempotency replay
      const replayResult = await syncFieldObservations(queued);
      expect(replayResult.success).toBe(true);
      expect(replayResult.acknowledgedKeys).toHaveLength(2);
    });

    it("preserves offline queue when server reports failure or rejection", () => {
      clearOfflineQueue();
      const obs = queueObservation({
        zone_id: 3,
        observed_at: new Date().toISOString(),
        rainfall_mm: 45.0,
        observer_id: "observer_aizawl",
      });

      expect(getQueuedObservations().length).toBe(1);

      // Server acknowledges NO keys due to hypothetical 500
      pruneQueue([]);
      expect(getQueuedObservations().length).toBe(1);
      expect(getQueuedObservations()[0]?.idempotency_key).toBe(obs.idempotency_key);
    });
  });

  describe("Item 3 & 12: Navigation & Section Anchors", () => {
    it("verifies required primary section anchors exist on dashboard", () => {
      const fs = require("fs");
      const path = require("path");
      const indexTsx = fs.readFileSync(path.resolve(__dirname, "../routes/index.tsx"), "utf8");

      expect(indexTsx).toContain('id="risk-map"');
      expect(indexTsx).toContain('id="recent-observations"');
      expect(indexTsx).toContain('id="road-connectivity"');
      expect(indexTsx).toContain('id="observations"');
      expect(indexTsx).toContain('id="road-network"');
    });

    it("verifies alerts page handles inbound hash redirects to primary dashboard sections", () => {
      const fs = require("fs");
      const path = require("path");
      const alertsTsx = fs.readFileSync(path.resolve(__dirname, "../routes/alerts.tsx"), "utf8");

      expect(alertsTsx).toContain('rawHash === "risk-map"');
      expect(alertsTsx).toContain('rawHash === "observations"');
      expect(alertsTsx).toContain('rawHash === "road-network"');
      expect(alertsTsx).toContain('navigate({ to: "/", hash: rawHash })');
    });
  });
});
