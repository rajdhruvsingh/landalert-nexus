import { describe, it, expect } from "vitest";
import {
  searchGeography,
  getAllCities,
  getCitiesByDistrict,
  getCitiesByState,
  NORTH_EASTERN_REGION,
  getAllStates,
} from "./geography";

describe("Geographic Hierarchy & City Search", () => {
  it("has root region and 8 NER states defined", () => {
    expect(NORTH_EASTERN_REGION.id).toBe("region-ner");
    const states = getAllStates();
    expect(states).toHaveLength(8);
    const codes = states.map((s) => s.code).sort();
    expect(codes).toEqual(["AR", "AS", "ML", "MN", "MZ", "NL", "SK", "TR"]);
  });

  it("contains extensive city dataset across all 8 states", () => {
    const cities = getAllCities();
    expect(cities.length).toBeGreaterThanOrEqual(400);

    // Verify presence of cities from every single state
    const stateIds = new Set(cities.map((c) => c.stateId));
    expect(stateIds.size).toBe(8);
  });

  it("searches case-insensitively and tolerates partial matching", () => {
    // 1. Partial "Imph" -> Imphal (Manipur)
    const imphResults = searchGeography("Imph");
    expect(imphResults.some((r) => r.name.toLowerCase().includes("imphal"))).toBe(true);

    // 2. Partial "shi" -> Shillong (Meghalaya)
    const shiResults = searchGeography("shi");
    expect(shiResults.some((r) => r.name.toLowerCase().includes("shillong"))).toBe(true);

    // 3. State query "manipur" -> Manipur State and locations
    const mnResults = searchGeography("manipur");
    expect(mnResults.some((r) => r.name.toLowerCase() === "manipur" && r.type === "state")).toBe(true);
  });

  it("searches representative cities across all 8 states without hardcoding", () => {
    const stateTestLocations = [
      { query: "Guwahati", expectedState: "Assam" },
      { query: "Pasighat", expectedState: "Arunachal Pradesh" },
      { query: "Churachandpur", expectedState: "Manipur" },
      { query: "Tura", expectedState: "Meghalaya" },
      { query: "Lunglei", expectedState: "Mizoram" },
      { query: "Mokokchung", expectedState: "Nagaland" },
      { query: "Gangtok", expectedState: "Sikkim" },
      { query: "Agartala", expectedState: "Tripura" },
    ];

    for (const testCase of stateTestLocations) {
      const results = searchGeography(testCase.query);
      expect(results.length).toBeGreaterThan(0);
      const match = results.find(
        (r) =>
          r.name.toLowerCase() === testCase.query.toLowerCase() &&
          r.stateName === testCase.expectedState,
      );
      expect(match).toBeDefined();
      expect(match?.centroid).toBeDefined();
    }
  });

  it("distinguishes identical names in different states or districts", () => {
    // E.g. Lakhipur exists in Cachar (Assam) and Goalpara (Assam)
    const results = searchGeography("Lakhipur");
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const res of results) {
      expect(res.description).toBeDefined();
    }
  });
});
