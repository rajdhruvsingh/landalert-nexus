/**
 * src/lib/alert.service.ts
 * ========================
 * Authoritative Alert and Notification Service for LandAlert-Nexus.
 * Handles:
 * - Risk threshold evaluation (High/Severe triggers)
 * - Cooldown enforcement (6h window, escalation override for Severe)
 * - Multilingual SMS message construction (English, Assamese, Bengali, Nepali)
 * - Stale/fallback telemetry warnings
 * - Idempotency and deduplication
 * - Delivery tracking and audit logging
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { RiskPredictionResult } from "./ml.service";
import type { Database } from "@/integrations/supabase/types";

export type AlertRow = Database["public"]["Tables"]["alerts"]["Row"];

export const ALERT_TEMPLATES: Record<
  string,
  { label: string; render: (zone: string, level: string, advisory?: string) => string }
> = {
  en: {
    label: "English",
    render: (zone, level, advisory) =>
      `${level.toUpperCase()} landslide risk in ${zone}. Avoid slope-cut roads. Report cracks or slumping to your district control room.${
        advisory ? ` [${advisory}]` : ""
      }`,
  },
  as: {
    label: "অসমীয়া (Assamese)",
    render: (zone, level, advisory) =>
      `${zone}ত ভূমিস্খলনৰ ${level === "Severe" ? "গুৰুতৰ" : "উচ্চ"} আশংকা। পাহাৰীয়া পথ এৰাই চলক। ফাট বা মাটি সৰি পৰা দেখিলে জিলা নিয়ন্ত্ৰণ কক্ষক জনাওক।${
        advisory ? ` [${advisory}]` : ""
      }`,
  },
  bn: {
    label: "বাংলা (Bengali)",
    render: (zone, level, advisory) =>
      `${zone}-এ ভূমিধসের ${level === "Severe" ? "মারাত্মক" : "উচ্চ"} ঝুঁকি। পাহাড়ি রাস্তা এড়িয়ে চলুন। ফাটল বা ধস দেখলে জেলা নিয়ন্ত্রণ কক্ষে জানান।${
        advisory ? ` [${advisory}]` : ""
      }`,
  },
  ne: {
    label: "नेपाली (Nepali)",
    render: (zone, level, advisory) =>
      `${zone} मा पहिरोको ${level === "Severe" ? "गम्भीर" : "उच्च"} जोखिम। भिरालो सडक नजानुहोस्। चिरा वा पहिरो देखिए जिल्ला नियन्त्रण कक्षलाई खबर गर्नुहोस्।${
        advisory ? ` [${advisory}]` : ""
      }`,
  },
};

export interface AlertDispatchOptions {
  actor?: string | undefined;
  channel?: ("sms" | "push" | "both") | undefined;
  language?: ("en" | "as" | "bn" | "ne") | undefined;
  idempotencyKey?: string | undefined;
  cooldownHours?: number | undefined;
  justification?: string | undefined;
}

export interface AlertDispatchResult {
  dispatched: boolean;
  reason: string;
  alertId?: number | undefined;
  riskLevel?: string | undefined;
  zoneId: number;
  smsPayloads?: Record<string, string> | undefined;
  dispatchedAt?: string | undefined;
}

/**
 * Evaluates risk prediction and dispatches alert if threshold and cooldown conditions are met.
 */
export async function evaluateAndDispatchAlert(
  prediction: RiskPredictionResult,
  options: AlertDispatchOptions = {},
): Promise<AlertDispatchResult> {
  const {
    actor = "rules_engine",
    channel = "both",
    language = "en",
    cooldownHours = 6,
    idempotencyKey,
  } = options;

  const zoneId = prediction.zone_id;
  const level = prediction.risk_level;

  // 1. Threshold check: Alerts only fire for High or Severe
  if (level !== "High" && level !== "Severe") {
    return {
      dispatched: false,
      reason: `Risk level ${level} below threshold (High/Severe required)`,
      zoneId,
    };
  }

  // 2. Cooldown check: Check recent alerts for this zone
  const cooldownSince = new Date(Date.now() - cooldownHours * 3600000).toISOString();
  const { data: recentAlerts, error: alertErr } = await supabaseAdmin
    .from("alerts")
    .select("id, risk_level, dispatched_at, idempotency_key")
    .eq("zone_id", zoneId)
    .gt("dispatched_at", cooldownSince)
    .order("dispatched_at", { ascending: false });

  if (alertErr) {
    console.error("[Alert Service] Error checking cooldown:", alertErr.message);
  }

  const latestAlert = recentAlerts?.[0];
  if (latestAlert) {
    // Escalation rule: If previous was High and current is Severe, allow dispatch
    const isEscalation = latestAlert.risk_level === "High" && level === "Severe";
    if (!isEscalation) {
      return {
        dispatched: false,
        reason: `Suppressed by cooldown: Alert for zone ${zoneId} already sent at ${latestAlert.dispatched_at} (${latestAlert.risk_level})`,
        alertId: latestAlert.id,
        riskLevel: latestAlert.risk_level,
        zoneId,
      };
    }
  }

  // 3. Telemetry / Stale Data Advisory
  let advisory: string | undefined = undefined;
  if (prediction.status === "STALE") {
    advisory = "DATA ADVISORY: Weather telemetry >72h old";
  } else if (prediction.status === "FALLBACK") {
    advisory = "DATA ADVISORY: Soil moisture using 50% neutral fallback";
  }

  // 4. Construct message and explanation
  const zoneDesc = `${prediction.zone_name}, ${prediction.state}`;
  const template = ALERT_TEMPLATES[language] ?? ALERT_TEMPLATES["en"]!;
  const message = template.render(zoneDesc, level, advisory);

  const explanationWithProvenance = (
    `${prediction.explanation_narrative} ` +
    `[Model: ${prediction.model_version} | Status: ${prediction.status} | Telemetry age: ${prediction.data_freshness.weather_age_hours}h]`
  ).trim();

  // 5. Generate deterministic idempotency key if not provided
  const hourBucket = new Date().toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
  const finalIdempotencyKey = idempotencyKey ?? `ALERT-${zoneId}-${level}-${hourBucket}`;

  // 6. Generate multilingual payloads for SMS dispatch
  const smsPayloads: Record<string, string> = {};
  for (const [langKey, tmpl] of Object.entries(ALERT_TEMPLATES)) {
    smsPayloads[langKey] = tmpl.render(zoneDesc, level, advisory);
  }

  // 7. Insert alert record
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("alerts")
    .insert({
      zone_id: zoneId,
      risk_level: level,
      message,
      language,
      channel,
      explanation: explanationWithProvenance,
      dispatched_by: actor,
      status: "sent",
      recipient_group: "district_disaster_management_authorities",
      idempotency_key: finalIdempotencyKey,
      delivery_attempts: 1,
      justification: options.justification ?? "Official threshold exceedance verified by authorized dispatcher",
      dispatch_status: "DISPATCH_AUTHORIZED",
    })
    .select("id, dispatched_at")
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Unique violation on idempotency_key
      return {
        dispatched: false,
        reason: `Duplicate alert suppressed by idempotency key: ${finalIdempotencyKey}`,
        zoneId,
      };
    }
    throw new Error(`Failed to persist alert: ${insertErr.message}`);
  }

  return {
    dispatched: true,
    reason: latestAlert
      ? `Escalated alert dispatched (${level})`
      : `New alert dispatched (${level})`,
    alertId: inserted?.id,
    riskLevel: level,
    zoneId,
    smsPayloads,
    dispatchedAt: inserted?.dispatched_at,
  };
}
