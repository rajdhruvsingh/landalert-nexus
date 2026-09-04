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
export type ModelConfigRow = Database["public"]["Tables"]["risk_model_config"]["Row"];

export const getOverview = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const [zones, roads, alerts, modelConfig] = await Promise.all([
    sb.from("risk_zones").select("*").order("risk_score", { ascending: false }),
    sb.from("road_segments").select("*"),
    sb
      .from("alerts")
      .select("*")
      .order("dispatched_at", { ascending: false })
      .limit(30),
    sb
      .from("risk_model_config")
      .select("*")
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  if (zones.error) throw new Error(zones.error.message);
  return {
    zones: zones.data ?? [],
    roads: roads.data ?? [],
    alerts: alerts.data ?? [],
    activeModel: modelConfig.data ?? null,
  };
});

export const getZoneDetail = createServerFn({ method: "GET" })
  .inputValidator((data: { id: number }) => ({ id: Number(data.id) }))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [zone, readings, roads, slides, alerts, modelConfig] = await Promise.all([
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
      sb
        .from("risk_model_config")
        .select("*")
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    return {
      zone: zone.data ?? null,
      readings: readings.data ?? [],
      roads: roads.data ?? [],
      slides: slides.data ?? [],
      alerts: alerts.data ?? [],
      activeModel: modelConfig.data ?? null,
    };
  });

export const getActiveModelConfig = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data, error } = await sb
    .from("risk_model_config")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
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
 * Live observed-rainfall + soil-moisture ingestion.
 *
 * RAINFALL: Pulls daily precipitation totals from Open-Meteo forecast/reanalysis
 * (keyless, gridded IMD-comparable data). Station ID: 'OM-{zone.id}'.
 *
 * SOIL MOISTURE (Task B): Fetches hourly soil_moisture_0_to_1cm and
 * soil_moisture_1_to_3cm from Open-Meteo ERA5-Land, averages them to daily
 * means, and converts from m³/m³ (ERA5-Land units, typical range 0.05–0.40)
 * to a 0–100% scale using 0.40 m³/m³ as field-capacity reference.
 * Station ID: 'OM-SM-{zone.id}' — separate from rainfall rows so the
 * unique index (zone_id, station_id, reading_time) keeps both idempotent.
 *
 * Field-capacity reference: 0.40 m³/m³ is the ERA5-Land saturation proxy
 * for tropical/subtropical humid mountain soils — appropriate for NER.
 * Source: Albergel et al. (2012) Hydrol. Earth Syst. Sci. 16:2617-2636.
 */
export async function ingestLiveRainfallImpl() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: zones, error: zErr } = await supabaseAdmin
    .from("risk_zones")
    .select("id, centroid_lat, centroid_lng")
    .order("id");
  if (zErr) throw new Error(zErr.message);
  if (!zones?.length) return { zones: 0, readings: 0 };

  const lats = zones.map((z) => z.centroid_lat).join(",");
  const lngs = zones.map((z) => z.centroid_lng).join(",");

  // ── Fetch 1: daily rainfall (existing) ──────────────────────────────────
  const rainfallUrl =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lats}&longitude=${lngs}` +
    "&daily=precipitation_sum&past_days=7&forecast_days=1&timezone=UTC";

  // ── Fetch 2: hourly soil moisture — ERA5-Land 0-1cm and 1-3cm ──────────
  // We request past 7 days of hourly data and aggregate to daily means.
  // ERA5-Land soil moisture is the best freely-available proxy for NER
  // hill-slope pre-wetting; this replaces the seed fixture formula.
  const soilMoistureUrl =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lats}&longitude=${lngs}` +
    "&hourly=soil_moisture_0_to_1cm,soil_moisture_1_to_3cm" +
    "&past_days=7&forecast_days=1&timezone=UTC&models=era5";

  const [rainfallRes, soilRes] = await Promise.all([
    fetch(rainfallUrl),
    fetch(soilMoistureUrl),
  ]);

  if (!rainfallRes.ok) throw new Error(`Open-Meteo rainfall request failed (${rainfallRes.status})`);
  if (!soilRes.ok) throw new Error(`Open-Meteo soil moisture request failed (${soilRes.status})`);

  const rainfallPayload = await rainfallRes.json();
  const soilPayload = await soilRes.json();

  const rainfallSeries: Array<{
    daily?: { time: string[]; precipitation_sum: (number | null)[] };
  }> = Array.isArray(rainfallPayload) ? rainfallPayload : [rainfallPayload];

  const soilSeries: Array<{
    hourly?: {
      time: string[];
      soil_moisture_0_to_1cm: (number | null)[];
      soil_moisture_1_to_3cm: (number | null)[];
    };
  }> = Array.isArray(soilPayload) ? soilPayload : [soilPayload];

  const rainfallRows: Array<{
    zone_id: number;
    station_id: string;
    reading_time: string;
    rainfall_mm: number;
    source: string;
  }> = [];

  const soilRows: Array<{
    zone_id: number;
    station_id: string;
    reading_time: string;
    rainfall_mm: number;
    soil_moisture_pct: number;
    source: string;
  }> = [];

  // Field-capacity constant for m³/m³ → % conversion
  const FIELD_CAPACITY_M3_M3 = 0.40;

  zones.forEach((zone, i) => {
    // Rainfall rows (unchanged logic)
    const daily = rainfallSeries[i]?.daily;
    if (daily) {
      daily.time.forEach((day, d) => {
        rainfallRows.push({
          zone_id: zone.id,
          station_id: `OM-${zone.id}`,
          reading_time: `${day}T00:00:00+00:00`,
          rainfall_mm: daily.precipitation_sum[d] ?? 0,
          source: "Open-Meteo observed daily precipitation",
        });
      });
    }

    // Soil moisture rows — aggregate hourly → daily means
    const hourly = soilSeries[i]?.hourly;
    if (hourly) {
      // Group hourly readings by calendar date
      const dayMap = new Map<string, { sum0: number; sum1: number; count: number }>();
      hourly.time.forEach((isoHour, h) => {
        const day = isoHour.slice(0, 10); // 'YYYY-MM-DD'
        const sm0 = hourly.soil_moisture_0_to_1cm[h];
        const sm1 = hourly.soil_moisture_1_to_3cm[h];
        if (sm0 == null && sm1 == null) return;
        const cur = dayMap.get(day) ?? { sum0: 0, sum1: 0, count: 0 };
        cur.sum0 += sm0 ?? 0;
        cur.sum1 += sm1 ?? 0;
        cur.count += 1;
        dayMap.set(day, cur);
      });

      dayMap.forEach(({ sum0, sum1, count }, day) => {
        if (count === 0) return;
        // Average the two depth layers (0-1cm and 1-3cm) to get 0-3cm mean
        const avgM3M3 = (sum0 + sum1) / (2 * count);
        // Normalize to 0-100% using field-capacity reference
        const pct = Math.min(100, Math.max(0, (avgM3M3 / FIELD_CAPACITY_M3_M3) * 100));
        soilRows.push({
          zone_id: zone.id,
          station_id: `OM-SM-${zone.id}`,
          reading_time: `${day}T00:00:00+00:00`,
          rainfall_mm: 0, // soil moisture rows carry no rainfall
          soil_moisture_pct: Math.round(pct * 10) / 10,
          source:
            "Open-Meteo ERA5-Land soil_moisture_0_to_3cm_avg " +
            "(m³/m³ daily mean → 0-100% normalized at 0.40 m³/m³ field-capacity; " +
            "Albergel et al. 2012 Hydrol. Earth Syst. Sci. 16:2617-2636)",
        });
      });
    }
  });

  // Upsert rainfall rows
  if (rainfallRows.length) {
    const { error } = await supabaseAdmin
      .from("weather_readings")
      .upsert(rainfallRows, { onConflict: "zone_id,station_id,reading_time" });
    if (error) throw new Error(`Rainfall upsert failed: ${error.message}`);
  }

  // Upsert soil moisture rows (separate station_id keeps unique index clean)
  if (soilRows.length) {
    const { error } = await supabaseAdmin
      .from("weather_readings")
      .upsert(soilRows, { onConflict: "zone_id,station_id,reading_time" });
    if (error) throw new Error(`Soil moisture upsert failed: ${error.message}`);
  }

  const { error: rErr } = await supabaseAdmin.rpc("recompute_risk");
  if (rErr) throw new Error(rErr.message);

  return {
    zones: zones.length,
    readings: rainfallRows.length,
    soilReadings: soilRows.length,
  };
}

export const ingestLiveRainfall = createServerFn({ method: "POST" }).handler(
  async () => ingestLiveRainfallImpl(),
);
