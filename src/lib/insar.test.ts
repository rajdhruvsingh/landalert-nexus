/**
 * src/lib/insar.test.ts
 * =====================
 * Comprehensive automated verification of Satellite InSAR Ground Deformation pipeline:
 *
 * 1. Satellite InSAR product ingestion and schema validity.
 * 2. Units verification (mm/year for velocity, mm for displacement, days for baseline).
 * 3. Spatial grid mapping (bounds and centroid intersection).
 * 4. Distinct geographic cells retrieve their own specific deformation data (no constant reuse).
 * 5. Missing satellite coverage explicitly reported as UNAVAILABLE with technical reason.
 * 6. Scientific integrity: Zero fallback prohibition (fake "0 mm/yr" or ungrounded values rejected).
 * 7. REST API router exposes /api/satellite/deformation with full provenance.
 * 8. ML model versioning: Option A (Independent Indicator) strictly enforced without modifying
 *    the active 19-feature model vector.
 * 9. Multi-location end-to-end proof across all 8 NER states.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getCellDeformation,
  getLocationDeformation,
  ingestInSarProduct,
  getAllInSarProducts,
  resetInSarRegistry,
  assertScientificIntegrity,
  CANONICAL_SAR_PIPELINE_STEPS,
  type InSarDeformationProduct,
} from "./insar.service";
import { handleApiRequest } from "./api.router";
import { deriveLocationSpatialRisk } from "./spatial-risk.service";
import fs from "node:fs";
import path from "node:path";

const artifactPath = path.resolve(process.cwd(), "models/v0.2-lr-trained.json");
const modelArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
const CANONICAL_FEATURES = modelArtifact.feature_names as string[];

describe("Satellite InSAR Ground Deformation Pipeline", () => {
  beforeEach(() => {
    resetInSarRegistry();
  });

  it("1: Verifies canonical 10-step SAR interferometric processing pipeline specification", () => {
    expect(CANONICAL_SAR_PIPELINE_STEPS.length).toBe(10);
    expect(CANONICAL_SAR_PIPELINE_STEPS[0]).toContain("SAR Acquisition");
    expect(CANONICAL_SAR_PIPELINE_STEPS[1]).toContain("Orbit State Vector Correction");
    expect(CANONICAL_SAR_PIPELINE_STEPS[2]).toContain("Co-registration");
    expect(CANONICAL_SAR_PIPELINE_STEPS[5]).toContain("Phase Unwrapping");
    expect(CANONICAL_SAR_PIPELINE_STEPS[8]).toContain("Time-Series InSAR Displacement Analysis");
    expect(CANONICAL_SAR_PIPELINE_STEPS[9]).toContain("Spatial Grid Zonal Aggregation");
  });

  it("2: InSAR product ingestion enforces scientific units and structural validation", () => {
    const testProduct: InSarDeformationProduct = {
      cell_id: "cell-25.50-91.80",
      bounds: [[25.375, 91.675], [25.625, 91.925]],
      centroid: [25.50, 91.80],
      status: "AVAILABLE",
      los_velocity_mean_mm_year: -7.5,
      los_velocity_max_mm_year: -15.2,
      cumulative_displacement_mm: -18.4,
      observation_period: {
        start_date: "2024-01-01",
        end_date: "2025-12-31",
      },
      temporal_baseline_days: 730,
      coherence_mean: 0.65,
      spatial_coverage_pct: 72.0,
      sensor: "Sentinel-1 C-SAR",
      orbit_pass: "DESCENDING",
      wavelength_cm: 5.546,
      processing_pipeline: "PS-InSAR / SBAS Multi-temporal Interferometry",
      processing_status: "COMPLETED",
      quality: "HIGH",
      unavailable_reason: null,
      source: "Copernicus Sentinel-1 InSAR Surface Movement Archive",
      last_processed_at: "2026-02-01T00:00:00Z",
    };

    ingestInSarProduct(testProduct);

    const retrieved = getCellDeformation("cell-25.50-91.80");
    expect(retrieved.status).toBe("AVAILABLE");
    expect(retrieved.los_velocity_mean_mm_year).toBe(-7.5);
    expect(retrieved.cumulative_displacement_mm).toBe(-18.4);
    expect(retrieved.temporal_baseline_days).toBe(730);
    expect(retrieved.wavelength_cm).toBe(5.546);
    expect(retrieved.spatial_coverage_pct).toBe(72.0);
    expect(() => assertScientificIntegrity(retrieved)).not.toThrow();
  });

  it("3: Prohibits fake values or null velocities when status is AVAILABLE", () => {
    const invalidProduct: InSarDeformationProduct = {
      cell_id: "cell-invalid-1",
      bounds: [[25.0, 91.0], [25.25, 91.25]],
      centroid: [25.125, 91.125],
      status: "AVAILABLE",
      los_velocity_mean_mm_year: null, // VIOLATION: Available must have real velocity
      los_velocity_max_mm_year: null,
      cumulative_displacement_mm: null,
      observation_period: null,
      temporal_baseline_days: null,
      coherence_mean: null,
      spatial_coverage_pct: 50,
      sensor: "Sentinel-1 C-SAR",
      orbit_pass: "ASCENDING",
      wavelength_cm: 5.546,
      processing_pipeline: "PS-InSAR",
      processing_status: "COMPLETED",
      quality: "HIGH",
      unavailable_reason: null,
      source: "Copernicus Sentinel-1",
      last_processed_at: null,
    };

    expect(() => ingestInSarProduct(invalidProduct)).toThrow(/SCIENTIFIC_INTEGRITY_VIOLATION/);
  });

  it("4: Prohibits fabricated deformation numbers when status is UNAVAILABLE (No fake 0 mm/yr)", () => {
    const invalidUnavailable: InSarDeformationProduct = {
      cell_id: "cell-invalid-2",
      bounds: [[25.0, 91.0], [25.25, 91.25]],
      centroid: [25.125, 91.125],
      status: "UNAVAILABLE",
      los_velocity_mean_mm_year: 0.0, // VIOLATION: Cannot substitute a fake zero
      los_velocity_max_mm_year: null,
      cumulative_displacement_mm: 0.0,
      observation_period: null,
      temporal_baseline_days: null,
      coherence_mean: null,
      spatial_coverage_pct: 0,
      sensor: "Sentinel-1 C-SAR",
      orbit_pass: null,
      wavelength_cm: 5.546,
      processing_pipeline: "Unprocessed",
      processing_status: "UNAVAILABLE",
      quality: "UNAVAILABLE",
      unavailable_reason: "PENDING_SAR_INTERFEROMETRIC_PROCESSING",
      source: "Copernicus Sentinel-1",
      last_processed_at: null,
    };

    expect(() => ingestInSarProduct(invalidUnavailable)).toThrow(/SCIENTIFIC_INTEGRITY_VIOLATION/);
  });

  it("5: Missing InSAR coverage returns honest UNAVAILABLE record with explicit reason", () => {
    // Unmonitored remote cell in Arunachal rainforest
    const remoteCell = getCellDeformation("cell-28.50-94.50", [[28.375, 94.375], [28.625, 94.625]], [28.50, 94.50]);
    expect(remoteCell.status).toBe("UNAVAILABLE");
    expect(remoteCell.los_velocity_mean_mm_year).toBeNull();
    expect(remoteCell.cumulative_displacement_mm).toBeNull();
    expect(remoteCell.unavailable_reason).toBe("SAR_DECORRELATION_DENSE_CANOPY");
    expect(remoteCell.processing_status).toBe("DECORRELATED");
  });

  it("6: Geographically distinct NER locations retrieve their own individual satellite results (no constant reuse)", () => {
    const gangtokAssessment = getLocationDeformation(27.33, 88.61, "Gangtok", "East Sikkim", "Sikkim");
    const dibrugarhAssessment = getLocationDeformation(27.47, 94.91, "Dibrugarh", "Dibrugarh", "Assam");
    const shillongAssessment = getLocationDeformation(25.57, 91.89, "Shillong", "East Khasi Hills", "Meghalaya");

    // 1. Coordinates and cells must differ
    expect(gangtokAssessment.associated_cell_id).not.toBe(dibrugarhAssessment.associated_cell_id);
    expect(gangtokAssessment.associated_cell_id).not.toBe(shillongAssessment.associated_cell_id);

    // 2. Gangtok has registered active InSAR slope monitoring
    expect(gangtokAssessment.deformation.status).toBe("AVAILABLE");
    expect(gangtokAssessment.deformation.los_velocity_mean_mm_year).toBe(-14.2);
    expect(gangtokAssessment.deformation.sensor).toBe("Sentinel-1 C-SAR");
    expect(gangtokAssessment.deformation.quality).toBe("HIGH");

    // 3. Dibrugarh has no active InSAR processing -> honest UNAVAILABLE
    expect(dibrugarhAssessment.deformation.status).toBe("UNAVAILABLE");
    expect(dibrugarhAssessment.deformation.los_velocity_mean_mm_year).toBeNull();
    expect(dibrugarhAssessment.deformation.unavailable_reason).toBe("PENDING_SAR_INTERFEROMETRIC_PROCESSING");

    // 4. Deformation values must not be equal or constant
    expect(gangtokAssessment.deformation.los_velocity_mean_mm_year).not.toBe(
      dibrugarhAssessment.deformation.los_velocity_mean_mm_year
    );
  });

  it("7: REST API /api/satellite/deformation returns cell and coordinate queries accurately", async () => {
    // A. Query by cellId for Gangtok
    const req1 = new Request("http://localhost:3000/api/satellite/deformation?cellId=cell-27.25-88.50", {
      method: "GET",
    });
    const res1 = await handleApiRequest(req1);
    expect(res1?.status).toBe(200);
    const json1 = await res1?.json();
    expect(json1.status).toBe("success");
    expect(json1.deformation.cell_id).toBe("cell-27.25-88.50");
    expect(json1.deformation.status).toBe("AVAILABLE");
    expect(json1.deformation.los_velocity_mean_mm_year).toBe(-14.2);
    expect(json1.scientific_integrity.zero_fabrication_prohibited).toBe(true);
    expect(json1.scientific_integrity.option_a_independent_indicator).toBe(true);

    // B. Query by lat/lng for Guwahati
    const req2 = new Request(
      "http://localhost:3000/api/satellite/deformation?lat=26.18&lng=91.75&city=Guwahati&state=Assam",
      { method: "GET" }
    );
    const res2 = await handleApiRequest(req2);
    expect(res2?.status).toBe(200);
    const json2 = await res2?.json();
    expect(json2.status).toBe("success");
    expect(json2.city_name).toBe("Guwahati");
    expect(json2.deformation.status).toBe("AVAILABLE");
    expect(json2.deformation.los_velocity_mean_mm_year).toBe(-4.1);
    expect(json2.risk_engine_integration.mode).toBe("OPTION_A_INDEPENDENT_INDICATOR");
    expect(json2.risk_engine_integration.incorporated_in_ml_weights).toBe(false);

    // C. Query by city name for remote/unmonitored location (e.g. Tawang)
    const req3 = new Request(
      "http://localhost:3000/api/satellite/deformation?city=Tawang&state=Arunachal%20Pradesh",
      { method: "GET" }
    );
    const res3 = await handleApiRequest(req3);
    expect(res3?.status).toBe(200);
    const json3 = await res3?.json();
    expect(json3.status).toBe("success");
    expect(json3.deformation.status).toBe("UNAVAILABLE");
    expect(json3.deformation.los_velocity_mean_mm_year).toBeNull();
    expect(["SAR_DECORRELATION_DENSE_CANOPY", "PENDING_SAR_INTERFEROMETRIC_PROCESSING"]).toContain(
      json3.deformation.unavailable_reason
    );
  });

  it("8: Proves Option A ML isolation: Active ML model feature vector contains exactly 19 features without deformation", () => {
    // Scientific Integrity check: Production model v0.2-lr-trained was trained on 19 canonical features.
    expect(CANONICAL_FEATURES.length).toBe(19);
    expect(CANONICAL_FEATURES).not.toContain("satellite_deformation");
    expect(CANONICAL_FEATURES).not.toContain("insar_velocity");
    expect(CANONICAL_FEATURES).not.toContain("sar_displacement");

    // Location spatial risk assessment explicitly documents Option A
    const locRisk = deriveLocationSpatialRisk("Gangtok", "city", "East Sikkim", "Sikkim", [27.33, 88.61]);
    expect(locRisk.model_provenance).toBeDefined();
    expect(locRisk.model_provenance?.satellite_feature_integration).toBe("OPTION_A_INDEPENDENT_INDICATOR");
    expect(locRisk.model_provenance?.active_ml_model).toBe("v0.2-lr-trained");
    expect(locRisk.model_provenance?.feature_schema_version).toBe("v1.0.0");
  });

  it("9: End-to-end multi-location demonstration across 8 geographically separated NER points", () => {
    const testCases = [
      { city: "Gangtok", state: "Sikkim", coords: [27.33, 88.61] as [number, number], expectedStatus: "AVAILABLE", hasVelocity: true },
      { city: "Guwahati", state: "Assam", coords: [26.18, 91.75] as [number, number], expectedStatus: "AVAILABLE", hasVelocity: true },
      { city: "Dibrugarh", state: "Assam", coords: [27.47, 94.91] as [number, number], expectedStatus: "UNAVAILABLE", hasVelocity: false },
      { city: "Itanagar", state: "Arunachal Pradesh", coords: [27.08, 93.60] as [number, number], expectedStatus: "UNAVAILABLE", hasVelocity: false },
      { city: "Shillong", state: "Meghalaya", coords: [25.57, 91.89] as [number, number], expectedStatus: "UNAVAILABLE", hasVelocity: false },
      { city: "Aizawl", state: "Mizoram", coords: [23.73, 92.71] as [number, number], expectedStatus: "UNAVAILABLE", hasVelocity: false },
      { city: "Kohima", state: "Nagaland", coords: [25.67, 94.10] as [number, number], expectedStatus: "UNAVAILABLE", hasVelocity: false },
      { city: "Agartala", state: "Tripura", coords: [23.83, 91.28] as [number, number], expectedStatus: "UNAVAILABLE", hasVelocity: false },
    ];

    const results = testCases.map((tc) => {
      const assessment = getLocationDeformation(tc.coords[0], tc.coords[1], tc.city, tc.city, tc.state);
      const spatialRisk = deriveLocationSpatialRisk(tc.city, "city", tc.city, tc.state, tc.coords);

      return {
        city: tc.city,
        state: tc.state,
        coords: tc.coords,
        cellId: assessment.associated_cell_id,
        status: assessment.deformation.status,
        velocity: assessment.deformation.los_velocity_mean_mm_year,
        sensor: assessment.deformation.sensor,
        period: assessment.deformation.observation_period,
        quality: assessment.deformation.quality,
        source: assessment.deformation.source,
        reason: assessment.deformation.unavailable_reason,
        riskScore: spatialRisk.risk.score,
        riskLevel: spatialRisk.risk.level,
      };
    });

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const r = results[i];

      expect(r.status).toBe(tc.expectedStatus);
      if (tc.hasVelocity) {
        expect(r.velocity).not.toBeNull();
        expect(typeof r.velocity).toBe("number");
        expect(r.period).not.toBeNull();
        expect(r.quality).not.toBe("UNAVAILABLE");
      } else {
        expect(r.velocity).toBeNull();
        expect(r.reason).not.toBeNull();
      }
    }
  });
});
