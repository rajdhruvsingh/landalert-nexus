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
import { ingestLiveRainfallImpl } from "./monitoring.server";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSatelliteLayerStatus, fetchSatelliteTile } from "./satellite.service";
import {
  getCellDeformation,
  getLocationDeformation,
  getAllInSarProducts,
  CANONICAL_SAR_PIPELINE_STEPS,
} from "./insar.service";
import {
  searchSentinel1Acquisitions,
  getAcquisitionsForCell,
  ingestAcquisitions,
} from "./sentinel-acquisition.service";
import {
  createInSarProcessingJob,
  getJobStatus,
  executeJobPipeline,
  getTimeseriesForCell,
  deriveTemporalTrend,
  getSatellitePipelineHealth,
  checkCdseCredentials,
} from "./insar-processor.service";
import { processIMDTelemetry } from "./integrations/imd.adapter";
import { processSensorTelemetry } from "./integrations/sensors.adapter";
import { processRoadStatusUpdate } from "./integrations/road-status.adapter";
import {
  defaultRateLimiter,
  RATE_LIMIT_POLICIES,
  getClientIdentifier,
} from "./rate-limiter";
import {
  getRegion,
  getAllStates,
  getStateById,
  getDistrictsByState,
  getDistrictById,
  getZonesByDistrict,
  getZonesByState,
  getAllZones,
  getCompleteHierarchy,
  searchGeography,
  getAllCities,
  getCityById,
} from "./geography";
import {
  getAllSpatialCells,
  getSpatialCellsByState,
  getSpatialCellsByDistrict,
  evaluateCellRisk,
  deriveLocationSpatialRisk,
} from "./spatial-risk.service";

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

    // 6c. Observation Review — Approve / Reject (VERIFIED_OFFICIAL, DISPATCHER, or ADMIN)
    if (pathname === "/api/observations/review" && request.method === "POST") {
      // Require authentication
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return errorResponse(
          "Authentication required to review observations",
          "UNAUTHORIZED",
          401,
          cors,
        );
      }

      const { authenticateToken: authToken, verifyGroundObservation } = await import("./official-auth.service");
      const profile = await authToken(authHeader);

      // Role check: VERIFIED_OFFICIAL, DISPATCHER, or ADMIN only
      const isAuthorized =
        profile !== null &&
        (profile.role === "VERIFIED_OFFICIAL" ||
          profile.role === "DISPATCHER" ||
          profile.role === "ADMIN");

      if (!isAuthorized) {
        return errorResponse(
          "Forbidden: Only verified government officials, dispatchers, or administrators can review observations",
          "FORBIDDEN",
          403,
          cors,
        );
      }

      // Parse and validate request body
      let body: {
        observation_id?: unknown;
        new_status?: unknown;
        verification_notes?: unknown;
        is_training_eligible?: unknown;
      } = {};
      try {
        body = await request.json();
      } catch {
        return errorResponse("Malformed JSON request body", "INVALID_JSON", 400, cors);
      }

      const observationId = body.observation_id;
      if (!observationId || (typeof observationId !== "string" && typeof observationId !== "number")) {
        return errorResponse("observation_id is required", "MISSING_OBSERVATION_ID", 400, cors);
      }

      const newStatus = body.new_status;
      if (newStatus !== "VERIFIED" && newStatus !== "REJECTED") {
        return errorResponse(
          "new_status must be 'VERIFIED' or 'REJECTED'",
          "INVALID_STATUS",
          400,
          cors,
        );
      }

      const verificationNotes =
        typeof body.verification_notes === "string" ? body.verification_notes.trim() : "";

      // REJECTED observations require a reason
      if (newStatus === "REJECTED" && verificationNotes.length < 5) {
        return errorResponse(
          "A rejection reason (verification_notes, min 5 chars) is required when rejecting an observation",
          "MISSING_REJECTION_REASON",
          400,
          cors,
        );
      }

      const result = await verifyGroundObservation(
        profile!,
        String(observationId),
        {
          status: newStatus,
          verificationNotes,
          isTrainingEligible: Boolean(body.is_training_eligible),
        },
      );

      if (!result.success) {
        // Distinguish 404 from other errors
        if (result.error?.includes("not found")) {
          return errorResponse(result.error, "NOT_FOUND", 404, cors);
        }
        return errorResponse(result.error ?? "Review failed", "REVIEW_FAILED", 400, cors);
      }

      return jsonResponse(
        {
          ok: true,
          observation_id: String(observationId),
          new_status: newStatus,
          reviewed_by: profile!.id,
          reviewed_at: new Date().toISOString(),
        },
        200,
        cors,
      );
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
      const mediaUploadEnabled = process.env["MEDIA_UPLOAD_ENABLED"] !== "false";
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

      const mediaUploadEnabled = process.env["MEDIA_UPLOAD_ENABLED"] !== "false";
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

      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const cronSecret = process.env["CRON_SECRET"];
      const isSystemSecret = Boolean(cronSecret && token === cronSecret);

      const { authenticateToken } = await import("./official-auth.service");
      const profile = await authenticateToken(authHeader);

      // Support citizen session tokens (e.g. bearer tokens generated by client or anonymous auth)
      const isCitizenToken =
        token.length >= 8 &&
        (token.startsWith("citizen_") || token.startsWith("anon_") || token.startsWith("test-"));

      if (!profile && !isSystemSecret && !isCitizenToken) {
        return errorResponse(
          "Invalid or expired authentication session",
          "UNAUTHORIZED",
          401,
          cors,
        );
      }

      let uploaderRole = "PUBLIC_CITIZEN";
      let uploaderId = `citizen_${getClientIdentifier(request).slice(0, 12)}`;
      if (profile) {
        uploaderRole = profile.role;
        uploaderId = profile.email || profile.id;
      } else if (isSystemSecret) {
        uploaderRole = "SYSTEM_ADMIN";
        uploaderId = "system_service";
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
        // Ensure bucket exists
        await supabaseAdmin.storage.createBucket("field-observation-media", {
          public: false,
          fileSizeLimit: 52428800,
          allowedMimeTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "video/mp4",
            "video/webm",
            "video/quicktime",
          ],
        }).catch(() => {});

        const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
          .from("field-observation-media")
          .upload(storagePath, buffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (!uploadErr && uploadData) {
          const { data: signedData } = await supabaseAdmin.storage
            .from("field-observation-media")
            .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year
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
        return new Response(new Uint8Array(buffer), {
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

    // 12b. Satellite InSAR Ground Deformation Endpoint
    if (pathname === "/api/satellite/deformation" && request.method === "GET") {
      const cellIdParam = url.searchParams.get("cellId");
      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      const cityName = url.searchParams.get("city") || "";
      const districtName = url.searchParams.get("district") || "";
      const stateName = url.searchParams.get("state") || "";

      if (cellIdParam) {
        let deformation = getCellDeformation(cellIdParam.trim());
        try {
          const { data: dbProd } = await supabaseAdmin
            .from("insar_deformation_products")
            .select("*")
            .eq("cell_id", cellIdParam.trim())
            .maybeSingle();
          if (dbProd) {
            deformation = {
              ...deformation,
              status: dbProd.status,
              los_velocity_mean_mm_year: dbProd.los_velocity_mean_mm_year !== null ? parseFloat(dbProd.los_velocity_mean_mm_year) : null,
              los_velocity_max_mm_year: dbProd.los_velocity_max_mm_year !== null ? parseFloat(dbProd.los_velocity_max_mm_year) : null,
              cumulative_displacement_mm: dbProd.cumulative_displacement_mm !== null ? parseFloat(dbProd.cumulative_displacement_mm) : null,
              coherence_mean: dbProd.coherence_mean !== null ? parseFloat(dbProd.coherence_mean) : null,
              spatial_coverage_pct: dbProd.spatial_coverage_pct !== null ? parseFloat(dbProd.spatial_coverage_pct) : null,
              quality: dbProd.quality,
              unavailable_reason: dbProd.unavailable_reason,
              sensor: dbProd.sensor || "Sentinel-1 C-SAR",
              orbit_pass: dbProd.orbit_pass as ("ASCENDING" | "DESCENDING" | "COMBINED" | null),
              temporal_baseline_days: dbProd.temporal_baseline_days,
              temporal_trend: dbProd.temporal_trend || deformation.temporal_trend,
              processing_pipeline: dbProd.processing_pipeline || deformation.processing_pipeline,
              observation_period: dbProd.observation_start && dbProd.observation_end ? {
                start_date: dbProd.observation_start,
                end_date: dbProd.observation_end,
              } : deformation.observation_period,
              last_processed_at: dbProd.updated_at,
            };
          }
        } catch {
          // Offline fallback to in-memory registry
        }

        return jsonResponse({
          status: "success",
          deformation,
          scientific_integrity: {
            zero_fabrication_prohibited: true,
            option_a_independent_indicator: true,
            pipeline_steps: CANONICAL_SAR_PIPELINE_STEPS,
          },
        }, 200, cors);
      }

      if (latParam && lngParam) {
        const lat = parseFloat(latParam);
        const lng = parseFloat(lngParam);
        if (isNaN(lat) || isNaN(lng)) {
          return errorResponse("Invalid lat/lng parameters", "INVALID_COORDINATES", 400, cors);
        }
        const cityDeform = getLocationDeformation(lat, lng, cityName || "Queried Location", districtName, stateName);
        try {
          const { data: dbProd } = await supabaseAdmin
            .from("insar_deformation_products")
            .select("*")
            .eq("cell_id", cityDeform.associated_cell_id)
            .maybeSingle();
          if (dbProd) {
            cityDeform.deformation = {
              ...cityDeform.deformation,
              status: dbProd.status,
              los_velocity_mean_mm_year: dbProd.los_velocity_mean_mm_year !== null ? parseFloat(dbProd.los_velocity_mean_mm_year) : null,
              los_velocity_max_mm_year: dbProd.los_velocity_max_mm_year !== null ? parseFloat(dbProd.los_velocity_max_mm_year) : null,
              cumulative_displacement_mm: dbProd.cumulative_displacement_mm !== null ? parseFloat(dbProd.cumulative_displacement_mm) : null,
              coherence_mean: dbProd.coherence_mean !== null ? parseFloat(dbProd.coherence_mean) : null,
              spatial_coverage_pct: dbProd.spatial_coverage_pct !== null ? parseFloat(dbProd.spatial_coverage_pct) : null,
              quality: dbProd.quality,
              unavailable_reason: dbProd.unavailable_reason,
              sensor: dbProd.sensor || "Sentinel-1 C-SAR",
              orbit_pass: dbProd.orbit_pass as ("ASCENDING" | "DESCENDING" | "COMBINED" | null),
              temporal_baseline_days: dbProd.temporal_baseline_days,
              temporal_trend: dbProd.temporal_trend || cityDeform.deformation.temporal_trend,
              processing_pipeline: dbProd.processing_pipeline || cityDeform.deformation.processing_pipeline,
              observation_period: dbProd.observation_start && dbProd.observation_end ? {
                start_date: dbProd.observation_start,
                end_date: dbProd.observation_end,
              } : cityDeform.deformation.observation_period,
              last_processed_at: dbProd.updated_at,
            };
          }
        } catch {
          // Offline fallback
        }

        return jsonResponse({
          status: "success",
          ...cityDeform,
          pipeline_steps: CANONICAL_SAR_PIPELINE_STEPS,
        }, 200, cors);
      }

      // If city name provided, look up in geography
      if (cityName) {
        const allCities = getAllCities();
        const found = allCities.find(
          (c) =>
            c.name.toLowerCase() === cityName.trim().toLowerCase() &&
            (!stateName || c.stateName.toLowerCase() === stateName.trim().toLowerCase())
        );
        if (found) {
          const cityDeform = getLocationDeformation(
            found.centroid[0],
            found.centroid[1],
            found.name,
            found.districtName,
            found.stateName
          );
          try {
            const { data: dbProd } = await supabaseAdmin
              .from("insar_deformation_products")
              .select("*")
              .eq("cell_id", cityDeform.associated_cell_id)
              .maybeSingle();
            if (dbProd) {
              cityDeform.deformation = {
                ...cityDeform.deformation,
                status: dbProd.status,
                los_velocity_mean_mm_year: dbProd.los_velocity_mean_mm_year !== null ? parseFloat(dbProd.los_velocity_mean_mm_year) : null,
                los_velocity_max_mm_year: dbProd.los_velocity_max_mm_year !== null ? parseFloat(dbProd.los_velocity_max_mm_year) : null,
                cumulative_displacement_mm: dbProd.cumulative_displacement_mm !== null ? parseFloat(dbProd.cumulative_displacement_mm) : null,
                coherence_mean: dbProd.coherence_mean !== null ? parseFloat(dbProd.coherence_mean) : null,
                spatial_coverage_pct: dbProd.spatial_coverage_pct !== null ? parseFloat(dbProd.spatial_coverage_pct) : null,
                quality: dbProd.quality,
                unavailable_reason: dbProd.unavailable_reason,
                sensor: dbProd.sensor || "Sentinel-1 C-SAR",
                orbit_pass: dbProd.orbit_pass as ("ASCENDING" | "DESCENDING" | "COMBINED" | null),
                temporal_baseline_days: dbProd.temporal_baseline_days,
                temporal_trend: dbProd.temporal_trend || cityDeform.deformation.temporal_trend,
                processing_pipeline: dbProd.processing_pipeline || cityDeform.deformation.processing_pipeline,
                observation_period: dbProd.observation_start && dbProd.observation_end ? {
                  start_date: dbProd.observation_start,
                  end_date: dbProd.observation_end,
                } : cityDeform.deformation.observation_period,
                last_processed_at: dbProd.updated_at,
              };
            }
          } catch {
            // Offline fallback
          }

          return jsonResponse({
            status: "success",
            ...cityDeform,
            pipeline_steps: CANONICAL_SAR_PIPELINE_STEPS,
          }, 200, cors);
        }
      }

      // Return all registered deformation products across NER
      const allDeformation = getAllInSarProducts();
      return jsonResponse({
        status: "success",
        total_registered: allDeformation.length,
        products: allDeformation,
        pipeline_steps: CANONICAL_SAR_PIPELINE_STEPS,
        scientific_integrity: {
          zero_fabrication_prohibited: true,
          uncalibrated_features_excluded_from_ml: true,
        },
      }, 200, cors);
    }

    // 12c. Satellite InSAR Coverage Lookup
    if (pathname === "/api/satellite/coverage" && request.method === "GET") {
      const cellIdParam = url.searchParams.get("cellId");
      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      const cityName = url.searchParams.get("city") || "";

      if (cellIdParam) {
        const deformation = getCellDeformation(cellIdParam.trim());
        return jsonResponse({
          status: "success",
          cell_id: cellIdParam,
          coverage_status: deformation.status,
          coverage_pct: deformation.spatial_coverage_pct,
          quality: deformation.quality,
          sensor: deformation.sensor,
          unavailable_reason: deformation.unavailable_reason,
        }, 200, cors);
      }

      if (latParam && lngParam) {
        const lat = parseFloat(latParam);
        const lng = parseFloat(lngParam);
        const assessment = getLocationDeformation(lat, lng, cityName);
        return jsonResponse({
          status: "success",
          city: assessment.city_name,
          coordinates: assessment.coordinates,
          associated_cell_id: assessment.associated_cell_id,
          coverage_status: assessment.deformation.status,
          coverage_pct: assessment.deformation.spatial_coverage_pct,
          quality: assessment.deformation.quality,
          sensor: assessment.deformation.sensor,
          unavailable_reason: assessment.deformation.unavailable_reason,
        }, 200, cors);
      }

      // Regional overview summary when no specific location is queried
      const allProducts = getAllInSarProducts();
      const activeProducts = allProducts.filter((p) => p.status === "AVAILABLE");
      return jsonResponse({
        status: "success",
        coverage: {
          total_monitored_cells: allProducts.length,
          active_insar_cells: activeProducts.length,
          coverage_pct: Math.round((activeProducts.length / Math.max(1, allProducts.length)) * 1000) / 10,
          sensor: "Sentinel-1 C-SAR",
          region: "Northeastern Region (NER), India",
          supported_states: 8,
        },
      }, 200, cors);
    }

    // 12d. Official Copernicus Sentinel-1 STAC Acquisitions Catalog
    if (pathname === "/api/satellite/acquisitions" && request.method === "GET") {
      const minLng = parseFloat(url.searchParams.get("minLng") || "88.0");
      const minLat = parseFloat(url.searchParams.get("minLat") || "26.0");
      const maxLng = parseFloat(url.searchParams.get("maxLng") || "93.0");
      const maxLat = parseFloat(url.searchParams.get("maxLat") || "28.0");
      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");

      let bbox: [number, number, number, number] = [minLng, minLat, maxLng, maxLat];
      if (latParam && lngParam) {
        const lat = parseFloat(latParam);
        const lng = parseFloat(lngParam);
        bbox = [lng - 0.25, lat - 0.25, lng + 0.25, lat + 0.25];
      }

      const acquisitions = await searchSentinel1Acquisitions({ bbox, limit: 20 });
      return jsonResponse({
        status: "success",
        count: acquisitions.length,
        bbox,
        acquisitions,
        source: "Copernicus Data Space Ecosystem (CDSE) STAC API",
      }, 200, cors);
    }

    // 12e. Satellite Pipeline Multi-Factor Health Check
    if (pathname === "/api/satellite/health" && request.method === "GET") {
      const health = getSatellitePipelineHealth();
      return jsonResponse({
        status: "success",
        ...health,
        timestamp: new Date().toISOString(),
      }, 200, cors);
    }

    // 12f. Asynchronous InSAR Processing Jobs Status & Dispatch
    if (pathname === "/api/satellite/jobs") {
      if (request.method === "GET") {
        const jobId = url.searchParams.get("jobId");
        if (jobId) {
          const job = await getJobStatus(jobId);
          if (!job) {
            return errorResponse("InSAR processing job not found", "JOB_NOT_FOUND", 404, cors);
          }
          return jsonResponse({ status: "success", job }, 200, cors);
        }
        return jsonResponse({
          status: "success",
          active_workers: 1,
          queue_policy: "ASYNCHRONOUS_DECOUPLED_RENDER_COMPATIBLE",
        }, 200, cors);
      }

      if (request.method === "POST") {
        try {
          const body = await request.json();
          const cellId = body.cell_id || body.cellId;
          if (!cellId) {
            return errorResponse("Missing required cell_id parameter", "INVALID_PARAMS", 400, cors);
          }
          const job = await createInSarProcessingJob(cellId);
          // In test environment, execute simulated pipeline; in production, dedicated worker claims QUEUED jobs
          if (process.env["NODE_ENV"] === "test") {
            executeJobPipeline(job.id).catch(() => {});
          }

          return jsonResponse({
            status: "accepted",
            message: "InSAR processing job queued successfully",
            job,
          }, 202, cors);
        } catch (err) {
          return errorResponse(
            err instanceof Error ? err.message : "Failed to create InSAR processing job",
            "JOB_DISPATCH_ERROR",
            400,
            cors
          );
        }
      }
    }

    // 12f. InSAR Multi-temporal Displacement Time-Series
    if (pathname === "/api/satellite/timeseries" && request.method === "GET") {
      const cellIdParam = url.searchParams.get("cellId") || "cell-27.25-88.50";
      const timeseries = getTimeseriesForCell(cellIdParam.trim());
      const trendAnalysis = deriveTemporalTrend(timeseries);

      return jsonResponse({
        status: "success",
        cell_id: cellIdParam,
        total_observations: timeseries.length,
        temporal_trend: trendAnalysis.trend,
        mean_velocity_mm_year: trendAnalysis.meanVelocityMmYear,
        cumulative_displacement_mm: trendAnalysis.cumulativeDisplacementMm,
        quality: trendAnalysis.quality,
        analysis: trendAnalysis,
        timeseries,
        measurement_type: "LOS_DEFORMATION_VELOCITY",
        unit: "mm/year",
        scientific_integrity: {
          zero_fallback_prohibited: true,
          no_synthetic_data: true,
        },
      }, 200, cors);
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
            status: (o as any).status ?? undefined,
            roadStatus: o.road_status ?? undefined,
            visualSigns: o.visual_signs ?? undefined,
            rainfallMm: o.rainfall_mm ?? undefined,
          })),
      }));

      const ranking = evaluateEmergencyPrioritization(zoneInputs);
      return jsonResponse(ranking, 200, cors);
    }

    // ==========================================
    // GEOGRAPHIC HIERARCHY REST API ENDPOINTS
    // ==========================================

    // GET /api/geo/hierarchy
    if (pathname === "/api/geo/hierarchy" && request.method === "GET") {
      const hierarchy = getCompleteHierarchy();
      return jsonResponse(hierarchy, 200, cors);
    }

    // GET /api/geo/states
    if (pathname === "/api/geo/states" && request.method === "GET") {
      const states = getAllStates();
      return jsonResponse({ states, count: states.length }, 200, cors);
    }

    // GET /api/geo/districts
    if (pathname === "/api/geo/districts" && request.method === "GET") {
      const stateId = url.searchParams.get("stateId");
      if (stateId) {
        const districts = getDistrictsByState(stateId);
        return jsonResponse({ districts, stateId, count: districts.length }, 200, cors);
      }
      const hierarchy = getCompleteHierarchy();
      const allDistricts = hierarchy.states.flatMap((s) => s.districts);
      return jsonResponse({ districts: allDistricts, count: allDistricts.length }, 200, cors);
    }

    // GET /api/geo/zones
    if (pathname === "/api/geo/zones" && request.method === "GET") {
      const districtId = url.searchParams.get("districtId");
      const stateId = url.searchParams.get("stateId");
      if (districtId) {
        const zones = getZonesByDistrict(districtId);
        return jsonResponse({ zones, districtId, count: zones.length }, 200, cors);
      }
      if (stateId) {
        const zones = getZonesByState(stateId);
        return jsonResponse({ zones, stateId, count: zones.length }, 200, cors);
      }
      const zones = getAllZones();
      return jsonResponse({ zones, count: zones.length }, 200, cors);
    }

    // GET /api/geo/search
    if (pathname === "/api/geo/search" && request.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const results = searchGeography(q);
      return jsonResponse({ query: q, results, count: results.length }, 200, cors);
    }

    // ==========================================
    // SPATIAL PREDICTION GRID REST API ENDPOINTS
    // ==========================================

    // GET /api/spatial/cells - Returns spatial prediction cells across all 8 NER states
    if (pathname === "/api/spatial/cells" && request.method === "GET") {
      const stateName = url.searchParams.get("state");
      const districtName = url.searchParams.get("district");
      let cells = getAllSpatialCells();
      if (stateName) {
        cells = getSpatialCellsByState(stateName);
      } else if (districtName) {
        cells = getSpatialCellsByDistrict(districtName);
      }
      return jsonResponse({ cells, count: cells.length }, 200, cors);
    }

    // GET /api/spatial/risk - Evaluates spatial risk for cells or specific coordinates
    if (pathname === "/api/spatial/risk" && request.method === "GET") {
      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      const cityName = url.searchParams.get("city");
      const districtName = url.searchParams.get("district");
      const stateName = url.searchParams.get("state") || "";

      let activeZones: any[] = [];
      try {
        const { data: zonesData } = await supabaseAdmin.from("risk_zones").select("*");
        activeZones = zonesData ?? [];
      } catch {
        activeZones = [];
      }

      if (latParam && lngParam) {
        const lat = parseFloat(latParam);
        const lng = parseFloat(lngParam);
        if (isNaN(lat) || isNaN(lng)) {
          return errorResponse("Invalid lat/lng coordinates", "INVALID_COORDINATES", 400, cors);
        }
        const spatialRisk = deriveLocationSpatialRisk(
          cityName || "Custom Coordinate",
          cityName ? "city" : "point",
          districtName || "Regional",
          stateName || "NER",
          [lat, lng],
          activeZones
        );
        return jsonResponse(spatialRisk, 200, cors);
      }

      // If city name is provided, look up city
      if (cityName) {
        const allCities = getAllCities();
        const found = allCities.find(
          (c) =>
            c.name.toLowerCase() === cityName.trim().toLowerCase() &&
            (!stateName || c.stateName.toLowerCase() === stateName.trim().toLowerCase())
        );
        if (found) {
          const spatialRisk = deriveLocationSpatialRisk(
            found.name,
            found.type,
            found.districtName,
            found.stateName,
            found.centroid,
            activeZones
          );
          return jsonResponse(spatialRisk, 200, cors);
        }
      }

      // Return regional spatial risk summary across representative cells
      const cells = getAllSpatialCells();
      const evaluations = cells.map((c) => evaluateCellRisk(c, activeZones));
      return jsonResponse({
        status: "success",
        evaluated_cells_count: evaluations.length,
        model_version: "v0.3-spatial-surface",
        cells: evaluations,
      }, 200, cors);
    }

    // GET /api/spatial/city-risk - Dedicated city-level risk endpoint
    if (pathname === "/api/spatial/city-risk" && request.method === "GET") {
      const cityId = url.searchParams.get("cityId");
      const cityName = url.searchParams.get("name");
      const stateName = url.searchParams.get("state") || "";

      let city = null;
      if (cityId) {
        city = getCityById(cityId);
      } else if (cityName) {
        const allCities = getAllCities();
        city = allCities.find(
          (c) =>
            c.name.toLowerCase() === cityName.trim().toLowerCase() &&
            (!stateName || c.stateName.toLowerCase() === stateName.trim().toLowerCase())
        ) || null;
      }

      if (!city) {
        return errorResponse("City not found in NER geographic registry", "CITY_NOT_FOUND", 404, cors);
      }

      let activeZones: any[] = [];
      try {
        const { data: zonesData } = await supabaseAdmin.from("risk_zones").select("*");
        activeZones = zonesData ?? [];
      } catch {
        activeZones = [];
      }

      const spatialRisk = deriveLocationSpatialRisk(
        city.name,
        city.type,
        city.districtName,
        city.stateName,
        city.centroid,
        activeZones
      );
      return jsonResponse(spatialRisk, 200, cors);
    }

    return errorResponse(`Endpoint not found: ${pathname}`, "NOT_FOUND", 404, cors);
  } catch (error) {
    console.error(`[API Router] Unhandled error on ${pathname}:`, error);
    return errorResponse("An unexpected server error occurred", "INTERNAL_SERVER_ERROR", 500, cors);
  }
}
