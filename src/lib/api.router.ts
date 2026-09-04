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

    // 6. Alert Dispatch Service (Explicit Dispatcher Authorization Required)
    if (pathname === "/api/alerts/dispatch" && request.method === "POST") {
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

    // 7b. Field Observation Media Upload (Task 2)
    if (pathname === "/api/field-observations/upload" && request.method === "POST") {
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

    return errorResponse(`Endpoint not found: ${pathname}`, "NOT_FOUND", 404, cors);
  } catch (error) {
    console.error(`[API Router] Unhandled error on ${pathname}:`, error);
    return errorResponse("An unexpected server error occurred", "INTERNAL_SERVER_ERROR", 500, cors);
  }
}
