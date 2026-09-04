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

const execFileAsync = promisify(execFile);

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
  status: "VALID" | "STALE" | "FALLBACK" | "MISSING" | "INVALID";
  zone_id: number;
  zone_name: string;
  district: string;
  state: string;
  model_version: string;
  feature_schema_version: string;
  probability: number;
  risk_score: number;
  risk_level: "Low" | "Moderate" | "High" | "Severe";
  explanation_narrative: string;
  factor_attribution?: {
    top_categories: FactorContribution[];
    top_features: FeatureAttribution[];
    all_features?: FeatureAttribution[];
  };
  canonical_features?: Record<string, number>;
  data_freshness: {
    latest_weather_timestamp: string | null;
    weather_age_hours: number;
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
      timeout: 10000,
      env: { ...process.env, PYTHONPATH: cwd },
    });

    const parsed = JSON.parse(stdout.trim()) as RiskPredictionResult;
    if (parsed.status === "INVALID" || parsed.status === "MISSING") {
      return parsed;
    }
    parsed.persisted = true;
    return parsed;
  } catch (err) {
    // If Python execution encounters an environmental issue, execute safe database fallback
    console.warn(
      `[ML Service] Python engine call failed, executing database fallback for zone ${zoneId}:`,
      err instanceof Error ? err.message : err,
    );
    return getDatabaseFallbackPrediction(validation.zoneId);
  }
}

/**
 * Fallback prediction path querying PostgreSQL public.risk_zones and active model config.
 */
async function getDatabaseFallbackPrediction(zoneId: number): Promise<RiskPredictionResult> {
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

  if (zoneRes.error || !zoneRes.data) {
    throw new Error(`Zone ${zoneId} not found in database: ${zoneRes.error?.message}`);
  }

  const zone = zoneRes.data;
  const cfg = configRes.data;
  const latestPred = latestPredictionRes.data;

  const riskLevel = (zone.current_risk_level as "Low" | "Moderate" | "High" | "Severe") ?? "Low";
  const riskScore = zone.risk_score ?? 0;
  const probability = latestPred?.probability ?? Math.round((riskScore / 100) * 1000) / 1000;

  return {
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
}
