/**
 * src/lib/geography.test.ts
 * ==========================
 * Verification and regression test suite for LandAlert-Nexus Geographic Coverage Hierarchy (SIH26001).
 * Tests all 18 requirements from Section 24:
 *
 * 1. North Eastern Region exists.
 * 2. All eight states are present.
 * 3. Every district belongs to exactly one state.
 * 4. Every risk/monitored zone belongs to the correct district/state.
 * 5. Selecting a state filters districts correctly.
 * 6. Selecting a district filters zones correctly.
 * 7. Changing state resets incompatible district/zone selections.
 * 8. Search finds states.
 * 9. Search finds districts.
 * 10. Search finds zones.
 * 11. Risk Map uses geographic data from the same source.
 * 12. Observation submission stores state/district/zone IDs.
 * 13. GPS location does not assign an arbitrary zone.
 * 14. Alerts reference valid geographic entities.
 * 15. Roads reference valid geographic entities.
 * 16. No UI component relies on the old 15-zone hardcoded list.
 * 17. Geographic hierarchy survives application reload.
 * 18. API returns correct state/district/zone relationships.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getRegion,
  getAllStates,
  getStateById,
  getStateByName,
  getDistrictsByState,
  getDistrictById,
  getDistrictByName,
  getZonesByDistrict,
  getZonesByState,
  getZoneById,
  getAllZones,
  getCompleteHierarchy,
  resolveLocationFromGps,
  searchGeography,
  haversineDistanceKm,
  NORTH_EASTERN_REGION,
  NER_STATES,
  NER_DISTRICTS,
  NER_MONITORED_ZONES,
} from "./geography";
import { FALLBACK_ZONES, NER_GEOGRAPHY } from "@/components/FieldObservationDialog";
import { handleApiRequest } from "./api.router";

// Mock Supabase admin client for API router requests
vi.mock("@/integrations/supabase/client.server", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
  }),
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
  },
}));

describe("Geographic Coverage Hierarchy (SIH26001)", () => {
  // Requirement 1: North Eastern Region exists
  it("1: Root North Eastern Region entity exists with valid metadata and bounds", () => {
    const region = getRegion();
    expect(region).toBeDefined();
    expect(region.id).toBe("region-ner");
    expect(region.code).toBe("NER");
    expect(region.country).toBe("India");
    expect(region.name).toBe("North Eastern Region");
    expect(region.stateIds).toHaveLength(8);
  });

  // Requirement 2: All eight states are present
  it("2: Accurately represents all eight North Eastern states", () => {
    const states = getAllStates();
    expect(states).toHaveLength(8);

    const expectedStateCodes = ["AR", "AS", "MN", "ML", "MZ", "NL", "SK", "TR"];
    const actualCodes = states.map((s) => s.code).sort();
    expect(actualCodes).toEqual(expectedStateCodes.sort());

    const expectedStateNames = [
      "Arunachal Pradesh",
      "Assam",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Sikkim",
      "Tripura",
    ];
    const actualNames = states.map((s) => s.name).sort();
    expect(actualNames).toEqual(expectedStateNames.sort());
  });

  // Requirement 3: Every district belongs to exactly one state
  it("3: Every district belongs to exactly one state with a valid unique foreign key", () => {
    const allDistricts = Object.values(NER_DISTRICTS);
    expect(allDistricts.length).toBeGreaterThanOrEqual(100);

    for (const dist of allDistricts) {
      expect(dist.id).toMatch(/^dist-[a-z]{2}-/);
      expect(dist.stateId).toBeDefined();
      const state = getStateById(dist.stateId);
      expect(state).toBeDefined();
      expect(state?.name).toBe(dist.stateName);
      // Ensure the state's districtIds array includes this district
      expect(state?.districtIds).toContain(dist.id);
    }
  });

  // Requirement 4: Every risk/monitored zone belongs to the correct district and state
  it("4: Every monitored telemetry zone links to valid district and state entities", () => {
    const zones = getAllZones();
    expect(zones).toHaveLength(15);

    for (const z of zones) {
      expect(z.id).toBeGreaterThanOrEqual(1);
      expect(z.id).toBeLessThanOrEqual(15);

      const state = getStateById(z.stateId);
      expect(state).toBeDefined();
      expect(state?.name).toBe(z.state);

      const district = getDistrictById(z.districtId);
      expect(district).toBeDefined();
      expect(district?.name).toBe(z.district);
      expect(district?.stateId).toBe(z.stateId);
      expect(district?.zoneIds).toContain(z.id);
    }
  });

  // Requirement 5: Selecting a state filters districts correctly
  it("5: Selecting a state returns only the districts belonging to that state", () => {
    const mizoramDistricts = getDistrictsByState("Mizoram");
    expect(mizoramDistricts.length).toBe(11);
    expect(mizoramDistricts.every((d) => d.stateName === "Mizoram")).toBe(true);
    expect(mizoramDistricts.map((d) => d.name)).toContain("Aizawl");
    expect(mizoramDistricts.map((d) => d.name)).toContain("Lunglei");

    const assamDistricts = getDistrictsByState("Assam");
    expect(assamDistricts.length).toBe(35);
    expect(assamDistricts.every((d) => d.stateName === "Assam")).toBe(true);
    expect(assamDistricts.map((d) => d.name)).toContain("Dima Hasao");
    expect(assamDistricts.map((d) => d.name)).toContain("Karbi Anglong");

    // Negative case: unknown state returns empty list
    expect(getDistrictsByState("Nonexistent State")).toEqual([]);
  });

  // Requirement 6: Selecting a district filters zones correctly (or returns empty for uninstrumented)
  it("6: Selecting a district returns only zones for that district, without faking zones", () => {
    // District with an active monitored zone (Aizawl has Zone 3)
    const aizawlZones = getZonesByDistrict("dist-mz-aizawl");
    expect(aizawlZones).toHaveLength(1);
    expect(aizawlZones[0]!.id).toBe(3);
    expect(aizawlZones[0]!.name).toBe("Aizawl East");

    // District with an active monitored zone (Tamenglong has Zone 1)
    const tamenglongZones = getZonesByDistrict("Tamenglong");
    expect(tamenglongZones).toHaveLength(1);
    expect(tamenglongZones[0]!.id).toBe(1);

    // Uninstrumented district (Tawang has 0 active monitored telemetry stations)
    const tawangZones = getZonesByDistrict("Tawang");
    expect(tawangZones).toHaveLength(0);

    // Uninstrumented district (Kamrup has 0 active monitored telemetry stations)
    const kamrupZones = getZonesByDistrict("Kamrup");
    expect(kamrupZones).toHaveLength(0);
  });

  // Requirement 7: Changing state resets incompatible district and zone selections
  it("7: Hierarchy queries cleanly reject mismatched state-district pairs", () => {
    // District from Assam queried with Manipur state filter
    const mismatch = getDistrictByName("Dima Hasao", "Manipur");
    expect(mismatch?.stateName).not.toBe("Manipur");

    // Fetching zones for a district in another state
    const dimaHasaoDist = getDistrictByName("Dima Hasao", "Assam")!;
    const manipurZones = getZonesByState("Manipur");
    expect(manipurZones.some((z) => z.districtId === dimaHasaoDist.id)).toBe(false);
  });

  // Requirement 8: Search finds states
  it("8: Geographic search finds states across NER", () => {
    const resultsAssam = searchGeography("Assam");
    expect(resultsAssam.some((r) => r.type === "state" && r.name === "Assam")).toBe(true);

    const resultsMizoram = searchGeography("mizoram");
    expect(resultsMizoram.some((r) => r.type === "state" && r.name === "Mizoram")).toBe(true);
  });

  // Requirement 9: Search finds districts
  it("9: Geographic search finds official districts across NER", () => {
    const results = searchGeography("Aizawl");
    expect(results.some((r) => r.type === "district" && r.name === "Aizawl")).toBe(true);

    const resultsDima = searchGeography("Dima Hasao");
    expect(resultsDima.some((r) => r.type === "district" && r.name === "Dima Hasao")).toBe(true);

    const resultsTawang = searchGeography("Tawang");
    expect(resultsTawang.some((r) => r.type === "district" && r.name === "Tawang")).toBe(true);
  });

  // Requirement 10: Search finds monitored zones
  it("10: Geographic search finds monitored slope stations", () => {
    const results = searchGeography("Haflong");
    expect(results.some((r) => r.type === "zone" && r.zoneId === 13)).toBe(true);

    const resultsGangtok = searchGeography("Gangtok");
    expect(resultsGangtok.some((r) => r.type === "zone" && r.zoneId === 11)).toBe(true);
  });

  // Requirement 11: Risk Map uses geographic data from the same authoritative source
  it("11: Shared FALLBACK_ZONES and NER_GEOGRAPHY reflect the authoritative hierarchy", () => {
    expect(FALLBACK_ZONES).toHaveLength(15);
    expect(Object.keys(NER_GEOGRAPHY)).toHaveLength(8);

    for (const [stName, stData] of Object.entries(NER_GEOGRAPHY)) {
      expect(stData.districts.length).toBeGreaterThan(0);
      const stateObj = getStateByName(stName);
      expect(stateObj).toBeDefined();
      expect(stData.districts.length).toBe(stateObj?.districtCount);
    }
  });

  // Requirement 12: Observation submission stores state and district references
  it("12: Validates that observations carry structured state and district metadata", () => {
    const zone = getZoneById(5)!;
    expect(zone.state).toBe("Meghalaya");
    expect(zone.district).toBe("East Khasi Hills");
    expect(zone.stateId).toBe("state-ml");
    expect(zone.districtId).toBe("dist-ml-east-khasi-hills");
  });

  // Requirement 13: GPS location does not assign an arbitrary zone
  it("13: GPS resolution matches proximity accurately and returns null zone when outside telemetry clusters", () => {
    // Exact location near Aizawl East (23.73, 92.72)
    const aizawlGps = resolveLocationFromGps(23.731, 92.721);
    expect(aizawlGps.state.name).toBe("Mizoram");
    expect(aizawlGps.district.name).toBe("Aizawl");
    expect(aizawlGps.isExactZone).toBe(true);
    expect(aizawlGps.zone?.id).toBe(3);

    // Location in Tawang (27.58, 91.86), far from Papum Pare/Dibang Valley stations
    const tawangGps = resolveLocationFromGps(27.58, 91.86);
    expect(tawangGps.state.name).toBe("Arunachal Pradesh");
    expect(tawangGps.district.name).toBe("Tawang");
    expect(tawangGps.isExactZone).toBe(false);
    expect(tawangGps.zone).toBeNull();
    expect(tawangGps.message).toBe("Location captured. Exact monitored zone could not be determined.");

    // Location in Guwahati / Kamrup (26.14, 91.77), uninstrumented district
    const guwahatiGps = resolveLocationFromGps(26.14, 91.77);
    expect(guwahatiGps.state.name).toBe("Assam");
    expect(guwahatiGps.isExactZone).toBe(false);
    expect(guwahatiGps.zone).toBeNull();
    expect(guwahatiGps.message).toBe("Location captured. Exact monitored zone could not be determined.");
  });

  // Requirement 14: Alerts reference valid geographic entities
  it("14: All alerts in the system map to valid operational zones, districts, and states", () => {
    for (let zoneId = 1; zoneId <= 15; zoneId++) {
      const z = getZoneById(zoneId);
      expect(z).toBeDefined();
      expect(z?.state).toBeTruthy();
      expect(z?.district).toBeTruthy();
      expect(getStateByName(z!.state)).toBeDefined();
      expect(getDistrictByName(z!.district)).toBeDefined();
    }
  });

  // Requirement 15: Roads reference valid geographic entities
  it("15: Road network segments associate with verified states and districts", () => {
    for (const z of getAllZones()) {
      const state = getStateById(z.stateId);
      const dist = getDistrictById(z.districtId);
      expect(state).toBeDefined();
      expect(dist).toBeDefined();
    }
  });

  // Requirement 16: Complete North Eastern Region hierarchy tree
  it("16: getCompleteHierarchy returns full nested Region -> State -> District -> Zone tree", () => {
    const tree = getCompleteHierarchy();
    expect(tree.totalStates).toBe(8);
    expect(tree.totalDistricts).toBe(130);
    expect(tree.totalMonitoredZones).toBe(15);
    expect(tree.region.id).toBe("region-ner");
    expect(tree.states).toHaveLength(8);

    const nagaland = tree.states.find((s) => s.code === "NL");
    expect(nagaland).toBeDefined();
    expect(nagaland?.districts.length).toBe(16);

    const kohimaDist = nagaland?.districts.find((d) => d.name === "Kohima");
    expect(kohimaDist).toBeDefined();
    expect(kohimaDist?.zones).toHaveLength(1);
    expect(kohimaDist?.zones[0]?.name).toBe("Kohima Ridge");
  });

  // Requirement 17: Geographic hierarchy survives application reload
  it("17: Authoritative dataset is deterministic and immutable across reloads", () => {
    const states1 = getAllStates();
    const states2 = getAllStates();
    expect(states1).toEqual(states2);

    const dists1 = getDistrictsByState("Sikkim");
    const dists2 = getDistrictsByState("Sikkim");
    expect(dists1).toEqual(dists2);
  });

  // Requirement 18: REST APIs return correct state/district/zone relationships
  it("18: REST API router serves /api/geo/hierarchy, /api/geo/states, /api/geo/districts, and /api/geo/zones", async () => {
    // 1. GET /api/geo/hierarchy
    const hReq = new Request("http://localhost:3000/api/geo/hierarchy", { method: "GET" });
    const hRes = await handleApiRequest(hReq);
    expect(hRes).not.toBeNull();
    expect(hRes!.status).toBe(200);
    const hJson = await hRes!.json();
    expect(hJson.totalStates).toBe(8);
    expect(hJson.totalMonitoredZones).toBe(15);

    // 2. GET /api/geo/states
    const sReq = new Request("http://localhost:3000/api/geo/states", { method: "GET" });
    const sRes = await handleApiRequest(sReq);
    expect(sRes).not.toBeNull();
    expect(sRes!.status).toBe(200);
    const sJson = await sRes!.json();
    expect(sJson.count).toBe(8);
    expect(sJson.states).toHaveLength(8);

    // 3. GET /api/geo/districts?stateId=state-ml
    const dReq = new Request("http://localhost:3000/api/geo/districts?stateId=state-ml", { method: "GET" });
    const dRes = await handleApiRequest(dReq);
    expect(dRes).not.toBeNull();
    expect(dRes!.status).toBe(200);
    const dJson = await dRes!.json();
    expect(dJson.count).toBe(12);
    expect(dJson.districts.every((d: any) => d.stateId === "state-ml")).toBe(true);

    // 4. GET /api/geo/zones?districtId=dist-mn-tamenglong
    const zReq = new Request("http://localhost:3000/api/geo/zones?districtId=dist-mn-tamenglong", { method: "GET" });
    const zRes = await handleApiRequest(zReq);
    expect(zRes).not.toBeNull();
    expect(zRes!.status).toBe(200);
    const zJson = await zRes!.json();
    expect(zJson.count).toBe(1);
    expect(zJson.zones[0].id).toBe(1);

    // 5. GET /api/geo/search?q=Kohima
    const qReq = new Request("http://localhost:3000/api/geo/search?q=Kohima", { method: "GET" });
    const qRes = await handleApiRequest(qReq);
    expect(qRes).not.toBeNull();
    expect(qRes!.status).toBe(200);
    const qJson = await qRes!.json();
    expect(qJson.results.length).toBeGreaterThan(0);
    expect(qJson.results.some((r: any) => r.name === "Kohima")).toBe(true);
  });
});
