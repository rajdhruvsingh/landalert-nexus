/**
 * src/lib/satellite.service.ts
 * =============================
 * Copernicus Sentinel-2 / Sentinel Hub Free-Tier Integration.
 *
 * Scope & Integrity Disclaimers:
 * - Provides supplementary visual context only (True-Color basemap & NDVI vegetation overlay).
 * - Strictly DOES NOT perform automated landslide scar detection or change detection.
 * - Enforces server-side tile caching with 24-hour TTL to respect free-tier quotas.
 * - Gracefully reports unconfigured state when credentials or SATELLITE_LAYER_ENABLED are missing.
 */

export interface SatelliteLayerStatus {
  enabled: boolean;
  configured: boolean;
  provider: string;
  attribution: string;
  disclaimer: string;
  availableLayers: string[];
}

interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  cachedAt: number;
}

// Server-side in-memory tile cache with 24h TTL
const tileCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getSatelliteLayerStatus(): SatelliteLayerStatus {
  const isEnabled = process.env["SATELLITE_LAYER_ENABLED"] === "true";
  const instanceId = process.env["SENTINEL_HUB_INSTANCE_ID"] || process.env["COPERNICUS_INSTANCE_ID"];
  const isConfigured = Boolean(instanceId && instanceId.trim().length > 0);

  return {
    enabled: isEnabled,
    configured: isConfigured,
    provider: "Copernicus Sentinel-2 / Sentinel Hub",
    attribution: "© Copernicus Sentinel data 2026 / Sentinel Hub | Supplementary Visual Context",
    disclaimer:
      "Supplementary visual context only. Does NOT perform automated landslide scar detection or hazard prediction.",
    availableLayers: ["TRUE-COLOR", "NDVI"],
  };
}

/**
 * Converts XYZ Web Mercator tile coordinates to EPSG:3857 bounding box coordinates.
 */
export function tileToBbox3857(x: number, y: number, z: number): [number, number, number, number] {
  const n = Math.pow(2, z);
  const minLng = (x / n) * 360 - 180;
  const maxLng = ((x + 1) / n) * 360 - 180;
  const minLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const maxLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const minLat = (minLatRad * 180) / Math.PI;
  const maxLat = (maxLatRad * 180) / Math.PI;

  const to3857 = (lat: number, lng: number): [number, number] => {
    const xMeters = (lng * 20037508.34) / 180;
    let yMeters = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    yMeters = (yMeters * 20037508.34) / 180;
    return [xMeters, yMeters];
  };

  const [minX = 0, minY = 0] = to3857(minLat, minLng);
  const [maxX = 0, maxY = 0] = to3857(maxLat, maxLng);
  return [minX, minY, maxX, maxY];
}

export async function fetchSatelliteTile(
  layer: "TRUE-COLOR" | "NDVI",
  z: number,
  x: number,
  y: number,
  fetchClient: typeof fetch = fetch,
): Promise<{ buffer: Buffer; contentType: string; cached: boolean }> {
  const status = getSatelliteLayerStatus();

  if (!status.enabled) {
    throw new Error("SATELLITE_LAYER_DISABLED: SATELLITE_LAYER_ENABLED feature flag is false.");
  }

  if (!status.configured) {
    throw new Error(
      "SATELLITE_LAYER_NOT_CONFIGURED: SENTINEL_HUB_INSTANCE_ID environment variable is missing.",
    );
  }

  const instanceId = (process.env["SENTINEL_HUB_INSTANCE_ID"] || process.env["COPERNICUS_INSTANCE_ID"])!.trim();
  const cacheKey = `${layer}:${z}:${x}:${y}`;
  const now = Date.now();

  const cached = tileCache.get(cacheKey);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return { buffer: cached.buffer, contentType: cached.contentType, cached: true };
  }

  const [minX, minY, maxX, maxY] = tileToBbox3857(x, y, z);
  const wmsUrl = `https://services.sentinel-hub.com/ogc/wms/${instanceId}?SERVICE=WMS&REQUEST=GetMap&LAYERS=${encodeURIComponent(
    layer,
  )}&MAXCC=30&FORMAT=image/jpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX=${minX},${minY},${maxX},${maxY}`;

  const res = await fetchClient(wmsUrl);
  if (!res.ok) {
    throw new Error(`Sentinel Hub upstream error: HTTP ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  tileCache.set(cacheKey, { buffer, contentType, cachedAt: now });

  return { buffer, contentType, cached: false };
}
