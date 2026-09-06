/**
 * src/lib/integrations/sensors.adapter.ts
 * =======================================
 * Physical Geotechnical In-Situ Sensor Telemetry Ingestion Engine.
 *
 * Handles live telemetry from:
 * - Surface / borehole inclinometers & tiltmeters (slope creep & tilt angle)
 * - Vibrating wire piezometers (pore water pressure kPa)
 * - Surface wire crackmeters / extensometers (displacement mm)
 * - Capacitive multi-depth soil moisture probes (volumetric water content %)
 *
 * Scaffolding Note:
 * Endpoint is production-ready with physical limit validations and token auth.
 * Activation requires physical sensor hardware deployment and telemetry SIM/LoRa gateway.
 * See docs/EXTERNAL_INTEGRATIONS_PENDING.md for hardware deployment specifications.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface SensorTelemetryPayload {
  device_id: string;
  zone_id: number;
  timestamp: string;
  sensor_type: "inclinometer" | "piezometer" | "extensometer" | "soil_probe" | "multi_sensor";
  coordinates?: {
    latitude: number;
    longitude: number;
    elevation_m?: number;
  };
  readings: {
    tilt_pitch_deg?: number;
    tilt_roll_deg?: number;
    tilt_cumulative_deg?: number;
    pore_pressure_kpa?: number;
    displacement_mm?: number;
    displacement_rate_mm_per_h?: number;
    soil_moisture_10cm_pct?: number;
    soil_moisture_30cm_pct?: number;
    soil_moisture_50cm_pct?: number;
  };
  telemetry?: {
    battery_v?: number;
    rssi_dbm?: number;
    solar_mv?: number;
  };
}

export interface SensorIngestionResult {
  success: boolean;
  ingestedCount: number;
  alertsTriggered: string[];
  errors: string[];
}

export async function processSensorTelemetry(
  payloads: SensorTelemetryPayload[],
  authHeader?: string | null,
): Promise<SensorIngestionResult> {
  const expectedSecret = process.env["SENSOR_INGESTION_SECRET"];
  if (!expectedSecret || expectedSecret.trim() === "") {
    throw new Error(
      "SENSOR_INGESTION_UNCONFIGURED: SENSOR_INGESTION_SECRET is not configured in server environment. Physical sensor deployment required.",
    );
  }

  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader?.trim();
  if (token !== expectedSecret) {
    throw new Error("SENSOR_AUTH_FAILED: Invalid sensor ingestion bearer token.");
  }

  if (!Array.isArray(payloads) || payloads.length === 0) {
    return { success: true, ingestedCount: 0, alertsTriggered: [], errors: [] };
  }

  const errors: string[] = [];
  const alertsTriggered: string[] = [];
  let ingested = 0;

  for (const p of payloads) {
    // 1. Validation of physical constraints
    if (!p.device_id || !p.zone_id || !p.timestamp) {
      errors.push(`Missing mandatory fields (device_id, zone_id, timestamp).`);
      continue;
    }

    if (p.zone_id < 1 || p.zone_id > 15) {
      errors.push(`Device ${p.device_id}: Zone ID ${p.zone_id} outside monitored range [1, 15].`);
      continue;
    }

    const { readings } = p;
    // Physical bounds checks
    if (readings.tilt_cumulative_deg !== undefined && (readings.tilt_cumulative_deg < -90 || readings.tilt_cumulative_deg > 90)) {
      errors.push(`Device ${p.device_id}: Tilt angle ${readings.tilt_cumulative_deg}° exceeds physical limits [-90, 90].`);
      continue;
    }

    if (readings.pore_pressure_kpa !== undefined && readings.pore_pressure_kpa < 0) {
      errors.push(`Device ${p.device_id}: Pore pressure cannot be negative (${readings.pore_pressure_kpa} kPa).`);
      continue;
    }

    // 2. High-hazard threshold alarms
    if (readings.tilt_cumulative_deg && Math.abs(readings.tilt_cumulative_deg) > 5.0) {
      alertsTriggered.push(
        `CRITICAL TILT: Device ${p.device_id} in Zone ${p.zone_id} measured ${readings.tilt_cumulative_deg}° slope tilt!`,
      );
    }
    if (readings.displacement_rate_mm_per_h && readings.displacement_rate_mm_per_h > 2.0) {
      alertsTriggered.push(
        `ACCELERATING DISPLACEMENT: Device ${p.device_id} in Zone ${p.zone_id} displacement rate ${readings.displacement_rate_mm_per_h} mm/h!`,
      );
    }

    // 3. Update weather / soil moisture readings if soil probe is attached
    if (readings.soil_moisture_10cm_pct !== undefined) {
      const readingTime = new Date(p.timestamp).toISOString();
      const avgMoisture = readings.soil_moisture_30cm_pct !== undefined
        ? (readings.soil_moisture_10cm_pct + readings.soil_moisture_30cm_pct) / 2
        : readings.soil_moisture_10cm_pct;

      await supabaseAdmin.from("weather_readings").upsert(
        {
          zone_id: p.zone_id,
          reading_time: readingTime,
          rainfall_mm: 0,
          soil_moisture_pct: Number(avgMoisture.toFixed(1)),
          source: `Physical-Sensor-${p.device_id} (In-situ probe)`,
          station_id: p.device_id,
        },
        { onConflict: "zone_id,reading_time" },
      );
    }

    ingested++;
  }

  return {
    success: errors.length === 0,
    ingestedCount: ingested,
    alertsTriggered,
    errors,
  };
}
