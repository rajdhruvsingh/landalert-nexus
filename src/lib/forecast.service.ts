/**
 * src/lib/forecast.service.ts
 * ===========================
 * Forward-looking short-range weather-linked landslide hazard projection.
 *
 * Implements Task 1:
 * - Ingests 24h, 48h, and 72h precipitation guidance from Open-Meteo Numerical Weather Prediction (NWP).
 * - Applies published, physically grounded threshold formulas from risk.ts:
 *     * Monga & Ganguli (2024/2026): moistureThresholdMm(D) = -11.10 + 0.62 * D(hr)
 *     * Das et al. (2018): intensityThresholdMmPerDay(D) = 43.26 * D^(-0.78)
 * - Computes projected risk levels (Low, Moderate, High, Severe) for 24h, 48h, and 72h lead times.
 * - STRICT SCIENTIFIC BOUNDARY:
 *     Projections represent advisory trend guidance and NEVER overwrite or modify
 *     authoritative current risk levels derived from observed ground sensors and reanalysis.
 *     Forecast confidence degrades with lead time (High at 24h, Medium at 48h, Low at 72h).
 */

import {
  moistureThresholdMm,
  intensityThresholdMmPerDay,
  type RiskLevel,
} from "./risk";

export interface ForecastWindowProjection {
  leadHours: 24 | 48 | 72;
  forecastRainfallMm: number;
  intensityMmPerDay: number;
  intensityThresholdMmPerDay: number;
  moistureThresholdMm: number;
  intensityRatio: number;
  projectedRiskLevel: RiskLevel;
  trend: "improving" | "stable" | "elevating" | "critical";
  confidence: "high" | "medium" | "low";
  confidenceNotes: string;
  narrative: string;
}

export interface ZoneForecastProjection {
  zoneId: number;
  zoneName: string;
  district: string;
  state: string;
  currentRiskLevel: RiskLevel;
  currentRiskScore: number;
  forecastStatus: "AVAILABLE" | "UNAVAILABLE";
  forecastTimestamp: string;
  forecastWindows: {
    "24h": ForecastWindowProjection;
    "48h": ForecastWindowProjection;
    "72h": ForecastWindowProjection;
  } | null;
  explanation: string;
  disclaimer: string;
}

export interface ForecastEvaluationInput {
  zoneId: number;
  zoneName: string;
  district: string;
  state: string;
  currentRiskLevel: RiskLevel;
  currentRiskScore: number;
  threshold_e_mm?: number;
  threshold_i_coefficient?: number;
  threshold_i_exponent?: number;
  forecast_24h_mm: number | null;
  forecast_48h_mm: number | null;
  forecast_72h_mm: number | null;
  antecedent_30d_mm?: number;
}

// In-memory cache of latest fetched forecasts per zone
const forecastCache = new Map<number, ZoneForecastProjection>();

// Test harness override for deterministic offline testing
let mockForecastOverride: Map<number, Partial<ForecastEvaluationInput>> | null = null;

export function setMockForecastOverrideForTesting(
  override: Map<number, Partial<ForecastEvaluationInput>> | null,
): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("PROHIBITED_IN_PRODUCTION: Mock forecast override cannot be activated in production.");
  }
  mockForecastOverride = override;
}

export function clearForecastCacheForTesting(): void {
  forecastCache.clear();
  mockForecastOverride = null;
}

/**
 * Authoritative forecast risk projection engine.
 * Applies physical intensity-duration and moisture thresholds to forecast rainfall.
 */
export function projectZoneRiskForecast(
  input: ForecastEvaluationInput,
): ZoneForecastProjection {
  const disclaimer =
    "Weather-linked forecast projections represent forward-looking guidance based on Open-Meteo numerical weather prediction. " +
    "Forecast skill degrades with lead time. Projections do NOT alter authoritative current risk levels.";

  // If forecast data is completely missing or null, return explicit UNAVAILABLE state
  if (
    input.forecast_24h_mm === null ||
    input.forecast_48h_mm === null ||
    input.forecast_72h_mm === null ||
    Number.isNaN(input.forecast_24h_mm) ||
    Number.isNaN(input.forecast_48h_mm) ||
    Number.isNaN(input.forecast_72h_mm)
  ) {
    return {
      zoneId: input.zoneId,
      zoneName: input.zoneName,
      district: input.district,
      state: input.state,
      currentRiskLevel: input.currentRiskLevel,
      currentRiskScore: input.currentRiskScore,
      forecastStatus: "UNAVAILABLE",
      forecastTimestamp: new Date().toISOString(),
      forecastWindows: null,
      explanation: "Short-range precipitation forecast unavailable for this zone.",
      disclaimer,
    };
  }

  const windows: [24 | 48 | 72, number, "high" | "medium" | "low", string][] = [
    [
      24,
      Math.max(0, input.forecast_24h_mm),
      "high",
      "24h short-range skill is highest (uncertainty ±15%).",
    ],
    [
      48,
      Math.max(0, input.forecast_48h_mm),
      "medium",
      "48h medium-range skill is moderate (uncertainty ±30%).",
    ],
    [
      72,
      Math.max(0, input.forecast_72h_mm),
      "low",
      "72h skill degrades significantly in steep orographic terrain (uncertainty ±50%). Advisory only.",
    ],
  ];

  const projections: Partial<Record<"24h" | "48h" | "72h", ForecastWindowProjection>> = {};

  for (const [leadHours, rainfallMm, confidence, confidenceNotes] of windows) {
    const days = leadHours / 24;
    const intensityMmPerDay = Math.round((rainfallMm / days) * 10) / 10;
    const iThr = Math.round(intensityThresholdMmPerDay(days) * 10) / 10;
    const eThr = Math.round(moistureThresholdMm(leadHours) * 10) / 10;
    const intensityRatio = Math.round((intensityMmPerDay / iThr) * 100) / 100;

    let projectedLevel: RiskLevel = "Low";
    let trend: "improving" | "stable" | "elevating" | "critical" = "stable";

    // Determine projected level based on physical thresholds
    if (intensityRatio >= 1.6 || rainfallMm >= (leadHours === 24 ? 90 : leadHours === 48 ? 140 : 180)) {
      projectedLevel = "Severe";
    } else if (intensityRatio >= 1.0 || rainfallMm >= (leadHours === 24 ? 50 : leadHours === 48 ? 85 : 120)) {
      projectedLevel = "High";
    } else if (intensityRatio >= 0.55 || rainfallMm >= (leadHours === 24 ? 25 : leadHours === 48 ? 45 : 65)) {
      projectedLevel = "Moderate";
    } else {
      projectedLevel = "Low";
    }

    // Determine trend relative to current authoritative risk level
    const currentLvl = input.currentRiskLevel;
    if (projectedLevel === "Severe" || (projectedLevel === "High" && currentLvl !== "Severe")) {
      trend = projectedLevel === "Severe" ? "critical" : "elevating";
    } else if (projectedLevel === currentLvl) {
      trend = "stable";
    } else if (
      (projectedLevel === "Low" && currentLvl !== "Low") ||
      (projectedLevel === "Moderate" && (currentLvl === "High" || currentLvl === "Severe"))
    ) {
      trend = "improving";
    } else {
      trend = "elevating";
    }

    let narrative: string;
    if (projectedLevel === "Severe") {
      narrative = `Projected to reach Severe by +${leadHours}h if ${rainfallMm.toFixed(0)}mm forecast realizes (intensity ${intensityMmPerDay.toFixed(1)} vs ${iThr.toFixed(1)} mm/day threshold).`;
    } else if (projectedLevel === "High") {
      narrative = `Projected to reach High by +${leadHours}h if ${rainfallMm.toFixed(0)}mm forecast realizes (intensity ${intensityMmPerDay.toFixed(1)} vs ${iThr.toFixed(1)} mm/day threshold).`;
    } else if (projectedLevel === "Moderate") {
      narrative = `Projected to track Moderate by +${leadHours}h (${rainfallMm.toFixed(0)}mm forecast precipitation).`;
    } else {
      narrative = `Projected to remain Low by +${leadHours}h (${rainfallMm.toFixed(0)}mm forecast precipitation below hazard threshold).`;
    }

    const key = `${leadHours}h` as const;
    projections[key] = {
      leadHours,
      forecastRainfallMm: Math.round(rainfallMm * 10) / 10,
      intensityMmPerDay,
      intensityThresholdMmPerDay: iThr,
      moistureThresholdMm: eThr,
      intensityRatio,
      projectedRiskLevel: projectedLevel,
      trend,
      confidence,
      confidenceNotes,
      narrative,
    };
  }

  return {
    zoneId: input.zoneId,
    zoneName: input.zoneName,
    district: input.district,
    state: input.state,
    currentRiskLevel: input.currentRiskLevel,
    currentRiskScore: input.currentRiskScore,
    forecastStatus: "AVAILABLE",
    forecastTimestamp: new Date().toISOString(),
    forecastWindows: projections as ZoneForecastProjection["forecastWindows"],
    explanation:
      "Physical Sikkim/NE-Himalaya I-D threshold evaluated against Open-Meteo 72h short-range forecast.",
    disclaimer,
  };
}

/**
 * Fetches short-range precipitation forecast from Open-Meteo and projects hazard trajectory.
 */
export async function getZoneWeatherForecastProjection(
  zoneId: number,
): Promise<ZoneForecastProjection> {
  if (process.env["NODE_ENV"] !== "production" && mockForecastOverride?.has(zoneId)) {
    const override = mockForecastOverride.get(zoneId)!;
    return projectZoneRiskForecast({
      zoneId,
      zoneName: override.zoneName ?? `Zone ${zoneId}`,
      district: override.district ?? "District",
      state: override.state ?? "State",
      currentRiskLevel: override.currentRiskLevel ?? "Low",
      currentRiskScore: override.currentRiskScore ?? 20,
      forecast_24h_mm: override.forecast_24h_mm ?? null,
      forecast_48h_mm: override.forecast_48h_mm ?? null,
      forecast_72h_mm: override.forecast_72h_mm ?? null,
    });
  }

  // Check in-memory cache if available within 1 hour
  const cached = forecastCache.get(zoneId);
  if (
    cached &&
    Date.now() - new Date(cached.forecastTimestamp).getTime() < 3600000
  ) {
    return cached;
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: zone, error } = await supabaseAdmin
      .from("risk_zones")
      .select("*")
      .eq("id", zoneId)
      .maybeSingle();

    if (error || !zone) {
      throw new Error(error?.message ?? `Zone ${zoneId} not found`);
    }

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${zone.centroid_lat}&longitude=${zone.centroid_lng}` +
      "&daily=precipitation_sum&forecast_days=4&timezone=UTC";

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo forecast failed with HTTP ${res.status}`);
    }

    const payload = await res.json();
    const precip = payload?.daily?.precipitation_sum as (number | null)[] | undefined;

    if (!precip || precip.length < 4) {
      throw new Error("Incomplete forecast precipitation array returned by Open-Meteo");
    }

    const day1 = precip[1] ?? 0;
    const day2 = precip[2] ?? 0;
    const day3 = precip[3] ?? 0;

    const projection = projectZoneRiskForecast({
      zoneId: zone.id,
      zoneName: zone.zone_name,
      district: zone.district,
      state: zone.state,
      currentRiskLevel: (zone.current_risk_level as RiskLevel) ?? "UNKNOWN",
      currentRiskScore: zone.risk_score ?? 0,
      threshold_e_mm: zone.threshold_e_mm,
      threshold_i_coefficient: (zone as any).threshold_i_coefficient,
      threshold_i_exponent: (zone as any).threshold_i_exponent,
      forecast_24h_mm: day1,
      forecast_48h_mm: day1 + day2,
      forecast_72h_mm: day1 + day2 + day3,
    });

    forecastCache.set(zoneId, projection);
    return projection;
  } catch (err) {
    console.warn(`[Forecast Service] Forecast fetch failed for zone ${zoneId}:`, err);
    return {
      zoneId,
      zoneName: `Zone ${zoneId}`,
      district: "NER District",
      state: "North East Region",
      currentRiskLevel: "UNKNOWN",
      currentRiskScore: 0,
      forecastStatus: "UNAVAILABLE",
      forecastTimestamp: new Date().toISOString(),
      forecastWindows: null,
      explanation:
        "Forecast data unavailable: Open-Meteo weather guidance or database unreachable.",
      disclaimer:
        "Forecast projections represent short-range numerical weather guidance and do not overwrite current risk levels.",
    };
  }
}

/**
 * Retrieves forecast risk projections across all monitored zones.
 */
export async function getAllWeatherForecastProjections(): Promise<
  ZoneForecastProjection[]
> {
  const zoneIds = Array.from({ length: 15 }, (_, i) => i + 1);
  const projections = await Promise.all(
    zoneIds.map((id) => getZoneWeatherForecastProjection(id)),
  );
  return projections;
}
