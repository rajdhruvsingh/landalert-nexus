import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queueObservation,
  getQueuedObservations,
  pruneQueue,
  getCachedOfflinePackage,
} from "./offline-manager";
import { riskColor, riskBadgeClass, RISK_LEVELS } from "./risk";

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
});

describe("Authoritative Risk Representation & Color Consistency", () => {
  it("enforces identical four-level severity mapping across all components", () => {
    expect(RISK_LEVELS).toEqual(["Low", "Moderate", "High", "Severe"]);

    expect(riskColor("Low")).toBe("var(--risk-low)");
    expect(riskColor("Moderate")).toBe("var(--risk-moderate)");
    expect(riskColor("High")).toBe("var(--risk-high)");
    expect(riskColor("Severe")).toBe("var(--risk-severe)");

    expect(riskBadgeClass("Low")).toContain("text-risk-low");
    expect(riskBadgeClass("Moderate")).toContain("text-risk-moderate");
    expect(riskBadgeClass("High")).toContain("text-risk-high");
    expect(riskBadgeClass("Severe")).toContain("text-risk-severe");
  });
});
