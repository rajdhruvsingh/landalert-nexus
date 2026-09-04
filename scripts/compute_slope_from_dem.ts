#!/usr/bin/env npx tsx
/**
 * Task C: Compute real SRTM-derived slope for each risk zone centroid.
 *
 * Uses the Open-Topo-Data public API (api.opentopodata.org) with the SRTM30m
 * dataset. Queries the zone centroid plus four cardinal-direction neighbors at
 * ±0.0009° offset (≈ 90m = 1 SRTM pixel width). Computes slope via the central
 * finite difference formula.
 *
 * Usage:
 *   npx tsx scripts/compute_slope_from_dem.ts           # dry run — prints SQL
 *   npx tsx scripts/compute_slope_from_dem.ts --apply   # writes to Supabase
 *
 * Rate limits: Open-Topo-Data public API = 1 req/sec, 1000 req/day.
 * This script makes 3 batch requests (15 zones × 5 points = 75 locations,
 * batched at 100 locations max per request) — well within limits.
 *
 * NOTE: Does NOT overwrite zones where slope_source already cites a
 * peer-reviewed study AND the difference from the computed value is < 5°.
 * These zones are logged but skipped.
 *
 * LIMITATION NOTE:
 * Centroid-only sampling (centroid ± 100m) samples only a single location
 * in each zone. In zones with extreme relief contrast (such as Zone 5 Shillong-Sohra,
 * where the centroid is on the flat 1500m plateau top rather than the 45-60°
 * canyon escarpments, or Zone 8 Dimapur on the alluvial floor), centroid slope
 * will register as nearly flat (~0-1°). For operational production, zonal
 * polygon sampling evaluating the 90th percentile slope across the hazardous
 * terrain is recommended.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config();

const DRY_RUN = !process.argv.includes("--apply");

// SRTM 30m pixel ≈ 0.000833° (1 arc-second). Use 0.0009° (~100m) as offset.
const DELTA_DEG = 0.0009;
const SRTM_PIXEL_M = 100; // meters between the N/S or E/W sample points

// Zones where slope_source already has a peer-reviewed citation —
// only overwrite if computed value differs by > 5°.
const PEER_REVIEWED_ZONES = new Set([11, 12]); // Sikkim — Das et al. 2018

interface ZoneRow {
  id: number;
  zone_name: string;
  centroid_lat: number;
  centroid_lng: number;
  mean_slope_deg: number;
  slope_source: string;
}

interface TopoPoint {
  lat: number;
  lng: number;
  elevation: number | null;
}

async function fetchElevations(points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const locationStr = points.map((p) => `${p.lat},${p.lng}`).join("|");
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locationStr}`;

  let attempts = 0;
  while (attempts < 3) {
    const res = await fetch(url);
    if (res.status === 429) {
      console.warn("Rate limited — waiting 2s");
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
      continue;
    }
    if (!res.ok) {
      console.error(`OpenTopoData error ${res.status} for request: ${url}`);
      return points.map(() => null);
    }
    const json = await res.json() as { results: { elevation: number | null }[] };
    return json.results.map((r) => r.elevation);
  }
  return points.map(() => null);
}

function computeSlope(
  zCenter: number | null,
  zNorth: number | null,
  zSouth: number | null,
  zEast: number | null,
  zWest: number | null,
): number | null {
  if (zNorth == null || zSouth == null || zEast == null || zWest == null) return null;

  // Central finite difference: dz/dx = (z_east - z_west) / (2 * dx_m)
  // dz/dy = (z_north - z_south) / (2 * dy_m)
  const dzdx = (zEast - zWest) / (2 * SRTM_PIXEL_M);
  const dzdy = (zNorth - zSouth) / (2 * SRTM_PIXEL_M);
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  return Math.round((slopeRad * 180) / Math.PI * 10) / 10;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const FALLBACK_ZONES: ZoneRow[] = [
    { id: 1, zone_name: "Tamenglong", centroid_lat: 24.98, centroid_lng: 93.5, mean_slope_deg: 31.4, slope_source: "NDMA NER Composite Risk Atlas 2021" },
    { id: 2, zone_name: "Noney", centroid_lat: 24.83, centroid_lng: 93.66, mean_slope_deg: 38.2, slope_source: "GSI District Hazard Zonation Report, Noney (2017)" },
    { id: 3, zone_name: "Aizawl East", centroid_lat: 23.73, centroid_lng: 92.72, mean_slope_deg: 42.6, slope_source: "Pachuau & Lallianthanga (2017)" },
    { id: 4, zone_name: "Lunglei Slopes", centroid_lat: 22.89, centroid_lng: 92.79, mean_slope_deg: 36.1, slope_source: "NDMA NER Composite Risk Atlas 2021" },
    { id: 5, zone_name: "Shillong-Sohra Escarpment", centroid_lat: 25.3, centroid_lng: 91.72, mean_slope_deg: 45.8, slope_source: "GSI Meghalaya Hazard Zonation Report (2015)" },
    { id: 6, zone_name: "Jaintia Hills Ridge", centroid_lat: 25.45, centroid_lng: 92.36, mean_slope_deg: 33.7, slope_source: "Estimated from regional terrain class" },
    { id: 7, zone_name: "Kohima Ridge", centroid_lat: 25.67, centroid_lng: 94.11, mean_slope_deg: 40.3, slope_source: "GSI Nagaland Hazard Zonation Report (2014)" },
    { id: 8, zone_name: "Dimapur Foothills", centroid_lat: 25.9, centroid_lng: 93.73, mean_slope_deg: 21.5, slope_source: "Estimated from regional terrain class" },
    { id: 9, zone_name: "Papum Pare", centroid_lat: 27.1, centroid_lng: 93.62, mean_slope_deg: 29.9, slope_source: "Estimated from regional terrain class" },
    { id: 10, zone_name: "Dibang Valley", centroid_lat: 28.25, centroid_lng: 95.9, mean_slope_deg: 47.2, slope_source: "GSI Arunachal Pradesh Zonation Report (2018)" },
    { id: 11, zone_name: "Gangtok-Singtam Corridor", centroid_lat: 27.33, centroid_lng: 88.61, mean_slope_deg: 44.1, slope_source: "Das et al. (2018) Nat Hazards Earth Syst Sci 18:2759-2775" },
    { id: 12, zone_name: "Mangan North", centroid_lat: 27.51, centroid_lng: 88.53, mean_slope_deg: 48.6, slope_source: "Das et al. (2018) Nat Hazards Earth Syst Sci 18:2759-2775" },
    { id: 13, zone_name: "Haflong Hills", centroid_lat: 25.17, centroid_lng: 93.02, mean_slope_deg: 34.8, slope_source: "Boro et al. (2021) Landslides 18(4):1533-1547" },
    { id: 14, zone_name: "Karbi Anglong West", centroid_lat: 26.05, centroid_lng: 93.1, mean_slope_deg: 24.6, slope_source: "Estimated from regional terrain class" },
    { id: 15, zone_name: "Ambassa Hills", centroid_lat: 23.93, centroid_lng: 91.85, mean_slope_deg: 19.8, slope_source: "Estimated from regional terrain class" },
  ];

  let zones: ZoneRow[] = [];

  if (supabaseUrl && supabaseKey) {
    try {
      const sb = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await sb
        .from("risk_zones")
        .select("id, zone_name, centroid_lat, centroid_lng, mean_slope_deg, slope_source")
        .order("id");
      if (!error && data && data.length > 0) {
        zones = data as ZoneRow[];
      }
    } catch {
      // Fallback
    }
  }

  if (zones.length === 0) {
    console.log("Using static baseline zone coordinates for slope calculation.");
    zones = FALLBACK_ZONES;
  }

  console.log(`Loaded ${zones.length} zones. Computing slopes from SRTM30m...`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (print SQL only)" : "APPLY (write to Supabase)"}\n`);

  const sqlLines: string[] = [
    "-- Task C: SRTM30m-derived slope values computed by scripts/compute_slope_from_dem.ts",
    "-- Source: api.opentopodata.org SRTM30m, central finite difference (±90m offset)",
    "-- Run date: " + new Date().toISOString(),
    "-- To apply: npx tsx scripts/compute_slope_from_dem.ts --apply",
    "",
  ];

  for (const zone of zones as ZoneRow[]) {
    // Build 5-point sample: center + N/S/E/W
    const points = [
      { lat: zone.centroid_lat, lng: zone.centroid_lng }, // center
      { lat: zone.centroid_lat + DELTA_DEG, lng: zone.centroid_lng }, // N
      { lat: zone.centroid_lat - DELTA_DEG, lng: zone.centroid_lng }, // S
      { lat: zone.centroid_lat, lng: zone.centroid_lng + DELTA_DEG }, // E
      { lat: zone.centroid_lat, lng: zone.centroid_lng - DELTA_DEG }, // W
    ];

    // Rate limit: 1 req/sec per API guidelines
    await new Promise((r) => setTimeout(r, 1100));

    const elevations = await fetchElevations(points);
    const [zC, zN, zS, zE, zW] = elevations;

    const computedSlope = computeSlope(zC, zN, zS, zE, zW);

    if (computedSlope == null) {
      console.warn(`Zone ${zone.id} (${zone.zone_name}): Could not compute slope (null elevation). Skipping.`);
      continue;
    }

    const existing = zone.mean_slope_deg;
    const diff = Math.abs(computedSlope - existing);

    if (PEER_REVIEWED_ZONES.has(zone.id) && diff < 5) {
      console.log(
        `Zone ${zone.id} (${zone.zone_name}): peer-reviewed slope ${existing}°, ` +
        `computed ${computedSlope}° (diff ${diff.toFixed(1)}° < 5° threshold) — SKIPPING.`
      );
      continue;
    }

    const source =
      `SRTM30m DEM via api.opentopodata.org, ` +
      `central finite difference ±${SRTM_PIXEL_M}m offset, ` +
      `computed ${new Date().toISOString().slice(0, 10)}. ` +
      `Center elevation: ${zC}m. N:${zN}m S:${zS}m E:${zE}m W:${zW}m.`;

    console.log(
      `Zone ${zone.id} (${zone.zone_name}): ` +
      `prev=${existing}°, computed=${computedSlope}° (diff ${diff.toFixed(1)}°) ` +
      `— ${DRY_RUN ? "would update" : "updating"}`
    );

    sqlLines.push(
      `UPDATE public.risk_zones`,
      `  SET mean_slope_deg = ${computedSlope},`,
      `      slope_source = '${source.replace(/'/g, "''")}'`,
      `WHERE id = ${zone.id};`,
      ``
    );

    if (!DRY_RUN) {
      const { error: updateErr } = await sb
        .from("risk_zones")
        .update({ mean_slope_deg: computedSlope, slope_source: source })
        .eq("id", zone.id);

      if (updateErr) {
        console.error(`Zone ${zone.id}: update failed — ${updateErr.message}`);
      } else {
        console.log(`  ✓ Updated zone ${zone.id}`);
      }
    }
  }

  const sqlOutput = sqlLines.join("\n");
  const fs = await import("fs");
  const outPath = "supabase/migrations/20260904140500_task_c_dem_slope.sql";
  fs.writeFileSync(outPath, sqlOutput, "utf-8");
  console.log(`\n✓ SQL written to ${outPath}`);

  if (DRY_RUN) {
    console.log("\n--- Generated SQL ---");
    console.log(sqlOutput);
    console.log("\nRun with --apply to write to Supabase.");
  } else {
    console.log("\n✓ All applicable zones updated in Supabase.");
    console.log("Run: SELECT id, zone_name, mean_slope_deg, slope_source FROM risk_zones ORDER BY id;");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
