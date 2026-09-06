import "@tanstack/react-start/server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const CANONICAL_ZONES = [
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

export async function simulateRainfallSpikeImpl(zoneId: number, rainfallMm: number) {
  if (process.env["ENABLE_SIMULATION"] !== "true") {
    throw new Error(
      "Simulation functionality is disabled in production environment. Operational controls only accept verified live telemetry or authorized official dispatches.",
    );
  }
  const { error: insErr } = await supabaseAdmin.from("weather_readings").insert({
    zone_id: zoneId,
    station_id: `SIM-${zoneId}`,
    rainfall_mm: rainfallMm,
    soil_moisture_pct: 92,
    source: "Simulated spike (test/non-operational)",
  });
  if (insErr) throw new Error(insErr.message);
  const { error } = await supabaseAdmin.rpc("recompute_risk");
  if (error) throw new Error(error.message);
  const { data: zone } = await supabaseAdmin
    .from("risk_zones")
    .select("*")
    .eq("id", zoneId)
    .maybeSingle();
  return { zone };
}

export async function recomputeAllImpl() {
  const { error } = await supabaseAdmin.rpc("recompute_risk");
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function ingestLiveRainfallImpl() {
  try {
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

    // ── Fetch 1: daily rainfall (keyless Open-Meteo with 4-day short-range forecast) ──
    const rainfallUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lats}&longitude=${lngs}` +
      "&daily=precipitation_sum&past_days=7&forecast_days=4&timezone=UTC";

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
    const todayIso = new Date().toISOString().slice(0, 10);

    zones.forEach((zone, i) => {
      const daily = rainfallSeries[i]?.daily;
      if (daily) {
        daily.time.forEach((day, d) => {
          // Strict temporal boundary: Only historical/observed days (<= today) are written to weather_readings
          if (day <= todayIso) {
            rainfallRows.push({
              zone_id: zone.id,
              station_id: `OM-${zone.id}`,
              reading_time: `${day}T00:00:00+00:00`,
              rainfall_mm: Math.max(0, Math.min(1200, daily.precipitation_sum[d] ?? 0)),
              source: "Open-Meteo observed daily precipitation",
            });
          }
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
