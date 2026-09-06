import { describe, it, expect } from "vitest";
import {
  getAllSpatialCells,
  getSpatialCellsByState,
  getSpatialCellsByDistrict,
  findSurroundingCells,
  evaluateCellRisk,
  deriveLocationSpatialRisk,
} from "./spatial-risk.service";
import {
  getAllStates,
  getAllDistricts,
  getAllCities,
  getDistrictsByState,
  getCitiesByDistrict,
  searchGeography,
} from "./geography";
import { handleApiRequest } from "./api.router";
import type { ZoneRow } from "./monitoring.functions";

const SAMPLE_ZONES: ZoneRow[] = [
  {
    id: 1,
    zone_name: "Guwahati Hills",
    state: "Assam",
    district: "Kamrup Metropolitan",
    current_risk_level: "Moderate",
    risk_score: 45,
    mean_slope_deg: 22,
    population: 950000,
    rainfall_1d_mm: 18.5,
    rainfall_3d_mm: 42.0,
    rainfall_7d_mm: 85.0,
    soil_moisture_pct: 48,
    soil_moisture_status: "measured",
    centroid_lat: 26.18,
    centroid_lng: 91.75,
    explanation: "Moderate terrain gradient with seasonal precipitation",
  },
  {
    id: 2,
    zone_name: "Shillong Plateau",
    state: "Meghalaya",
    district: "East Khasi Hills",
    current_risk_level: "High",
    risk_score: 72,
    mean_slope_deg: 34,
    population: 350000,
    rainfall_1d_mm: 45.0,
    rainfall_3d_mm: 110.0,
    rainfall_7d_mm: 220.0,
    soil_moisture_pct: 78,
    soil_moisture_status: "measured",
    centroid_lat: 25.57,
    centroid_lng: 91.89,
    explanation: "Steep escarpments with persistent high antecedent moisture",
  },
];

describe("Continuous 8-State Spatial Prediction Grid Architecture", () => {
  const ALL_8_STATES = [
    "Assam",
    "Arunachal Pradesh",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Sikkim",
    "Tripura",
  ];

  it("1 & 2: Represents the entire Northeast geographic scope across all 8 states", () => {
    const states = getAllStates();
    expect(states.length).toBe(8);
    const stateNames = states.map((s) => s.name);
    for (const st of ALL_8_STATES) {
      expect(stateNames).toContain(st);
    }

    const allCells = getAllSpatialCells();
    expect(allCells.length).toBeGreaterThanOrEqual(400); // 479 grid cells

    for (const stateName of ALL_8_STATES) {
      const stateCells = getSpatialCellsByState(stateName);
      expect(stateCells.length).toBeGreaterThan(0);
      for (const c of stateCells) {
        expect(c.state_name).toBe(stateName);
        expect(c.centroid[0]).toBeGreaterThan(20);
        expect(c.centroid[1]).toBeGreaterThanOrEqual(88.0);
        expect(typeof c.elevation_m).toBe("number");
        expect(c.slope_deg).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("3 & 4: District and City geographic lookups work across all 8 states", () => {
    const allDistricts = getAllStates().flatMap((s) => getDistrictsByState(s.name));
    expect(allDistricts.length).toBeGreaterThanOrEqual(120);

    for (const stateName of ALL_8_STATES) {
      const stateDistricts = getDistrictsByState(stateName);
      expect(stateDistricts.length).toBeGreaterThan(0);
      for (const d of stateDistricts) {
        expect(d.stateName).toBe(stateName);
        const districtCities = getCitiesByDistrict(d.id);
        expect(districtCities.length).toBeGreaterThanOrEqual(1);
      }
    }

    const allCities = getAllCities();
    expect(allCities.length).toBeGreaterThanOrEqual(120);
  });

  it("5: City to surrounding spatial cells aggregation", () => {
    // Test cities across distinct states
    const testCities = [
      { name: "Guwahati", state: "Assam", lat: 26.18, lng: 91.75 },
      { name: "Itanagar", state: "Arunachal Pradesh", lat: 27.08, lng: 93.61 },
      { name: "Imphal", state: "Manipur", lat: 24.81, lng: 93.94 },
      { name: "Shillong", state: "Meghalaya", lat: 25.57, lng: 91.88 },
      { name: "Aizawl", state: "Mizoram", lat: 23.73, lng: 92.72 },
      { name: "Kohima", state: "Nagaland", lat: 25.67, lng: 94.11 },
      { name: "Gangtok", state: "Sikkim", lat: 27.33, lng: 88.61 },
      { name: "Agartala", state: "Tripura", lat: 23.83, lng: 91.28 },
    ];

    for (const tc of testCities) {
      const surrounding = findSurroundingCells(tc.lat, tc.lng, 40.0);
      expect(surrounding.length).toBeGreaterThan(0);
      for (const c of surrounding) {
        expect(c.distanceKm).toBeLessThanOrEqual(40.0);
      }
    }
  });

  it("6: Spatial cell evaluates risk with scientific distinction between static and dynamic factors", () => {
    const allCells = getAllSpatialCells();
    const cell = allCells[0]!;

    const evalResult = evaluateCellRisk(cell, SAMPLE_ZONES);
    expect(evalResult.cell_id).toBe(cell.cell_id);
    expect(evalResult.risk_level).toBeDefined();
    expect(["Low", "Moderate", "High", "Severe"]).toContain(evalResult.risk_level);
    expect(evalResult.final_risk_score).toBeGreaterThanOrEqual(0);
    expect(evalResult.final_risk_score).toBeLessThanOrEqual(100);

    // Static susceptibility is separated from dynamic trigger
    expect(evalResult.static_susceptibility).toBeGreaterThanOrEqual(0.0);
    expect(evalResult.static_susceptibility).toBeLessThanOrEqual(1.0);
    expect(evalResult.dynamic_trigger_score).toBeGreaterThanOrEqual(0);
    expect(evalResult.dynamic_trigger_score).toBeLessThanOrEqual(100);

    // Never fabricates uncalibrated probability
    expect(evalResult.probability).toBeNull();
  });

  it("7, 8, 9: Derived location spatial risk calculates deterministic aggregation for representative cities in all 8 states", () => {
    const representativePoints = [
      { name: "Dispur", state: "Assam", district: "Kamrup Metropolitan", coord: [26.14, 91.79] as [number, number] },
      { name: "Tawang", state: "Arunachal Pradesh", district: "Tawang", coord: [27.58, 91.86] as [number, number] },
      { name: "Churachandpur", state: "Manipur", district: "Churachandpur", coord: [24.33, 93.68] as [number, number] },
      { name: "Nongpoh", state: "Meghalaya", district: "Ri Bhoi", coord: [25.90, 91.88] as [number, number] },
      { name: "Lunglei", state: "Mizoram", district: "Lunglei", coord: [22.88, 92.73] as [number, number] },
      { name: "Mokokchung", state: "Nagaland", district: "Mokokchung", coord: [26.32, 94.52] as [number, number] },
      { name: "Namchi", state: "Sikkim", district: "Namchi", coord: [27.17, 88.35] as [number, number] },
      { name: "Udaipur", state: "Tripura", district: "Gomati", coord: [23.53, 91.48] as [number, number] },
    ];

    for (const rep of representativePoints) {
      const locRisk = deriveLocationSpatialRisk(
        rep.name,
        "city",
        rep.district,
        rep.state,
        rep.coord,
        SAMPLE_ZONES
      );

      expect(locRisk.location.name).toBe(rep.name);
      expect(locRisk.location.state).toBe(rep.state);
      expect(locRisk.risk.score).toBeGreaterThanOrEqual(0);
      expect(locRisk.risk.score).toBeLessThanOrEqual(100);
      expect(locRisk.risk.probability).toBeNull(); // No fabricated probability
      expect(locRisk.surrounding_cells_count).toBeGreaterThan(0);
      expect(locRisk.components.satellite_deformation.status).toBe("UNAVAILABLE"); // No fabricated satellite data
    }
  });

  it("10 & 11: Missing data handling and distinction between Low Risk and Insufficient Data", () => {
    // If point is completely outside the region (e.g. Indian Ocean)
    const remotePoint: [number, number] = [0.0, 0.0];
    const remoteResult = deriveLocationSpatialRisk(
      "Deep Ocean Point",
      "point",
      "Offshore",
      "International Waters",
      remotePoint,
      []
    );

    expect(remoteResult.risk.confidence).toBe("INSUFFICIENT_DATA");
    expect(remoteResult.risk.probability).toBeNull();
    expect(remoteResult.data_quality.status).toBe("INSUFFICIENT_DATA");
  });

  it("12 & 13: Model version tracking and complete data provenance", () => {
    const locRisk = deriveLocationSpatialRisk(
      "Shillong",
      "city",
      "East Khasi Hills",
      "Meghalaya",
      [25.57, 91.88],
      SAMPLE_ZONES
    );

    expect(locRisk.model_version).toBe("v0.3-spatial-surface");
    expect(locRisk.data_quality).toBeDefined();
    expect(locRisk.computed_at).toBeDefined();
  });

  it("14: Never fabricates probabilities across random queries", () => {
    const cities = getAllCities().slice(0, 20);
    for (const c of cities) {
      const res = deriveLocationSpatialRisk(c.name, c.type, c.districtName, c.stateName, c.centroid, SAMPLE_ZONES);
      expect(res.risk.probability).toBeNull();
    }
  });

  it("15 & 16: REST APIs GET /api/spatial/cells and GET /api/spatial/risk respond correctly", async () => {
    // GET /api/spatial/cells
    const reqCells = new Request("http://localhost:3000/api/spatial/cells?state=Sikkim");
    const resCells = await handleApiRequest(reqCells);
    expect(resCells).not.toBeNull();
    expect(resCells!.status).toBe(200);
    const jsonCells = await resCells!.json();
    expect(jsonCells.count).toBeGreaterThan(0);
    expect(jsonCells.cells.every((c: any) => c.state_name === "Sikkim")).toBe(true);

    // GET /api/spatial/risk by coordinates
    const reqRisk = new Request("http://localhost:3000/api/spatial/risk?lat=25.57&lng=91.88&city=Shillong&state=Meghalaya");
    const resRisk = await handleApiRequest(reqRisk);
    expect(resRisk).not.toBeNull();
    expect(resRisk!.status).toBe(200);
    const jsonRisk = await resRisk!.json();
    expect(jsonRisk.location.name).toBe("Shillong");
    expect(jsonRisk.risk.score).toBeDefined();
    expect(jsonRisk.risk.probability).toBeNull();

    // GET /api/spatial/city-risk by city name
    const reqCity = new Request("http://localhost:3000/api/spatial/city-risk?name=Gangtok&state=Sikkim");
    const resCity = await handleApiRequest(reqCity);
    expect(resCity).not.toBeNull();
    expect(resCity!.status).toBe(200);
    const jsonCity = await resCity!.json();
    expect(jsonCity.location.name).toBe("Gangtok");
    expect(jsonCity.location.state).toBe("Sikkim");
    expect(jsonCity.risk.probability).toBeNull();
  });

  it("17: Satellite unavailable state cleanly exposed without pretending analysis occurred", () => {
    const cells = getSpatialCellsByState("Nagaland");
    const evalCell = evaluateCellRisk(cells[0]!, SAMPLE_ZONES);
    expect(evalCell.provenance.satellite_status).toBe("UNAVAILABLE");
  });

  it("18: Search geography partial matching works for cities, districts, and states across all 8 states", () => {
    const hitsGuwahati = searchGeography("guwa");
    expect(hitsGuwahati.some((h) => h.name.includes("Guwahati"))).toBe(true);

    const hitsAizawl = searchGeography("aiz");
    expect(hitsAizawl.some((h) => h.name.includes("Aizawl"))).toBe(true);

    const hitsGangtok = searchGeography("gang");
    expect(hitsGangtok.some((h) => h.name.includes("Gangtok"))).toBe(true);

    const hitsKohima = searchGeography("kohi");
    expect(hitsKohima.some((h) => h.name.includes("Kohima"))).toBe(true);
  });
});
