/**
 * src/lib/observation-status.test.ts
 * ====================================
 * Regression tests for the field_observations status-field mismatch bug.
 *
 * HISTORY: Before this fix, ObservationDetailsDialog.tsx read a non-existent
 * `review_status` column and compared against values (APPROVED, OFFICIAL_VERIFIED,
 * PENDING, UNVERIFIED) that do not exist in the DB CHECK constraint. Every
 * observation fell through to the "Pending" display regardless of actual status.
 *
 * The real DB constraint (migration 20260905010000) allows:
 *   'SUBMITTED' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'ACTIONABLE'
 *
 * These tests pin that contract so the mismatch can never silently regress.
 */

import { describe, it, expect } from "vitest";
import {
  getObservationStatusMeta,
  matchesObservationStatusFilter,
  OBSERVATION_STATUS_FILTER_GROUPS,
  type ObservationStatus,
  type ObservationFilterGroup,
} from "./observation-status";
import { USER_PROFILE_VERIFICATION_STATUSES } from "./auth-domains";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock observation shape (mirrors the DB row fields used by the UI). */
interface MockObsRow {
  id: number;
  zone_id: number;
  observed_at: string;
  status: any;
  review_status?: any;
  visual_signs?: string;
  road_status?: string;
}

function makeMockObs(status: any, id = 1): MockObsRow {
  return {
    id,
    zone_id: 1,
    observed_at: new Date().toISOString(),
    status,
  };
}

/**
 * Replicate the exact filtering logic from ObservationDetailsDialog.tsx so we
 * can assert it behaves correctly for every status value.
 */
function matchesFilter(obs: MockObsRow, filter: ObservationFilterGroup): boolean {
  return matchesObservationStatusFilter(obs.status ?? obs.review_status, filter);
}

// ---------------------------------------------------------------------------
// 1. getObservationStatusMeta — one assertion per real DB status value
// ---------------------------------------------------------------------------
describe("getObservationStatusMeta", () => {
  const DB_STATUSES: ObservationStatus[] = [
    "SUBMITTED",
    "PENDING_VERIFICATION",
    "VERIFIED",
    "REJECTED",
    "ACTIONABLE",
  ];

  it("returns a non-empty label for every real DB status", () => {
    for (const s of DB_STATUSES) {
      const { label } = getObservationStatusMeta(s);
      expect(label, `label for ${s} should not be empty`).toBeTruthy();
    }
  });

  it("returns a non-empty badgeClass for every real DB status", () => {
    for (const s of DB_STATUSES) {
      const { badgeClass } = getObservationStatusMeta(s);
      expect(badgeClass, `badgeClass for ${s} should not be empty`).toBeTruthy();
    }
  });

  it("SUBMITTED → pending filter group", () => {
    expect(getObservationStatusMeta("SUBMITTED").filterGroup).toBe("pending");
  });

  it("PENDING_VERIFICATION → pending filter group", () => {
    expect(getObservationStatusMeta("PENDING_VERIFICATION").filterGroup).toBe("pending");
  });

  it("VERIFIED → verified filter group", () => {
    expect(getObservationStatusMeta("VERIFIED").filterGroup).toBe("verified");
  });

  it("REJECTED → rejected filter group", () => {
    expect(getObservationStatusMeta("REJECTED").filterGroup).toBe("rejected");
  });

  it("ACTIONABLE → actionable filter group", () => {
    expect(getObservationStatusMeta("ACTIONABLE").filterGroup).toBe("actionable");
  });

  it("returns a sane fallback for unknown/null/undefined status", () => {
    const { label, filterGroup } = getObservationStatusMeta(null);
    expect(label).toBeTruthy();
    expect(filterGroup).toBe("pending"); // unknown treated as pending, not silently hidden

    const { filterGroup: fg2 } = getObservationStatusMeta(undefined);
    expect(fg2).toBe("pending");

    const { filterGroup: fg3 } = getObservationStatusMeta("SOME_FUTURE_VALUE");
    expect(fg3).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // Regression: old wrong values must NOT accidentally map to "verified"
  // -------------------------------------------------------------------------
  it("OLD VALUE 'APPROVED' does NOT classify as verified (regression guard)", () => {
    const { filterGroup } = getObservationStatusMeta("APPROVED");
    expect(filterGroup).not.toBe("verified");
  });

  it("OLD VALUE 'OFFICIAL_VERIFIED' does NOT classify as verified (regression guard)", () => {
    const { filterGroup } = getObservationStatusMeta("OFFICIAL_VERIFIED");
    expect(filterGroup).not.toBe("verified");
  });

  it("OLD VALUE 'PENDING_REVIEW' does NOT classify as verified (regression guard)", () => {
    const { filterGroup } = getObservationStatusMeta("PENDING_REVIEW");
    expect(filterGroup).not.toBe("verified");
  });
});

// ---------------------------------------------------------------------------
// 2. Filter group membership — OBSERVATION_STATUS_FILTER_GROUPS
// ---------------------------------------------------------------------------
describe("OBSERVATION_STATUS_FILTER_GROUPS", () => {
  it("'verified' group contains exactly VERIFIED", () => {
    expect(OBSERVATION_STATUS_FILTER_GROUPS.verified).toEqual(["VERIFIED"]);
  });

  it("'pending' group contains SUBMITTED and PENDING_VERIFICATION", () => {
    expect(OBSERVATION_STATUS_FILTER_GROUPS.pending).toContain("SUBMITTED");
    expect(OBSERVATION_STATUS_FILTER_GROUPS.pending).toContain("PENDING_VERIFICATION");
  });

  it("'rejected' group contains exactly REJECTED", () => {
    expect(OBSERVATION_STATUS_FILTER_GROUPS.rejected).toEqual(["REJECTED"]);
  });

  it("'actionable' group contains exactly ACTIONABLE", () => {
    expect(OBSERVATION_STATUS_FILTER_GROUPS.actionable).toEqual(["ACTIONABLE"]);
  });

  it("no old values appear in any group", () => {
    const allGroupValues = Object.values(OBSERVATION_STATUS_FILTER_GROUPS).flat();
    expect(allGroupValues).not.toContain("APPROVED");
    expect(allGroupValues).not.toContain("OFFICIAL_VERIFIED");
    expect(allGroupValues).not.toContain("PENDING_REVIEW");
    expect(allGroupValues).not.toContain("UNVERIFIED");
    expect(allGroupValues).not.toContain("PENDING");
  });
});

// ---------------------------------------------------------------------------
// 3. Filter logic (mirrors ObservationDetailsDialog.tsx filteredObservations)
// ---------------------------------------------------------------------------
describe("Observation filter logic (mirrors ObservationDetailsDialog)", () => {
  const observations = [
    makeMockObs("SUBMITTED", 1),
    makeMockObs("PENDING_VERIFICATION", 2),
    makeMockObs("VERIFIED", 3),
    makeMockObs("REJECTED", 4),
    makeMockObs("ACTIONABLE", 5),
  ];

  it("'all' filter returns all 5 observations", () => {
    const result = observations.filter((o) => matchesFilter(o, "all"));
    expect(result).toHaveLength(5);
  });

  it("'verified' filter returns only VERIFIED observations", () => {
    const result = observations.filter((o) => matchesFilter(o, "verified"));
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("VERIFIED");
  });

  it("'pending' filter returns SUBMITTED and PENDING_VERIFICATION", () => {
    const result = observations.filter((o) => matchesFilter(o, "pending"));
    expect(result).toHaveLength(2);
    const statuses = result.map((o) => o.status);
    expect(statuses).toContain("SUBMITTED");
    expect(statuses).toContain("PENDING_VERIFICATION");
  });

  it("'rejected' filter returns only REJECTED observations", () => {
    const result = observations.filter((o) => matchesFilter(o, "rejected"));
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("REJECTED");
  });

  it("'actionable' filter returns only ACTIONABLE observations", () => {
    const result = observations.filter((o) => matchesFilter(o, "actionable"));
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("ACTIONABLE");
  });

  // -------------------------------------------------------------------------
  // Regression: old value comparisons must not accidentally pass the filter
  // -------------------------------------------------------------------------
  it("REGRESSION: observation with old 'APPROVED' status is NOT shown in 'verified' tab", () => {
    const staleObs = { ...makeMockObs("SUBMITTED", 99), status: "APPROVED" as any };
    expect(matchesFilter(staleObs, "verified")).toBe(false);
  });

  it("REGRESSION: observation with old 'OFFICIAL_VERIFIED' status is NOT shown in 'verified' tab", () => {
    const staleObs = { ...makeMockObs("SUBMITTED", 98), status: "OFFICIAL_VERIFIED" as any };
    expect(matchesFilter(staleObs, "verified")).toBe(false);
  });

  it("REGRESSION: observation with old 'PENDING_REVIEW' is NOT shown in 'verified' tab", () => {
    const staleObs = { ...makeMockObs("SUBMITTED", 97), status: "PENDING_REVIEW" as any };
    expect(matchesFilter(staleObs, "verified")).toBe(false);
  });

  it("Pending tab returns exactly the observations whose badge shows 'Pending' or pending group", () => {
    const mixedObservations: MockObsRow[] = [
      makeMockObs("PENDING", 1),
      makeMockObs("Pending", 2),
      makeMockObs("pending", 3),
      makeMockObs("PENDING_VERIFICATION", 4),
      makeMockObs("SUBMITTED", 5),
      makeMockObs(null, 6),
      makeMockObs(undefined, 7),
      makeMockObs("VERIFIED", 8),
      makeMockObs("REJECTED", 9),
      makeMockObs("ACTIONABLE", 10),
    ];

    const pendingTabResults = mixedObservations.filter((o) => matchesFilter(o, "pending"));
    const pendingBadgeObservations = mixedObservations.filter((o) => {
      const meta = getObservationStatusMeta(o.status);
      return meta.filterGroup === "pending";
    });

    // Exactly the same elements
    expect(pendingTabResults).toHaveLength(7);
    expect(pendingTabResults).toEqual(pendingBadgeObservations);

    // Non-pending are excluded
    const nonPendingStatuses = ["VERIFIED", "REJECTED", "ACTIONABLE"];
    for (const obs of pendingTabResults) {
      expect(nonPendingStatuses).not.toContain(obs.status);
    }
  });

  it("Pending tab correctly matches 4 observations displaying a 'Pending' badge", () => {
    // Exact scenario from user request: 4 observations that display a "Pending" badge
    const observations = [
      makeMockObs("PENDING", 101),
      makeMockObs("Pending", 102),
      makeMockObs("pending", 103),
      makeMockObs("PENDING_VERIFICATION", 104),
    ];

    // Assert every observation's badge displays a pending label
    for (const obs of observations) {
      const meta = getObservationStatusMeta(obs.status);
      expect(meta.filterGroup).toBe("pending");
      expect(meta.label.toLowerCase()).toContain("pending");
    }

    // Assert all 4 are returned in the "pending" tab filter
    const filtered = observations.filter((o) => matchesFilter(o, "pending"));
    expect(filtered).toHaveLength(4);
    expect(filtered.map((o) => o.id)).toEqual([101, 102, 103, 104]);
  });
});

// ---------------------------------------------------------------------------
// user_profiles.verification_status DB contract
// ---------------------------------------------------------------------------
// Pin the exact set of values that satisfy the CHECK constraint in migration
// 20260905010000_harden_official_auth_and_observation_trust.sql:
//   CHECK (verification_status IN ('UNVERIFIED', 'PENDING_OFFICIAL_VERIFICATION', 'VERIFIED', 'REJECTED'))
// If this test fails, a DB write with an invalid value will cause a runtime CHECK constraint violation.

describe("user_profiles.verification_status DB contract", () => {
  it("USER_PROFILE_VERIFICATION_STATUSES contains exactly the four DB-valid values", () => {
    const expected = new Set([
      "UNVERIFIED",
      "PENDING_OFFICIAL_VERIFICATION",
      "VERIFIED",
      "REJECTED",
    ]);
    const actual = new Set(USER_PROFILE_VERIFICATION_STATUSES);
    expect(actual).toEqual(expected);
  });

  it("'OFFICIAL_VERIFIED' is NOT in USER_PROFILE_VERIFICATION_STATUSES (regression guard)", () => {
    expect(USER_PROFILE_VERIFICATION_STATUSES).not.toContain("OFFICIAL_VERIFIED");
  });

  it("'VERIFIED' IS in USER_PROFILE_VERIFICATION_STATUSES (correct approval value)", () => {
    expect(USER_PROFILE_VERIFICATION_STATUSES).toContain("VERIFIED");
  });
});
