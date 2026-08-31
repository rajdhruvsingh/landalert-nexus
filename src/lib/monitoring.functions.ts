import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const url = process.env["SUPABASE_URL"]!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type ZoneRow = Database["public"]["Tables"]["risk_zones"]["Row"];
export type AlertRow = Database["public"]["Tables"]["alerts"]["Row"];
export type RoadRow = Database["public"]["Tables"]["road_segments"]["Row"];
export type ReadingRow = Database["public"]["Tables"]["weather_readings"]["Row"];
export type SlideRow = Database["public"]["Tables"]["historical_landslides"]["Row"];

export const getOverview = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const [zones, roads, alerts] = await Promise.all([
    sb.from("risk_zones").select("*").order("risk_score", { ascending: false }),
    sb.from("road_segments").select("*"),
    sb
      .from("alerts")
      .select("*")
      .order("dispatched_at", { ascending: false })
      .limit(30),
  ]);
  if (zones.error) throw new Error(zones.error.message);
  return {
    zones: zones.data ?? [],
    roads: roads.data ?? [],
    alerts: alerts.data ?? [],
  };
});

export const getZoneDetail = createServerFn({ method: "GET" })
  .inputValidator((data: { id: number }) => ({ id: Number(data.id) }))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [zone, readings, roads, slides, alerts] = await Promise.all([
      sb.from("risk_zones").select("*").eq("id", data.id).maybeSingle(),
      sb
        .from("weather_readings")
        .select("*")
        .eq("zone_id", data.id)
        .order("reading_time", { ascending: true }),
      sb.from("road_segments").select("*").eq("zone_id", data.id),
      sb
        .from("historical_landslides")
        .select("*")
        .eq("zone_id", data.id)
        .order("event_date", { ascending: false }),
      sb
        .from("alerts")
        .select("*")
        .eq("zone_id", data.id)
        .order("dispatched_at", { ascending: false })
        .limit(10),
    ]);
    return {
      zone: zone.data ?? null,
      readings: readings.data ?? [],
      roads: roads.data ?? [],
      slides: slides.data ?? [],
      alerts: alerts.data ?? [],
    };
  });

/**
 * Demo control used in the end-to-end walkthrough: inject a rainfall spike for a
 * zone, re-run the threshold + terrain risk engine, and let the rules engine
 * raise alerts for any zone that crosses into High/Severe.
 */
export const simulateRainfallSpike = createServerFn({ method: "POST" })
  .inputValidator((data: { zoneId: number; rainfallMm: number }) => ({
    zoneId: Number(data.zoneId),
    rainfallMm: Math.max(0, Math.min(600, Number(data.rainfallMm))),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: insErr } = await supabaseAdmin.from("weather_readings").insert({
      zone_id: data.zoneId,
      station_id: `SIM-${data.zoneId}`,
      rainfall_mm: data.rainfallMm,
      soil_moisture_pct: 92,
      source: "Simulated spike (demo)",
    });
    if (insErr) throw new Error(insErr.message);
    const { error } = await supabaseAdmin.rpc("recompute_risk");
    if (error) throw new Error(error.message);
    const { data: zone } = await supabaseAdmin
      .from("risk_zones")
      .select("*")
      .eq("id", data.zoneId)
      .maybeSingle();
    return { zone };
  });

export const recomputeAll = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("recompute_risk");
  if (error) throw new Error(error.message);
  return { ok: true };
});
