/**
 * src/lib/insar.test.ts
 * =====================
 * Comprehensive automated verification of Satellite InSAR Ground Deformation pipeline:
 *
 * 1. Canonical 10-step SAR interferometric processing pipeline specification.
 * 2. InSAR product ingestion and schema validity.
 * 3. Units verification (mm/year for velocity, mm for displacement, days for baseline).
 * 4. Scientific integrity: Zero fallback prohibition (fake "0 mm/yr" or ungrounded values rejected).
 * 5. Missing satellite coverage explicitly reported as UNAVAILABLE with technical reason.
 * 6. Distinct geographic cells retrieve their own specific deformation data (no constant reuse).
 * 7. REST API router exposes /api/satellite/deformation with full provenance.
 * 8. ML model versioning: Option A (Independent Indicator) strictly enforced without modifying
 *    the active 19-feature model vector.
 * 9. Multi-location end-to-end proof across all 8 NER states.
 * 10. Sentinel-1 STAC acquisition searching and spatial bounding box queries.
 * 11. Acquisition ingestion and duplicate avoidance / idempotency.
 * 12. Asynchronous InSAR processing job lifecycle (QUEUED -> PROCESSING -> COMPLETED).
 * 13. Temporal trend derivation (STABLE, INCREASING_DEFORMATION, INSUFFICIENT_DATA).
 * 14. Quality filtering based on mean coherence thresholds.
 * 15. Strict temporal data leakage protection (t_observation <= t_event_cutoff).
 * 16. REST API /api/satellite/coverage endpoint.
 * 17. REST API /api/satellite/acquisitions endpoint.
 * 18. REST API /api/satellite/jobs endpoint (POST 202 Accepted & GET polling).
 * 19. REST API /api/satellite/timeseries endpoint with trend evaluation.
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
import {
  searchSentinel1Acquisitions,
  ingestAcquisitions,
  getAcquisitionsForCell,
  type Sentinel1AcquisitionRecord,
} from "./sentinel-acquisition.service";
import {
  createInSarProcessingJob,
  getJobStatus,
  executeJobPipeline,
  deriveTemporalTrend,
  filterObservationsBeforeCutoff,
  getTimeseriesForCell,
  saveTimeseriesForCell,
  type InSarTimeseriesPoint,
} from "./insar-processor.service";
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

    expect(gangtokAssessment.associated_cell_id).not.toBe(dibrugarhAssessment.associated_cell_id);
    expect(gangtokAssessment.associated_cell_id).not.toBe(shillongAssessment.associated_cell_id);

    expect(gangtokAssessment.deformation.status).toBe("AVAILABLE");
    expect(gangtokAssessment.deformation.los_velocity_mean_mm_year).toBe(-14.2);
    expect(gangtokAssessment.deformation.sensor).toBe("Sentinel-1 C-SAR");
    expect(gangtokAssessment.deformation.quality).toBe("HIGH");

    expect(dibrugarhAssessment.deformation.status).toBe("UNAVAILABLE");
    expect(dibrugarhAssessment.deformation.los_velocity_mean_mm_year).toBeNull();
    expect(dibrugarhAssessment.deformation.unavailable_reason).toBe("PENDING_SAR_INTERFEROMETRIC_PROCESSING");

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
    expect(CANONICAL_FEATURES.length).toBe(19);
    expect(CANONICAL_FEATURES).not.toContain("satellite_deformation");
    expect(CANONICAL_FEATURES).not.toContain("insar_velocity");
    expect(CANONICAL_FEATURES).not.toContain("sar_displacement");

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

  it("10: Searches Sentinel-1 acquisitions via spatial bounding box and filters correctly", async () => {
    // Search around Sikkim bbox [88.0, 27.0, 89.0, 28.0]
    const acqs = await searchSentinel1Acquisitions({
      bbox: [88.0, 27.0, 89.0, 28.0],
      productType: "SLC",
    });

    expect(acqs.length).toBeGreaterThan(0);
    const first = acqs[0];
    expect(first.satellite).toMatch(/Sentinel-1[A-C]/);
    expect(first.sensor).toBe("C-SAR");
    expect(first.mode).toBe("IW");
    expect(first.product_type).toBe("SLC");
    expect(first.sensing_start).toBeDefined();
    expect(first.footprint_geojson).toBeDefined();
  });

  it("11: Ingestion prevents duplicate Sentinel-1 scene records (idempotent)", async () => {
    const customScene: Sentinel1AcquisitionRecord = {
      scene_id: "S1A_IW_SLC__CUSTOM_TEST_0001",
      satellite: "Sentinel-1A",
      sensor: "C-SAR",
      mode: "IW",
      polarization: "VV+VH",
      product_type: "SLC",
      orbit_direction: "DESCENDING",
      relative_orbit: 121,
      sensing_start: "2025-05-01T00:00:00Z",
      sensing_stop: "2025-05-01T00:00:27Z",
      footprint_geojson: { type: "Polygon", coordinates: [[[88.5, 27.0], [89.0, 27.0], [89.0, 27.5], [88.5, 27.5], [88.5, 27.0]]] },
      download_url: null,
      checksum_sha256: "testchecksum12345",
      source: "Copernicus STAC",
    };

    // First ingestion should insert
    const res1 = await ingestAcquisitions([customScene]);
    expect(res1.inserted).toBe(1);
    expect(res1.duplicatesSkipped).toBe(0);

    // Second ingestion should identify duplicate and skip
    const res2 = await ingestAcquisitions([customScene]);
    expect(res2.inserted).toBe(0);
    expect(res2.duplicatesSkipped).toBe(1);
  });

  it("12: Creates and executes asynchronous InSAR processing jobs with lifecycle stages", async () => {
    const job = await createInSarProcessingJob("cell-27.25-88.50");
    expect(job.id).toMatch(/^job-/);
    expect(job.status).toBe("QUEUED");
    expect(job.progress_pct).toBe(0);

    // Poll status immediately
    const polledJob = await getJobStatus(job.id);
    expect(polledJob).not.toBeNull();
    expect(polledJob?.status).toBe("QUEUED");

    // Execute job through pipeline stages
    const executedJob = await executeJobPipeline(job.id);
    expect(executedJob.status).toBe("COMPLETED");
    expect(executedJob.progress_pct).toBe(100);
    expect(executedJob.worker_id).toBeDefined();
    expect(executedJob.completed_at).toBeDefined();
  });

  it("13: Accurately derives temporal trends and rates from multi-temporal InSAR displacement points", () => {
    // A. Stable points (|v| < 2.0 mm/yr)
    const stablePoints: InSarTimeseriesPoint[] = [
      { observation_date: "2024-01-01", displacement_mm: 0.0, coherence: 0.70, is_outlier: false },
      { observation_date: "2024-07-01", displacement_mm: -0.5, coherence: 0.68, is_outlier: false },
      { observation_date: "2025-01-01", displacement_mm: -1.0, coherence: 0.72, is_outlier: false },
    ];
    const stableResult = deriveTemporalTrend(stablePoints);
    expect(stableResult.trend).toBe("STABLE");
    expect(stableResult.quality).toBe("HIGH");

    // B. Increasing deformation (active subsidence / movement away: v <= -5.0 mm/yr)
    const activePoints: InSarTimeseriesPoint[] = [
      { observation_date: "2024-01-01", displacement_mm: 0.0, coherence: 0.65, is_outlier: false },
      { observation_date: "2024-06-01", displacement_mm: -8.0, coherence: 0.62, is_outlier: false },
      { observation_date: "2025-01-01", displacement_mm: -18.0, coherence: 0.60, is_outlier: false },
    ];
    const activeResult = deriveTemporalTrend(activePoints);
    expect(activeResult.trend).toBe("INCREASING_DEFORMATION");
    expect(activeResult.meanVelocityMmYear).toBeLessThan(-10);

    // C. Insufficient points (< 3)
    const fewPoints: InSarTimeseriesPoint[] = [
      { observation_date: "2024-01-01", displacement_mm: 0.0, coherence: 0.70, is_outlier: false },
      { observation_date: "2024-07-01", displacement_mm: -2.0, coherence: 0.68, is_outlier: false },
    ];
    const insufficientResult = deriveTemporalTrend(fewPoints);
    expect(insufficientResult.trend).toBe("INSUFFICIENT_DATA");
    expect(insufficientResult.meanVelocityMmYear).toBeNull();
  });

  it("14: Quality filtering rejects low coherence (< 0.40) or dense canopy decorrelation", () => {
    const decorrelatedPoints: InSarTimeseriesPoint[] = [
      { observation_date: "2024-01-01", displacement_mm: 0.0, coherence: 0.25, is_outlier: false },
      { observation_date: "2024-07-01", displacement_mm: -4.0, coherence: 0.30, is_outlier: false },
      { observation_date: "2025-01-01", displacement_mm: -8.0, coherence: 0.28, is_outlier: false },
    ];
    const result = deriveTemporalTrend(decorrelatedPoints);
    expect(result.trend).toBe("INSUFFICIENT_DATA");
    expect(result.quality).toBe("UNAVAILABLE");
    expect(result.meanVelocityMmYear).toBeNull();
  });

  it("15: Enforces temporal data leakage protection (t_observation <= t_event_cutoff)", () => {
    const timeseries: InSarTimeseriesPoint[] = [
      { observation_date: "2024-01-10", displacement_mm: -1.2, coherence: 0.7, is_outlier: false },
      { observation_date: "2024-06-15", displacement_mm: -4.5, coherence: 0.7, is_outlier: false },
      { observation_date: "2024-11-20", displacement_mm: -8.1, coherence: 0.7, is_outlier: false },
      { observation_date: "2025-05-30", displacement_mm: -14.0, coherence: 0.7, is_outlier: false }, // Future point
    ];

    const cutoffDate = "2024-12-01";
    const filtered = filterObservationsBeforeCutoff(timeseries, cutoffDate);

    expect(filtered.length).toBe(3);
    for (const point of filtered) {
      expect(new Date(point.observation_date).getTime()).toBeLessThanOrEqual(new Date(cutoffDate).getTime());
    }
  });

  it("16: REST API /api/satellite/coverage returns regional coverage metrics", async () => {
    const req = new Request("http://localhost:3000/api/satellite/coverage", { method: "GET" });
    const res = await handleApiRequest(req);
    expect(res?.status).toBe(200);
    const data = await res?.json();
    expect(data.status).toBe("success");
    expect(data.coverage).toBeDefined();
    expect(data.coverage.total_monitored_cells).toBeGreaterThan(0);
    expect(data.coverage.active_insar_cells).toBeGreaterThan(0);
  });

  it("17: REST API /api/satellite/acquisitions handles bbox queries", async () => {
    const req = new Request("http://localhost:3000/api/satellite/acquisitions?bbox=88.0,27.0,89.0,28.0", {
      method: "GET",
    });
    const res = await handleApiRequest(req);
    expect(res?.status).toBe(200);
    const data = await res?.json();
    expect(data.status).toBe("success");
    expect(Array.isArray(data.acquisitions)).toBe(true);
    expect(data.acquisitions.length).toBeGreaterThan(0);
  });

  it("18: REST API /api/satellite/jobs creates async job with 202 and returns job status via GET", async () => {
    // Create job via POST
    const postReq = new Request("http://localhost:3000/api/satellite/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cellId: "cell-27.25-88.50" }),
    });
    const postRes = await handleApiRequest(postReq);
    expect(postRes?.status).toBe(202);
    const postData = await postRes?.json();
    expect(postData.status).toBe("accepted");
    expect(postData.job.id).toBeDefined();

    // Query job via GET
    const getReq = new Request(`http://localhost:3000/api/satellite/jobs?jobId=${postData.job.id}`, {
      method: "GET",
    });
    const getRes = await handleApiRequest(getReq);
    expect(getRes?.status).toBe(200);
    const getData = await getRes?.json();
    expect(getData.status).toBe("success");
    expect(getData.job.id).toBe(postData.job.id);
  });

  it("19: REST API /api/satellite/timeseries retrieves multi-temporal epochs and derived trend", async () => {
    const req = new Request("http://localhost:3000/api/satellite/timeseries?cellId=cell-27.25-88.50", {
      method: "GET",
    });
    const res = await handleApiRequest(req);
    expect(res?.status).toBe(200);
    const data = await res?.json();
    expect(data.status).toBe("success");
    expect(data.cell_id).toBe("cell-27.25-88.50");
    expect(Array.isArray(data.timeseries)).toBe(true);
    expect(data.timeseries.length).toBeGreaterThanOrEqual(3);
    expect(data.analysis.trend).toBe("INCREASING_DEFORMATION");
    expect(data.mean_velocity_mm_year).toBeLessThan(-5);
  });
});
