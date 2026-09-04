#!/usr/bin/env npx tsx
/**
 * Task C / Task 3: Multi-point SRTM-derived slope sampling for risk zones.
 *
 * Samples a 3x3 grid (9 points, ~250m spacing: -250m, 0, +250m) across each zone's
 * extent. Evaluates local central finite difference slope at each grid center using
 * ±0.0009° (≈90m) offsets.
 *
 * Computes:
 *   - mean_slope_deg: arithmetic mean across the grid
 *   - slope_p90_deg: 90th percentile slope across the grid (representative hazard slope)
 *   - max_slope_deg: maximum slope across the grid
 *
 * Usage:
 *   npx tsx scripts/compute_slope_from_dem.ts           # dry run — prints computed values
 *   npx tsx scripts/compute_slope_from_dem.ts --apply   # writes to Supabase risk_zones
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as fs from "fs";
config();

const DRY_RUN = !process.argv.includes("--apply");

// SRTM 30m pixel ≈ 0.000833° (1 arc-second). Use 0.0009° (~90m-100m) for gradient evaluation.
const DELTA_DEG = 0.0009;
const SRTM_PIXEL_M = 100; // meters between the N/S or E/W sample points

// Multi-point grid spacing: ~250m spacing between grid centers
const SPACING_DEG = 0.00225; // ~250m in latitude

// Zones where slope_source already has a peer-reviewed citation (Zones 11, 12: Sikkim — Das et al. 2018)
const PEER_REVIEWED_ZONES = new Set([11, 12]);

interface ZoneRow {
  id: number;
  zone_name: string;
  centroid_lat: number;
  centroid_lng: number;
  mean_slope_deg: number;
  slope_p90_deg?: number | null;
  max_slope_deg?: number | null;
  slope_source: string;
}

async function fetchElevations(points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const locationStr = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locationStr}`;

  let attempts = 0;
  while (attempts < 3) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        console.warn("Rate limited — waiting 2s...");
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
        continue;
      }
      if (!res.ok) {
        console.error(`OpenTopoData error ${res.status} for request: ${url}`);
        return points.map(() => null);
      }
      const json = (await res.json()) as { results: { elevation: number | null }[] };
      return json.results.map((r) => r.elevation);
    } catch (e) {
      console.warn(`Fetch error (attempt ${attempts + 1}):`, e);
      await new Promise((r) => setTimeout(r, 1500));
      attempts++;
    }
  }
  return points.map(() => null);
}

function computeLocalSlope(
  zCenter: number | null,
  zNorth: number | null,
  zSouth: number | null,
  zEast: number | null,
  zWest: number | null,
): number | null {
  if (zNorth == null || zSouth == null || zEast == null || zWest == null) return null;
  const dzdx = (zEast - zWest) / (2 * SRTM_PIXEL_M);
  const dzdy = (zNorth - zSouth) / (2 * SRTM_PIXEL_M);
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  return (slopeRad * 180) / Math.PI;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (upper >= sorted.length) return sorted[sorted.length - 1];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const FALLBACK_ZONES: ZoneRow[] = [
    { id: 1, zone_name: "Tamenglong", centroid_lat: 24.98, centroid_lng: 93.5, mean_slope_deg: 31.4, slope_source: "NDMA 2021" },
    { id: 2, zone_name: "Noney", centroid_lat: 24.83, centroid_lng: 93.66, mean_slope_deg: 38.2, slope_source: "GSI Noney 2017" },
    { id: 3, zone_name: "Aizawl East", centroid_lat: 23.73, centroid_lng: 92.72, mean_slope_deg: 42.6, slope_source: "Pachuau 2017" },
    { id: 4, zone_name: "Lunglei Slopes", centroid_lat: 22.89, centroid_lng: 92.79, mean_slope_deg: 36.1, slope_source: "NDMA 2021" },
    { id: 5, zone_name: "Shillong-Sohra Escarpment", centroid_lat: 25.3, centroid_lng: 91.72, mean_slope_deg: 45.8, slope_source: "GSI Meghalaya 2015" },
    { id: 6, zone_name: "Jaintia Hills Ridge", centroid_lat: 25.45, centroid_lng: 92.36, mean_slope_deg: 33.7, slope_source: "Estimated" },
    { id: 7, zone_name: "Kohima Ridge", centroid_lat: 25.67, centroid_lng: 94.11, mean_slope_deg: 40.3, slope_source: "GSI Nagaland 2014" },
    { id: 8, zone_name: "Dimapur Foothills", centroid_lat: 25.9, centroid_lng: 93.73, mean_slope_deg: 21.5, slope_source: "Estimated" },
    { id: 9, zone_name: "Papum Pare", centroid_lat: 27.1, centroid_lng: 93.62, mean_slope_deg: 29.9, slope_source: "Estimated" },
    { id: 10, zone_name: "Dibang Valley", centroid_lat: 28.25, centroid_lng: 95.9, mean_slope_deg: 47.2, slope_source: "GSI Arunachal 2018" },
    { id: 11, zone_name: "Gangtok-Singtam Corridor", centroid_lat: 27.33, centroid_lng: 88.61, mean_slope_deg: 44.1, slope_source: "Das et al. 2018" },
    { id: 12, zone_name: "Mangan North", centroid_lat: 27.51, centroid_lng: 88.53, mean_slope_deg: 48.6, slope_source: "Das et al. 2018" },
    { id: 13, zone_name: "Haflong Hills", centroid_lat: 25.17, centroid_lng: 93.02, mean_slope_deg: 34.8, slope_source: "Boro et al. 2021" },
    { id: 14, zone_name: "Karbi Anglong West", centroid_lat: 26.05, centroid_lng: 93.1, mean_slope_deg: 24.6, slope_source: "Estimated" },
    { id: 15, zone_name: "Ambassa Hills", centroid_lat: 23.93, centroid_lng: 91.85, mean_slope_deg: 19.8, slope_source: "Estimated" },
  ];

  let zones: ZoneRow[] = [];
  let sb: any = null;

  if (supabaseUrl && supabaseKey) {
    try {
      sb = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await sb
        .from("risk_zones")
        .select("id, zone_name, centroid_lat, centroid_lng, mean_slope_deg, slope_p90_deg, max_slope_deg, slope_source")
        .order("id");
      if (!error && data && data.length > 0) {
        zones = data as ZoneRow[];
      }
    } catch {
      // Fallback
    }
  }

  if (zones.length === 0) {
    console.log("Using static fallback zones for slope calculation.");
    zones = FALLBACK_ZONES;
  }

  console.log(`Loaded ${zones.length} zones. Computing multi-point slopes (3x3 grid, ~250m spacing)...`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (print only)" : "APPLY (write to Supabase)"}\n`);

  const sqlLines: string[] = [
    "-- Multi-point SRTM30m slope values (3x3 grid, ~250m spacing) computed by scripts/compute_slope_from_dem.ts",
    "-- Run date: " + new Date().toISOString(),
    "",
  ];

  for (const zone of zones) {
    const clat = zone.centroid_lat;
    const clng = zone.centroid_lng;

    // Build 3x3 grid of sample centers
    const gridOffsets = [-SPACING_DEG, 0.0, SPACING_DEG];
    const samplePoints: { lat: number; lng: number }[] = [];

    // For each center, we query: center, North, South, East, West (5 points x 9 centers = 45 points)
    for (const dy of gridOffsets) {
      for (const dx of gridOffsets) {
        const cy = clat + dy;
        const cx = clng + dx;
        samplePoints.push(
          { lat: cy, lng: cx },
          { lat: cy + DELTA_DEG, lng: cx },
          { lat: cy - DELTA_DEG, lng: cx },
          { lat: cy, lng: cx + DELTA_DEG },
          { lat: cy, lng: cx - DELTA_DEG },
        );
      }
    }

    // Rate limit: 1.1s per zone request to respect OpenTopoData guidelines
    await new Promise((r) => setTimeout(r, 1100));

    const elevations = await fetchElevations(samplePoints);

    const slopes: number[] = [];
    for (let idx = 0; idx < 9; idx++) {
      const base = idx * 5;
      const [zC, zN, zS, zE, zW] = elevations.slice(base, base + 5);
      const s = computeLocalSlope(zC, zN, zS, zE, zW);
      if (s != null) {
        slopes.push(s);
      }
    }

    if (slopes.length === 0) {
      console.warn(`Zone ${zone.id} (${zone.zone_name}): Could not compute slopes (elevations null). Skipping.`);
      continue;
    }

    const meanSlope = Math.round((slopes.reduce((a, b) => a + b, 0) / slopes.length) * 10) / 10;
    const p90Slope = Math.round(calculatePercentile(slopes, 90) * 10) / 10;
    const maxSlope = Math.round(Math.max(...slopes) * 10) / 10;

    const source =
      `SRTM30m DEM multi-point 3x3 grid (~250m spacing, 9 samples) via api.opentopodata.org, ` +
      `computed ${new Date().toISOString().slice(0, 10)}. ` +
      `Grid mean=${meanSlope}°, 90th-percentile=${p90Slope}°, max=${maxSlope}°.`;

    console.log(
      `Zone ${zone.id.toString().padStart(2)} ${zone.zone_name.padEnd(28)}: ` +
      `mean=${meanSlope.toFixed(1)}°, p90=${p90Slope.toFixed(1)}°, max=${maxSlope.toFixed(1)}° ` +
      `— ${DRY_RUN ? "would update" : "updating"}`
    );

    sqlLines.push(
      `UPDATE public.risk_zones`,
      `  SET mean_slope_deg = ${meanSlope},`,
      `      slope_p90_deg  = ${p90Slope},`,
      `      max_slope_deg  = ${maxSlope},`,
      `      slope_source   = '${source.replace(/'/g, "''")}'`,
      `WHERE id = ${zone.id};`,
      ``,
    );

    if (!DRY_RUN && sb) {
      const { error: updateErr } = await sb
        .from("risk_zones")
        .update({
          mean_slope_deg: meanSlope,
          slope_p90_deg: p90Slope,
          max_slope_deg: maxSlope,
          slope_source: source,
        })
        .eq("id", zone.id);

      if (updateErr) {
        console.error(`Zone ${zone.id}: update failed — ${updateErr.message}`);
      } else {
        console.log(`  ✓ Updated zone ${zone.id} (mean=${meanSlope}°, p90=${p90Slope}°, max=${maxSlope}°)`);
      }
    }
  }

  const outPath = "supabase/migrations/20260905033500_update_zone_slopes.sql";
  fs.writeFileSync(outPath, sqlLines.join("\n"), "utf-8");
  console.log(`\n✓ Generated SQL written to ${outPath}`);

  if (!DRY_RUN) {
    console.log("✓ All applicable zones updated in database.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
