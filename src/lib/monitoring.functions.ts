import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || "sb_publishable_default_key";
  const url = process.env["SUPABASE_URL"] || "https://shkpwbqcbeqlybdrhczq.supabase.co";
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
export type ObservationRow = Database["public"]["Tables"]["field_observations"]["Row"];

let dbPool: any = null;
async function getDbPool() {
  if (!dbPool && process.env["DATABASE_URL"]) {
    try {
      const pgModule: any = await import("pg");
      const PoolClass = pgModule.default?.Pool || pgModule.Pool;
      dbPool = new PoolClass({
        connectionString: process.env["DATABASE_URL"],
        connectionTimeoutMillis: 3000,
      });
    } catch (e) {
      console.error("[getDbPool] Error initializing pg pool:", e);
    }
  }
  return dbPool;
}

export const getOverview = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const sb = publicClient();
    const [zones, roads, alerts, modelConfig, candidateConfig, observations] = await Promise.all([
      sb.from("risk_zones").select("*").order("risk_score", { ascending: false }),
      sb.from("road_segments").select("*"),
      sb.from("alerts").select("*").order("dispatched_at", { ascending: false }).limit(30),
      sb.from("risk_model_config").select("*").eq("is_active", true).maybeSingle(),
      sb
        .from("risk_model_config")
        .select("*")
        .eq("is_active", false)
        .in("status", ["validated", "candidate"])
        .order("trained_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from("field_observations").select("*").order("observed_at", { ascending: false }).limit(20),
    ]);
    if (!zones.error && zones.data) {
      return {
        zones: zones.data ?? [],
        roads: roads.data ?? [],
        alerts: alerts.data ?? [],
        activeModel: modelConfig.data ?? null,
        candidateModel: candidateConfig?.data ?? null,
        observations: observations?.data ?? [],
      };
    }
  } catch {
    // Proceed to Postgres fallback if available
  }

  // Authoritative Postgres fallback
  const pool = await getDbPool();
  if (pool) {
    try {
      const [zRes, rRes, aRes, mRes, cRes, oRes] = await Promise.all([
        pool.query("SELECT * FROM risk_zones ORDER BY risk_score DESC"),
        pool.query("SELECT * FROM road_segments"),
        pool.query("SELECT * FROM alerts ORDER BY dispatched_at DESC LIMIT 30"),
        pool.query("SELECT * FROM risk_model_config WHERE is_active = true LIMIT 1"),
        pool.query(
          "SELECT * FROM risk_model_config WHERE is_active = false AND status IN ('validated', 'candidate') ORDER BY trained_at DESC LIMIT 1"
        ),
        pool.query("SELECT * FROM field_observations ORDER BY observed_at DESC LIMIT 20"),
      ]);
      return {
        zones: zRes.rows || [],
        roads: rRes.rows || [],
        alerts: aRes.rows || [],
        activeModel: mRes.rows[0] || null,
        candidateModel: cRes.rows[0] || null,
        observations: oRes.rows || [],
      };
    } catch (pgErr) {
      console.error("[getOverview] Postgres fallback query error:", pgErr);
    }
  }

  return {
    zones: [],
    roads: [],
    alerts: [],
    activeModel: null,
    candidateModel: null,
    observations: [],
  };
});

export const getZoneDetail = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => ({ id: Number(data.id) }))
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

export const getCandidateModelConfig = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data, error } = await sb
    .from("risk_model_config")
    .select("*")
    .eq("is_active", false)
    .in("status", ["validated", "candidate"])
    .order("trained_at", { ascending: false })
    .limit(1)
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
  .validator((data: { zoneId: number; rainfallMm: number }) => ({
    zoneId: Number(data.zoneId),
    rainfallMm: Math.max(0, Math.min(600, Number(data.rainfallMm))),
  }))
  .handler(async ({ data }) => {
    const { simulateRainfallSpikeImpl } = await import("./monitoring.server");
    return simulateRainfallSpikeImpl(data.zoneId, data.rainfallMm);
  });

export const recomputeAll = createServerFn({ method: "POST" }).handler(async () => {
  const { recomputeAllImpl } = await import("./monitoring.server");
  return recomputeAllImpl();
});

export const ingestLiveRainfall = createServerFn({ method: "POST" }).handler(async () => {
  const { ingestLiveRainfallImpl } = await import("./monitoring.server");
  return ingestLiveRainfallImpl();
});

export const getWeatherRiskForecastsServerFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getAllWeatherForecastProjections } = await import("./forecast.service");
    return getAllWeatherForecastProjections();
  },
);

export const getZoneWeatherRiskForecastServerFn = createServerFn({ method: "GET" })
  .validator((data: { zoneId: number }) => ({ zoneId: Number(data.zoneId) }))
  .handler(async ({ data }) => {
    const { getZoneWeatherForecastProjection } = await import("./forecast.service");
    return getZoneWeatherForecastProjection(data.zoneId);
  });

export const getResponsePrioritizationServerFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const sb = publicClient();
    const [zonesRes, roadsRes, obsRes] = await Promise.all([
      sb.from("risk_zones").select("*").order("id"),
      sb.from("road_segments").select("*").order("id"),
      sb
        .from("field_observations")
        .select("*")
        .order("observed_at", { ascending: false })
        .limit(50),
    ]);

    if (zonesRes.error) throw new Error(zonesRes.error.message);

    const zones = zonesRes.data ?? [];
    const roads = roadsRes.data ?? [];
    const observations = obsRes.data ?? [];

    const zoneInputs = zones.map((z) => ({
      zoneId: z.id,
      zoneName: z.zone_name,
      district: z.district,
      state: z.state,
      currentRiskLevel: z.current_risk_level,
      population: z.population,
      roadSegments: roads
        .filter((r) => r.zone_id === z.id)
        .map((r) => ({
          id: r.id,
          roadName: r.road_name,
          segmentLabel: r.segment_label,
          status: r.status,
        })),
      fieldObservations: observations
        .filter((o) => o.zone_id === z.id)
        .map((o) => ({
          id: o.id,
          status: (o as any).status ?? undefined,
          roadStatus: o.road_status ?? undefined,
          visualSigns: o.visual_signs ?? undefined,
          rainfallMm: o.rainfall_mm ?? undefined,
        })),
    }));

    const { evaluateEmergencyPrioritization } = await import("./prioritization.service");
    return evaluateEmergencyPrioritization(zoneInputs);
  },
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

export const retractAlertServerFn = createServerFn({ method: "POST" })
  .validator((data: { alertId: number; reason: string; authToken?: string }) => ({
    alertId: Number(data.alertId),
    reason: String(data.reason || "").trim(),
    authToken: data.authToken,
  }))
  .handler(async ({ data }) => {
    const { getSessionProfile } = await import("./official-auth.service");
    const profile = await getSessionProfile(data.authToken);

    const isAuthorized =
      profile &&
      (profile.role === "DISPATCHER" || profile.role === "ADMIN" || profile.dispatch_authorized);

    if (!isAuthorized) {
      throw new Error("Emergency alert retraction requires authorized DISPATCHER or ADMIN role.");
    }

    const { retractAlert } = await import("./alert.service");
    return retractAlert({
      alertId: data.alertId,
      reason: data.reason,
      retractedBy: profile.email || profile.id,
    });
  });

export interface LocationRiskResult {
  matched: boolean;
  zone: {
    id: number;
    zone_name: string;
    district: string;
    state: string;
    current_risk_level: string;
    risk_score: number;
    explanation: string | null;
    centroid_lat: number;
    centroid_lng: number;
    mean_slope_deg?: number;
    population?: number;
  } | null;
  userCoords: {
    lat: number;
    lng: number;
  };
}

export async function getRiskForLocation(lat: number, lng: number): Promise<LocationRiskResult> {
  const sb = publicClient();
  const { data: zones, error } = await sb
    .from("risk_zones")
    .select("id, zone_name, district, state, current_risk_level, risk_score, explanation, centroid_lat, centroid_lng, mean_slope_deg, population")
    .order("id");

  if (error) {
    throw new Error(error.message);
  }

  const { findMatchingZone } = await import("./risk");
  const matched = findMatchingZone(lat, lng, zones ?? []);

  if (!matched) {
    return {
      matched: false,
      zone: null,
      userCoords: { lat, lng },
    };
  }

  return {
    matched: true,
    zone: {
      id: matched.id,
      zone_name: matched.zone_name,
      district: matched.district,
      state: matched.state,
      current_risk_level: matched.current_risk_level,
      risk_score: matched.risk_score,
      explanation: matched.explanation,
      centroid_lat: matched.centroid_lat,
      centroid_lng: matched.centroid_lng,
      mean_slope_deg: matched.mean_slope_deg,
      population: matched.population,
    },
    userCoords: { lat, lng },
  };
}

export const getRiskForLocationServerFn = createServerFn({ method: "GET" })
  .validator((data: { lat: number; lng: number }) => ({
    lat: Number(data.lat),
    lng: Number(data.lng),
  }))
  .handler(async ({ data }): Promise<LocationRiskResult> => {
    return getRiskForLocation(data.lat, data.lng);
  });
