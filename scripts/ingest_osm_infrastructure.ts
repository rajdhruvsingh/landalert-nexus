#!/usr/bin/env npx tsx
/**
 * scripts/ingest_osm_infrastructure.ts
 *
 * Ingestion script for OpenStreetMap (OSM) villages and critical infrastructure
 * across Northeast India (NER) landslide risk zones.
 * Fulfills SIH Requirements 9 (Villages) & 10 (Critical Infrastructure).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const DRY_RUN = process.argv.includes("--dry-run");

// Earth & Spatial Constants
const EARTH_RADIUS_KM = 6371.0;
const KM_PER_DEG_LAT = 111.0;
const BBOX_RADIUS_KM = 20.0;
const OVERPASS_RATE_LIMIT_DELAY_MS = 5000;
const OVERPASS_TIMEOUT_SEC = 35;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "LandAlertNexus-SIH-Ingestion/1.0 (landalert-nexus@hackathon.org)";
const UPSERT_BATCH_SIZE = 400;

interface RiskZone {
  id: number;
  zone_name: string;
  district: string;
  state: string;
  centroid_lat: number;
  centroid_lng: number;
}

interface OverpassNodeElement {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassWayElement {
  type: "way";
  id: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

type OverpassElement = OverpassNodeElement | OverpassWayElement;

interface OverpassResponse {
  version: number;
  generator: string;
  elements: OverpassElement[];
}

interface VillageRecord {
  name: string;
  district: string | null;
  state: string | null;
  population: number | null;
  lat: number;
  lng: number;
  zone_id: number;
  distance_km_to_zone: number;
  osm_id: number;
  osm_element_type: "node" | "way";
  osm_place_tag: string | null;
}

interface CriticalInfrastructureRecord {
  name: string;
  type: "hospital" | "clinic" | "school" | "bridge" | "power";
  lat: number;
  lng: number;
  zone_id: number;
  distance_km_to_zone: number;
  osm_id: number;
  osm_element_type: "node" | "way";
}

interface DeduplicationHolder<T> {
  entityKey: string;
  record: T;
  lat: number;
  lng: number;
  zonesSeen: RiskZone[];
}

type ZoneQueryStatus = "SUCCESS_WITH_DATA" | "SUCCESS_ZERO_DATA" | "FAILED";

interface ZoneExecutionStats {
  zone: RiskZone;
  status: ZoneQueryStatus;
  rawCount: number;
  villageCount: number;
  infraCount: number;
  infraByType: Record<string, number>;
  errorMessage?: string;
}

interface CrossZoneResolutionSample {
  name: string;
  osmKey: string;
  category: "village" | "infrastructure";
  assignedZone: string;
  assignedDistanceKm: number;
  candidateDistances: Array<{ zoneName: string; distanceKm: number }>;
}

// Fallback risk zones covering the 15 monitored landslide corridors across NER (dry-run only)
const FALLBACK_ZONES: RiskZone[] = [
  { id: 1, zone_name: "Tamenglong", district: "Tamenglong", state: "Manipur", centroid_lat: 24.98, centroid_lng: 93.5 },
  { id: 2, zone_name: "Noney", district: "Noney", state: "Manipur", centroid_lat: 24.83, centroid_lng: 93.66 },
  { id: 3, zone_name: "Aizawl East", district: "Aizawl", state: "Mizoram", centroid_lat: 23.73, centroid_lng: 92.72 },
  { id: 4, zone_name: "Lunglei Slopes", district: "Lunglei", state: "Mizoram", centroid_lat: 22.89, centroid_lng: 92.79 },
  { id: 5, zone_name: "Shillong-Sohra Escarpment", district: "East Khasi Hills", state: "Meghalaya", centroid_lat: 25.3, centroid_lng: 91.72 },
  { id: 6, zone_name: "Jaintia Hills Ridge", district: "West Jaintia Hills", state: "Meghalaya", centroid_lat: 25.45, centroid_lng: 92.36 },
  { id: 7, zone_name: "Kohima Ridge", district: "Kohima", state: "Nagaland", centroid_lat: 25.67, centroid_lng: 94.11 },
  { id: 8, zone_name: "Dimapur Foothills", district: "Dimapur", state: "Nagaland", centroid_lat: 25.9, centroid_lng: 93.73 },
  { id: 9, zone_name: "Papum Pare", district: "Papum Pare", state: "Arunachal Pradesh", centroid_lat: 27.1, centroid_lng: 93.62 },
  { id: 10, zone_name: "Dibang Valley", district: "Dibang Valley", state: "Arunachal Pradesh", centroid_lat: 28.25, centroid_lng: 95.9 },
  { id: 11, zone_name: "Gangtok-Singtam Corridor", district: "East Sikkim", state: "Sikkim", centroid_lat: 27.33, centroid_lng: 88.61 },
  { id: 12, zone_name: "Mangan North", district: "North Sikkim", state: "Sikkim", centroid_lat: 27.51, centroid_lng: 88.53 },
  { id: 13, zone_name: "Haflong Hills", district: "Dima Hasao", state: "Assam", centroid_lat: 25.17, centroid_lng: 93.02 },
  { id: 14, zone_name: "Karbi Anglong West", district: "Karbi Anglong", state: "Assam", centroid_lat: 26.05, centroid_lng: 93.1 },
  { id: 15, zone_name: "Ambassa Hills", district: "Dhalai", state: "Tripura", centroid_lat: 23.93, centroid_lng: 91.85 },
];

/**
 * Calculates great-circle Haversine distance between two coordinates in kilometers.
 */
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Constructs a ~20km bounding box around (centroid_lat, centroid_lng),
 * adjusting the longitude delta for latitude compression:
 *   lng_delta = radius / (111 * cos(lat_in_radians))
 */
function computeBoundingBox(centroidLat: number, centroidLng: number, radiusKm = BBOX_RADIUS_KM) {
  const latDelta = radiusKm / KM_PER_DEG_LAT;
  const latRad = (centroidLat * Math.PI) / 180.0;
  const lngDelta = radiusKm / (KM_PER_DEG_LAT * Math.cos(latRad));

  const south = Number((centroidLat - latDelta).toFixed(6));
  const north = Number((centroidLat + latDelta).toFixed(6));
  const west = Number((centroidLng - lngDelta).toFixed(6));
  const east = Number((centroidLng + lngDelta).toFixed(6));

  return { south, west, north, east };
}

/**
 * Builds the single union Overpass QL query per zone.
 */
function buildOverpassQuery(south: number, west: number, north: number, east: number): string {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:${OVERPASS_TIMEOUT_SEC}];
(
  node["place"~"^(village|hamlet)$"](${bbox});
  node["amenity"~"^(hospital|clinic)$"](${bbox});
  node["amenity"="school"](${bbox});
  way["bridge"="yes"](${bbox});
  node["power"~"^(substation|plant)$"](${bbox});
);
out center;`;
}

/**
 * Queries Overpass API across ordered endpoints with bounded exponential retry and fallback.
 */
async function fetchOverpassData(
  query: string,
  maxAttempts = 3
): Promise<OverpassElement[]> {
  let lastError: Error | null = null;

  for (let epIdx = 0; epIdx < OVERPASS_ENDPOINTS.length; epIdx++) {
    const endpoint = OVERPASS_ENDPOINTS[epIdx];
    const endpointHost = new URL(endpoint).hostname;

    console.log(`    [Endpoint] ${endpointHost}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const body = "data=" + encodeURIComponent(query);

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });

        if (response.status === 429) {
          const waitMs = attempt * 3500;

          console.warn(
            `    [Retry] HTTP 429 (${endpointHost}) -> waiting ${waitMs}ms ` +
              `(attempt ${attempt}/${maxAttempts})...`
          );

          lastError = new Error(`${endpointHost} returned HTTP 429`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504
        ) {
          const waitMs = attempt * 4000;
          const text = await response.text().catch(() => "");

          console.warn(
            `    [Retry] HTTP ${response.status} (${endpointHost}) -> ` +
              `waiting ${waitMs}ms (attempt ${attempt}/${maxAttempts})...`
          );

          lastError = new Error(
            `${endpointHost} returned HTTP ${response.status}: ${text.slice(0, 150)}`
          );

          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");

          throw new Error(
            `${endpointHost} returned HTTP ${response.status}: ${text.slice(0, 150)}`
          );
        }

        const json = (await response.json()) as OverpassResponse;

        if (!json || !Array.isArray(json.elements)) {
          throw new Error(
            `${endpointHost} did not return a valid Overpass elements array`
          );
        }

        return json.elements;
      } catch (err: unknown) {
        lastError =
          err instanceof Error ? err : new Error(String(err));

        if (attempt < maxAttempts) {
          const backoffMs = attempt * 3000;

          console.warn(
            `    [Retry] network/error (${endpointHost}): ` +
              `${lastError.message} -> waiting ${backoffMs}ms ` +
              `(attempt ${attempt}/${maxAttempts})...`
          );

          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    if (epIdx < OVERPASS_ENDPOINTS.length - 1) {
      const nextHost = new URL(
        OVERPASS_ENDPOINTS[epIdx + 1]
      ).hostname;

      console.warn(
        `    [Fallback] trying next endpoint: ${nextHost}...`
      );
    }
  }

  throw (
    lastError ??
    new Error("Overpass request failed after all endpoints/retries")
  );
}

/**
 * Extracts coordinates for an Overpass element:
 * - Nodes: returns (lat, lon) directly
 * - Ways: returns center (lat, lon)
 */
function extractElementCoordinates(element: OverpassElement): { lat: number; lng: number } | null {
  if (element.type === "node") {
    if (typeof element.lat === "number" && typeof element.lon === "number") {
      return { lat: element.lat, lng: element.lon };
    }
    return null;
  }

  if (element.type === "way") {
    if (
      element.center &&
      typeof element.center.lat === "number" &&
      typeof element.center.lon === "number"
    ) {
      return { lat: element.center.lat, lng: element.center.lon };
    }
  }

  return null;
}

/**
 * Classifies an Overpass element tag set into village/hamlet or infrastructure types.
 */
function classifyElement(
  element: OverpassElement
):
  | { category: "village"; placeTag: string }
  | { category: "infrastructure"; infraType: CriticalInfrastructureRecord["type"] }
  | null {
  const tags = element.tags;
  if (!tags) return null;

  // 1. Villages / Hamlets (place tag)
  if (tags.place === "village" || tags.place === "hamlet") {
    return { category: "village", placeTag: tags.place };
  }

  // 2. Health infrastructure
  if (tags.amenity === "hospital") {
    return { category: "infrastructure", infraType: "hospital" };
  }
  if (tags.amenity === "clinic") {
    return { category: "infrastructure", infraType: "clinic" };
  }

  // 3. Education infrastructure
  if (tags.amenity === "school") {
    return { category: "infrastructure", infraType: "school" };
  }

  // 4. Bridges
  if (tags.bridge === "yes" || tags.bridge === "viaduct" || tags.bridge === "aqueduct") {
    return { category: "infrastructure", infraType: "bridge" };
  }

  // 5. Power infrastructure
  if (tags.power === "substation" || tags.power === "plant") {
    return { category: "infrastructure", infraType: "power" };
  }

  return null;
}

/**
 * Chunks array into batches for safe Supabase upserting.
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log("================================================================================");
  console.log(" LandAlert Nexus â€” OSM Infrastructure & Village Ingestion");
  console.log(` Mode: ${DRY_RUN ? "DRY RUN (no DB modifications)" : "APPLY (writing to Supabase)"}`);
  console.log("================================================================================\n");

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

  if (!DRY_RUN && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("âŒ Fatal: SUPABASE_SERVICE_ROLE_KEY is required for write operations.");
    process.exit(1);
  }

  const supabaseKey = !DRY_RUN
    ? process.env.SUPABASE_SERVICE_ROLE_KEY!
    : process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  let supabase: SupabaseClient | null = null;
  let zones: RiskZone[] = [];

  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // 1. Fetch risk zones from Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("risk_zones")
        .select("id, zone_name, district, state, centroid_lat, centroid_lng")
        .order("id");

      if (error) {
        console.warn(`âš ï¸ Error fetching risk_zones from DB (${error.message}).`);
      } else if (data && data.length > 0) {
        zones = data as RiskZone[];
        console.log(`âœ“ Retrieved ${zones.length} risk zones from public.risk_zones.`);
      }
    } catch (e: any) {
      console.warn(`âš ï¸ Supabase connection error: ${e.message}.`);
    }
  }

  if (zones.length === 0) {
    if (DRY_RUN) {
      console.log(`âœ“ [DRY RUN] Using fallback set of ${FALLBACK_ZONES.length} Northeast India risk zones.`);
      zones = FALLBACK_ZONES;
    } else {
      console.error("âŒ Fatal: No risk zones could be loaded from public.risk_zones. Cannot proceed with database writes without verified live risk zones.");
      process.exit(1);
    }
  }

  // Data structures for cross-zone aggregation & deduplication
  const rawVillageHolders = new Map<string, DeduplicationHolder<VillageRecord>>();
  const rawInfraHolders = new Map<string, DeduplicationHolder<CriticalInfrastructureRecord>>();

  // Per-zone execution tracking
  const perZoneStats: Record<number, ZoneExecutionStats> = {};

  console.log(`\nStarting Overpass queries across ${zones.length} zones (~20km bounding boxes)...`);

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const bbox = computeBoundingBox(zone.centroid_lat, zone.centroid_lng);
    const query = buildOverpassQuery(bbox.south, bbox.west, bbox.north, bbox.east);

    perZoneStats[zone.id] = {
      zone,
      status: "FAILED",
      rawCount: 0,
      villageCount: 0,
      infraCount: 0,
      infraByType: { hospital: 0, clinic: 0, school: 0, bridge: 0, power: 0 },
    };

    console.log(
      `[${i + 1}/${zones.length}] Zone ${zone.id.toString().padStart(2)}: ${zone.zone_name.padEnd(28)} ` +
      `(${zone.district}, ${zone.state}) â€” bbox [${bbox.south}, ${bbox.west}, ${bbox.north}, ${bbox.east}]`
    );

    try {
      const elements = await fetchOverpassData(query);
      const rawCount = elements.length;

      let zoneVillages = 0;
      let zoneInfra = 0;

      for (const el of elements) {
        // Skip unnamed entities
        const rawName = el.tags?.name?.trim();
        if (!rawName) continue;

        const coords = extractElementCoordinates(el);
        if (!coords) continue;

        const classification = classifyElement(el);
        if (!classification) continue;

        const osmKey = `${el.type}:${el.id}`;

        if (classification.category === "village") {
          zoneVillages++;
          let pop: number | null = null;
          if (el.tags?.population) {
            const parsed = parseInt(el.tags.population.replace(/[^0-9]/g, ""), 10);
            if (!isNaN(parsed) && parsed > 0) pop = parsed;
          }

          const existing = rawVillageHolders.get(osmKey);
          if (existing) {
            if (!existing.zonesSeen.some((z) => z.id === zone.id)) {
              existing.zonesSeen.push(zone);
            }
          } else {
            rawVillageHolders.set(osmKey, {
              entityKey: osmKey,
              lat: coords.lat,
              lng: coords.lng,
              zonesSeen: [zone],
              record: {
                name: rawName,
                district: zone.district || null,
                state: zone.state || null,
                population: pop,
                lat: coords.lat,
                lng: coords.lng,
                zone_id: zone.id,
                distance_km_to_zone: 0,
                osm_id: el.id,
                osm_element_type: el.type,
                osm_place_tag: classification.placeTag,
              },
            });
          }
        } else if (classification.category === "infrastructure") {
          zoneInfra++;
          const infraType = classification.infraType;
          perZoneStats[zone.id].infraByType[infraType] =
            (perZoneStats[zone.id].infraByType[infraType] || 0) + 1;

          const existing = rawInfraHolders.get(osmKey);
          if (existing) {
            if (!existing.zonesSeen.some((z) => z.id === zone.id)) {
              existing.zonesSeen.push(zone);
            }
          } else {
            rawInfraHolders.set(osmKey, {
              entityKey: osmKey,
              lat: coords.lat,
              lng: coords.lng,
              zonesSeen: [zone],
              record: {
                name: rawName,
                type: infraType,
                lat: coords.lat,
                lng: coords.lng,
                zone_id: zone.id,
                distance_km_to_zone: 0,
                osm_id: el.id,
                osm_element_type: el.type,
              },
            });
          }
        }
      }

      perZoneStats[zone.id].rawCount = rawCount;
      perZoneStats[zone.id].villageCount = zoneVillages;
      perZoneStats[zone.id].infraCount = zoneInfra;
      perZoneStats[zone.id].status = rawCount > 0 ? "SUCCESS_WITH_DATA" : "SUCCESS_ZERO_DATA";

      if (rawCount > 0) {
        console.log(
          `    âœ“ [SUCCESS] Found ${rawCount} raw elements (${zoneVillages} named villages/hamlets, ` +
          `${zoneInfra} critical infrastructure)`
        );
      } else {
        console.log(`    âœ“ [SUCCESS (0 elements)] Query returned 0 matching elements in bbox.`);
      }
    } catch (err: any) {
      perZoneStats[zone.id].status = "FAILED";
      perZoneStats[zone.id].errorMessage = err.message;
      console.error(`    âŒ [FAILED] Query failed for Zone ${zone.id} (${zone.zone_name}): ${err.message}`);
    }

    // 5-second rate-limiting delay between zones
    if (i < zones.length - 1) {
      console.log(`    â³ Waiting ${OVERPASS_RATE_LIMIT_DELAY_MS / 1000}s before next zone...`);
      await new Promise((r) => setTimeout(r, OVERPASS_RATE_LIMIT_DELAY_MS));
    }
  }

  // ============================================================================
  // GLOBAL DEDUPLICATION & TRUE NEAREST-ZONE RESOLUTION ACROSS ALL REAL ZONES
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log(" Performing Global Deduplication & Nearest-Zone Resolution Across ALL Real Zones");
  console.log("--------------------------------------------------------------------------------");

  let villageCrossZoneCount = 0;
  let infraCrossZoneCount = 0;
  const resolutionSamples: CrossZoneResolutionSample[] = [];

  const finalVillages: VillageRecord[] = [];
  const finalInfrastructures: CriticalInfrastructureRecord[] = [];

  // 1. Deduplicate & resolve villages
  rawVillageHolders.forEach((holder, key) => {
    let nearestZone = zones[0];
    let minDistance = haversineDistanceKm(
      holder.lat,
      holder.lng,
      zones[0].centroid_lat,
      zones[0].centroid_lng
    );

    const allDistances: Array<{ zoneName: string; distanceKm: number }> = [
      { zoneName: zones[0].zone_name, distanceKm: Number(minDistance.toFixed(2)) },
    ];

    for (let j = 1; j < zones.length; j++) {
      const candidateZone = zones[j];
      const dist = haversineDistanceKm(
        holder.lat,
        holder.lng,
        candidateZone.centroid_lat,
        candidateZone.centroid_lng
      );
      allDistances.push({
        zoneName: candidateZone.zone_name,
        distanceKm: Number(dist.toFixed(2)),
      });

      if (dist < minDistance) {
        minDistance = dist;
        nearestZone = candidateZone;
      }
    }

    const isMultiZoneDiscovered = holder.zonesSeen.length > 1;
    const reallocatedAwayFromFirstSeen = holder.zonesSeen[0]?.id !== nearestZone.id;

    if (isMultiZoneDiscovered) {
      villageCrossZoneCount++;
    }

    if ((isMultiZoneDiscovered || reallocatedAwayFromFirstSeen) && resolutionSamples.length < 5) {
      const topCandidates = allDistances
        .filter((c) => c.distanceKm <= BBOX_RADIUS_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm);

      resolutionSamples.push({
        name: holder.record.name,
        osmKey: key,
        category: "village",
        assignedZone: nearestZone.zone_name,
        assignedDistanceKm: Number(minDistance.toFixed(2)),
        candidateDistances: topCandidates,
      });
    }

    // Haversine 20km filtering and assignment
    if (minDistance <= BBOX_RADIUS_KM) {
      holder.record.zone_id = nearestZone.id;
      holder.record.distance_km_to_zone = Number(minDistance.toFixed(2));
      holder.record.district = nearestZone.district || holder.record.district;
      holder.record.state = nearestZone.state || holder.record.state;

      finalVillages.push(holder.record);
    }
  });

  // 2. Deduplicate & resolve critical infrastructure
  rawInfraHolders.forEach((holder, key) => {
    let nearestZone = zones[0];
    let minDistance = haversineDistanceKm(
      holder.lat,
      holder.lng,
      zones[0].centroid_lat,
      zones[0].centroid_lng
    );

    const allDistances: Array<{ zoneName: string; distanceKm: number }> = [
      { zoneName: zones[0].zone_name, distanceKm: Number(minDistance.toFixed(2)) },
    ];

    for (let j = 1; j < zones.length; j++) {
      const candidateZone = zones[j];
      const dist = haversineDistanceKm(
        holder.lat,
        holder.lng,
        candidateZone.centroid_lat,
        candidateZone.centroid_lng
      );
      allDistances.push({
        zoneName: candidateZone.zone_name,
        distanceKm: Number(dist.toFixed(2)),
      });

      if (dist < minDistance) {
        minDistance = dist;
        nearestZone = candidateZone;
      }
    }

    const isMultiZoneDiscovered = holder.zonesSeen.length > 1;
    const reallocatedAwayFromFirstSeen = holder.zonesSeen[0]?.id !== nearestZone.id;

    if (isMultiZoneDiscovered) {
      infraCrossZoneCount++;
    }

    if ((isMultiZoneDiscovered || reallocatedAwayFromFirstSeen) && resolutionSamples.length < 10) {
      const topCandidates = allDistances
        .filter((c) => c.distanceKm <= BBOX_RADIUS_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm);

      resolutionSamples.push({
        name: holder.record.name,
        osmKey: key,
        category: "infrastructure",
        assignedZone: nearestZone.zone_name,
        assignedDistanceKm: Number(minDistance.toFixed(2)),
        candidateDistances: topCandidates,
      });
    }

    // Haversine 20km filtering and assignment
    if (minDistance <= BBOX_RADIUS_KM) {
      holder.record.zone_id = nearestZone.id;
      holder.record.distance_km_to_zone = Number(minDistance.toFixed(2));

      finalInfrastructures.push(holder.record);
    }
  });

  console.log(`âœ“ Global deduplication complete:`);
  console.log(`  - Unique villages/hamlets prepared: ${finalVillages.length} (${villageCrossZoneCount} discovered in multiple bounding boxes)`);
  console.log(`  - Unique critical infrastructure prepared: ${finalInfrastructures.length} (${infraCrossZoneCount} discovered in multiple bounding boxes)`);

  if (resolutionSamples.length > 0) {
    console.log("\n  Sample Nearest-Zone Resolutions Across All Risk Zones:");
    for (const sample of resolutionSamples) {
      const candidatesStr = sample.candidateDistances
        .map((c) => `${c.zoneName}: ${c.distanceKm}km`)
        .join(" vs ");
      console.log(
        `    â€¢ [${sample.category}] "${sample.name}" (${sample.osmKey}) -> Assigned to ${sample.assignedZone} ` +
        `(${sample.assignedDistanceKm}km) [Top Candidate Centroids: ${candidatesStr}]`
      );
    }
  }

  // Breakdown of Overpass query execution status
  const successfulWithData = zones.filter((z) => perZoneStats[z.id]?.status === "SUCCESS_WITH_DATA");
  const successfulZeroData = zones.filter((z) => perZoneStats[z.id]?.status === "SUCCESS_ZERO_DATA");
  const failedZones = zones.filter((z) => perZoneStats[z.id]?.status === "FAILED");

  console.log("\n================================================================================");
  console.log(" Overpass Query Status Breakdown across Monitored Zones");
  console.log("================================================================================");
  console.log(" Overall Coverage:");
  console.log(`   Successful zones: ${successfulWithData.length + successfulZeroData.length}/${zones.length}`);
  console.log(`   Failed zones:     ${failedZones.length}/${zones.length}`);
  console.log("--------------------------------------------------------------------------------");
  console.log(`\n1. SUCCESSFUL ZONES WITH DATA (${successfulWithData.length}/${zones.length}):`);
  for (const z of successfulWithData) {
    const stats = perZoneStats[z.id];
    console.log(
      `   âœ“ Zone ${z.id.toString().padStart(2)}: ${z.zone_name.padEnd(28)} ` +
      `â€” ${stats.rawCount} raw elements (${stats.villageCount} villages/hamlets, ${stats.infraCount} infra)`
    );
  }

  console.log(`\n2. SUCCESSFUL ZONES WITH ZERO DATA (${successfulZeroData.length}/${zones.length}):`);
  if (successfulZeroData.length === 0) {
    console.log("   (None â€” all successful zones returned data)");
  } else {
    for (const z of successfulZeroData) {
      console.log(
        `   â€¢ Zone ${z.id.toString().padStart(2)}: ${z.zone_name.padEnd(28)} ` +
        `â€” 0 raw elements in 20km bbox (Query succeeded)`
      );
    }
  }

  console.log(`\n3. FAILED ZONES (${failedZones.length}/${zones.length}):`);
  if (failedZones.length === 0) {
    console.log("   (None â€” all zones queried successfully)");
  } else {
    for (const z of failedZones) {
      const stats = perZoneStats[z.id];
      console.log(
        `   âŒ Zone ${z.id.toString().padStart(2)}: ${z.zone_name.padEnd(28)} ` +
        `â€” FAILED: ${stats.errorMessage || "Unknown error"}`
      );
    }
  }

  // Breakdown counts per assigned zone
  const assignedCounts: Record<
    number,
    {
      villages: number;
      infrastructure: number;
      infraByType: Record<string, number>;
    }
  > = {};

  for (const z of zones) {
    assignedCounts[z.id] = {
      villages: 0,
      infrastructure: 0,
      infraByType: { hospital: 0, clinic: 0, school: 0, bridge: 0, power: 0 },
    };
  }

  for (const v of finalVillages) {
    if (assignedCounts[v.zone_id]) {
      assignedCounts[v.zone_id].villages++;
    }
  }

  for (const inf of finalInfrastructures) {
    if (assignedCounts[inf.zone_id]) {
      assignedCounts[inf.zone_id].infrastructure++;
      assignedCounts[inf.zone_id].infraByType[inf.type] =
        (assignedCounts[inf.zone_id].infraByType[inf.type] || 0) + 1;
    }
  }

  // ============================================================================
  // ZONE SUMMARY & DATABASE UPSERT (OR DRY RUN PRINT)
  // ============================================================================
  console.log("\n================================================================================");
  console.log(` Assigned Entity Counts per Risk Zone & ${DRY_RUN ? "Dry Run Projection" : "Database Upsert Execution"}`);
  console.log("================================================================================");

  for (const zone of zones) {
    const counts = assignedCounts[zone.id];
    const totalEntities = (counts?.villages || 0) + (counts?.infrastructure || 0);
    const qStatus = perZoneStats[zone.id]?.status;

    let statusNote = "";
    if (qStatus === "FAILED") {
      statusNote = " [OVERPASS QUERY FAILED â€” assigned via spatial proximity]";
    } else if (qStatus === "SUCCESS_ZERO_DATA") {
      statusNote = " [OVERPASS QUERY RETURNED 0 â€” assigned via spatial proximity]";
    }

    if (totalEntities === 0) {
      console.log(
        `âš ï¸  Zone ${zone.id.toString().padStart(2)}: ${zone.zone_name.padEnd(28)} â€” 0 entities assigned${statusNote}`
      );
    } else {
      const typeBreakdown = Object.entries(counts.infraByType)
        .filter(([, cnt]) => cnt > 0)
        .map(([tp, cnt]) => `${tp}: ${cnt}`)
        .join(", ");

      console.log(
        `âœ“ Zone ${zone.id.toString().padStart(2)}: ${zone.zone_name.padEnd(28)} â€” ` +
        `${counts.villages} villages, ${counts.infrastructure} infrastructure` +
        (typeBreakdown ? ` (${typeBreakdown})` : "") +
        statusNote
      );
    }

    // Print 2-3 samples per zone in dry run
    if (DRY_RUN) {
      const zoneVillageSamples = finalVillages.filter((v) => v.zone_id === zone.id).slice(0, 2);
      const zoneInfraSamples = finalInfrastructures.filter((inf) => inf.zone_id === zone.id).slice(0, 2);

      for (const s of zoneVillageSamples) {
        console.log(
          `      Sample [village]: "${s.name}" (${s.osm_place_tag}, ${s.osm_element_type}#${s.osm_id}) ` +
          `at [${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}], dist=${s.distance_km_to_zone}km`
        );
      }
      for (const s of zoneInfraSamples) {
        console.log(
          `      Sample [${s.type}]: "${s.name}" (${s.osm_element_type}#${s.osm_id}) ` +
          `at [${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}], dist=${s.distance_km_to_zone}km`
        );
      }
    }
  }

  if (DRY_RUN) {
    console.log("\n--------------------------------------------------------------------------------");
    console.log(" [DRY RUN] Completed simulation.");
    console.log(` Would upsert ${finalVillages.length} villages and ${finalInfrastructures.length} critical infrastructure rows.`);
    console.log(` Overall Coverage: Successful zones: ${successfulWithData.length + successfulZeroData.length}/${zones.length}, Failed zones: ${failedZones.length}/${zones.length}`);
    console.log(` Overpass Query Outcomes: ${successfulWithData.length} with data, ${successfulZeroData.length} zero-data, ${failedZones.length} failed.`);
    console.log(" No database writes were performed. Pass without --dry-run to apply to Supabase.");
    console.log("--------------------------------------------------------------------------------");
    return;
  }

  // Live Upsert Mode
  if (!supabase) {
    console.error("âŒ Fatal: Cannot perform live upsert without Supabase configuration (SUPABASE_URL and key).");
    process.exit(1);
  }

  console.log("\nExecuting Supabase upserts using onConflict: 'osm_element_type,osm_id'...");

  // 1. Upsert Villages in batches
  const villageBatches = chunkArray(finalVillages, UPSERT_BATCH_SIZE);
  let upsertedVillages = 0;

  for (let b = 0; b < villageBatches.length; b++) {
    const batch = villageBatches[b];
    const { error: vErr } = await supabase
      .from("villages")
      .upsert(batch, { onConflict: "osm_element_type,osm_id" });

    if (vErr) {
      console.error(`âŒ Villages upsert batch ${b + 1}/${villageBatches.length} failed: ${vErr.message}`);
    } else {
      upsertedVillages += batch.length;
      console.log(`  âœ“ Villages batch ${b + 1}/${villageBatches.length}: ${batch.length} rows upserted.`);
    }
  }

  // 2. Upsert Critical Infrastructure in batches
  const infraBatches = chunkArray(finalInfrastructures, UPSERT_BATCH_SIZE);
  let upsertedInfra = 0;

  for (let b = 0; b < infraBatches.length; b++) {
    const batch = infraBatches[b];
    const { error: iErr } = await supabase
      .from("critical_infrastructure")
      .upsert(batch, { onConflict: "osm_element_type,osm_id" });

    if (iErr) {
      console.error(`âŒ Critical infrastructure batch ${b + 1}/${infraBatches.length} failed: ${iErr.message}`);
    } else {
      upsertedInfra += batch.length;
      console.log(`  âœ“ Critical infrastructure batch ${b + 1}/${infraBatches.length}: ${batch.length} rows upserted.`);
    }
  }

  console.log("\n================================================================================");
  console.log(" Ingestion Summary");
  console.log("================================================================================");
  console.log(` Villages upserted:                ${upsertedVillages} / ${finalVillages.length}`);
  console.log(` Critical Infrastructure upserted: ${upsertedInfra} / ${finalInfrastructures.length}`);
  console.log(` Overall Coverage:                 Successful zones: ${successfulWithData.length + successfulZeroData.length}/${zones.length}, Failed zones: ${failedZones.length}/${zones.length}`);
  console.log(` Overpass Query Outcomes:          ${successfulWithData.length} succeeded with data, ${successfulZeroData.length} succeeded with zero data, ${failedZones.length} failed`);
  if (failedZones.length > 0) {
    console.log(` Failed Zones (${failedZones.length}):`);
    for (const fz of failedZones) {
      console.log(`   - Zone ${fz.id} (${fz.zone_name}): ${perZoneStats[fz.id]?.errorMessage}`);
    }
  } else {
    console.log(" All zone queries completed without API errors.");
  }
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Fatal error during OSM ingestion:", err);
  process.exit(1);
});
