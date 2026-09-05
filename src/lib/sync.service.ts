/**
 * src/lib/sync.service.ts
 * =======================
 * Authoritative Offline Synchronization Service for LandAlert-Nexus.
 * Handles:
 * - Offline observation batch upload with validation and idempotency
 * - Conflict resolution and server acknowledgement
 * - Field-ready offline cache bundle packaging with strict freshness timestamps
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zonePolygon } from "./risk";

export interface FieldObservationInput {
  zone_id: number;
  observed_at: string;
  client_timestamp: string;
  rainfall_mm?: number | undefined;
  soil_condition?: string | undefined;
  visual_signs?: string | undefined;
  road_status?: ("open" | "restricted" | "blocked" | "unknown") | undefined;
  observer_id?: string | undefined;
  idempotency_key?: string | undefined;
  // Geo-tagged Media & Sensor Coordinates (Task 2)
  media_urls?: string[] | undefined;
  media_metadata?:
    | Array<{
        name: string;
        size: number;
        mimeType: string;
        storagePath?: string | undefined;
        url?: string | undefined;
      }>
    | undefined;
  geo_lat?: number | undefined;
  geo_lng?: number | undefined;
  geo_accuracy_m?: number | undefined;
  geo_captured_at?: string | undefined;
  consent_given?: boolean | undefined;
  submitter_role?: string | undefined;
  review_status?: ("PENDING_REVIEW" | "APPROVED" | "REJECTED") | undefined;
}

export interface SyncResult {
  success: boolean;
  receivedCount: number;
  syncedCount: number;
  skippedDuplicates: number;
  acknowledgedKeys: string[];
  errors?: string[] | undefined;
}

export interface OfflinePackage {
  zones: Array<{
    id: number;
    name: string;
    district: string;
    state: string;
    lat: number;
    lng: number;
    mean_slope_deg: number;
    risk_level: string;
    risk_score: number;
    soil_moisture_pct: number | null;
    soil_moisture_status: string;
    explanation: string | null;
    polygon: [number, number][];
  }>;
  roads: Array<{
    id: number;
    zone_id: number;
    road_name: string;
    segment_label: string;
    status: string;
    length_km: number;
  }>;
  active_model: {
    model_version: string;
    feature_schema_version: string;
    pr_auc: number | null;
    recall_at_80_precision: number | null;
    cutoffs: {
      moderate: number;
      high: number;
      severe: number;
    };
    weights: {
      intensity: number;
      antecedent: number;
      soil_moisture: number;
      slope: number;
      history: number;
    };
  };
  cache_policy: {
    cached_at: string;
    valid_until: string;
    max_age_hours: number;
    is_expired: boolean;
    instructions: string;
  };
}

/**
 * Validates and synchronizes a batch of field observations collected offline.
 */
export async function syncFieldObservations(records: FieldObservationInput[]): Promise<SyncResult> {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      success: true,
      receivedCount: 0,
      syncedCount: 0,
      skippedDuplicates: 0,
      acknowledgedKeys: [],
    };
  }

  const errors: string[] = [];
  const validRows: Array<{
    zone_id: number;
    observed_at: string;
    client_timestamp: string;
    rainfall_mm: number | null;
    soil_condition: string | null;
    visual_signs: string | null;
    road_status: "open" | "restricted" | "blocked" | "unknown" | null;
    observer_id: string;
    idempotency_key: string;
    status: "PENDING_VERIFICATION" | "OFFICIAL_VERIFIED" | "REJECTED";
    is_training_eligible: boolean;
    source: string;
    media_urls: string[];
    media_metadata: unknown[];
    geo_lat: number | null;
    geo_lng: number | null;
    geo_accuracy_m: number | null;
    geo_captured_at: string | null;
    consent_given: boolean;
    review_status: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  }> = [];

  const acknowledgedKeys: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const parsedZone = Number(r.zone_id);
    if (!Number.isInteger(parsedZone) || parsedZone < 1 || parsedZone > 15) {
      errors.push(`Record ${i}: invalid zone_id ${r.zone_id} (must be 1-15)`);
      continue;
    }

    if (Number.isNaN(Date.parse(r.observed_at))) {
      errors.push(`Record ${i}: invalid observed_at timestamp`);
      continue;
    }

    const rainfall =
      r.rainfall_mm !== undefined ? Math.max(0, Math.min(1200, Number(r.rainfall_mm))) : null;
    const key =
      r.idempotency_key ??
      `OBS-${parsedZone}-${new Date(r.observed_at).getTime()}-${r.observer_id ?? "field"}`;

    const isOfficial =
      r.submitter_role === "VERIFIED_OFFICIAL" ||
      r.submitter_role === "DISPATCHER" ||
      r.submitter_role === "ADMIN" ||
      (r.observer_id && /^(official|ddma|gsi|sdma|admin)/i.test(r.observer_id));

    const reviewStatus: "PENDING_REVIEW" | "APPROVED" | "REJECTED" = isOfficial
      ? "APPROVED"
      : "PENDING_REVIEW";
    const status: "PENDING_VERIFICATION" | "OFFICIAL_VERIFIED" = isOfficial
      ? "OFFICIAL_VERIFIED"
      : "PENDING_VERIFICATION";
    const source = isOfficial ? "OFFICIAL_SURVEY" : "PUBLIC_REPORT";

    validRows.push({
      zone_id: parsedZone,
      observed_at: new Date(r.observed_at).toISOString(),
      client_timestamp: new Date(r.client_timestamp || Date.now()).toISOString(),
      rainfall_mm: rainfall,
      soil_condition: r.soil_condition ?? null,
      visual_signs: r.visual_signs ?? null,
      road_status: r.road_status ?? null,
      observer_id: r.observer_id ?? "field_worker",
      idempotency_key: key,
      status,
      is_training_eligible: isOfficial,
      source,
      media_urls: r.media_urls ?? [],
      media_metadata: r.media_metadata ?? [],
      geo_lat: r.geo_lat ?? null,
      geo_lng: r.geo_lng ?? null,
      geo_accuracy_m: r.geo_accuracy_m ?? null,
      geo_captured_at: r.geo_captured_at ?? null,
      consent_given: r.consent_given ?? true,
      review_status: reviewStatus,
    });

    acknowledgedKeys.push(key);
  }

  if (validRows.length === 0) {
    return {
      success: false,
      receivedCount: records.length,
      syncedCount: 0,
      skippedDuplicates: 0,
      acknowledgedKeys: [],
      errors,
    };
  }

  // Insert valid rows with ON CONFLICT (idempotency_key) DO NOTHING
  const { error: insErr } = await supabaseAdmin
    .from("field_observations")
    .upsert(validRows, { onConflict: "idempotency_key", ignoreDuplicates: true });

  if (insErr) {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const script = `
import sys, json, os, psycopg2
rows = json.loads(sys.argv[1])
db_url = os.environ.get("DATABASE_URL", "postgresql://localhost/landalert")
conn = psycopg2.connect(db_url)
with conn.cursor() as cur:
    for r in rows:
        cur.execute("""
            INSERT INTO public.field_observations 
            (zone_id, observer_id, observed_at, client_timestamp, rainfall_mm, soil_condition, visual_signs, road_status, idempotency_key, sync_status, status, is_training_eligible, source, media_urls, media_metadata, geo_lat, geo_lng, geo_accuracy_m, geo_captured_at, consent_given, review_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'synced', %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
        """, (r['zone_id'], r['observer_id'], r['observed_at'], r['client_timestamp'], r['rainfall_mm'], r['soil_condition'], r['visual_signs'], r['road_status'], r['idempotency_key'], r['status'], r['is_training_eligible'], r['source'], r['media_urls'], json.dumps(r['media_metadata']), r['geo_lat'], r['geo_lng'], r['geo_accuracy_m'], r['geo_captured_at'], r['consent_given'], r['review_status']))
conn.commit()
conn.close()
`;
      await execFileAsync("python3", ["-c", script, JSON.stringify(validRows)], {
        env: {
          ...process.env,
          DATABASE_URL: process.env["DATABASE_URL"] || "postgresql://localhost/landalert",
        },
      });
    } catch (localErr) {
      throw new Error(
        `Failed to sync field observations: ${insErr.message} (local fallback: ${localErr instanceof Error ? localErr.message : String(localErr)})`,
      );
    }
  }

  return {
    success: errors.length === 0,
    receivedCount: records.length,
    syncedCount: validRows.length,
    skippedDuplicates: records.length - validRows.length,
    acknowledgedKeys,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Builds a complete offline data package for disaster response officers.
 */
export async function getOfflinePackage(): Promise<OfflinePackage> {
  const [zonesRes, roadsRes, modelRes] = await Promise.all([
    supabaseAdmin.from("risk_zones").select("*").order("id"),
    supabaseAdmin.from("road_segments").select("*").order("id"),
    supabaseAdmin.from("risk_model_config").select("*").eq("is_active", true).maybeSingle(),
  ]);

  if (zonesRes.error) throw new Error(zonesRes.error.message);
  if (roadsRes.error) throw new Error(roadsRes.error.message);

  const zones = (zonesRes.data ?? []).map((z) => ({
    id: z.id,
    name: z.zone_name,
    district: z.district,
    state: z.state,
    lat: z.centroid_lat,
    lng: z.centroid_lng,
    mean_slope_deg: z.mean_slope_deg,
    risk_level: z.current_risk_level ?? "UNKNOWN",
    risk_score: z.risk_score ?? 0,
    soil_moisture_pct: z.soil_moisture_pct,
    soil_moisture_status: z.soil_moisture_status,
    explanation: z.explanation,
    polygon: zonePolygon(z.id, z.centroid_lat, z.centroid_lng),
  }));

  const roads = (roadsRes.data ?? []).map((r) => ({
    id: r.id,
    zone_id: r.zone_id,
    road_name: r.road_name,
    segment_label: r.segment_label,
    status: r.status,
    length_km: r.length_km,
  }));

  const cfg = modelRes.data;
  const now = new Date();
  const validUntil = new Date(now.getTime() + 24 * 3600000);

  return {
    zones,
    roads,
    active_model: {
      model_version: cfg?.model_version ?? "v0.2-lr-trained",
      feature_schema_version: cfg?.feature_schema_version ?? "v1.0.0",
      pr_auc: cfg?.pr_auc ?? null,
      recall_at_80_precision: cfg?.recall_at_80_precision ?? null,
      cutoffs: {
        moderate: cfg?.cutoff_moderate ?? 38.0,
        high: cfg?.cutoff_high ?? 56.0,
        severe: cfg?.cutoff_severe ?? 74.0,
      },
      weights: {
        intensity: cfg?.weight_intensity ?? 0.38,
        antecedent: cfg?.weight_antecedent ?? 0.22,
        soil_moisture: cfg?.weight_soil_moisture ?? 0.18,
        slope: cfg?.weight_slope ?? 0.12,
        history: cfg?.weight_history ?? 0.1,
      },
    },
    cache_policy: {
      cached_at: now.toISOString(),
      valid_until: validUntil.toISOString(),
      max_age_hours: 24,
      is_expired: false,
      instructions:
        "Field cache is valid for 24 hours. When offline, risk scores reflect the last synchronization point. Inspect telemetry status before dispatching field teams.",
    },
  };
}
