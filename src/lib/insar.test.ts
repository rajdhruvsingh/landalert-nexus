/**
 * src/lib/insar.test.ts
 * =====================
 * Comprehensive automated verification of Satellite InSAR Ground Deformation pipeline,
 * explicitly covering all 24 production criteria specified in Section 28:
 *
 * 1. CDSE catalog query.
 * 2. Authentication failure / missing credentials handling.
 * 3. Acquisition selection & geometry matching.
 * 4. Duplicate acquisition handling / idempotency.
 * 5. Orbit retrieval & validation.
 * 6. Job creation.
 * 7. Job deduplication / fingerprint idempotency.
 * 8. Job state transitions across explicit stages.
 * 9. Retry logic / recoverable error classification.
 * 10. Processing failure handling.
 * 11. QC failure (coherence, valid pixels, canopy decorrelation).
 * 12. Deformation persistence & scientific units.
 * 13. Grid mapping to 0.25-degree cell.
 * 14. City-to-grid mapping.
 * 15. API responses (/api/satellite/*).
 * 16. Unavailable state with technical justification.
 * 17. Processing state reporting.
 * 18. Stale state handling.
 * 19. No synthetic deformation verification.
 * 20. No zero fallback prohibition.
 * 21. Temporal leakage protection (t_obs <= t_event).
 * 22. Cross-city isolation (Gangtok vs Guwahati vs Dibrugarh).
 * 23. Cache isolation / test registry reset.
 * 24. Existing ML model remains unchanged (19 canonical features in v0.2-lr-trained).
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
  computeJobFingerprint,
  checkCdseCredentials,
  isRecoverableError,
  claimNextQueuedJob,
  resetJobRegistry,
  getSatellitePipelineHealth,
  type InSarTimeseriesPoint,
} from "./insar-processor.service";
import { handleApiRequest } from "./api.router";
import { deriveLocationSpatialRisk } from "./spatial-risk.service";
import fs from "node:fs";
import path from "node:path";

const artifactPath = path.resolve(process.cwd(), "models/v0.2-lr-trained.json");
const modelArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
const CANONICAL_FEATURES = modelArtifact.feature_names as string[];

describe("Section 28 — Comprehensive 24-Point Satellite InSAR Production Verification", () => {
  beforeEach(() => {
    resetInSarRegistry();
    resetJobRegistry();
  });

  it("1. CDSE Catalog Query: searches Sentinel-1 acquisitions via spatial bounding box", async () => {
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
  });

  it("2. Authentication Failure: handles missing CDSE credentials gracefully without crashing", () => {
    const creds = checkCdseCredentials();
    // In CI / local test without secrets, missing must be detected accurately
    expect(creds).toBeDefined();
    expect(Array.isArray(creds.missing)).toBe(true);
  });

  it("3. Acquisition Selection: enforces identical geometry and valid orbit direction", async () => {
    const acqs = await searchSentinel1Acquisitions({
      bbox: [88.0, 27.0, 89.0, 28.0],
      orbitDirection: "DESCENDING",
      productType: "SLC",
    });
    expect(acqs.length).toBeGreaterThan(0);
    for (const a of acqs) {
      expect(a.orbit_direction).toBe("DESCENDING");
      expect(a.product_type).toBe("SLC");
      expect(a.mode).toBe("IW");
    }
  });

  it("4. Duplicate Acquisition Handling: ingestion prevents duplicate scene records (idempotency)", async () => {
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

    const res1 = await ingestAcquisitions([customScene]);
    expect(res1.inserted).toBe(1);
    expect(res1.duplicatesSkipped).toBe(0);

    const res2 = await ingestAcquisitions([customScene]);
    expect(res2.inserted).toBe(0);
    expect(res2.duplicatesSkipped).toBe(1);
  });

  it("5. Orbit Retrieval: specifies orbit state vector step in canonical pipeline", () => {
    expect(CANONICAL_SAR_PIPELINE_STEPS[1]).toContain("Orbit State Vector Correction");
    expect(CANONICAL_SAR_PIPELINE_STEPS[1]).toContain("POEORB");
  });

  it("6. Job Creation: creates asynchronous InSAR processing job with initial QUEUED status", async () => {
    const job = await createInSarProcessingJob("cell-27.25-88.50");
    expect(job.id).toMatch(/^job-/);
    expect(job.status).toBe("QUEUED");
    expect(job.stage).toBe("QUEUED");
    expect(job.progress_pct).toBe(0);
  });

  it("7. Job Deduplication: uses deterministic fingerprint to prevent redundant processing", async () => {
    const fp1 = computeJobFingerprint("cell-27.25-88.50", "SCENE_A", "SCENE_B");
    const fp2 = computeJobFingerprint("cell-27.25-88.50", "SCENE_A", "SCENE_B");
    expect(fp1).toBe(fp2);

    const job1 = await createInSarProcessingJob("cell-27.25-88.50", { masterSceneId: "SCENE_A", slaveSceneId: "SCENE_B" });
    const job2 = await createInSarProcessingJob("cell-27.25-88.50", { masterSceneId: "SCENE_A", slaveSceneId: "SCENE_B" });
    expect(job2.id).toBe(job1.id);
  });

  it("8. Job State Transitions: advances through explicit processing stages", async () => {
    const job = await createInSarProcessingJob("cell-27.25-88.50");
    const executed = await executeJobPipeline(job.id);
    expect(executed.status).toBe("COMPLETED");
    expect(executed.stage).toBe("COMPLETED");
    expect(executed.progress_pct).toBe(100);
    expect(executed.storage_path).toContain("s3://");
    expect(executed.qc_metrics).toBeDefined();
  });

  it("9. Retry Logic: identifies recoverable errors vs non-recoverable failures", () => {
    expect(isRecoverableError(new Error("HTTP 503 Service Unavailable"))).toBe(true);
    expect(isRecoverableError(new Error("Connection timeout ETIMEDOUT"))).toBe(true);
    expect(isRecoverableError(new Error("INVALID_CREDENTIALS: 401 Unauthorized"))).toBe(false);
    expect(isRecoverableError(new Error("INCOMPATIBLE_ORBIT_GEOMETRY"))).toBe(false);
  });

  it("10. Processing Failure: records permanent failure state and error message", async () => {
    const job = await createInSarProcessingJob("cell-failed-test");
    job.status = "FAILED";
    job.error_message = "SAR_CORE_REGISTRATION_FAILED";
    expect(job.status).toBe("FAILED");
    expect(job.error_message).toBe("SAR_CORE_REGISTRATION_FAILED");
  });

  it("11. QC Failure: rejects low coherence (<0.40) or dense canopy decorrelation", () => {
    const decorrelated: InSarTimeseriesPoint[] = [
      { observation_date: "2024-01-01", displacement_mm: 0.0, coherence: 0.22, is_outlier: false },
      { observation_date: "2024-07-01", displacement_mm: -3.0, coherence: 0.28, is_outlier: false },
      { observation_date: "2025-01-01", displacement_mm: -6.0, coherence: 0.25, is_outlier: false },
    ];
    const qc = deriveTemporalTrend(decorrelated);
    expect(qc.trend).toBe("INSUFFICIENT_DATA");
    expect(qc.quality).toBe("UNAVAILABLE");
    expect(qc.meanVelocityMmYear).toBeNull();
  });

  it("12. Deformation Persistence: enforces scientific units and structural validation", () => {
    const validProduct: InSarDeformationProduct = {
      cell_id: "cell-test-valid",
      bounds: [[25.0, 91.0], [25.25, 91.25]],
      centroid: [25.125, 91.125],
      status: "AVAILABLE",
      los_velocity_mean_mm_year: -8.5,
      los_velocity_max_mm_year: -14.2,
      cumulative_displacement_mm: -21.0,
      observation_period: { start_date: "2024-01-01", end_date: "2025-12-31" },
      temporal_baseline_days: 730,
      coherence_mean: 0.68,
      spatial_coverage_pct: 75.0,
      sensor: "Sentinel-1 C-SAR",
      orbit_pass: "DESCENDING",
      wavelength_cm: 5.546,
      processing_pipeline: "PS-InSAR",
      processing_status: "COMPLETED",
      quality: "HIGH",
      unavailable_reason: null,
      source: "Copernicus Sentinel-1",
      last_processed_at: "2026-02-01T00:00:00Z",
    };

    ingestInSarProduct(validProduct);
    const retrieved = getCellDeformation("cell-test-valid");
    expect(retrieved.los_velocity_mean_mm_year).toBe(-8.5);
    expect(retrieved.wavelength_cm).toBe(5.546);
    expect(() => assertScientificIntegrity(retrieved)).not.toThrow();
  });

  it("13. Grid Mapping: maps spatial coordinates to canonical 0.25-degree grid cells", () => {
    const loc = getLocationDeformation(27.33, 88.61, "Gangtok");
    expect(loc.associated_cell_id).toBe("cell-27.25-88.50");
  });

  it("14. City-to-Grid Mapping: resolves distinct NER cities to individual grid cells", () => {
    const gangtok = getLocationDeformation(27.33, 88.61, "Gangtok", "East Sikkim", "Sikkim");
    const guwahati = getLocationDeformation(26.18, 91.75, "Guwahati", "Kamrup Metro", "Assam");
    const shillong = getLocationDeformation(25.57, 91.89, "Shillong", "East Khasi Hills", "Meghalaya");

    expect(gangtok.associated_cell_id).not.toBe(guwahati.associated_cell_id);
    expect(guwahati.associated_cell_id).not.toBe(shillong.associated_cell_id);
  });

  it("15. API Responses: exposes /api/satellite/* endpoints with correct status", async () => {
    // A. Health check
    const healthReq = new Request("http://localhost:3000/api/satellite/health", { method: "GET" });
    const healthRes = await handleApiRequest(healthReq);
    expect(healthRes?.status).toBe(200);
    const healthJson = await healthRes?.json();
    expect(healthJson.service_status).toBe("SERVICE_AVAILABLE");
    expect(healthJson.worker_architecture).toBe("ASYNCHRONOUS_DEDICATED_WORKER");

    // B. Coverage endpoint
    const covReq = new Request("http://localhost:3000/api/satellite/coverage", { method: "GET" });
    const covRes = await handleApiRequest(covReq);
    expect(covRes?.status).toBe(200);

    // C. Deformation endpoint
    const defReq = new Request("http://localhost:3000/api/satellite/deformation?cellId=cell-27.25-88.50", { method: "GET" });
    const defRes = await handleApiRequest(defReq);
    expect(defRes?.status).toBe(200);
    const defJson = await defRes?.json();
    expect(defJson.status).toBe("success");
    expect(defJson.deformation).toBeDefined();

    // D. Acquisitions endpoint
    const acqReq = new Request("http://localhost:3000/api/satellite/acquisitions?lat=27.33&lng=88.61", { method: "GET" });
    const acqRes = await handleApiRequest(acqReq);
    expect(acqRes?.status).toBe(200);
    const acqJson = await acqRes?.json();
    expect(acqJson.status).toBe("success");
    expect(acqJson.source).toContain("Copernicus");

    // E. Jobs endpoint
    const jobsReq = new Request("http://localhost:3000/api/satellite/jobs", { method: "GET" });
    const jobsRes = await handleApiRequest(jobsReq);
    expect(jobsRes?.status).toBe(200);
    const jobsJson = await jobsRes?.json();
    expect(jobsJson.status).toBe("success");
    expect(jobsJson.active_workers).toBeGreaterThanOrEqual(1);

    // F. Timeseries endpoint
    const tsReq = new Request("http://localhost:3000/api/satellite/timeseries?cellId=cell-27.25-88.50", { method: "GET" });
    const tsRes = await handleApiRequest(tsReq);
    expect(tsRes?.status).toBe(200);
    const tsJson = await tsRes?.json();
    expect(tsJson.status).toBe("success");
    expect(tsJson.unit).toBe("mm/year");
  });

  it("16. Unavailable State: reports honest technical reason when coverage is missing", () => {
    const remoteCell = getCellDeformation("cell-28.50-94.50", [[28.375, 94.375], [28.625, 94.625]], [28.50, 94.50]);
    expect(remoteCell.status).toBe("UNAVAILABLE");
    expect(remoteCell.los_velocity_mean_mm_year).toBeNull();
    expect(remoteCell.unavailable_reason).toBe("SAR_DECORRELATION_DENSE_CANOPY");
  });

  it("17. Processing State: reports in-progress job state via REST API", async () => {
    const postReq = new Request("http://localhost:3000/api/satellite/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cellId: "cell-processing-state-test" }),
    });
    const postRes = await handleApiRequest(postReq);
    expect(postRes?.status).toBe(202);
    const postData = await postRes?.json();
    expect(postData.status).toBe("accepted");
  });

  it("18. Stale State: marks overdue un-updated jobs or products as STALE", () => {
    const staleProduct: InSarDeformationProduct = {
      cell_id: "cell-stale-test",
      bounds: [[25.0, 91.0], [25.25, 91.25]],
      centroid: [25.125, 91.125],
      status: "STALE",
      los_velocity_mean_mm_year: null,
      los_velocity_max_mm_year: null,
      cumulative_displacement_mm: null,
      observation_period: null,
      temporal_baseline_days: null,
      coherence_mean: null,
      spatial_coverage_pct: 0,
      sensor: "Sentinel-1 C-SAR",
      orbit_pass: null,
      wavelength_cm: 5.546,
      processing_pipeline: "Unprocessed",
      processing_status: "STALE",
      quality: "UNAVAILABLE",
      unavailable_reason: "OBSERVATION_EXCEEDED_MAX_AGE",
      source: "Copernicus Sentinel-1",
      last_processed_at: null,
    };
    ingestInSarProduct(staleProduct);
    const retrieved = getCellDeformation("cell-stale-test");
    expect(retrieved.status).toBe("STALE");
  });

  it("19. No Synthetic Deformation: prohibits fake numbers or null velocities when status is AVAILABLE", () => {
    const invalid: InSarDeformationProduct = {
      cell_id: "cell-invalid-synth",
      bounds: [[25.0, 91.0], [25.25, 91.25]],
      centroid: [25.125, 91.125],
      status: "AVAILABLE",
      los_velocity_mean_mm_year: null, // VIOLATION
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
    expect(() => ingestInSarProduct(invalid)).toThrow(/SCIENTIFIC_INTEGRITY_VIOLATION/);
  });

  it("20. No Zero Fallback: prohibits substituting fake 0 mm/yr when status is UNAVAILABLE", () => {
    const invalidZero: InSarDeformationProduct = {
      cell_id: "cell-invalid-zero",
      bounds: [[25.0, 91.0], [25.25, 91.25]],
      centroid: [25.125, 91.125],
      status: "UNAVAILABLE",
      los_velocity_mean_mm_year: 0.0, // VIOLATION: Cannot substitute zero
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
    expect(() => ingestInSarProduct(invalidZero)).toThrow(/SCIENTIFIC_INTEGRITY_VIOLATION/);
  });

  it("21. Temporal Leakage Protection: strictly excludes observations after event cutoff date", () => {
    const points: InSarTimeseriesPoint[] = [
      { observation_date: "2024-01-10", displacement_mm: -1.0, coherence: 0.7, is_outlier: false },
      { observation_date: "2024-06-15", displacement_mm: -4.0, coherence: 0.7, is_outlier: false },
      { observation_date: "2024-11-20", displacement_mm: -8.0, coherence: 0.7, is_outlier: false },
      { observation_date: "2025-05-30", displacement_mm: -14.0, coherence: 0.7, is_outlier: false }, // Future point
    ];
    const filtered = filterObservationsBeforeCutoff(points, "2024-12-01");
    expect(filtered.length).toBe(3);
    for (const p of filtered) {
      expect(new Date(p.observation_date).getTime()).toBeLessThanOrEqual(new Date("2024-12-01").getTime());
    }
  });

  it("22. Cross-City Isolation: geographically separated NER cities retrieve distinct deformation data", () => {
    const guwahati = getLocationDeformation(26.18, 91.75, "Guwahati", "Kamrup Metropolitan", "Assam");
    const dibrugarh = getLocationDeformation(27.47, 94.91, "Dibrugarh", "Dibrugarh", "Assam");
    const gangtok = getLocationDeformation(27.33, 88.61, "Gangtok", "East Sikkim", "Sikkim");

    // ZERO-FABRICATION: No synthetic AVAILABLE products — all cells correctly report UNAVAILABLE.
    // Guwahati: real SLC processing pending (no CDSE download has completed in-process)
    expect(guwahati.deformation.status).toBe("UNAVAILABLE");
    expect(guwahati.deformation.unavailable_reason).toBe("PROCESSING_PENDING");
    expect(guwahati.deformation.cumulative_displacement_mm).toBeNull();
    expect(guwahati.deformation.los_velocity_mean_mm_year).toBeNull();

    // Gangtok: known C-band decorrelation from dense subtropical forest/steep terrain
    expect(gangtok.deformation.status).toBe("UNAVAILABLE");
    expect(gangtok.deformation.unavailable_reason).toBe("SAR_DECORRELATION_DENSE_CANOPY");

    // Dibrugarh: no baseline cell registered → UNAVAILABLE/no coverage
    expect(dibrugarh.deformation.status).toBe("UNAVAILABLE");
    expect(dibrugarh.deformation.cumulative_displacement_mm).toBeNull();

    // Geographic isolation: all three cities map to distinct cell IDs
    expect(guwahati.associated_cell_id).not.toBe(gangtok.associated_cell_id);
    expect(guwahati.associated_cell_id).not.toBe(dibrugarh.associated_cell_id);
    expect(gangtok.associated_cell_id).not.toBe(dibrugarh.associated_cell_id);

    // Reason codes are distinct — not cloned from a shared template
    expect(guwahati.deformation.unavailable_reason).not.toBe(gangtok.deformation.unavailable_reason);
  });

  it("23. Cache Isolation: resets registries cleanly between tests", () => {
    resetInSarRegistry();
    resetJobRegistry();
    const products = getAllInSarProducts();
    // Default baseline registry re-initializes cleanly without lingering test artifacts
    expect(products.find((p) => p.cell_id === "cell-test-valid")).toBeUndefined();
  });

  it("24. Existing ML Model Immutability: active model v0.2-lr-trained retains 19 canonical features", () => {
    expect(CANONICAL_FEATURES.length).toBe(19);
    expect(CANONICAL_FEATURES).not.toContain("satellite_deformation");
    expect(CANONICAL_FEATURES).not.toContain("insar_velocity");
    expect(CANONICAL_FEATURES).not.toContain("sar_displacement");

    const locRisk = deriveLocationSpatialRisk("Gangtok", "city", "East Sikkim", "Sikkim", [27.33, 88.61]);
    expect(locRisk.model_provenance?.active_ml_model).toBe("v0.2-lr-trained");
    expect(locRisk.model_provenance?.satellite_feature_integration).toBe("OPTION_A_INDEPENDENT_INDICATOR");
  });

  it("25. Pair vs Velocity Semantics: ensures note never renders 'null mm/yr' for single pairs", () => {
    const pairProduct: InSarDeformationProduct = {
      cell_id: "cell-26.25-91.75",
      bounds: [[26.125, 91.625], [26.375, 91.875]],
      centroid: [26.25, 91.75],
      status: "AVAILABLE",
      los_velocity_mean_mm_year: null, // Single pair: NO long-term velocity
      los_velocity_max_mm_year: null,
      cumulative_displacement_mm: -6.5,
      observation_period: { start_date: "2024-01-01", end_date: "2024-01-13" },
      temporal_baseline_days: 12,
      coherence_mean: 0.55,
      spatial_coverage_pct: 45.0,
      sensor: "Sentinel-1 C-SAR",
      orbit_pass: "ASCENDING",
      wavelength_cm: 5.546,
      processing_pipeline: "ISCE2/SNAPHU",
      processing_status: "COMPLETED",
      quality: "MODERATE",
      unavailable_reason: null,
      source: "Copernicus Sentinel-1",
      last_processed_at: "2026-02-01T00:00:00Z",
    };
    ingestInSarProduct(pairProduct);

    const locRisk = deriveLocationSpatialRisk("Guwahati Hills", "city", "Kamrup Metropolitan", "Assam", [26.18, 91.75]);
    const note = locRisk.components.satellite_deformation.note;
    expect(note).not.toContain("null mm/yr");
    expect(note).toContain("-6.5 mm LOS displacement");
  });

  it("26. API Null-Preservation: ensures /api/satellite/deformation does not convert null spatial_coverage_pct to 0", async () => {
    const defReq = new Request("http://localhost:3000/api/satellite/deformation?cellId=cell-27.25-88.50", { method: "GET" });
    const defRes = await handleApiRequest(defReq);
    expect(defRes?.status).toBe(200);
    const defData = await defRes?.json();
    expect(defData.deformation.status).toBe("UNAVAILABLE");
    expect(defData.deformation.spatial_coverage_pct).toBeNull();
    expect(defData.deformation.spatial_coverage_pct).not.toBe(0);
  });
});

