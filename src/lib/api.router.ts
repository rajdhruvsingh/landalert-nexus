/**
 * src/lib/api.router.ts
 * =====================
 * Authoritative REST API Router for LandAlert-Nexus.
 * Exposes standardized, validated HTTP endpoints for:
 * - System & ML health checks
 * - Canonical ML risk prediction
 * - Weather ingestion (protected)
 * - Alert evaluation and dispatch
 * - Field observation offline synchronization
 * - GIS RFC 7946 GeoJSON layers
 */

import { getSystemHealth, getMLHealth } from "./health.service";
import { getRiskPrediction, validatePredictionInput } from "./ml.service";
import { evaluateAndDispatchAlert } from "./alert.service";
import { syncFieldObservations, getOfflinePackage } from "./sync.service";
import { getZonesGeoJson, getLandslidesGeoJson } from "./gis.service";
import { ingestLiveRainfallImpl } from "./monitoring.functions";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:5173", "http://localhost:8080"];

function getAllowedOrigin(requestOrigin: string | null): string | null {
  // Production: explicit allowlist via env var (e.g. https://landalert-nexus.onrender.com)
  const envOrigin = process.env["ALLOWED_ORIGIN"];
  if (envOrigin) {
    const allowed = envOrigin
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
    // If env is set, only allow listed origins + dev
    if (requestOrigin && DEV_ORIGINS.includes(requestOrigin)) return requestOrigin;
    return null;
  }
  // Development fallback: permit known local origins
  if (requestOrigin && DEV_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return null;
}

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getAllowedOrigin(requestOrigin);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function errorResponse(message: string, code: string, status = 400, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse(
    {
      error: message,
      code,
      status,
      timestamp: new Date().toISOString(),
    },
    status,
    extraHeaders,
  );
}

/**
 * Handles /api/* requests. Returns null if the request is not an /api route.
 */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/")) {
    return null;
  }

  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors } });
  }

  try {
    // 1. System Health
    if (pathname === "/api/health" && request.method === "GET") {
      const health = await getSystemHealth();
      const status = health.status === "unavailable" ? 503 : 200;
      return jsonResponse(health, status, cors);
    }

    // 2. ML Subsystem Health
    if (pathname === "/api/ml/health" && request.method === "GET") {
      const mlHealth = await getMLHealth();
      return jsonResponse(mlHealth, 200, cors);
    }

    // 3. Authoritative ML Risk Prediction
    if (pathname === "/api/risk-prediction" && request.method === "GET") {
      const zoneParam = url.searchParams.get("zoneId");
      const asOfParam = url.searchParams.get("asOfDate") ?? undefined;

      const validation = validatePredictionInput(zoneParam, asOfParam);
      if (!validation.valid || validation.zoneId === undefined) {
        return errorResponse(
          validation.error ?? "Invalid parameters",
          validation.code ?? "INVALID_INPUT",
          400,
          cors,
        );
      }

      const prediction = await getRiskPrediction(validation.zoneId, validation.asOfDate);
      return jsonResponse(prediction, 200, cors);
    }

    // 4. Live Weather Ingestion (Cron Protected)
    if (pathname === "/api/ingest-weather" && request.method === "POST") {
      const authError = await authenticateCronRequest(request);
      if (authError) return authError;

      const result = await ingestLiveRainfallImpl();
      return jsonResponse({ ok: true, ...result }, 200, cors);
    }

    // 5. Risk Recompute Trigger (Cron or Service Role Protected)
    if (pathname === "/api/recompute" && request.method === "POST") {
      const authError = await authenticateCronRequest(request);
      if (authError) return authError;

      const { error } = await supabaseAdmin.rpc("recompute_risk");
      if (error) {
        return errorResponse(`Recomputation failed: ${error.message}`, "DATABASE_ERROR", 500, cors);
      }
      return jsonResponse({ ok: true, timestamp: new Date().toISOString() }, 200, cors);
    }

    // 6. Alert Dispatch Service
    if (pathname === "/api/alerts/dispatch" && request.method === "POST") {
      let body: {
        zoneId?: unknown;
        language?: unknown;
        channel?: unknown;
        idempotencyKey?: unknown;
      } = {};
      try {
        body = await request.json();
      } catch {
        return errorResponse("Malformed JSON request body", "INVALID_JSON", 400, cors);
      }

      const validation = validatePredictionInput(body.zoneId);
      if (!validation.valid || validation.zoneId === undefined) {
        return errorResponse(
          validation.error ?? "Invalid zoneId",
          validation.code ?? "INVALID_ZONE_ID",
          400,
          cors,
        );
      }

      const prediction = await getRiskPrediction(validation.zoneId);
      const result = await evaluateAndDispatchAlert(prediction, {
        language:
          typeof body.language === "string" ? (body.language as "en" | "as" | "bn" | "ne") : "en",
        channel:
          typeof body.channel === "string" ? (body.channel as "sms" | "push" | "both") : "both",
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
        actor: "api_dispatch",
      });

      return jsonResponse(result, result.dispatched ? 201 : 200, cors);
    }

    // 7. Offline Field Observation Synchronization
    if (pathname === "/api/sync/observations" && request.method === "POST") {
      let body: { observations?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        return errorResponse("Malformed JSON body", "INVALID_JSON", 400, cors);
      }

      if (!Array.isArray(body.observations)) {
        return errorResponse("observations must be an array of records", "INVALID_INPUT", 400, cors);
      }

      const syncResult = await syncFieldObservations(body.observations);
      return jsonResponse(syncResult, syncResult.success ? 200 : 422, cors);
    }

    // 8. Offline Package Download
    if (pathname === "/api/sync/package" && request.method === "GET") {
      const pkg = await getOfflinePackage();
      return jsonResponse(pkg, 200, cors);
    }

    // 9. GIS GeoJSON - Risk Zones Layer
    if (pathname === "/api/gis/zones.geojson" && request.method === "GET") {
      const geojson = await getZonesGeoJson();
      return new Response(JSON.stringify(geojson, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/geo+json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=60",
          ...cors,
        },
      });
    }

    // 10. GIS GeoJSON - Landslides Layer
    if (pathname === "/api/gis/landslides.geojson" && request.method === "GET") {
      const geojson = await getLandslidesGeoJson();
      return new Response(JSON.stringify(geojson, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/geo+json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=300",
          ...cors,
        },
      });
    }

    return errorResponse(`Endpoint not found: ${pathname}`, "NOT_FOUND", 404, cors);
  } catch (error) {
    console.error(`[API Router] Unhandled error on ${pathname}:`, error);
    return errorResponse("An unexpected server error occurred", "INTERNAL_SERVER_ERROR", 500, cors);
  }
}
