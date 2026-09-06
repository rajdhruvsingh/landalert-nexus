import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSatelliteLayerStatus,
  tileToBbox3857,
  fetchSatelliteTile,
} from "./satellite.service";

describe("Satellite Imagery Service (Sentinel Hub / Copernicus)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["SENTINEL_HUB_INSTANCE_ID"];
    delete process.env["COPERNICUS_INSTANCE_ID"];
    delete process.env["SATELLITE_LAYER_ENABLED"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports disabled and unconfigured by default without crashing", () => {
    const status = getSatelliteLayerStatus();
    expect(status.enabled).toBe(false);
    expect(status.configured).toBe(false);
    expect(status.disclaimer).toContain("Supplementary visual context only");
  });

  it("reports enabled and configured when flags and instance ID are present", () => {
    process.env["SATELLITE_LAYER_ENABLED"] = "true";
    process.env["SENTINEL_HUB_INSTANCE_ID"] = "test-instance-id-12345";

    const status = getSatelliteLayerStatus();
    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(true);
    expect(status.availableLayers).toContain("TRUE-COLOR");
    expect(status.availableLayers).toContain("NDVI");
  });

  it("calculates accurate EPSG:3857 bounding box coordinates from XYZ tile", () => {
    // Tile z=10, x=800, y=400 (roughly over Northeast India / Myanmar area)
    const bbox = tileToBbox3857(800, 400, 10);
    expect(bbox.length).toBe(4);
    const [minX, minY, maxX, maxY] = bbox;
    expect(minX).toBeLessThan(maxX);
    expect(minY).toBeLessThan(maxY);
    expect(typeof minX).toBe("number");
  });

  it("refuses to fetch satellite tiles when SATELLITE_LAYER_ENABLED is false", async () => {
    process.env["SATELLITE_LAYER_ENABLED"] = "false";
    process.env["SENTINEL_HUB_INSTANCE_ID"] = "valid-id";

    await expect(fetchSatelliteTile("TRUE-COLOR", 10, 800, 400)).rejects.toThrow(
      "SATELLITE_LAYER_DISABLED",
    );
  });

  it("refuses to fetch satellite tiles when SENTINEL_HUB_INSTANCE_ID is unconfigured", async () => {
    process.env["SATELLITE_LAYER_ENABLED"] = "true";

    await expect(fetchSatelliteTile("TRUE-COLOR", 10, 800, 400)).rejects.toThrow(
      "SATELLITE_LAYER_NOT_CONFIGURED",
    );
  });

  it("fetches and caches satellite tiles when configured using mock client", async () => {
    process.env["SATELLITE_LAYER_ENABLED"] = "true";
    process.env["SENTINEL_HUB_INSTANCE_ID"] = "mock-instance-id-xyz";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/jpeg" }),
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
    });

    const res1 = await fetchSatelliteTile("TRUE-COLOR", 8, 198, 112, mockFetch as unknown as typeof fetch);
    expect(res1.contentType).toBe("image/jpeg");
    expect(res1.cached).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call should hit the in-memory cache
    const res2 = await fetchSatelliteTile("TRUE-COLOR", 8, 198, 112, mockFetch as unknown as typeof fetch);
    expect(res2.cached).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
