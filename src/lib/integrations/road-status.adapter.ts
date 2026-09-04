/**
 * src/lib/integrations/road-status.adapter.ts
 * ==========================================
 * Border Roads Organisation (BRO) & State PWD Live Road Status Ingestion Adapter.
 *
 * Updates arterial hill road connectivity, landslides cutoffs, and clearance ETAs across NER.
 *
 * Scaffolding Note:
 * Production-ready ingestion schema matching BRO Project SEWAK / PUSHPAT dispatch formats.
 * Activation requires an institutional data-sharing MOU with Ministry of Road Transport & Highways (MoRTH)
 * or BRO headquarters. See docs/EXTERNAL_INTEGRATIONS_PENDING.md.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface RoadStatusUpdatePayload {
  highway_code: string; // e.g., "NH-29", "NH-37", "NH-102"
  segment_label: string;
  status: "open" | "restricted" | "blocked";
  reason?: string;
  clearing_eta?: string; // ISO 8601
  reported_by: string; // e.g., "BRO_SEWAK_UNIT_42", "MANIPUR_PWD_CONTROL"
  latitude?: number;
  longitude?: number;
}

export interface RoadIngestionResult {
  success: boolean;
  updatedSegments: number;
  errors: string[];
}

export async function processRoadStatusUpdate(
  updates: RoadStatusUpdatePayload[],
  apiKey?: string | null,
): Promise<RoadIngestionResult> {
  const expectedKey = process.env.ROAD_STATUS_API_KEY;
  if (!expectedKey || expectedKey.trim() === "") {
    throw new Error(
      "ROAD_STATUS_UNCONFIGURED: ROAD_STATUS_API_KEY is not configured in server environment. BRO/PWD data-sharing agreement required.",
    );
  }

  const token = apiKey?.startsWith("Bearer ") ? apiKey.substring(7).trim() : apiKey?.trim();
  if (token !== expectedKey) {
    throw new Error("ROAD_STATUS_AUTH_FAILED: Invalid road status API token.");
  }

  if (!Array.isArray(updates) || updates.length === 0) {
    return { success: true, updatedSegments: 0, errors: [] };
  }

  const errors: string[] = [];
  let updatedCount = 0;

  for (const item of updates) {
    if (!item.highway_code || !item.status) {
      errors.push("Missing mandatory highway_code or status.");
      continue;
    }

    // Update matching road_segments
    const { data: matched, error: matchErr } = await supabaseAdmin
      .from("road_segments")
      .select("id, road_name, segment_label")
      .ilike("road_name", `%${item.highway_code}%`);

    if (matchErr || !matched || matched.length === 0) {
      errors.push(`Highway ${item.highway_code}: No matching mapped road segment in database.`);
      continue;
    }

    for (const r of matched) {
      const { error: updErr } = await supabaseAdmin
        .from("road_segments")
        .update({ status: item.status })
        .eq("id", r.id);

      if (updErr) {
        errors.push(`Segment ${r.id} (${r.road_name}): Update failed - ${updErr.message}`);
      } else {
        updatedCount++;
      }
    }
  }

  return {
    success: errors.length === 0,
    updatedSegments: updatedCount,
    errors,
  };
}
