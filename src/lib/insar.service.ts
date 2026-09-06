/**
 * src/lib/insar.service.ts
 * ========================
 * Satellite InSAR (Interferometric Synthetic Aperture Radar) Ground Deformation Service.
 *
 * Scientific & Architectural Principles:
 * 1. SCIENTIFIC INTEGRITY & ZERO-FABRICATION RULE:
 *    - Never substitute "0 mm/year" or random values for unmonitored or uncalculated cells.
 *    - If InSAR processing has not been executed or phase decorrelation occurs (e.g. dense jungle canopy),
 *      explicitly report status="UNAVAILABLE" with the exact technical cause.
 *
 * 2. DISTINCTION OF OBSERVATIONAL TIERS:
 *    - Optical Imagery (Sentinel-2 True Color): Visual basemap context only.
 *    - Optical Vegetation Index (Sentinel-2 NDVI): Canopy chlorophyll proxy.
 *    - SAR Observations (Sentinel-1 Single Look Complex / GRD): Amplitude/backscatter radar.
 *    - InSAR Ground Deformation (Sentinel-1 Interferometry): Millimetric phase-derived displacement/velocity.
 *
 * 3. ML MODEL INTEGRATION (OPTION A — INDEPENDENT INDICATOR):
 *    - Production ML model (v0.2-lr-trained, schema v1.0.0) was trained on 19 canonical hydrometeorological
 *      and topographic features without satellite deformation.
 *    - InSAR deformation is exposed as an INDEPENDENT observational risk indicator.
 *    - We strictly avoid injecting an uncalibrated deformation feature into v0.2-lr-trained weights.
 *
 * 4. CANONICAL SAR PROCESSING PIPELINE:
 *    SAR acquisition (Copernicus Sentinel-1 C-SAR / NISAR L-SAR)
 *    → Preprocessing (Precise Orbit Ephemerides applied)
 *    → Co-registration (ESD sub-pixel alignment)
 *    → Interferogram Generation (Complex conjugate multiplication)
 *    → Topographic Phase Removal (DEM simulation via Survey of India / SRTM 30m)
 *    → Phase Unwrapping (SNAPHU minimum cost flow)
 *    → Atmospheric Correction (GACOS / ERA5 weather reanalysis)
 *    → Geocoding (SAR Doppler range-Doppler projection to WGS84)
 *    → Displacement & Velocity Estimation (PS-InSAR / SBAS time series)
 *    → Spatial Grid Aggregation (Zonal statistics over cell bounds)
 *    → Risk Engine (Option A: Independent indicator alongside v0.2-lr-trained)
 */

import { haversineDistanceKm } from "./geography";

export type InSarProcessingStatus =
  | "COMPLETED"
  | "PENDING_PIPELINE"
  | "PROCESSING_PENDING"
  | "DECORRELATED"
  | "UNAVAILABLE"
  | "STALE";

export type InSarQuality = "HIGH" | "MODERATE" | "LOW" | "UNAVAILABLE";

export type InSarTemporalTrend =
  | "STABLE"
  | "NO_CLEAR_TREND"
  | "INCREASING_DEFORMATION"
  | "DECREASING_DEFORMATION"
  | "INSUFFICIENT_DATA";

export type InSarUnavailableReason =
  | "PENDING_SAR_INTERFEROMETRIC_PROCESSING"
  | "SAR_DECORRELATION_DENSE_CANOPY"
  | "INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS"
  | "ATMOSPHERIC_PHASE_CONTAMINATION"
  | "NO_CONVERGENT_ORBIT_PASS"
  | "MISSING_COPERNICUS_SLC_DATA"
  | "OUTSIDE_PRIMARY_RADAR_FOOTPRINT"
  | "PROCESSING_PENDING";

export interface InSarDeformationProduct {
  cell_id: string;
  bounds: [[number, number], [number, number]]; // [[south, west], [north, east]]
  centroid: [number, number]; // [lat, lng]
  status: "AVAILABLE" | "UNAVAILABLE" | "PROCESSING" | "FAILED" | "STALE";
  measurement_type: "LOS_DEFORMATION_VELOCITY" | "PAIR_DISPLACEMENT";
  unit: "mm/year" | "mm";
  los_velocity_mean_mm_year: number | null; // Negative = subsidence/movement away from satellite (LOS)
  los_velocity_max_mm_year: number | null;
  cumulative_displacement_mm: number | null;
  temporal_trend: InSarTemporalTrend;
  observation_period: {
    start_date: string; // YYYY-MM-DD
    end_date: string;   // YYYY-MM-DD
  } | null;
  temporal_baseline_days: number | null;
  coherence_mean: number | null; // 0.0 to 1.0
  spatial_coverage_pct: number | null; // Percentage of cell with valid interferometric phase pixels (null when UNAVAILABLE)
  sensor: string; // e.g., "Sentinel-1 C-SAR" or "NISAR L-SAR"
  orbit_pass: "ASCENDING" | "DESCENDING" | "COMBINED" | null;
  wavelength_cm: number; // 5.546 cm for C-band Sentinel-1
  processing_pipeline: string;
  processing_status: InSarProcessingStatus;
  quality: InSarQuality;
  unavailable_reason: InSarUnavailableReason | string | null;
  source: string;
  last_processed_at: string | null;
  processing_job_id?: string | null;
}

export interface CityDeformationAssessment {
  city_id: string;
  city_name: string;
  district: string;
  state: string;
  coordinates: [number, number];
  associated_cell_id: string;
  deformation: InSarDeformationProduct;
  aggregation_method: "POINT_IN_POLYGON" | "CENTROID_NEAREST_NEIGHBOR" | "IDW_MULTI_CELL";
  risk_engine_integration: {
    mode: "OPTION_A_INDEPENDENT_INDICATOR";
    incorporated_in_ml_weights: false;
    ml_model_version: string;
    ml_feature_schema_version: string;
    satellite_feature_version: string;
    inference_date: string;
    rationale: string;
  };
}

export const CANONICAL_SAR_PIPELINE_STEPS = [
  "1. SAR Acquisition (Copernicus Sentinel-1 C-SAR IW Mode)",
  "2. Orbit State Vector Correction (ESA Precise Orbit Ephemerides - POEORB)",
  "3. Co-registration & Enhanced Spectral Diversity (ESD)",
  "4. Interferogram Generation & Multi-looking",
  "5. Topographic Phase Flattening (Survey of India DEM / SRTM 1-arcsec)",
  "6. Phase Unwrapping (SNAPHU Statistical-Cost Network-Flow Algorithm)",
  "7. Atmospheric Phase Screen (APS) Removal (GACOS / ERA5)",
  "8. Geocoding & Range-Doppler Terrain Correction to WGS84 EPSG:4326",
  "9. Time-Series InSAR Displacement Analysis (PS-InSAR / SBAS)",
  "10. Spatial Grid Zonal Aggregation across 0.25-degree NER Cells",
];

// In-memory InSAR registry storing validated ground deformation products
const inSarRegistry = new Map<string, InSarDeformationProduct>();

/**
 * Baseline InSAR registry entries for NER monitoring cells.
 *
 * ZERO-FABRICATION POLICY: No synthetic deformation values are pre-populated.
 * All AVAILABLE products must originate exclusively from the real Sentinel-1
 * InSAR worker (workers/insar/worker.py) completing a full 14-stage ISCE2/SNAPHU
 * pipeline against real CDSE SLC acquisitions.
 *
 * UNAVAILABLE cells include a reason code so the API can explain why data is
 * absent rather than serving a fabricated substitute.
 */
const BASELINE_INSAR_DATASETS: InSarDeformationProduct[] = [
  {
    cell_id: "cell-27.25-88.50", // Gangtok, Sikkim (Himalayan steep mountain relief)
    bounds: [[27.125, 88.375], [27.375, 88.625]],
    centroid: [27.25, 88.50],
    status: "UNAVAILABLE",
    measurement_type: "LOS_DEFORMATION_VELOCITY",
    unit: "mm/year",
    los_velocity_mean_mm_year: null, // Cannot be derived from decorrelated phase
    los_velocity_max_mm_year: null,
    cumulative_displacement_mm: null,
    temporal_trend: "INSUFFICIENT_DATA",
    observation_period: null, // No valid interferometric pair processed
    temporal_baseline_days: null,
    coherence_mean: null,
    spatial_coverage_pct: null,
    sensor: "Sentinel-1 C-SAR",
    orbit_pass: "DESCENDING",
    wavelength_cm: 5.546,
    processing_pipeline: "Dedicated InSAR Worker v1.2.0 (ISCE2/SNAPHU)",
    processing_status: "DECORRELATED",
    quality: "UNAVAILABLE",
    unavailable_reason: "SAR_DECORRELATION_DENSE_CANOPY",
    source: "Copernicus Sentinel-1 InSAR Surface Movement Archive",
    last_processed_at: null,
  },
  {
    // ZERO-FABRICATION: Guwahati cell is marked UNAVAILABLE/PROCESSING_PENDING.
    // When the InSAR worker successfully completes a real CDSE SLC pair, it will
    // call ingestInSarProduct() to replace this entry with a real measurement.
    cell_id: "cell-26.25-91.75", // Kamrup Metro / Guwahati Hills (26.18 N, 91.75 E)
    bounds: [[26.125, 91.625], [26.375, 91.875]],
    centroid: [26.25, 91.75],
    status: "UNAVAILABLE",
    measurement_type: "LOS_DEFORMATION_VELOCITY",
    unit: "mm/year",
    los_velocity_mean_mm_year: null,
    los_velocity_max_mm_year: null,
    cumulative_displacement_mm: null,
    temporal_trend: "INSUFFICIENT_DATA",
    observation_period: null,
    temporal_baseline_days: null,
    coherence_mean: null,
    spatial_coverage_pct: null,
    sensor: "Sentinel-1 C-SAR",
    orbit_pass: "ASCENDING",
    wavelength_cm: 5.546,
    processing_pipeline: "Dedicated InSAR Worker v1.2.0 (ISCE2/SNAPHU)",
    processing_status: "PROCESSING_PENDING",
    quality: "UNAVAILABLE",
    unavailable_reason: "PROCESSING_PENDING",
    source: "Copernicus Sentinel-1 InSAR Surface Movement Archive",
    last_processed_at: null,
  },
];

// Initialize registry with validated baseline
function initializeRegistry(): void {
  for (const product of BASELINE_INSAR_DATASETS) {
    inSarRegistry.set(product.cell_id, { ...product });
  }
}
initializeRegistry();

/**
 * Ingests or registers a validated InSAR ground deformation product for a spatial cell.
 */
export function ingestInSarProduct(product: InSarDeformationProduct): void {
  // Scientific Integrity validation: AVAILABLE must have real velocity or displacement and observation period
  if (product.status === "AVAILABLE") {
    if (
      (product.los_velocity_mean_mm_year === null && product.cumulative_displacement_mm === null) ||
      product.observation_period === null
    ) {
      throw new Error(
        "SCIENTIFIC_INTEGRITY_VIOLATION: InSAR product declared AVAILABLE without valid velocity, displacement, or observation period."
      );
    }
    if (product.spatial_coverage_pct !== null && (product.spatial_coverage_pct <= 0 || product.spatial_coverage_pct > 100)) {
      throw new Error(
        "SCIENTIFIC_INTEGRITY_VIOLATION: Invalid spatial_coverage_pct in InSAR product."
      );
    }
    // Single-pair annualization guard
    if (
      product.temporal_baseline_days !== null &&
      product.temporal_baseline_days < 60 &&
      product.los_velocity_mean_mm_year !== null
    ) {
      throw new Error(
        "SCIENTIFIC_INTEGRITY_VIOLATION: Single-pair interferogram (<60d) cannot be annualized into annual deformation velocity."
      );
    }
  } else {
    // UNAVAILABLE must NOT contain fabricated non-null deformation numbers
    if (product.los_velocity_mean_mm_year !== null || product.cumulative_displacement_mm !== null) {
      throw new Error(
        "SCIENTIFIC_INTEGRITY_VIOLATION: InSAR product declared UNAVAILABLE cannot contain non-null deformation metrics."
      );
    }
  }

  inSarRegistry.set(product.cell_id, { ...product });
}

/**
 * Determines the scientifically justified reason why InSAR is unavailable for a cell.
 * E.g., dense tropical rainforest canopy in Arunachal/Meghalaya causes C-band decorrelation.
 */
function deriveUnavailableReason(lat: number, lng: number): InSarUnavailableReason {
  // High-elevation tropical canopy (e.g. Arunachal Pradesh inner ranges) suffers severe C-band decorrelation
  if (lat >= 27.5 && lng >= 93.0) {
    return "SAR_DECORRELATION_DENSE_CANOPY";
  }
  // Default uncomputed state
  return "PENDING_SAR_INTERFEROMETRIC_PROCESSING";
}

/**
 * Retrieves the InSAR deformation product for a spatial grid cell.
 * If no processed InSAR product exists for the cell, returns an honest UNAVAILABLE record.
 * NEVER fabricates a 0 mm/year or dummy value.
 */
export function getCellDeformation(
  cellId: string,
  bounds?: [[number, number], [number, number]],
  centroid?: [number, number]
): InSarDeformationProduct {
  const registered = inSarRegistry.get(cellId);
  if (registered) {
    return { ...registered };
  }

  // Parse centroid from cellId if not provided: cell-LAT-LNG
  let cellCentroid: [number, number] = centroid || [26.0, 92.0];
  if (!centroid && cellId.startsWith("cell-")) {
    const parts = cellId.replace("cell-", "").split("-");
    if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        cellCentroid = [lat, lng];
      }
    }
  }

  const cellBounds: [[number, number], [number, number]] = bounds || [
    [cellCentroid[0] - 0.125, cellCentroid[1] - 0.125],
    [cellCentroid[0] + 0.125, cellCentroid[1] + 0.125],
  ];

  const reason = deriveUnavailableReason(cellCentroid[0], cellCentroid[1]);

  return {
    cell_id: cellId,
    bounds: cellBounds,
    centroid: cellCentroid,
    status: "UNAVAILABLE",
    measurement_type: "LOS_DEFORMATION_VELOCITY",
    unit: "mm/year",
    los_velocity_mean_mm_year: null, // Strictly null - no fake zero
    los_velocity_max_mm_year: null,
    cumulative_displacement_mm: null,
    temporal_trend: "INSUFFICIENT_DATA",
    observation_period: null,
    temporal_baseline_days: null,
    coherence_mean: null,
    spatial_coverage_pct: null,
    sensor: "Sentinel-1 C-SAR",
    orbit_pass: null,
    wavelength_cm: 5.546,
    processing_pipeline: "Copernicus Sentinel-1 InSAR Pipeline (Unprocessed)",
    processing_status: reason === "SAR_DECORRELATION_DENSE_CANOPY" ? "DECORRELATED" : "PENDING_PIPELINE",
    quality: "UNAVAILABLE",
    unavailable_reason: reason,
    source: "Copernicus Sentinel-1 SAR Interface",
    last_processed_at: null,
  };
}

/**
 * Resolves city/locality-level satellite ground deformation assessment.
 * Links city coordinates to its primary intersecting or nearest spatial cell
 * and returns the deformation product along with Option A ML risk engine provenance.
 */
export function getLocationDeformation(
  lat: number,
  lng: number,
  cityName = "NER Location",
  district = "Regional",
  state = "NER"
): CityDeformationAssessment {
  // Find matching cell in registry first if within distance
  let matchedProduct: InSarDeformationProduct | null = null;
  let minDistance = Infinity;
  let nearestCellId = `cell-${lat.toFixed(2)}-${lng.toFixed(2)}`;

  for (const [cellId, prod] of inSarRegistry.entries()) {
    // Check if lat/lng is within bounds
    const [[s, w], [n, e]] = prod.bounds;
    if (lat >= s && lat <= n && lng >= w && lng <= e) {
      matchedProduct = { ...prod };
      nearestCellId = cellId;
      break;
    }

    const d = haversineDistanceKm(lat, lng, prod.centroid[0], prod.centroid[1]);
    if (d < minDistance) {
      minDistance = d;
      if (d <= 25.0) { // Within cell radius
        matchedProduct = { ...prod };
        nearestCellId = cellId;
      }
    }
  }

  // If not matched to an available cell in registry, generate an honest unavailable product
  if (!matchedProduct) {
    matchedProduct = getCellDeformation(nearestCellId, undefined, [lat, lng]);
  }

  return {
    city_id: `city-${lat.toFixed(2)}-${lng.toFixed(2)}`,
    city_name: cityName,
    district,
    state,
    coordinates: [lat, lng],
    associated_cell_id: nearestCellId,
    deformation: matchedProduct,
    aggregation_method: matchedProduct.status === "AVAILABLE" ? "POINT_IN_POLYGON" : "CENTROID_NEAREST_NEIGHBOR",
    risk_engine_integration: {
      mode: "OPTION_A_INDEPENDENT_INDICATOR",
      incorporated_in_ml_weights: false,
      ml_model_version: "v0.2-lr-trained",
      ml_feature_schema_version: "v1.0.0",
      satellite_feature_version: "insar-v1.0-indep",
      inference_date: new Date().toISOString(),
      rationale:
        "Production ML model v0.2-lr-trained was trained on 19 canonical hydrometeorological and topographic features without satellite deformation. Deformation is reported independently to preserve statistical calibration integrity.",
    },
  };
}

/**
 * Returns all currently registered InSAR deformation products.
 */
export function getAllInSarProducts(): InSarDeformationProduct[] {
  return Array.from(inSarRegistry.values());
}

/**
 * Resets the in-memory registry back to the default baseline (used in test isolation).
 */
export function resetInSarRegistry(): void {
  inSarRegistry.clear();
  initializeRegistry();
}

/**
 * Asserts scientific integrity of an InSAR deformation product.
 * Throws if fake zero or ungrounded values are detected.
 */
export function assertScientificIntegrity(product: InSarDeformationProduct): void {
  if (product.status === "UNAVAILABLE") {
    if (product.los_velocity_mean_mm_year !== null || product.cumulative_displacement_mm !== null) {
      throw new Error(
        `Scientific Integrity Violation: cell ${product.cell_id} is UNAVAILABLE but has non-null deformation metrics.`
      );
    }
    if (!product.unavailable_reason) {
      throw new Error(
        `Scientific Integrity Violation: cell ${product.cell_id} is UNAVAILABLE without an explicit limitation reason.`
      );
    }
  } else if (product.status === "AVAILABLE") {
    if (product.los_velocity_mean_mm_year === null && product.cumulative_displacement_mm === null) {
      throw new Error(
        `Scientific Integrity Violation: cell ${product.cell_id} is AVAILABLE but both los_velocity_mean_mm_year and cumulative_displacement_mm are null.`
      );
    }
    if (!product.observation_period) {
      throw new Error(
        `Scientific Integrity Violation: cell ${product.cell_id} is AVAILABLE but observation_period is missing.`
      );
    }
  }
}
