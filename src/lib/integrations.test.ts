import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { processIMDTelemetry } from "./integrations/imd.adapter";
import { processSensorTelemetry } from "./integrations/sensors.adapter";
import { processRoadStatusUpdate } from "./integrations/road-status.adapter";

describe("Honest Scaffolding & Pending Integrations Adapters", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.IMD_API_KEY;
    delete process.env.SENSOR_INGESTION_SECRET;
    delete process.env.ROAD_STATUS_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("IMD Weather Station Adapter", () => {
    it("fails honestly with IMD_ADAPTER_UNCONFIGURED when key is missing", async () => {
      await expect(
        processIMDTelemetry([
          {
            station_id: "IMD-GUW-01",
            station_name: "Guwahati Airport AWS",
            state: "Assam",
            latitude: 26.1061,
            longitude: 91.5859,
            timestamp: new Date().toISOString(),
            rainfall_1h_mm: 12.4,
          },
        ]),
      ).rejects.toThrow("IMD_ADAPTER_UNCONFIGURED");
    });

    it("rejects unauthorized telemetry submission when key does not match", async () => {
      process.env.IMD_API_KEY = "valid-secret-imd-token";
      await expect(
        processIMDTelemetry(
          [
            {
              station_id: "IMD-GUW-01",
              station_name: "Guwahati Airport AWS",
              state: "Assam",
              latitude: 26.1061,
              longitude: 91.5859,
              timestamp: new Date().toISOString(),
            },
          ],
          "wrong-key",
        ),
      ).rejects.toThrow("IMD_AUTH_FAILED");
    });
  });

  describe("Physical Sensor Telemetry Ingestion", () => {
    it("fails honestly with SENSOR_INGESTION_UNCONFIGURED when secret is missing", async () => {
      await expect(
        processSensorTelemetry([
          {
            device_id: "TILT-NONEY-01",
            zone_id: 2,
            timestamp: new Date().toISOString(),
            sensor_type: "inclinometer",
            readings: { tilt_cumulative_deg: 2.1 },
          },
        ]),
      ).rejects.toThrow("SENSOR_INGESTION_UNCONFIGURED");
    });

    it("rejects unauthorized sensor ingestion when token does not match", async () => {
      process.env.SENSOR_INGESTION_SECRET = "sensor-auth-token-123";
      await expect(
        processSensorTelemetry(
          [
            {
              device_id: "TILT-NONEY-01",
              zone_id: 2,
              timestamp: new Date().toISOString(),
              sensor_type: "inclinometer",
              readings: { tilt_cumulative_deg: 2.1 },
            },
          ],
          "Bearer invalid-token",
        ),
      ).rejects.toThrow("SENSOR_AUTH_FAILED");
    });

    it("validates physical constraints and detects impossible tilt readings", async () => {
      process.env.SENSOR_INGESTION_SECRET = "sensor-auth-token-123";
      const res = await processSensorTelemetry(
        [
          {
            device_id: "BROKEN-TILT",
            zone_id: 2,
            timestamp: new Date().toISOString(),
            sensor_type: "inclinometer",
            readings: { tilt_cumulative_deg: 145.0 }, // > 90 deg is impossible
          },
        ],
        "Bearer sensor-auth-token-123",
      );

      expect(res.success).toBe(false);
      expect(res.errors[0]).toContain("exceeds physical limits");
    });

    it("triggers critical alarms when high-hazard tilt threshold is crossed", async () => {
      process.env.SENSOR_INGESTION_SECRET = "sensor-auth-token-123";
      const res = await processSensorTelemetry(
        [
          {
            device_id: "TILT-HAZARD-02",
            zone_id: 2,
            timestamp: new Date().toISOString(),
            sensor_type: "inclinometer",
            readings: { tilt_cumulative_deg: 6.8 }, // > 5.0 deg trigger
          },
        ],
        "Bearer sensor-auth-token-123",
      );

      expect(res.alertsTriggered.length).toBe(1);
      expect(res.alertsTriggered[0]).toContain("CRITICAL TILT");
    });
  });

  describe("Live Road Status Adapter", () => {
    it("fails honestly with ROAD_STATUS_UNCONFIGURED when key is missing", async () => {
      await expect(
        processRoadStatusUpdate([
          {
            highway_code: "NH-29",
            segment_label: "Pagla Pahar corridor",
            status: "blocked",
            reported_by: "BRO_SEWAK",
          },
        ]),
      ).rejects.toThrow("ROAD_STATUS_UNCONFIGURED");
    });

    it("rejects unauthorized road status updates", async () => {
      process.env.ROAD_STATUS_API_KEY = "road-secret-xyz";
      await expect(
        processRoadStatusUpdate(
          [
            {
              highway_code: "NH-29",
              segment_label: "Pagla Pahar corridor",
              status: "blocked",
              reported_by: "BRO_SEWAK",
            },
          ],
          "Bearer wrong-token",
        ),
      ).rejects.toThrow("ROAD_STATUS_AUTH_FAILED");
    });
  });
});
