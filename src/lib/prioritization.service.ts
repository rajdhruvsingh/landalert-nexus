/**
 * src/lib/prioritization.service.ts
 * =================================
 * Authoritative Emergency Response Prioritization Engine.
 *
 * Implements Task 2:
 * - Scores each monitored hill zone for operational dispatch urgency using an
 *   inspectable, physically-grounded weighted linear formula.
 * - CONTRIBUTING FACTORS:
 *     1. Current Risk Severity (40%): severityRank (Severe=4, High=3, Moderate=2, Low=1).
 *        CRITICAL RULE: Zones with UNKNOWN risk severity return severityRank=null
 *        and are STRICTLY EXCLUDED from numerical ranking (placed into an unranked list).
 *        UNKNOWN is NEVER coerced to a low-risk or zero score.
 *     2. Population Vulnerability (25%): Resident exposure scaled up to 100,000 residents.
 *     3. Road Connectivity Cutoff (20%): Arterial isolation (blocked=1.0, restricted=0.5, open=0.0).
 *     4. Ground Observation Intensity (15%): Pending field observations (tension cracks/slumping).
 * - DECISION SUPPORT ONLY:
 *     This ranking serves as decision support for disaster response officers and dispatchers.
 *     It strictly DOES NOT trigger automated alert broadcasts.
 */

import { severityRank, type RiskLevel } from "./risk";

export interface ZonePrioritizationInput {
  zoneId: number;
  zoneName: string;
  district: string;
  state: string;
  currentRiskLevel: RiskLevel | string;
  population: number;
  roadSegments: Array<{
    id: number;
    roadName: string;
    segmentLabel: string;
    status: "open" | "restricted" | "blocked" | string;
  }>;
  fieldObservations?: Array<{
    id?: number | string;
    reviewStatus?: string;
    roadStatus?: string;
    visualSigns?: string;
    rainfallMm?: number;
  }>;
}

export interface FactorBreakdown {
  severityPoints: number; // Max 40.0
  populationPoints: number; // Max 25.0
  roadPoints: number; // Max 20.0
  observationPoints: number; // Max 15.0
  totalScore: number; // 0.0 to 100.0
  topContributingDrivers: string[];
}

export interface RankedZoneItem {
  rank: number;
  zoneId: number;
  zoneName: string;
  district: string;
  state: string;
  currentRiskLevel: RiskLevel;
  population: number;
  priorityScore: number;
  factors: FactorBreakdown;
  worstRoadStatus: "blocked" | "restricted" | "open" | "none";
  pendingObservationCount: number;
}

export interface UnrankedZoneItem {
  zoneId: number;
  zoneName: string;
  district: string;
  state: string;
  currentRiskLevel: "UNKNOWN" | string;
  population: number;
  reason: string;
}

export interface ResponsePrioritizationResult {
  evaluatedAt: string;
  rankedZones: RankedZoneItem[];
  unrankedZones: UnrankedZoneItem[];
  weights: {
    severityWeight: number; // 0.40
    populationWeight: number; // 0.25
    roadCutoffWeight: number; // 0.20
    fieldObservationWeight: number; // 0.15
  };
  disclaimer: string;
}

export const PRIORITIZATION_WEIGHTS = {
  severityWeight: 0.4,
  populationWeight: 0.25,
  roadCutoffWeight: 0.2,
  fieldObservationWeight: 0.15,
} as const;

/**
 * Calculates the transparent prioritization score and drivers for a single zone.
 * If currentRiskLevel is UNKNOWN or invalid, returns null (must be unranked).
 */
export function scoreZonePrioritization(
  zone: ZonePrioritizationInput,
): { score: number; breakdown: FactorBreakdown } | null {
  const rank = severityRank(zone.currentRiskLevel);
  if (rank === null) {
    // Strict requirement: UNKNOWN cannot be converted to numeric or ranked
    return null;
  }

  const drivers: string[] = [];

  // 1. Severity Points (Max 40)
  // Low=1 -> 10pts, Moderate=2 -> 20pts, High=3 -> 30pts, Severe=4 -> 40pts
  const normSeverity = rank / 4.0;
  const severityPoints = Math.round(normSeverity * PRIORITIZATION_WEIGHTS.severityWeight * 1000) / 10;
  drivers.push(`${zone.currentRiskLevel} risk tier (${severityPoints} pts)`);

  // 2. Population Exposure Points (Max 25)
  // Saturated at 100,000 residents
  const popClamped = Math.min(100000, Math.max(0, zone.population));
  const normPop = popClamped / 100000;
  const populationPoints = Math.round(normPop * PRIORITIZATION_WEIGHTS.populationWeight * 1000) / 10;
  if (populationPoints >= 10) {
    drivers.push(`High population density: ${zone.population.toLocaleString("en-IN")} residents (${populationPoints} pts)`);
  } else {
    drivers.push(`Population exposure: ${zone.population.toLocaleString("en-IN")} (${populationPoints} pts)`);
  }

  // 3. Road Connectivity Cutoff Points (Max 20)
  // Any blocked segment = 20 pts; restricted segment = 10 pts; open = 0 pts
  let roadFactor = 0;
  let worstStatus: "blocked" | "restricted" | "open" | "none" = "open";

  if (!zone.roadSegments || zone.roadSegments.length === 0) {
    worstStatus = "none";
    roadFactor = 0;
  } else {
    const hasBlocked = zone.roadSegments.some((r) => r.status === "blocked");
    const hasRestricted = zone.roadSegments.some((r) => r.status === "restricted");

    if (hasBlocked) {
      roadFactor = 1.0;
      worstStatus = "blocked";
      const blockedRoads = zone.roadSegments.filter((r) => r.status === "blocked").map((r) => r.roadName);
      drivers.push(`Arterial road blocked (${blockedRoads.join(", ")}) (20 pts)`);
    } else if (hasRestricted) {
      roadFactor = 0.5;
      worstStatus = "restricted";
      drivers.push("Road traffic restricted / caution (10 pts)");
    } else {
      roadFactor = 0.0;
      worstStatus = "open";
    }
  }
  const roadPoints = Math.round(roadFactor * PRIORITIZATION_WEIGHTS.roadCutoffWeight * 1000) / 10;

  // 4. Field Observation Intensity Points (Max 15)
  // Saturated at 4 pending observations with visual distress or high rainfall
  const pendingObs = (zone.fieldObservations ?? []).filter((o) => {
    const isPending = o.reviewStatus === "PENDING_REVIEW" || !o.reviewStatus;
    const hasDistress =
      (o.visualSigns && o.visualSigns.toLowerCase() !== "none") ||
      (o.rainfallMm !== undefined && o.rainfallMm > 40) ||
      o.roadStatus === "blocked" ||
      o.roadStatus === "restricted";
    return isPending && hasDistress;
  });

  const obsCount = pendingObs.length;
  const normObs = Math.min(1.0, obsCount / 4.0);
  const observationPoints = Math.round(normObs * PRIORITIZATION_WEIGHTS.fieldObservationWeight * 1000) / 10;
  if (obsCount > 0) {
    drivers.push(`${obsCount} pending distressed field report(s) (${observationPoints} pts)`);
  }

  const totalScore = Math.round((severityPoints + populationPoints + roadPoints + observationPoints) * 10) / 10;

  return {
    score: totalScore,
    breakdown: {
      severityPoints,
      populationPoints,
      roadPoints,
      observationPoints,
      totalScore,
      topContributingDrivers: drivers,
    },
  };
}

/**
 * Computes the authoritative response prioritization ranking across all provided zones.
 */
export function evaluateEmergencyPrioritization(
  zones: ZonePrioritizationInput[],
): ResponsePrioritizationResult {
  const scoredItems: Array<RankedZoneItem> = [];
  const unrankedItems: Array<UnrankedZoneItem> = [];

  for (const zone of zones) {
    const result = scoreZonePrioritization(zone);

    if (result === null) {
      unrankedItems.push({
        zoneId: zone.zoneId,
        zoneName: zone.zoneName,
        district: zone.district,
        state: zone.state,
        currentRiskLevel: "UNKNOWN",
        population: zone.population,
        reason: "Risk Severity is UNKNOWN due to telemetry outage. Excluded from numerical rank.",
      });
      continue;
    }

    const hasBlocked = zone.roadSegments?.some((r) => r.status === "blocked");
    const hasRestricted = zone.roadSegments?.some((r) => r.status === "restricted");
    const worstRoad = hasBlocked ? "blocked" : hasRestricted ? "restricted" : "open";

    const pendingCount = (zone.fieldObservations ?? []).filter(
      (o) => o.reviewStatus === "PENDING_REVIEW" || !o.reviewStatus,
    ).length;

    scoredItems.push({
      rank: 0, // Assigned after sorting
      zoneId: zone.zoneId,
      zoneName: zone.zoneName,
      district: zone.district,
      state: zone.state,
      currentRiskLevel: zone.currentRiskLevel as RiskLevel,
      population: zone.population,
      priorityScore: result.score,
      factors: result.breakdown,
      worstRoadStatus: worstRoad,
      pendingObservationCount: pendingCount,
    });
  }

  // Sort descending by priority score; tie-break on population descending
  scoredItems.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return b.population - a.population;
  });

  // Assign 1-indexed ranks
  scoredItems.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    evaluatedAt: new Date().toISOString(),
    rankedZones: scoredItems,
    unrankedZones: unrankedItems,
    weights: PRIORITIZATION_WEIGHTS,
    disclaimer:
      "Decision-support ranking only. Transparently combines risk severity (40%), population exposure (25%), road cutoff (20%), and field reports (15%). " +
      "Does NOT automatically trigger emergency alerts.",
  };
}
