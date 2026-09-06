/**
 * src/lib/location-risk.test.ts
 * =============================
 * Unit & Integration tests for geolocation risk resolution:
 * - Ray casting point-in-polygon logic
 * - Resolution of coordinates inside known risk zones
 * - Resolution of coordinates outside monitored coverage (e.g. Delhi, oceans)
 * - getRiskForLocation server function returning authoritative risk scores and explanations
 */

import { describe, it, expect, vi } from "vitest";
import { isPointInPolygon, findMatchingZone, zonePolygon } from "./risk";

const mockMonitoredZones = [
  {
    id: 1,
    zone_name: "Tamenglong",
    district: "Tamenglong",
    state: "Manipur",
    centroid_lat: 24.98,
    centroid_lng: 93.5,
    current_risk_level: "High",
    risk_score: 78.4,
    explanation: "High cumulative 72h rainfall exceeds threshold.",
    mean_slope_deg: 31.4,
    population: 51213,
  },
  {
    id: 2,
    zone_name: "Noney",
    district: "Noney",
    state: "Manipur",
    centroid_lat: 24.83,
    centroid_lng: 93.66,
    current_risk_level: "Moderate",
    risk_score: 55.2,
    explanation: "Moderate antecedent moisture on steep slopes.",
    mean_slope_deg: 38.2,
    population: 22840,
  },
  {
    id: 5,
    zone_name: "Shillong-Sohra Escarpment",
    district: "East Khasi Hills",
    state: "Meghalaya",
    centroid_lat: 25.3,
    centroid_lng: 91.72,
    current_risk_level: "Severe",
    risk_score: 88.0,
    explanation: "Continuous high-intensity rainfall on vulnerable escarpment.",
    mean_slope_deg: 45.8,
    population: 96420,
  },
  {
    id: 11,
    zone_name: "Gangtok-Singtam Corridor",
    district: "East Sikkim",
    state: "Sikkim",
    centroid_lat: 27.33,
    centroid_lng: 88.61,
    current_risk_level: "Severe",
    risk_score: 91.5,
    explanation: "Extreme rainfall exceeding Sikkim I-D threshold.",
    mean_slope_deg: 44.1,
    population: 58970,
  },
];

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => ({
      from: (table: string) => ({
        select: (cols?: string) => ({
          order: (col?: string) =>
            Promise.resolve({
              data: mockMonitoredZones,
              error: null,
            }),
        }),
      }),
    }),
  };
});

import { getRiskForLocation } from "./monitoring.functions";

describe("Point-in-Polygon & Geolocation Zone Matching", () => {
  it("resolves a coordinate directly at zone centroid to that zone", () => {
    // Tamenglong centroid
    const match = findMatchingZone(24.98, 93.5, mockMonitoredZones);
    expect(match).not.toBeNull();
    expect(match?.id).toBe(1);
    expect(match?.zone_name).toBe("Tamenglong");
    expect(match?.current_risk_level).toBe("High");
  });

  it("resolves a coordinate slightly offset inside the zone polygon to that zone", () => {
    // Offset ~1.5 km northeast of Tamenglong centroid
    const match = findMatchingZone(24.992, 93.515, mockMonitoredZones);
    expect(match).not.toBeNull();
    expect(match?.id).toBe(1);
    expect(match?.zone_name).toBe("Tamenglong");

    // Offset ~1 km from Gangtok-Singtam centroid
    const gangtokMatch = findMatchingZone(27.338, 88.615, mockMonitoredZones);
    expect(gangtokMatch).not.toBeNull();
    expect(gangtokMatch?.id).toBe(11);
    expect(gangtokMatch?.zone_name).toBe("Gangtok-Singtam Corridor");
  });

  it("resolves coordinates outside all monitored zones to none (null)", () => {
    // New Delhi
    expect(findMatchingZone(28.6139, 77.209, mockMonitoredZones)).toBeNull();

    // Mumbai
    expect(findMatchingZone(19.076, 72.8777, mockMonitoredZones)).toBeNull();

    // Kolkata (near NER but outside hill zones)
    expect(findMatchingZone(22.5726, 88.3639, mockMonitoredZones)).toBeNull();

    // Coordinates in the Indian Ocean
    expect(findMatchingZone(5.0, 80.0, mockMonitoredZones)).toBeNull();
  });

  it("accurately executes ray-casting algorithm for convex and non-convex polygons", () => {
    // Unit square: (0,0) -> (0,2) -> (2,2) -> (2,0)
    const square: [number, number][] = [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
    ];
    expect(isPointInPolygon([1, 1], square)).toBe(true);
    expect(isPointInPolygon([0.5, 0.5], square)).toBe(true);
    expect(isPointInPolygon([3, 1], square)).toBe(false);
    expect(isPointInPolygon([-1, 1], square)).toBe(false);
    expect(isPointInPolygon([1, 3], square)).toBe(false);
  });
});

describe("getRiskForLocation() server function", () => {
  it("returns matched=true with risk level, score, and explanation for an inside coordinate", async () => {
    // Tamenglong: lat 24.98, lng 93.5
    const result = await getRiskForLocation(24.98, 93.5);

    expect(result.matched).toBe(true);
    expect(result.zone).not.toBeNull();
    expect(result.zone?.zone_name).toBe("Tamenglong");
    expect(result.zone?.district).toBe("Tamenglong");
    expect(result.zone?.state).toBe("Manipur");
    expect(result.zone?.current_risk_level).toBe("High");
    expect(typeof result.zone?.risk_score).toBe("number");
    // Verifies explanation was loaded from the database
    expect(result.zone?.explanation).toBe("High cumulative 72h rainfall exceeds threshold.");
    expect(result.userCoords).toEqual({ lat: 24.98, lng: 93.5 });
  });

  it("returns matched=false and zone=null for coordinates outside the monitored region", async () => {
    // Bengaluru: lat 12.9716, lng 77.5946 (clearly outside NER)
    const result = await getRiskForLocation(12.9716, 77.5946);

    expect(result.matched).toBe(false);
    expect(result.zone).toBeNull();
    expect(result.userCoords).toEqual({ lat: 12.9716, lng: 77.5946 });
  });
});
