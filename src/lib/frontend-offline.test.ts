import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queueObservation,
  getQueuedObservations,
  pruneQueue,
  clearOfflineQueue,
  getCachedOfflinePackage,
} from "./offline-manager";
import {
  riskColor,
  riskBadgeClass,
  RISK_LEVELS,
  severityRank,
} from "./risk";

describe("Frontend Offline Queue & Synchronization Layer", () => {
  beforeEach(() => {
    // Mock localStorage
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("queues offline observations with unique idempotency keys", () => {
    const obs = queueObservation({
      zone_id: 1,
      observed_at: new Date().toISOString(),
      rainfall_mm: 55.4,
      soil_condition: "saturated",
      visual_signs: "Tension cracks on slope",
      road_status: "restricted",
      observer_id: "field_unit_01",
    });

    expect(obs.idempotency_key).toBeDefined();
    expect(typeof obs.idempotency_key).toBe("string");
    expect(obs.client_timestamp).toBeDefined();

    const queued = getQueuedObservations();
    expect(queued.length).toBe(1);
    expect(queued[0]?.zone_id).toBe(1);
    expect(queued[0]?.rainfall_mm).toBe(55.4);
  });

  it("queues field observations with geo-tagged coordinates and media metadata", () => {
    const obs = queueObservation({
      zone_id: 3,
      observed_at: new Date().toISOString(),
      rainfall_mm: 42.0,
      soil_condition: "mudflow_observed",
      visual_signs: "Active debris slide on roadside",
      road_status: "blocked",
      observer_id: "official_observer_aizawl",
      geo_lat: 23.7271,
      geo_lng: 92.7176,
      geo_accuracy_m: 8.5,
      geo_captured_at: new Date().toISOString(),
      consent_given: true,
      media_urls: ["https://storage.landalert.org/field-media/zone_3_slide.jpg"],
      media_metadata: [
        {
          name: "zone_3_slide.jpg",
          size: 2048500,
          mimeType: "image/jpeg",
          url: "https://storage.landalert.org/field-media/zone_3_slide.jpg",
        },
      ],
    });

    expect(obs.geo_lat).toBe(23.7271);
    expect(obs.geo_lng).toBe(92.7176);
    expect(obs.consent_given).toBe(true);
    expect(obs.media_urls?.length).toBe(1);
    expect(obs.media_metadata?.[0]?.size).toBe(2048500);

    const queued = getQueuedObservations();
    expect(queued.length).toBe(1);
    expect(queued[0]?.geo_lat).toBe(23.7271);
    expect(queued[0]?.media_urls?.[0]).toBe("https://storage.landalert.org/field-media/zone_3_slide.jpg");
  });

  it("prunes synchronized observations based on acknowledged keys", () => {
    const o1 = queueObservation({
      zone_id: 1,
      observed_at: new Date().toISOString(),
      rainfall_mm: 10,
    });
    const o2 = queueObservation({
      zone_id: 2,
      observed_at: new Date().toISOString(),
      rainfall_mm: 20,
    });

    expect(getQueuedObservations().length).toBe(2);

    pruneQueue([o1.idempotency_key!]);

    const remaining = getQueuedObservations();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.idempotency_key).toBe(o2.idempotency_key);
  });

  it("handles offline package cache evaluation and 24h expiration policy", () => {
    const now = Date.now();
    const freshPkg = {
      zones: [],
      roads: [],
      active_model: {
        model_version: "v2_canonical_logreg",
        feature_schema_version: "v2_19features",
        pr_auc: 0.5934,
        recall_at_80_precision: 0.125,
        cutoffs: { moderate: 25, high: 50, severe: 75 },
        weights: {
          intensity: 0.35,
          antecedent: 0.25,
          soil_moisture: 0.2,
          slope: 0.15,
          history: 0.05,
        },
      },
      cache_policy: {
        cached_at: new Date(now - 2 * 3600 * 1000).toISOString(), // 2 hours old
        valid_until: new Date(now + 22 * 3600 * 1000).toISOString(),
        max_age_hours: 24,
        is_expired: false,
        instructions: "Offline cache valid for 24 hours.",
      },
    };

    localStorage.setItem("landalert_offline_bundle_v1", JSON.stringify(freshPkg));
    const cached = getCachedOfflinePackage();

    expect(cached.package).not.toBeNull();
    expect(cached.isExpired).toBe(false);
    expect(cached.ageHours).toBeCloseTo(2.0, 0);

    // Simulate expired package (> 24 hours)
    const expiredPkg = {
      ...freshPkg,
      cache_policy: {
        ...freshPkg.cache_policy,
        cached_at: new Date(now - 26 * 3600 * 1000).toISOString(),
        valid_until: new Date(now - 2 * 3600 * 1000).toISOString(),
      },
    };
    localStorage.setItem("landalert_offline_bundle_v1", JSON.stringify(expiredPkg));
    const expiredResult = getCachedOfflinePackage();

    expect(expiredResult.isExpired).toBe(true);
    expect(expiredResult.ageHours).toBeGreaterThan(24);
  });

  it("executes client offline queueing, acknowledged key pruning, and queue clearing", () => {
    // 1. Initial state: queue is completely empty
    clearOfflineQueue();
    expect(getQueuedObservations().length).toBe(0);

    // 2. Offline simulation: queue an observation while disconnected
    const fieldObs = queueObservation({
      zone_id: 2,
      observed_at: new Date().toISOString(),
      rainfall_mm: 78.5,
      soil_condition: "saturated",
      visual_signs: "Active debris slide blocking left lane",
      road_status: "restricted",
      observer_id: "field_ranger_noney",
      geo_lat: 24.817,
      geo_lng: 93.633,
      geo_accuracy_m: 6.2,
      consent_given: true,
      media_urls: ["https://storage.landalert.org/media/slide_noney.jpg"],
    });

    // Verify observation is queued locally with generated idempotency key and client timestamp
    const queuedBefore = getQueuedObservations();
    expect(queuedBefore.length).toBe(1);
    expect(queuedBefore[0]?.idempotency_key).toBe(fieldObs.idempotency_key);
    expect(queuedBefore[0]?.client_timestamp).toBeDefined();

    // 3. Queue pruning: remove successfully synchronized records using acknowledged keys
    pruneQueue([fieldObs.idempotency_key!]);
    const queuedAfter = getQueuedObservations();
    expect(queuedAfter.length).toBe(0);
  });
});

describe("Authoritative Risk Representation & Color Consistency", () => {
  it("enforces identical four-level severity mapping across all components", () => {
    expect(RISK_LEVELS).toEqual(["Low", "Moderate", "High", "Severe"]);

    expect(riskColor("Low")).toBe("var(--risk-low)");
    expect(riskColor("Moderate")).toBe("var(--risk-moderate)");
    expect(riskColor("High")).toBe("var(--risk-high)");
    expect(riskColor("Severe")).toBe("var(--risk-severe)");
    expect(riskColor("UNKNOWN")).toBe("var(--risk-unknown, #94a3b8)");

    expect(riskBadgeClass("Low")).toContain("text-risk-low");
    expect(riskBadgeClass("Moderate")).toContain("text-risk-moderate");
    expect(riskBadgeClass("High")).toContain("text-risk-high");
    expect(riskBadgeClass("Severe")).toContain("text-risk-severe");
    expect(riskBadgeClass("UNKNOWN")).toContain("text-muted-foreground");

    // Severity rank ensures UNKNOWN is never coerced into or compared as <= Low
    expect(severityRank("Low")).toBe(1);
    expect(severityRank("Moderate")).toBe(2);
    expect(severityRank("High")).toBe(3);
    expect(severityRank("Severe")).toBe(4);
    expect(severityRank("UNKNOWN")).toBeNull();

    // Verify ordering logic handles null severity rank safely
    const levels = ["Severe", "UNKNOWN", "Low", "High", "Moderate"];
    const sortable = levels.filter((l) => severityRank(l) !== null);
    sortable.sort((a, b) => severityRank(a)! - severityRank(b)!);
    expect(sortable).toEqual(["Low", "Moderate", "High", "Severe"]);
  });
});
