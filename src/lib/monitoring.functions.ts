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
    sb.from("alerts").select("*").order("dispatched_at", { ascending: false }).limit(30),
    sb.from("risk_model_config").select("*").eq("is_active", true).maybeSingle(),
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
    const [zone, readings, roads, slides, alerts, modelConfig, observations] = await Promise.all([
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
      sb.from("risk_model_config").select("*").eq("is_active", true).maybeSingle(),
      sb
        .from("field_observations")
        .select("*")
        .eq("zone_id", data.id)
        .order("observed_at", { ascending: false })
        .limit(10),
    ]);
    return {
      zone: zone.data ?? null,
      readings: readings.data ?? [],
      roads: roads.data ?? [],
      slides: slides.data ?? [],
      alerts: alerts.data ?? [],
      activeModel: modelConfig.data ?? null,
      observations: observations.data ?? [],
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
    if (process.env["ENABLE_SIMULATION"] !== "true") {
      throw new Error(
        "Simulation functionality is disabled in production environment. Operational controls only accept verified live telemetry or authorized official dispatches.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: insErr } = await supabaseAdmin.from("weather_readings").insert({
      zone_id: data.zoneId,
      station_id: `SIM-${data.zoneId}`,
      rainfall_mm: data.rainfallMm,
      soil_moisture_pct: 92,
      source: "Simulated spike (test/non-operational)",
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
async function fetchWithRetry(url: string, retries = 3, backoffMs = 500): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, backoffMs * attempt));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Fetch failed after ${retries} attempts for ${url}`);
}

const CANONICAL_ZONES = [
  { id: 1, centroid_lat: 25.5788, centroid_lng: 91.8933 },
  { id: 2, centroid_lat: 26.1445, centroid_lng: 91.7362 },
  { id: 3, centroid_lat: 25.6751, centroid_lng: 94.1086 },
  { id: 4, centroid_lat: 27.3389, centroid_lng: 88.6065 },
  { id: 5, centroid_lat: 23.7271, centroid_lng: 92.7176 },
  { id: 6, centroid_lat: 27.0844, centroid_lng: 93.6053 },
  { id: 7, centroid_lat: 25.3000, centroid_lng: 91.7000 },
  { id: 8, centroid_lat: 25.6000, centroid_lng: 91.2000 },
  { id: 9, centroid_lat: 23.7300, centroid_lng: 92.7100 },
  { id: 10, centroid_lat: 22.8800, centroid_lng: 92.7300 },
  { id: 11, centroid_lat: 25.6700, centroid_lng: 94.1100 },
  { id: 12, centroid_lat: 26.1000, centroid_lng: 94.2600 },
  { id: 13, centroid_lat: 27.1000, centroid_lng: 93.6200 },
  { id: 14, centroid_lat: 27.2600, centroid_lng: 92.4200 },
  { id: 15, centroid_lat: 25.1700, centroid_lng: 93.0200 },
];

export async function ingestLiveRainfallImpl() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let zones: Array<{ id: number; centroid_lat: number; centroid_lng: number }> = [];
    try {
      const { data, error: zErr } = await supabaseAdmin
        .from("risk_zones")
        .select("id, centroid_lat, centroid_lng")
        .order("id");
      if (!zErr && data && data.length > 0) {
        zones = data;
      } else {
        zones = CANONICAL_ZONES;
      }
    } catch {
      zones = CANONICAL_ZONES;
    }

    if (!zones.length) return { zones: 0, readings: 0 };

    const lats = zones.map((z) => z.centroid_lat).join(",");
    const lngs = zones.map((z) => z.centroid_lng).join(",");

    // ── Fetch 1: daily rainfall (keyless Open-Meteo) ──────────────────────────
    const rainfallUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lats}&longitude=${lngs}` +
      "&daily=precipitation_sum&past_days=7&forecast_days=1&timezone=UTC";

    // ── Fetch 2: hourly soil moisture — ERA5-Land 0-1cm and 1-3cm ──────────
    const soilMoistureUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lats}&longitude=${lngs}` +
      "&hourly=soil_moisture_0_to_1cm,soil_moisture_1_to_3cm" +
      "&past_days=7&forecast_days=1&timezone=UTC&models=era5";

    const [rainfallRes, soilRes] = await Promise.all([
      fetchWithRetry(rainfallUrl),
      fetchWithRetry(soilMoistureUrl),
    ]);

    if (!rainfallRes.ok)
      throw new Error(`Open-Meteo rainfall request failed (${rainfallRes.status})`);
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

    const FIELD_CAPACITY_M3_M3 = 0.4;

    zones.forEach((zone, i) => {
      const daily = rainfallSeries[i]?.daily;
      if (daily) {
        daily.time.forEach((day, d) => {
          rainfallRows.push({
            zone_id: zone.id,
            station_id: `OM-${zone.id}`,
            reading_time: `${day}T00:00:00+00:00`,
            rainfall_mm: Math.max(0, Math.min(1200, daily.precipitation_sum[d] ?? 0)),
            source: "Open-Meteo observed daily precipitation",
          });
        });
      }

      const hourly = soilSeries[i]?.hourly;
      if (hourly) {
        const dayMap = new Map<string, { sum0: number; sum1: number; count: number }>();
        hourly.time.forEach((isoHour, h) => {
          const day = isoHour.slice(0, 10);
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
          const avgM3M3 = (sum0 + sum1) / (2 * count);
          const pct = Math.min(100, Math.max(0, (avgM3M3 / FIELD_CAPACITY_M3_M3) * 100));
          soilRows.push({
            zone_id: zone.id,
            station_id: `OM-SM-${zone.id}`,
            reading_time: `${day}T00:00:00+00:00`,
            rainfall_mm: 0,
            soil_moisture_pct: Math.round(pct * 10) / 10,
            source:
              "Open-Meteo ERA5-Land soil_moisture_0_to_3cm_avg " +
              "(m³/m³ daily mean → 0-100% normalized at 0.40 m³/m³ field-capacity; " +
              "Albergel et al. 2012 Hydrol. Earth Syst. Sci. 16:2617-2636)",
          });
        });
      }
    });

    if (rainfallRows.length) {
      const { error } = await supabaseAdmin
        .from("weather_readings")
        .upsert(rainfallRows, { onConflict: "zone_id,station_id,reading_time" });
      if (error) throw new Error(error.message);
    }

    if (soilRows.length) {
      const { error } = await supabaseAdmin
        .from("weather_readings")
        .upsert(soilRows, { onConflict: "zone_id,station_id,reading_time" });
      if (error) throw new Error(error.message);
    }

    const { error: rErr } = await supabaseAdmin.rpc("recompute_risk");
    if (rErr) console.warn("[Recompute RPC warning]", rErr.message);

    return {
      zones: zones.length,
      readings: rainfallRows.length,
      soilReadings: soilRows.length,
    };
  } catch (err) {
    console.error("[Weather Ingest Error]", err instanceof Error ? err.message : err);
    throw new Error("Live weather ingestion unavailable. Showing the last verified dataset.");
  }
}

export const ingestLiveRainfall = createServerFn({ method: "POST" }).handler(async () =>
  ingestLiveRainfallImpl(),
);

export const getRiskPredictionServerFn = createServerFn({ method: "GET" })
  .validator((data: { zoneId: number; asOfDate?: string }) => ({
    zoneId: Number(data.zoneId),
    asOfDate: data.asOfDate,
  }))
  .handler(async ({ data }) => {
    const { getRiskPrediction } = await import("./ml.service");
    return getRiskPrediction(data.zoneId, data.asOfDate);
  });

export const getSystemHealthServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getSystemHealth } = await import("./health.service");
  return getSystemHealth();
});

export const getMLHealthServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getMLHealth } = await import("./health.service");
  return getMLHealth();
});

export const getOfflinePackageServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getOfflinePackage } = await import("./sync.service");
  return getOfflinePackage();
});

export const getZonesGeoJsonServerFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getZonesGeoJson } = await import("./gis.service");
  return getZonesGeoJson();
});

export const dispatchAlertServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      zoneId: number;
      language?: "en" | "as" | "bn" | "ne";
      channel?: "sms" | "push" | "both";
      idempotencyKey?: string;
      justification?: string;
      userToken?: string;
    }) => ({
      zoneId: Number(data.zoneId),
      language: data.language,
      channel: data.channel,
      idempotencyKey: data.idempotencyKey,
      justification: data.justification,
      userToken: data.userToken,
    }),
  )
  .handler(async ({ data }) => {
    const { getRiskPrediction } = await import("./ml.service");
    const { evaluateAndDispatchAlert } = await import("./alert.service");
    const { authenticateToken, verifyDispatcherAuthorization } = await import("./official-auth.service");

    let profile = null;
    if (data.userToken) {
      profile = await authenticateToken(data.userToken);
    }

    const actorInfo = profile
      ? {
          userId: profile.id,
          email: profile.email,
          role: profile.role,
          dispatchAuthorized: profile.dispatch_authorized,
          ...(profile.institution ? { institution: profile.institution } : {}),
        }
      : {
          userId: "unauthenticated_caller",
          role: "PUBLIC_USER" as const,
          dispatchAuthorized: false,
        };

    const authCheck = await verifyDispatcherAuthorization(
      actorInfo,
      data.zoneId,
      data.justification || "Official operational emergency dispatch",
    );

    if (!authCheck.authorized) {
      throw new Error(authCheck.reason || "Emergency dispatch requires authorized DISPATCHER credentials.");
    }

    const prediction = await getRiskPrediction(data.zoneId);
    return evaluateAndDispatchAlert(prediction, {
      language: data.language,
      channel: data.channel,
      idempotencyKey: data.idempotencyKey,
      actor: profile ? `dispatcher:${profile.email}` : "dispatcher:authorized_operator",
      justification: data.justification || "Official dispatcher emergency authorization",
    });
  });

export const submitFieldObservationsServerFn = createServerFn({ method: "POST" })
  .validator((data: { observations: import("./sync.service").FieldObservationInput[] }) => ({
    observations: data.observations,
  }))
  .handler(async ({ data }) => {
    const { syncFieldObservations } = await import("./sync.service");
    return syncFieldObservations(data.observations);
  });
