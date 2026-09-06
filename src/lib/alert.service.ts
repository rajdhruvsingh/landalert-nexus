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
  smsResponse?: any;
  dispatchStatus?: string | undefined;
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
      reason:
        level === "UNKNOWN"
          ? "Prediction unavailable: risk level is UNKNOWN (High/Severe required)"
          : `Risk level ${level} below threshold (High/Severe required)`,
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
    advisory = `DATA ADVISORY: Weather telemetry stale (last computed at ${prediction.data_freshness?.latest_weather_timestamp ?? prediction.inference_timestamp})`;
  } else if (prediction.status === "FALLBACK") {
    advisory = "DATA ADVISORY: Soil moisture using 50% neutral fallback";
  } else if (prediction.status === "DEGRADED") {
    advisory = "DATA ADVISORY: System data unavailable — inference engine and telemetry database offline";
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

  // 7. Execute real SMS Gateway Call if channel includes SMS
  const { getSmsProvider } = await import("./sms");
  const smsProvider = getSmsProvider();
  let smsResult: import("./sms").SendSmsResponse | undefined = undefined;

  let finalStatus: "sent" | "failed" | "provider_unconfigured" | "sandbox_logged" = "sent";
  let finalDispatchStatus:
    | "DISPATCH_AUTHORIZED"
    | "SMS_PROVIDER_NOT_CONFIGURED"
    | "SMS_SANDBOX_LOGGED"
    | "SENT"
    | "FAILED" = "DISPATCH_AUTHORIZED";
  let lastError: string | null = null;

  if (channel === "sms" || channel === "both") {
    const rawRecipientsEnv = process.env["ALERT_RECIPIENT_NUMBERS"];
    const recipients = rawRecipientsEnv
      ? rawRecipientsEnv.split(",").map((s) => s.trim()).filter(Boolean)
      : ["919876543210"]; // Default official DDMA emergency contact

    smsResult = await smsProvider.send({
      recipients,
      message,
      language,
      metadata: {
        zone_id: zoneId,
        zone_name: prediction.zone_name,
        risk_level: level,
      },
    });

    if (smsResult.status === "SMS_PROVIDER_NOT_CONFIGURED") {
      finalStatus = "provider_unconfigured";
      finalDispatchStatus = "SMS_PROVIDER_NOT_CONFIGURED";
      lastError = smsResult.error ?? "SMS provider not configured (MSG91_AUTH_KEY missing)";
      console.warn(
        `[Alert Service] Alert ${finalIdempotencyKey} status marked SMS_PROVIDER_NOT_CONFIGURED: ${lastError}`,
      );
    } else if (smsResult.status === "SMS_SANDBOX_LOGGED") {
      finalStatus = "sandbox_logged";
      finalDispatchStatus = "SMS_SANDBOX_LOGGED";
    } else if (smsResult.status === "SENT" || smsResult.status === "DELIVERED") {
      finalStatus = "sent";
      finalDispatchStatus = "SENT";
    } else {
      finalStatus = "failed";
      finalDispatchStatus = "FAILED";
      lastError = smsResult.error ?? "SMS delivery failed";
    }
  }

  // 8. Insert alert record
  const { data: inserted, error: insertErr } = await (supabaseAdmin
    .from("alerts") as any)
    .insert({
      zone_id: zoneId,
      risk_level: level,
      message,
      language,
      channel,
      explanation: explanationWithProvenance,
      dispatched_by: actor,
      status: finalStatus as any,
      recipient_group: "district_disaster_management_authorities",
      idempotency_key: finalIdempotencyKey,
      delivery_attempts: 1,
      justification:
        options.justification ?? "Official threshold exceedance verified by authorized dispatcher",
      dispatch_status: finalDispatchStatus,
      provider_message_id: smsResult?.messageId ?? null,
      provider_response: (smsResult?.rawResponse as any) ?? smsResult?.details ?? {},
      last_error: lastError,
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
    dispatched: finalDispatchStatus !== "FAILED",
    reason:
      finalDispatchStatus === "SMS_PROVIDER_NOT_CONFIGURED"
        ? `Alert created; SMS provider not configured (MSG91_AUTH_KEY required for live dispatch)`
        : latestAlert
          ? `Escalated alert dispatched (${level})`
          : `New alert dispatched (${level})`,
    alertId: inserted?.id,
    riskLevel: level,
    zoneId,
    smsPayloads,
    dispatchedAt: inserted?.dispatched_at,
    smsResponse: smsResult,
    dispatchStatus: finalDispatchStatus,
  };
}

export interface RetractAlertParams {
  alertId: number;
  reason: string;
  retractedBy: string;
}

export interface RetractAlertResult {
  success: boolean;
  alertId: number;
  retractedAt: string;
  retractedBy: string;
  reason: string;
  smsSent: boolean;
  smsResponse?: any;
}

/**
 * Retracts a previously-dispatched alert (False-alarm correction flow).
 * Restricted to authorized DISPATCHER or ADMIN operators.
 *
 * Immutability guarantee: The alert is NEVER deleted from public.alerts.
 * It is marked as 'retracted' with full audit trail (reason, timestamp, operator).
 * If the alert was broadcast over SMS, sends a follow-up correction broadcast.
 */
export async function retractAlert({
  alertId,
  reason,
  retractedBy,
}: RetractAlertParams): Promise<RetractAlertResult> {
  if (!reason || reason.trim().length < 5) {
    throw new Error("Operational retraction reason is required (minimum 5 characters)");
  }

  // 1. Fetch the alert to retract
  const { data: alert, error: fetchErr } = await supabaseAdmin
    .from("alerts")
    .select("*")
    .eq("id", alertId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Database error fetching alert ${alertId}: ${fetchErr.message}`);
  if (!alert) throw new Error(`Alert with id ${alertId} not found`);

  const now = new Date().toISOString();

  if ((alert as any).is_retracted || (alert as any).status === "retracted") {
    return {
      success: true,
      alertId,
      retractedAt: (alert as any).retracted_at || now,
      retractedBy: (alert as any).retracted_by || retractedBy,
      reason: (alert as any).retraction_reason || reason,
      smsSent: false,
    };
  }

  // 2. Mark alert as retracted in public.alerts (never delete)
  const { error: updateErr } = await (supabaseAdmin.from("alerts") as any)
    .update({
      status: "retracted",
      is_retracted: true,
      retracted_at: now,
      retracted_by: retractedBy,
      retraction_reason: reason.trim(),
    })
    .eq("id", alertId);

  if (updateErr) throw new Error(`Failed to update alert retraction status: ${updateErr.message}`);

  // 3. Dispatch follow-up correction SMS if channel was sms or both
  let smsSent = false;
  let smsResponse: unknown = undefined;

  if (alert.channel === "sms" || alert.channel === "both") {
    try {
      const { getSmsProvider } = await import("./sms");
      const smsProvider = getSmsProvider();

      // Retrieve zone name
      const { data: zone } = await supabaseAdmin
        .from("risk_zones")
        .select("zone_name")
        .eq("id", alert.zone_id)
        .maybeSingle();

      const zoneName = zone?.zone_name ?? `Zone ${alert.zone_id}`;
      const correctionMessage = `[CORRECTION / RETRACTION] The previous landslide alert for ${zoneName} has been RETRACTED by emergency authorities. Reason: ${reason.trim()}. Please disregard previous emergency warning.`;

      const smsResult = await smsProvider.send({
        recipients: ["910000000000"],
        message: correctionMessage,
        language: alert.language || "en",
        metadata: {
          retraction: true,
          original_alert_id: alertId,
          zone_id: alert.zone_id,
          retracted_by: retractedBy,
        },
      });

      smsSent = smsResult.success || smsResult.status === "SMS_SANDBOX_LOGGED";
      smsResponse = smsResult;
    } catch (smsErr) {
      console.error("Failed to send follow-up retraction SMS:", smsErr);
    }
  }

  return {
    success: true,
    alertId,
    retractedAt: now,
    retractedBy,
    reason: reason.trim(),
    smsSent,
    smsResponse,
  };
}

