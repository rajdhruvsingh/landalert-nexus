import { describe, it, expect } from "vitest";
import {
  parseObservationVisualSigns,
  sanitizeObservationRecord,
  sanitizeObservationList,
} from "./observation-sanitizer";

describe("Observation Sanitizer & Metadata Recovery", () => {
  it("handles clean, normal visual signs without metadata", () => {
    const raw = "Fresh scarp observed along roadside cutting";
    const parsed = parseObservationVisualSigns(raw);
    expect(parsed.cleanVisualSigns).toBe("Fresh scarp observed along roadside cutting");
    expect(parsed.metadata).toBeNull();
  });

  it("handles null, undefined, or empty visual signs safely", () => {
    expect(parseObservationVisualSigns(null).cleanVisualSigns).toBe("");
    expect(parseObservationVisualSigns(undefined).cleanVisualSigns).toBe("");
    expect(parseObservationVisualSigns("").cleanVisualSigns).toBe("");
  });

  it("extracts clean metadata and human text from standard [EVIDENCE_META:{...}] tags", () => {
    const raw =
      "Active mudflow near culvert [EVIDENCE_META:{\"consent_given\":true,\"geo_lat\":27.33,\"geo_lng\":88.61}]";
    const parsed = parseObservationVisualSigns(raw);
    expect(parsed.cleanVisualSigns).toBe("Active mudflow near culvert");
    expect(parsed.metadata).toEqual({
      consent_given: true,
      geo_lat: 27.33,
      geo_lng: 88.61,
    });
  });

  it("authoritatively cleans the user's reported corrupted JSON debris and recovers all metadata", () => {
    const corruptedRaw =
      'Tension cracks on slope}],"media_urls":[]}],"media_urls":[],"review_status":"PENDING_REVIEW"}] [EVIDENCE_META:{"consent_given":true,"geo_accuracy_m":35,"geo_captured_at":"2026-09-05T16:22:57.793Z","geo_lat":28.67438,"geo_lng":77.50341,"media_metadata":[{"id":"offline_1788625396158_xygs9u","name":"c47ab090-5a88-462f-ac87-5a50e213970c.png","size":1897874,"mimeType":"image/png"}],"media_urls":[],"review_status":"PENDING_REVIEW","source":"PUBLIC_REPORT"}]';

    const parsed = parseObservationVisualSigns(corruptedRaw);
    expect(parsed.cleanVisualSigns).toBe("Tension cracks on slope");
    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata?.geo_lat).toBe(28.67438);
    expect(parsed.metadata?.geo_lng).toBe(77.50341);
    expect(parsed.metadata?.geo_accuracy_m).toBe(35);
    expect(parsed.metadata?.media_metadata?.[0].name).toBe("c47ab090-5a88-462f-ac87-5a50e213970c.png");
    expect(parsed.metadata?.media_metadata?.[0].size).toBe(1897874);
  });

  it("promotes recovered metadata onto the sanitized observation record", () => {
    const rawRecord = {
      id: 42,
      zone_id: 1,
      observed_at: "2026-09-05T16:22:57.000Z",
      client_timestamp: "2026-09-05T16:22:57.000Z",
      rainfall_mm: 20.0,
      visual_signs:
        'Tension cracks on slope}],"media_urls":[]}],"media_urls":[],"review_status":"PENDING_REVIEW"}] [EVIDENCE_META:{"consent_given":true,"geo_accuracy_m":35,"geo_captured_at":"2026-09-05T16:22:57.793Z","geo_lat":28.67438,"geo_lng":77.50341,"media_metadata":[{"id":"offline_1788625396158_xygs9u","name":"c47ab090-5a88-462f-ac87-5a50e213970c.png","size":1897874,"mimeType":"image/png"}],"media_urls":[],"review_status":"PENDING_REVIEW","source":"PUBLIC_REPORT"}]',
      road_status: "open",
      observer_id: "field_worker_1",
      geo_lat: null,
      geo_lng: null,
      media_urls: [],
      media_metadata: [],
    };

    const sanitized = sanitizeObservationRecord(rawRecord);
    expect(sanitized.visual_signs).toBe("Tension cracks on slope");
    expect(sanitized.raw_visual_signs).toBe(rawRecord.visual_signs);
    expect(sanitized.geo_lat).toBe(28.67438);
    expect(sanitized.geo_lng).toBe(77.50341);
    expect(sanitized.geo_accuracy_m).toBe(35);
    expect(sanitized.media_metadata).toHaveLength(1);
    expect(sanitized.media_metadata?.[0].name).toBe("c47ab090-5a88-462f-ac87-5a50e213970c.png");
    expect(sanitized.consent_given).toBe(true);
    expect(sanitized.review_status).toBe("PENDING_REVIEW");
  });

  it("sanitizes an array of records with sanitizeObservationList", () => {
    const list = [
      {
        id: 1,
        visual_signs: "Rockfall debris on highway [EVIDENCE_META:{\"geo_lat\":26.15}]",
      },
      {
        id: 2,
        visual_signs: "No movement observed",
      },
    ];

    const sanitizedList = sanitizeObservationList(list);
    expect(sanitizedList).toHaveLength(2);
    expect(sanitizedList[0].visual_signs).toBe("Rockfall debris on highway");
    expect(sanitizedList[0].geo_lat).toBe(26.15);
    expect(sanitizedList[1].visual_signs).toBe("No movement observed");
  });
});
