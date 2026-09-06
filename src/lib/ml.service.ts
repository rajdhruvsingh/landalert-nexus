/**
 * src/lib/ml.service.ts
 * =====================
 * Authoritative Backend ML Service for LandAlert-Nexus.
 * Connects the backend layer directly to the canonical ML inference engine
 * (src/lib/ml/inference.py) and PostgreSQL persistence layer.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { RiskLevel } from "./risk";

const execFileAsync = promisify(execFile);

// Authoritative in-memory cache of last successful computations per zone
const lastKnownPredictions = new Map<number, RiskPredictionResult>();

export interface FactorContribution {
  category: string;
  net_contribution: number;
}

export interface FeatureAttribution {
  feature: string;
  value: number;
  scaled_value?: number;
  weight?: number;
  contribution: number;
  direction: "increases_risk" | "decreases_risk";
}

export interface RiskPredictionResult {
  status: "VALID" | "STALE" | "FALLBACK" | "MISSING" | "INVALID" | "DEGRADED";
  zone_id: number;
  zone_name: string;
  district: string;
  state: string;
  model_version: string;
  feature_schema_version: string;
  probability: number | null;
  risk_score: number | null;
  risk_level: RiskLevel;
  explanation_narrative: string;
  factor_attribution?: {
    top_categories: FactorContribution[];
    top_features: FeatureAttribution[];
    all_features?: FeatureAttribution[];
  };
  canonical_features?: Record<string, number>;
  data_freshness: {
    latest_weather_timestamp?: string | null | undefined;
    weather_age_hours?: number | undefined;
    soil_moisture_status: "measured" | "stale" | "missing" | "fallback";
  };
  inference_timestamp: string;
  persisted?: boolean;
}

export interface PredictionErrorResponse {
  error: string;
  code: string;
  zone_id?: number;
  timestamp: string;
}

/**
 * Validates zoneId and asOfDate parameters.
 */
export function validatePredictionInput(
  zoneId: unknown,
  asOfDate?: unknown,
): {
  valid: boolean;
  zoneId?: number | undefined;
  asOfDate?: string | undefined;
  error?: string | undefined;
  code?: string | undefined;
} {
  const parsedId = Number(zoneId);
  if (!Number.isInteger(parsedId) || parsedId < 1 || parsedId > 15) {
    return {
      valid: false,
      error: "zoneId must be an integer between 1 and 15 (NER monitored zones)",
      code: "INVALID_ZONE_ID",
    };
  }

  let validDate: string | undefined = undefined;
  if (asOfDate !== undefined && asOfDate !== null && asOfDate !== "") {
    if (typeof asOfDate !== "string") {
      return { valid: false, error: "asOfDate must be an ISO 8601 string", code: "INVALID_DATE" };
    }
    const parsedTs = Date.parse(asOfDate);
    if (Number.isNaN(parsedTs)) {
      return { valid: false, error: "asOfDate is not a valid date string", code: "INVALID_DATE" };
    }
    if (parsedTs > Date.now() + 86400000) {
      return {
        valid: false,
        error: "asOfDate cannot be in the future beyond 24h",
        code: "FUTURE_DATE_NOT_ALLOWED",
      };
    }
    validDate = new Date(parsedTs).toISOString();
  }

  return { valid: true, zoneId: parsedId, asOfDate: validDate };
}

/**
 * Executes canonical ML inference for a zone and persists the prediction record.
 */
export async function getRiskPrediction(
  zoneId: number,
  asOfDate?: string,
): Promise<RiskPredictionResult> {
  const validation = validatePredictionInput(zoneId, asOfDate);
  if (!validation.valid || validation.zoneId === undefined) {
    throw new Error(validation.error ?? "Invalid prediction input");
  }

  const cwd = process.cwd();
  const args = ["-m", "src.lib.ml.inference", "--zone", String(validation.zoneId), "--persist"];
  if (validation.asOfDate) {
    args.push("--as-of", validation.asOfDate);
  }

  try {
    const { stdout } = await execFileAsync("python3", args, {
      cwd,
      timeout: 4000,
      env: { ...process.env, PYTHONPATH: cwd },
    });

    const parsed = JSON.parse(stdout.trim()) as RiskPredictionResult;
    if (parsed.status === "INVALID" || parsed.status === "MISSING") {
      return parsed;
    }
    parsed.persisted = true;
    lastKnownPredictions.set(validation.zoneId, parsed);
    return parsed;
  } catch (err) {
    // If Python execution encounters an environmental issue or times out (>4s), execute safe fallback
    console.warn(
      `[ML Service] Python engine call failed or timed out, executing safe fallback for zone ${zoneId}:`,
      err instanceof Error ? err.message : err,
    );
    return getDatabaseFallbackPrediction(validation.zoneId);
  }
}

/**
 * Fallback prediction path querying PostgreSQL public.risk_zones and active model config,
 * with last-known-prediction preservation and explicit UNKNOWN/DEGRADED fallback if database is hydrating or offline.
 */
export async function getDatabaseFallbackPrediction(zoneId: number): Promise<RiskPredictionResult> {
  const fallbackZones: Record<number, { name: string; district: string; state: string }> = {
    1: { name: "Tamenglong", district: "Tamenglong", state: "Manipur" },
    2: { name: "Noney", district: "Noney", state: "Manipur" },
    3: { name: "Aizawl East", district: "Aizawl", state: "Mizoram" },
    4: { name: "Lunglei Slopes", district: "Lunglei", state: "Mizoram" },
    5: { name: "Shillong-Sohra Escarpment", district: "East Khasi Hills", state: "Meghalaya" },
    6: { name: "Jaintia Hills Ridge", district: "West Jaintia Hills", state: "Meghalaya" },
    7: { name: "Kohima Ridge", district: "Kohima", state: "Nagaland" },
    8: { name: "Dimapur Foothills", district: "Dimapur", state: "Nagaland" },
    9: { name: "Papum Pare", district: "Papum Pare", state: "Arunachal Pradesh" },
    10: { name: "Dibang Valley", district: "Dibang Valley", state: "Arunachal Pradesh" },
    11: { name: "Gangtok-Singtam Corridor", district: "East Sikkim", state: "Sikkim" },
    12: { name: "Mangan North", district: "Mangan", state: "Sikkim" },
    13: { name: "Haflong Hills", district: "Dima Hasao", state: "Assam" },
    14: { name: "Karbi Anglong West", district: "Karbi Anglong", state: "Assam" },
    15: { name: "Ambassa Hills", district: "Dhalai", state: "Tripura" },
  };

  try {
    const [zoneRes, configRes, latestPredictionRes] = await Promise.all([
      supabaseAdmin.from("risk_zones").select("*").eq("id", zoneId).maybeSingle(),
      supabaseAdmin.from("risk_model_config").select("*").eq("is_active", true).maybeSingle(),
      supabaseAdmin
        .from("risk_predictions")
        .select("*")
        .eq("zone_id", zoneId)
        .order("prediction_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (zoneRes.data) {
      const zone = zoneRes.data;
      const cfg = configRes.data;
      const latestPred = latestPredictionRes.data;

      const riskLevel = (zone.current_risk_level as RiskLevel) ?? "UNKNOWN";
      const riskScore = zone.risk_score ?? 0;
      const probability = latestPred?.probability ?? Math.round((riskScore / 100) * 1000) / 1000;

      const result: RiskPredictionResult = {
        status: zone.soil_moisture_status === "fallback" ? "FALLBACK" : "VALID",
        zone_id: zone.id,
        zone_name: zone.zone_name,
        district: zone.district,
        state: zone.state,
        model_version: cfg?.model_version ?? "v0.2-lr-trained",
        feature_schema_version: cfg?.feature_schema_version ?? "v1.0.0",
        probability,
        risk_score: riskScore,
        risk_level: riskLevel,
        explanation_narrative: zone.explanation ?? "Operational threshold calculation",
        data_freshness: {
          latest_weather_timestamp: zone.last_computed_at,
          weather_age_hours:
            Math.round(((Date.now() - new Date(zone.last_computed_at).getTime()) / 3600000) * 10) / 10,
          soil_moisture_status: zone.soil_moisture_status ?? "fallback",
        },
        inference_timestamp: new Date().toISOString(),
        persisted: false,
      };

      lastKnownPredictions.set(zoneId, result);
      return result;
    }
  } catch {
    // Database connection failure fallback below
  }

  // If a recent prior prediction exists for this zone, preserve that last-known value
  // with an explicit staleness indicator rather than degrading to UNKNOWN
  const prior = lastKnownPredictions.get(zoneId);
  if (prior) {
    const lastTimestamp =
      prior.data_freshness?.latest_weather_timestamp ||
      prior.inference_timestamp ||
      "prior computation";
    return {
      ...prior,
      status: "STALE",
      persisted: false,
      explanation_narrative: `Telemetry & database offline: showing last-known computation from ${lastTimestamp} (may be stale). ${prior.explanation_narrative}`,
      data_freshness: {
        ...prior.data_freshness,
        soil_moisture_status: "stale",
      },
    };
  }

  // When there is truly no prior value to fall back to and both ML engine and DB are unreachable,
  // return an explicit UNKNOWN / DEGRADED state (never fabricate "Low risk" or 0.20 probability).
  const zInfo = fallbackZones[zoneId] || {
    name: `Zone ${zoneId}`,
    district: "NER District",
    state: "North East Region",
  };

  return {
    status: "DEGRADED",
    zone_id: zoneId,
    zone_name: zInfo.name,
    district: zInfo.district,
    state: zInfo.state,
    model_version: "v0.2-lr-trained",
    feature_schema_version: "v1.0.0",
    probability: null,
    risk_score: null,
    risk_level: "UNKNOWN",
    explanation_narrative:
      "Status Unknown: system data unavailable — inference engine and telemetry database offline.",
    data_freshness: {
      latest_weather_timestamp: null,
      soil_moisture_status: "fallback",
    },
    inference_timestamp: new Date().toISOString(),
    persisted: false,
  };
}

export function setLastKnownPredictionForTesting(
  zoneId: number,
  prediction: RiskPredictionResult,
): void {
  lastKnownPredictions.set(zoneId, prediction);
}

export function clearLastKnownPredictionsForTesting(): void {
  lastKnownPredictions.clear();
}

