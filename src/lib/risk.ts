export type RiskLevel = "Low" | "Moderate" | "High" | "Severe" | "UNKNOWN";

export const RISK_LEVELS: RiskLevel[] = ["Low", "Moderate", "High", "Severe"];
export const ALL_RISK_LEVELS: RiskLevel[] = ["Low", "Moderate", "High", "Severe", "UNKNOWN"];

export const riskToken: Record<RiskLevel, string> = {
  Low: "risk-low",
  Moderate: "risk-moderate",
  High: "risk-high",
  Severe: "risk-severe",
  UNKNOWN: "risk-unknown",
};

export function riskColor(level: string): string {
  switch (level) {
    case "Severe":
      return "var(--risk-severe)";
    case "High":
      return "var(--risk-high)";
    case "Moderate":
      return "var(--risk-moderate)";
    case "Low":
      return "var(--risk-low)";
    case "UNKNOWN":
    default:
      return "var(--risk-unknown, #94a3b8)";
  }
}

export function riskBadgeClass(level: string): string {
  switch (level) {
    case "Severe":
      return "bg-risk-severe/15 text-risk-severe border-risk-severe/40";
    case "High":
      return "bg-risk-high/15 text-risk-high border-risk-high/40";
    case "Moderate":
      return "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40";
    case "Low":
      return "bg-risk-low/15 text-risk-low border-risk-low/40";
    case "UNKNOWN":
    default:
      return "bg-secondary/40 text-muted-foreground border-border";
  }
}

/**
 * Authoritative numeric severity rank for operational prioritization.
 * UNKNOWN returns null because it cannot be ordered or compared alongside
 * valid risk levels (it must never be coerced into <= Low or treated as low-risk).
 */
export function severityRank(level: RiskLevel | string): number | null {
  switch (level) {
    case "Low":
      return 1;
    case "Moderate":
      return 2;
    case "High":
      return 3;
    case "Severe":
      return 4;
    case "UNKNOWN":
    default:
      return null;
  }
}

export function roadStatusClass(status: string): string {
  switch (status) {
    case "blocked":
      return "bg-risk-severe/15 text-risk-severe border-risk-severe/40";
    case "restricted":
      return "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40";
    default:
      return "bg-risk-low/15 text-risk-low border-risk-low/40";
  }
}

/**
 * Published NE-Himalaya moisture threshold: E(mm) = -11.10 + 0.62 * D(hr),
 * valid for 24 < D < 1440 hr.
 * Source: Monga & Ganguli (2024) NHESS; Monga & Ganguli (2026) J. Hydrol. Eng. 31(2):04025043
 * DOI: 10.1061/JHYEFF.HEENG-6638. (Note: Sengupta et al. 2010 was a single-site study of Lanta Khola).
 */
export function moistureThresholdMm(durationHours: number): number {
  return -11.1 + 0.62 * durationHours;
}

/**
 * Sikkim intensity-duration threshold: I = 43.26 * D^-0.78 (I in mm/day, D in days).
 */
export function intensityThresholdMmPerDay(durationDays: number): number {
  return 43.26 * Math.pow(durationDays, -0.78);
}

/**
 * Deterministic zone footprint derived from the zone centroid, so the GIS layer
 * renders stable village-scale polygons without shipping heavy boundary files.
 */
export function zonePolygon(id: number, lat: number, lng: number): [number, number][] {
  const points: [number, number][] = [];
  const sides = 7;
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides + id * 0.37;
    const wobble = 0.72 + 0.42 * Math.abs(Math.sin(id * 3.1 + i * 1.7));
    const r = 0.17 * wobble;
    points.push([lat + r * Math.sin(angle), lng + r * Math.cos(angle) * 1.12]);
  }
  return points;
}
