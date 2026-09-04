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

/**
 * Live observed-rainfall ingestion. Pulls daily precipitation totals for every
 * zone centroid from the Open-Meteo reanalysis/forecast API (keyless, gridded
 * IMD-comparable data), upserts them as station readings and re-runs the
 * threshold engine. Safe to run repeatedly: the unique index on
 * (zone_id, station_id, reading_time) makes each day idempotent.
 */
export async function ingestLiveRainfallImpl() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: zones, error: zErr } = await supabaseAdmin
    .from("risk_zones")
    .select("id, centroid_lat, centroid_lng")
    .order("id");
  if (zErr) throw new Error(zErr.message);
  if (!zones?.length) return { zones: 0, readings: 0 };

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${zones.map((z) => z.centroid_lat).join(",")}` +
    `&longitude=${zones.map((z) => z.centroid_lng).join(",")}` +
    "&daily=precipitation_sum&past_days=7&forecast_days=1&timezone=UTC";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  const payload = await res.json();
  const series: Array<{ daily?: { time: string[]; precipitation_sum: (number | null)[] } }> =
    Array.isArray(payload) ? payload : [payload];

  const rows: Array<{
    zone_id: number;
    station_id: string;
    reading_time: string;
    rainfall_mm: number;
    source: string;
  }> = [];

  zones.forEach((zone, i) => {
    const daily = series[i]?.daily;
    if (!daily) return;
    daily.time.forEach((day, d) => {
      rows.push({
        zone_id: zone.id,
        station_id: `OM-${zone.id}`,
        reading_time: `${day}T00:00:00+00:00`,
        rainfall_mm: daily.precipitation_sum[d] ?? 0,
        source: "Open-Meteo observed daily precipitation",
      });
    });
  });

  if (rows.length) {
    const { error } = await supabaseAdmin
      .from("weather_readings")
      .upsert(rows, { onConflict: "zone_id,station_id,reading_time" });
    if (error) throw new Error(error.message);
  }

  const { error: rErr } = await supabaseAdmin.rpc("recompute_risk");
  if (rErr) throw new Error(rErr.message);

  return { zones: zones.length, readings: rows.length };
}

export const ingestLiveRainfall = createServerFn({ method: "POST" }).handler(
  async () => ingestLiveRainfallImpl(),
);

