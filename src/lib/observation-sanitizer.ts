/**
 * src/lib/observation-sanitizer.ts
 * ================================
 * Pure parsing and sanitization utility for Field Observations.
 * 
 * Guarantees:
 * - Safely extracts embedded metadata from `[EVIDENCE_META:{...}]`
 * - Strips any corrupted JSON debris or technical artifacts from `visual_signs`
 * - Recovers embedded media_urls, media_metadata, GPS coordinates, consent, and review status
 * - Never throws on malformed or partial inputs
 */

export interface ObservationMetadata {
  consent_given?: boolean;
  geo_lat?: number | null;
  geo_lng?: number | null;
  geo_accuracy_m?: number | null;
  geo_captured_at?: string | null;
  media_urls?: string[];
  media_metadata?: Array<{
    id?: string;
    name?: string;
    size?: number;
    mimeType?: string;
    url?: string;
  }>;
  review_status?: string;
  source?: string;
  [key: string]: any;
}

export interface ParsedVisualSigns {
  cleanVisualSigns: string;
  metadata: ObservationMetadata | null;
}

/**
 * Extracts embedded metadata and returns a clean, human-readable visual signs string.
 */
export function parseObservationVisualSigns(rawVisualSigns?: string | null): ParsedVisualSigns {
  if (!rawVisualSigns) {
    return { cleanVisualSigns: "", metadata: null };
  }

  let text = String(rawVisualSigns).trim();
  let metadata: ObservationMetadata | null = null;

  // 1. Locate and extract [EVIDENCE_META:{...}]
  const metaMarker = "[EVIDENCE_META:";
  const metaIndex = text.indexOf(metaMarker);
  if (metaIndex !== -1) {
    const afterMeta = text.slice(metaIndex + metaMarker.length);
    const lastBracket = afterMeta.lastIndexOf("]");
    if (lastBracket !== -1) {
      const jsonCandidate = afterMeta.slice(0, lastBracket).trim();
      try {
        metadata = JSON.parse(jsonCandidate);
      } catch {
        // Fallback: try parsing up to the last closing curly brace
        const lastBrace = jsonCandidate.lastIndexOf("}");
        if (lastBrace !== -1) {
          try {
            metadata = JSON.parse(jsonCandidate.slice(0, lastBrace + 1));
          } catch {
            // Unparseable JSON, discard safely
          }
        }
      }
    }
    // Truncate the text before the metadata marker
    text = text.slice(0, metaIndex).trim();
  }

  // 2. Strip corrupted JSON fragments / technical artifacts (e.g. `}],"media_urls":[]}],"review_status":"..."}]`)
  text = text.replace(
    /[\}\]\:\,\"]+\s*(?:media_urls|media_metadata|review_status|consent_given|geo_accuracy_m|geo_captured_at|geo_lat|geo_lng|source|is_training_eligible)[\s\S]*$/i,
    "",
  );

  // 3. Clean any remaining trailing punctuation or unbalanced braces/brackets from JSON debris
  text = text.replace(/[\{\}\[\]\"\,\:\s]+$/, "").trim();

  return {
    cleanVisualSigns: text,
    metadata,
  };
}

/**
 * Normalizes an observation record, cleaning `visual_signs` and promoting embedded metadata fields.
 */
export function sanitizeObservationRecord<T extends Record<string, any>>(obs: T): T {
  if (!obs) return obs;

  const rawSigns = obs["visual_signs"] || "";
  const { cleanVisualSigns, metadata } = parseObservationVisualSigns(rawSigns);

  const sanitized: any = {
    ...obs,
    raw_visual_signs: rawSigns,
    visual_signs: cleanVisualSigns || null,
  };

  if (metadata) {
    // 1. Media URLs
    if (
      (!sanitized.media_urls || sanitized.media_urls.length === 0) &&
      Array.isArray(metadata.media_urls) &&
      metadata.media_urls.length > 0
    ) {
      sanitized.media_urls = metadata.media_urls;
    }

    // 2. Media Metadata
    if (
      (!sanitized.media_metadata || sanitized.media_metadata.length === 0) &&
      Array.isArray(metadata.media_metadata) &&
      metadata.media_metadata.length > 0
    ) {
      sanitized.media_metadata = metadata.media_metadata;
    }

    // 3. Geolocation fields
    if (sanitized.geo_lat === null || sanitized.geo_lat === undefined) {
      if (typeof metadata.geo_lat === "number") sanitized.geo_lat = metadata.geo_lat;
      if (typeof metadata.geo_lng === "number") sanitized.geo_lng = metadata.geo_lng;
      if (typeof metadata.geo_accuracy_m === "number") sanitized.geo_accuracy_m = metadata.geo_accuracy_m;
      if (metadata.geo_captured_at) sanitized.geo_captured_at = metadata.geo_captured_at;
    }

    // 4. Consent
    if (sanitized.consent_given === undefined && metadata.consent_given !== undefined) {
      sanitized.consent_given = metadata.consent_given;
    }

    // 5. Review status & source
    if ((!sanitized.review_status || sanitized.review_status === "PENDING_REVIEW") && metadata.review_status) {
      sanitized.review_status = metadata.review_status;
    }
    if (!sanitized.source && metadata.source) {
      sanitized.source = metadata.source;
    }
  }

  return sanitized as T;
}

/**
 * Sanitizes an array of observation records.
 */
export function sanitizeObservationList<T extends Record<string, any>>(list: T[]): T[] {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeObservationRecord);
}
