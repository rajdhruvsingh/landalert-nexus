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
import { getSatelliteLayerStatus, fetchSatelliteTile } from "./satellite.service";
import { processIMDTelemetry } from "./integrations/imd.adapter";
import { processSensorTelemetry } from "./integrations/sensors.adapter";
import { processRoadStatusUpdate } from "./integrations/road-status.adapter";
import {
  defaultRateLimiter,
  RATE_LIMIT_POLICIES,
  getClientIdentifier,
} from "./rate-limiter";

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

    // 6. Alert Dispatch Service (Explicit Dispatcher Authorization Required)
    if (pathname === "/api/alerts/dispatch" && request.method === "POST") {
      const clientKey = `alert_dispatch:${getClientIdentifier(request)}`;
      const limitResult = defaultRateLimiter.checkLimit(clientKey, RATE_LIMIT_POLICIES.ALERT_DISPATCH);
      if (!limitResult.allowed) {
        return errorResponse(
          `Rate limit exceeded for alert dispatch. Maximum ${RATE_LIMIT_POLICIES.ALERT_DISPATCH.maxRequests} requests per ${RATE_LIMIT_POLICIES.ALERT_DISPATCH.windowSeconds}s.`,
          "RATE_LIMIT_EXCEEDED",
          429,
          {
            ...cors,
            "Retry-After": String(limitResult.resetSeconds),
            "X-RateLimit-Limit": String(limitResult.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(limitResult.resetSeconds),
          },
        );
      }

      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return errorResponse("Authentication required for emergency dispatch", "UNAUTHORIZED", 401, cors);
      }

      const { authenticateToken, verifyDispatcherAuthorization } = await import("./official-auth.service");
      const profile = await authenticateToken(authHeader);

      let isAuthorized = false;
      let actorId = "api_dispatcher";
      let actorRole = "PUBLIC_USER";
      let dispatchAuth = false;

      // System token / cron secret fallback for backend tests / automated services
      const cronSecret = process.env["CRON_SECRET"];
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const isSystemSecret = cronSecret && token === cronSecret;

      if (isSystemSecret) {
        isAuthorized = true;
        actorId = "system:cron_dispatcher";
        actorRole = "DISPATCHER";
        dispatchAuth = true;
      } else if (profile) {
        actorId = profile.id;
        actorRole = profile.role;
        dispatchAuth = profile.dispatch_authorized;
        isAuthorized = profile.role === "DISPATCHER" || profile.role === "ADMIN" || profile.dispatch_authorized;
      }

      if (!isAuthorized) {
        return errorResponse(
          "Forbidden: Emergency dispatch requires authorized DISPATCHER or ADMIN credentials",
          "FORBIDDEN",
          403,
          cors,
        );
      }

      let body: {
        zoneId?: unknown;
        language?: unknown;
        channel?: unknown;
        idempotencyKey?: unknown;
        justification?: unknown;
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

      const justification = typeof body.justification === "string" ? body.justification.trim() : "";
      if (!justification || justification.length < 8) {
        return errorResponse(
          "An official operational justification (min 8 chars) is required for emergency dispatch",
          "INVALID_JUSTIFICATION",
          400,
          cors,
        );
      }

      const authCheck = await verifyDispatcherAuthorization(
        {
          userId: actorId,
          role: actorRole as any,
          dispatchAuthorized: dispatchAuth,
        },
        validation.zoneId,
        justification,
      );

      if (!authCheck.authorized) {
        return errorResponse(
          authCheck.reason || "Dispatch authorization failed",
          "FORBIDDEN",
          403,
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
        actor: actorId,
        justification,
      });

      return jsonResponse(result, result.dispatched ? 201 : 200, cors);
    }

    // 6a. Alert Retraction (DISPATCHER/ADMIN role required)
    if (pathname === "/api/alerts/retract" && request.method === "POST") {
      const clientKey = `alert_retract:${getClientIdentifier(request)}`;
      const limitResult = defaultRateLimiter.checkLimit(clientKey, RATE_LIMIT_POLICIES.ALERT_DISPATCH);
      if (!limitResult.allowed) {
        return errorResponse(
          `Rate limit exceeded for alert retraction. Maximum ${RATE_LIMIT_POLICIES.ALERT_DISPATCH.maxRequests} requests per ${RATE_LIMIT_POLICIES.ALERT_DISPATCH.windowSeconds}s.`,
          "RATE_LIMIT_EXCEEDED",
          429,
          {
            ...cors,
            "Retry-After": String(limitResult.resetSeconds),
            "X-RateLimit-Limit": String(limitResult.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(limitResult.resetSeconds),
          },
        );
      }

      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return errorResponse("Authentication required for alert retraction", "UNAUTHORIZED", 401, cors);
      }

      const { authenticateToken } = await import("./official-auth.service");
      const profile = await authenticateToken(authHeader);

      let isAuthorized = false;
      let actorId = "api_dispatcher";

      const cronSecret = process.env["CRON_SECRET"];
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const isSystemSecret = Boolean(cronSecret && token === cronSecret);

      if (isSystemSecret) {
        isAuthorized = true;
        actorId = "system:admin";
      } else if (profile) {
        actorId = profile.id;
        isAuthorized = profile.role === "DISPATCHER" || profile.role === "ADMIN" || profile.dispatch_authorized;
      }

      if (!isAuthorized) {
        return errorResponse(
          "Forbidden: Alert retraction requires authorized DISPATCHER or ADMIN credentials",
          "FORBIDDEN",
          403,
          cors,
        );
      }

      let body: { alertId?: unknown; reason?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        return errorResponse("Malformed JSON body", "INVALID_JSON", 400, cors);
      }

      const alertId = Number(body.alertId);
      if (!Number.isInteger(alertId) || alertId <= 0) {
        return errorResponse("Valid positive integer alertId is required", "INVALID_ALERT_ID", 400, cors);
      }

      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason || reason.length < 5) {
        return errorResponse(
          "Operational retraction reason is required (minimum 5 characters)",
          "INVALID_RETRACTION_REASON",
          400,
          cors,
        );
      }

      try {
        const { retractAlert } = await import("./alert.service");
        const result = await retractAlert({
          alertId,
          reason,
          retractedBy: actorId,
        });
        return jsonResponse(result, 200, cors);
      } catch (err: any) {
        return errorResponse(err.message || "Failed to retract alert", "RETRACTION_FAILED", 400, cors);
      }
    }

    // 6b. Simulation Endpoint (Explicitly Gated Behind ENABLE_SIMULATION=true)
    if (pathname === "/api/simulate" && request.method === "POST") {
      if (process.env["ENABLE_SIMULATION"] !== "true") {
        return errorResponse(
          "Simulation functionality is disabled in production environment",
          "SIMULATION_DISABLED",
          403,
          cors,
        );
      }
      let body: { zoneId?: unknown; rainfallMm?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        return errorResponse("Malformed JSON body", "INVALID_JSON", 400, cors);
      }
      const zoneId = Number(body.zoneId);
      const rainfallMm = Number(body.rainfallMm);
      if (!Number.isInteger(zoneId) || zoneId < 1 || zoneId > 15 || Number.isNaN(rainfallMm)) {
        return errorResponse("Invalid zoneId or rainfallMm", "INVALID_INPUT", 400, cors);
      }
      const { simulateRainfallSpike } = await import("./monitoring.functions");
      const res = await simulateRainfallSpike({ data: { zoneId, rainfallMm } });
      return jsonResponse(res, 200, cors);
    }

    // 7. Offline Field Observation Synchronization
    if (pathname === "/api/sync/observations" && request.method === "POST") {
      const clientKey = `sync_observations:${getClientIdentifier(request)}`;
      const limitResult = defaultRateLimiter.checkLimit(clientKey, RATE_LIMIT_POLICIES.OBSERVATION_SYNC);
      if (!limitResult.allowed) {
        return errorResponse(
          `Rate limit exceeded for observation sync. Maximum ${RATE_LIMIT_POLICIES.OBSERVATION_SYNC.maxRequests} requests per ${RATE_LIMIT_POLICIES.OBSERVATION_SYNC.windowSeconds}s.`,
          "RATE_LIMIT_EXCEEDED",
          429,
          {
            ...cors,
            "Retry-After": String(limitResult.resetSeconds),
            "X-RateLimit-Limit": String(limitResult.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(limitResult.resetSeconds),
          },
        );
      }

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

    // 7a. Field Observation Status & Capability Flag
    if (pathname === "/api/field-observations/status" && request.method === "GET") {
      const mediaUploadEnabled = process.env["MEDIA_UPLOAD_ENABLED"] === "true";
      return jsonResponse({ mediaUploadEnabled }, 200, cors);
    }

    // 7b. Field Observation Media Upload
    if (pathname === "/api/field-observations/upload" && request.method === "POST") {
      const clientKey = `media_upload:${getClientIdentifier(request)}`;
      const limitResult = defaultRateLimiter.checkLimit(clientKey, RATE_LIMIT_POLICIES.MEDIA_UPLOAD);
      if (!limitResult.allowed) {
        return errorResponse(
          `Rate limit exceeded for media upload. Maximum ${RATE_LIMIT_POLICIES.MEDIA_UPLOAD.maxRequests} requests per ${RATE_LIMIT_POLICIES.MEDIA_UPLOAD.windowSeconds}s.`,
          "RATE_LIMIT_EXCEEDED",
          429,
          {
            ...cors,
            "Retry-After": String(limitResult.resetSeconds),
            "X-RateLimit-Limit": String(limitResult.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(limitResult.resetSeconds),
          },
        );
      }

      const mediaUploadEnabled = process.env["MEDIA_UPLOAD_ENABLED"] === "true";
      if (!mediaUploadEnabled) {
        return errorResponse(
          "Media upload is currently disabled on this server instance",
          "MEDIA_UPLOAD_DISABLED",
          403,
          cors,
        );
      }

      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return errorResponse(
          "Authentication required for field media upload",
          "UNAUTHORIZED",
          401,
          cors,
        );
      }

      const { authenticateToken } = await import("./official-auth.service");
      const profile = await authenticateToken(authHeader);
      const cronSecret = process.env["CRON_SECRET"];
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const isSystemSecret = Boolean(cronSecret && token === cronSecret);

      if (!profile && !isSystemSecret) {
        return errorResponse(
          "Invalid or expired authentication session",
          "UNAUTHORIZED",
          401,
          cors,
        );
      }

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return errorResponse("Invalid multipart form data", "INVALID_MULTIPART", 400, cors);
      }


      const file = formData.get("file");
      if (!file || !(file instanceof Blob)) {
        return errorResponse("Missing 'file' in upload request", "MISSING_FILE", 400, cors);
      }

      const mimeType = file.type || "application/octet-stream";
      const size = file.size;

      const allowedImageMimes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
      const allowedVideoMimes = ["video/mp4", "video/webm", "video/quicktime"];

      const isImage = allowedImageMimes.includes(mimeType);
      const isVideo = allowedVideoMimes.includes(mimeType);

      if (!isImage && !isVideo) {
        return errorResponse(
          `Unsupported media type: ${mimeType}. Allowed: JPEG, PNG, WebP, HEIC, MP4, WebM, QuickTime`,
          "UNSUPPORTED_MEDIA_TYPE",
          400,
          cors,
        );
      }

      // Hard caps: 10MB image, 50MB video
      const maxImageBytes = 10 * 1024 * 1024;
      const maxVideoBytes = 50 * 1024 * 1024;

      if (isImage && size > maxImageBytes) {
        return errorResponse("Image size exceeds 10MB hard cap", "FILE_TOO_LARGE", 400, cors);
      }
      if (isVideo && size > maxVideoBytes) {
        return errorResponse("Video size exceeds 50MB hard cap", "FILE_TOO_LARGE", 400, cors);
      }

      const rawFileName = (file as any).name || `upload-${Date.now()}`;
      const ext = rawFileName.split(".").pop() || (isImage ? "jpg" : "mp4");
      const storagePath = `observations/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const buffer = Buffer.from(await file.arrayBuffer());

      let fileUrl = "";
      try {
        const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
          .from("field-observation-media")
          .upload(storagePath, buffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (!uploadErr && uploadData) {
          const { data: signedData } = await supabaseAdmin.storage
            .from("field-observation-media")
            .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
          fileUrl = signedData?.signedUrl || `/api/field-observations/media/${storagePath}`;
        }
      } catch {
        // Storage cloud fallback below
      }

      if (!fileUrl) {
        try {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const uploadDir = path.resolve("./public/uploads/field-media");
          await fs.mkdir(uploadDir, { recursive: true });
          const localFilePath = path.join(uploadDir, path.basename(storagePath));
          await fs.writeFile(localFilePath, buffer);
          fileUrl = `/uploads/field-media/${path.basename(storagePath)}`;
        } catch {
          fileUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        }
      }

      return jsonResponse(
        {
          success: true,
          url: fileUrl,
          storagePath,
          name: rawFileName,
          size,
          mimeType,
          uploadedAt: new Date().toISOString(),
        },
        201,
        cors,
      );
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

    // 11. Satellite Imagery Status (Sentinel-2 / Copernicus)
    if (pathname === "/api/satellite/status" && request.method === "GET") {
      const status = getSatelliteLayerStatus();
      return jsonResponse(status, 200, cors);
    }

    // 12. Satellite Tiles Proxy with Server-side Caching (TTL 24h)
    if (pathname === "/api/satellite/tiles" && request.method === "GET") {
      const status = getSatelliteLayerStatus();
      if (!status.enabled || !status.configured) {
        return jsonResponse(
          {
            error: "SATELLITE_LAYER_UNAVAILABLE",
            configured: status.configured,
            enabled: status.enabled,
            message: "Sentinel Hub / Copernicus credentials not configured or feature disabled.",
          },
          503,
          cors,
        );
      }

      const layerParam = (url.searchParams.get("layer") || "TRUE-COLOR").toUpperCase();
      const z = Number(url.searchParams.get("z"));
      const x = Number(url.searchParams.get("x"));
      const y = Number(url.searchParams.get("y"));

      if (isNaN(z) || isNaN(x) || isNaN(y) || (layerParam !== "TRUE-COLOR" && layerParam !== "NDVI")) {
        return errorResponse(
          "Invalid parameters: required layer=TRUE-COLOR|NDVI, and numeric z, x, y coordinates.",
          "INVALID_PARAMS",
          400,
          cors,
        );
      }

      try {
        const { buffer, contentType, cached } = await fetchSatelliteTile(layerParam as "TRUE-COLOR" | "NDVI", z, x, y);
        return new Response(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
            "X-Tile-Cache": cached ? "HIT" : "MISS",
            ...cors,
          },
        });
      } catch (err) {
        return errorResponse(
          err instanceof Error ? err.message : "Failed to fetch satellite tile",
          "SATELLITE_UPSTREAM_ERROR",
          502,
          cors,
        );
      }
    }

    // 13. Physical Geotechnical In-Situ Sensor Ingestion (Inclinometers, Piezometers, Soil Probes)
    if (pathname === "/api/sensors/ingest" && request.method === "POST") {
      const authHeader = request.headers.get("authorization");
      try {
        const body = await request.json();
        const payloads = Array.isArray(body) ? body : body.readings || [body];
        const result = await processSensorTelemetry(payloads, authHeader);
        return jsonResponse(result, result.success ? 200 : 207, cors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sensor ingestion failed";
        const status = msg.includes("AUTH_FAILED") ? 401 : msg.includes("UNCONFIGURED") ? 503 : 400;
        return errorResponse(msg, "SENSOR_INGESTION_ERROR", status, cors);
      }
    }

    // 14. India Meteorological Department (IMD) Real-Time Weather Station Ingestion
    if (pathname === "/api/integrations/imd/ingest" && request.method === "POST") {
      const apiKey = request.headers.get("x-imd-key") || url.searchParams.get("key") || undefined;
      try {
        const body = await request.json();
        const records = Array.isArray(body) ? body : body.records || [body];
        const result = await processIMDTelemetry(records, apiKey);
        return jsonResponse(result, 200, cors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "IMD ingestion failed";
        const status = msg.includes("AUTH_FAILED") ? 401 : msg.includes("UNCONFIGURED") ? 503 : 400;
        return errorResponse(msg, "IMD_INGESTION_ERROR", status, cors);
      }
    }

    // 15. Live Road Status Feed Ingestion (BRO / State PWD)
    if (pathname === "/api/integrations/roads/ingest" && request.method === "POST") {
      const apiKey = request.headers.get("authorization") || request.headers.get("x-road-key") || undefined;
      try {
        const body = await request.json();
        const updates = Array.isArray(body) ? body : body.updates || [body];
        const result = await processRoadStatusUpdate(updates, apiKey);
        return jsonResponse(result, 200, cors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Road status ingestion failed";
        const status = msg.includes("AUTH_FAILED") ? 401 : msg.includes("UNCONFIGURED") ? 503 : 400;
        return errorResponse(msg, "ROAD_STATUS_INGESTION_ERROR", status, cors);
      }
    }

    // 16. Weather-Linked Risk Forecast Projections (24h / 48h / 72h forward guidance)
    if (pathname === "/api/forecast/projections" && request.method === "GET") {
      const {
        getZoneWeatherForecastProjection,
        getAllWeatherForecastProjections,
      } = await import("./forecast.service");

      const zoneParam = url.searchParams.get("zoneId");
      if (zoneParam !== null) {
        const parsedId = Number(zoneParam);
        if (!Number.isInteger(parsedId) || parsedId < 1 || parsedId > 15) {
          return errorResponse(
            "zoneId must be an integer between 1 and 15",
            "INVALID_ZONE_ID",
            400,
            cors,
          );
        }
        const projection = await getZoneWeatherForecastProjection(parsedId);
        return jsonResponse(projection, 200, cors);
      }

      const projections = await getAllWeatherForecastProjections();
      return jsonResponse(
        {
          status: "success",
          evaluated_at: new Date().toISOString(),
          disclaimer:
            "Weather-linked forecast projections represent forward-looking guidance based on Open-Meteo numerical weather prediction. " +
            "Forecast skill degrades with lead time. Projections do NOT alter authoritative current risk levels.",
          zones: projections,
        },
        200,
        cors,
      );
    }

    // 17. Emergency Response Prioritization Ranking (Decision-Support Only)
    if (pathname === "/api/response/prioritization" && request.method === "GET") {
      const { evaluateEmergencyPrioritization } = await import("./prioritization.service");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const [zonesRes, roadsRes, obsRes] = await Promise.all([
        supabaseAdmin.from("risk_zones").select("*").order("id"),
        supabaseAdmin.from("road_segments").select("*").order("id"),
        supabaseAdmin
          .from("field_observations")
          .select("*")
          .order("observed_at", { ascending: false })
          .limit(50),
      ]);

      if (zonesRes.error) {
        return errorResponse(zonesRes.error.message, "DATABASE_ERROR", 500, cors);
      }

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
            reviewStatus: o.review_status ?? undefined,
            roadStatus: o.road_status ?? undefined,
            visualSigns: o.visual_signs ?? undefined,
            rainfallMm: o.rainfall_mm ?? undefined,
          })),
      }));

      const ranking = evaluateEmergencyPrioritization(zoneInputs);
      return jsonResponse(ranking, 200, cors);
    }

    return errorResponse(`Endpoint not found: ${pathname}`, "NOT_FOUND", 404, cors);
  } catch (error) {
    console.error(`[API Router] Unhandled error on ${pathname}:`, error);
    return errorResponse("An unexpected server error occurred", "INTERNAL_SERVER_ERROR", 500, cors);
  }
}
