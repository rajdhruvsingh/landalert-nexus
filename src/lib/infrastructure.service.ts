/**
 * src/lib/infrastructure.service.ts
 * =================================
 * Authoritative Backend Service for Villages & Critical Infrastructure.
 * 
 * Provides database queries, GeoJSON feature collection generators (RFC 7946),
 * and exposure metrics calculation for Northeast India landslide risk zones.
 * 
 * Fulfills SIH Requirements 9 (Villages) & 10 (Critical Infrastructure).
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonPointGeometry,
} from "./gis.service";

export type InfrastructureType = "hospital" | "clinic" | "school" | "bridge" | "power";

export interface VillageRow {
  id: string;
  name: string;
  district: string | null;
  state: string | null;
  population: number | null;
  lat: number;
  lng: number;
  zone_id: number | null;
  distance_km_to_zone: number | null;
  osm_id: number | null;
  osm_element_type: "node" | "way";
  osm_place_tag: string | null;
  created_at: string;
}

export interface CriticalInfrastructureRow {
  id: string;
  name: string;
  type: InfrastructureType;
  lat: number;
  lng: number;
  zone_id: number | null;
  distance_km_to_zone: number | null;
  osm_id: number | null;
  osm_element_type: "node" | "way";
  created_at: string;
}

export interface VillageGisProperties {
  name: string;
  district: string | null;
  state: string | null;
  population: number | null;
  zone_id: number | null;
  distance_km_to_zone: number | null;
  osm_place_tag: string | null;
}

export interface InfrastructureGisProperties {
  name: string;
  type: InfrastructureType;
  zone_id: number | null;
  distance_km_to_zone: number | null;
}

export interface ExposureSummary {
  zoneId: number;
  villageCount: number;
  estimatedPopulationExposed: number;
  populationDataCompleteness: number;
  villagesWithPopulationData: number;
  infrastructureCount: number;
  infrastructureByType: {
    hospital: number;
    clinic: number;
    school: number;
    bridge: number;
    power: number;
  };
  nearestVillage: {
    name: string;
    distance_km: number;
  } | null;
  nearestInfrastructure: {
    name: string;
    type: string;
    distance_km: number;
  } | null;
}

/**
 * 1. getVillagesForZone
 * Fetches all villages assigned to a specific risk zone, ordered by proximity.
 */
export async function getVillagesForZone(zoneId: number): Promise<VillageRow[]> {
  // NOTE: Type assertion ('villages' as any) is temporarily required at the query-builder call site
  // because public.villages is not yet present in the generated Database type definitions.
  const { data, error } = await supabaseAdmin
    .from("villages" as any)
    .select("*")
    .eq("zone_id", zoneId)
    .order("distance_km_to_zone", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch villages for zone ${zoneId}: ${error.message}`);
  }

  return (data as unknown as VillageRow[]) ?? [];
}

/**
 * 2. getInfrastructureForZone
 * Fetches all critical infrastructure assigned to a specific risk zone, ordered by proximity.
 */
export async function getInfrastructureForZone(
  zoneId: number,
): Promise<CriticalInfrastructureRow[]> {
  // NOTE: Type assertion ('critical_infrastructure' as any) is temporarily required at the query-builder call site
  // because public.critical_infrastructure is not yet present in the generated Database type definitions.
  const { data, error } = await supabaseAdmin
    .from("critical_infrastructure" as any)
    .select("*")
    .eq("zone_id", zoneId)
    .order("distance_km_to_zone", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch critical infrastructure for zone ${zoneId}: ${error.message}`);
  }

  return (data as unknown as CriticalInfrastructureRow[]) ?? [];
}

/**
 * 3. getAllVillagesGeoJSON
 * Generates an RFC 7946 compliant GeoJSON FeatureCollection of all villages.
 * Coordinates are strictly in [longitude, latitude] order.
 */
export async function getAllVillagesGeoJSON(): Promise<
  GeoJsonFeatureCollection<GeoJsonPointGeometry, VillageGisProperties>
> {
  // NOTE: Type assertion ('villages' as any) is temporarily required at the query-builder call site
  // because public.villages is not yet present in the generated Database type definitions.
  const { data, error } = await supabaseAdmin
    .from("villages" as any)
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch villages GeoJSON: ${error.message}`);
  }

  const rows = (data as unknown as VillageRow[]) ?? [];

  const features: GeoJsonFeature<GeoJsonPointGeometry, VillageGisProperties>[] = rows.map((v) => ({
    type: "Feature",
    id: v.id,
    geometry: {
      type: "Point",
      coordinates: [v.lng, v.lat], // RFC 7946 standard: [lng, lat]
    },
    properties: {
      name: v.name,
      district: v.district,
      state: v.state,
      population: v.population,
      zone_id: v.zone_id,
      distance_km_to_zone: v.distance_km_to_zone,
      osm_place_tag: v.osm_place_tag,
    },
  }));

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      generated_at: new Date().toISOString(),
      village_count: features.length,
      spatial_reference: "EPSG:4326 (WGS84)",
      data_layer: "LandAlert-Nexus Villages",
    },
  };
}

/**
 * 4. getAllInfrastructureGeoJSON
 * Generates an RFC 7946 compliant GeoJSON FeatureCollection of all critical infrastructure.
 * Coordinates are strictly in [longitude, latitude] order.
 */
export async function getAllInfrastructureGeoJSON(): Promise<
  GeoJsonFeatureCollection<GeoJsonPointGeometry, InfrastructureGisProperties>
> {
  // NOTE: Type assertion ('critical_infrastructure' as any) is temporarily required at the query-builder call site
  // because public.critical_infrastructure is not yet present in the generated Database type definitions.
  const { data, error } = await supabaseAdmin
    .from("critical_infrastructure" as any)
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch critical infrastructure GeoJSON: ${error.message}`);
  }

  const rows = (data as unknown as CriticalInfrastructureRow[]) ?? [];

  const features: GeoJsonFeature<GeoJsonPointGeometry, InfrastructureGisProperties>[] = rows.map(
    (inf) => ({
      type: "Feature",
      id: inf.id,
      geometry: {
        type: "Point",
        coordinates: [inf.lng, inf.lat], // RFC 7946 standard: [lng, lat]
      },
      properties: {
        name: inf.name,
        type: inf.type,
        zone_id: inf.zone_id,
        distance_km_to_zone: inf.distance_km_to_zone,
      },
    }),
  );

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      generated_at: new Date().toISOString(),
      infrastructure_count: features.length,
      spatial_reference: "EPSG:4326 (WGS84)",
      data_layer: "LandAlert-Nexus Critical Infrastructure",
    },
  };
}

/**
 * 5. computeExposureSummary
 * Computes exposure metrics for a specific risk zone combining village population
 * and critical infrastructure tallies. Handles zero-data zones gracefully.
 */
export async function computeExposureSummary(zoneId: number): Promise<ExposureSummary> {
  const [villages, infrastructure] = await Promise.all([
    getVillagesForZone(zoneId),
    getInfrastructureForZone(zoneId),
  ]);

  const villageCount = villages.length;
  let estimatedPopulationExposed = 0;
  let villagesWithPopulationData = 0;

  for (const v of villages) {
    if (v.population !== null && v.population !== undefined) {
      estimatedPopulationExposed += v.population;
      villagesWithPopulationData += 1;
    }
  }

  const populationDataCompleteness =
    villageCount === 0 ? 0 : villagesWithPopulationData / villageCount;

  const infrastructureByType: {
    hospital: number;
    clinic: number;
    school: number;
    bridge: number;
    power: number;
  } = {
    hospital: 0,
    clinic: 0,
    school: 0,
    bridge: 0,
    power: 0,
  };

  for (const item of infrastructure) {
    if (item.type in infrastructureByType) {
      infrastructureByType[item.type] += 1;
    }
  }

  const nearestVillage =
    villages.length > 0 && villages[0]
      ? {
          name: villages[0].name,
          distance_km: villages[0].distance_km_to_zone ?? 0,
        }
      : null;

  const nearestInfrastructure =
    infrastructure.length > 0 && infrastructure[0]
      ? {
          name: infrastructure[0].name,
          type: infrastructure[0].type,
          distance_km: infrastructure[0].distance_km_to_zone ?? 0,
        }
      : null;

  return {
    zoneId,
    villageCount,
    estimatedPopulationExposed,
    populationDataCompleteness,
    villagesWithPopulationData,
    infrastructureCount: infrastructure.length,
    infrastructureByType,
    nearestVillage,
    nearestInfrastructure,
  };
}

