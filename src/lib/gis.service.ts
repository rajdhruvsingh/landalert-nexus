/**
 * src/lib/gis.service.ts
 * ======================
 * Authoritative GIS Backend Service for LandAlert-Nexus.
 * Outputs standards-compliant RFC 7946 GeoJSON FeatureCollections for
 * desktop GIS (QGIS, ArcGIS), web map clients (Leaflet, Mapbox), and external APIs.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zonePolygon } from "./risk";

export interface GeoJsonPolygonGeometry {
  type: "Polygon";
  coordinates: number[][][]; // [ [ [lng, lat], ... ] ]
}

export interface GeoJsonPointGeometry {
  type: "Point";
  coordinates: [number, number]; // [lng, lat]
}

export interface GeoJsonFeature<G, P> {
  type: "Feature";
  id?: string | number | undefined;
  geometry: G;
  properties: P;
}

export interface GeoJsonFeatureCollection<G, P> {
  type: "FeatureCollection";
  features: GeoJsonFeature<G, P>[];
  metadata?: Record<string, string | number | boolean> | undefined;
}

export interface ZoneGisProperties {
  id: number;
  zone_name: string;
  district: string;
  state: string;
  population: number;
  mean_slope_deg: number;
  current_risk_level: string;
  risk_score: number;
  soil_moisture_pct: number | null;
  soil_moisture_status: string;
  explanation: string | null;
  last_computed_at: string;
  active_model_version: string;
  centroid_lat: number;
  centroid_lng: number;
}

export interface SlideGisProperties {
  id: number;
  event_date: string;
  severity: string;
  source: string;
  hazard_type?: string;
  is_synthetic?: boolean;
  zone_id: number | null;
}

/**
 * Generates an RFC 7946 compliant GeoJSON FeatureCollection of all monitored risk zones.
 */
export async function getZonesGeoJson(): Promise<
  GeoJsonFeatureCollection<GeoJsonPolygonGeometry, ZoneGisProperties>
> {
  const [zonesRes, modelRes] = await Promise.all([
    supabaseAdmin.from("risk_zones").select("*").order("id"),
    supabaseAdmin
      .from("risk_model_config")
      .select("model_version")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (zonesRes.error) throw new Error(zonesRes.error.message);
  const activeModel = modelRes.data?.model_version ?? "v0.2-lr-trained";

  const features: GeoJsonFeature<GeoJsonPolygonGeometry, ZoneGisProperties>[] = (
    zonesRes.data ?? []
  ).map((z) => {
    // zonePolygon returns [lat, lng] array. GeoJSON standard requires [lng, lat]!
    const latLngs = zonePolygon(z.id, z.centroid_lat, z.centroid_lng);
    const ring: number[][] = latLngs.map(([lat, lng]) => [lng, lat]);
    // Close the ring (first and last coordinate identical)
    if (ring.length > 0) {
      ring.push([ring[0]![0]!, ring[0]![1]!]);
    }

    return {
      type: "Feature",
      id: z.id,
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
      properties: {
        id: z.id,
        zone_name: z.zone_name,
        district: z.district,
        state: z.state,
        population: z.population,
        mean_slope_deg: z.mean_slope_deg,
        current_risk_level: z.current_risk_level,
        risk_score: z.risk_score,
        soil_moisture_pct: z.soil_moisture_pct,
        soil_moisture_status: z.soil_moisture_status,
        explanation: z.explanation,
        last_computed_at: z.last_computed_at,
        active_model_version: activeModel,
        centroid_lat: z.centroid_lat,
        centroid_lng: z.centroid_lng,
      },
    };
  });

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      generated_at: new Date().toISOString(),
      zone_count: features.length,
      spatial_reference: "EPSG:4326 (WGS84)",
      data_layer: "LandAlert-Nexus Monitored Hill Zones",
    },
  };
}

/**
 * Generates an RFC 7946 compliant GeoJSON FeatureCollection of historical landslide events.
 */
export async function getLandslidesGeoJson(): Promise<
  GeoJsonFeatureCollection<GeoJsonPointGeometry, SlideGisProperties>
> {
  const { data, error } = await supabaseAdmin
    .from("historical_landslides")
    .select("*")
    .order("event_date", { ascending: false });

  if (error) throw new Error(error.message);

  const features: GeoJsonFeature<GeoJsonPointGeometry, SlideGisProperties>[] = (data ?? []).map(
    (s) => ({
      type: "Feature",
      id: s.id,
      geometry: {
        type: "Point",
        coordinates: [s.lng, s.lat], // [lng, lat]
      },
      properties: {
        id: s.id,
        event_date: s.event_date,
        severity: s.severity,
        source: s.source,
        zone_id: s.zone_id,
      },
    }),
  );

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      generated_at: new Date().toISOString(),
      event_count: features.length,
      spatial_reference: "EPSG:4326 (WGS84)",
    },
  };
}
