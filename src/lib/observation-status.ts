/**
 * src/lib/observation-status.ts
 * ==============================
 * Single source of truth for `field_observations.status` values.
 *
 * The database (migration 20260905010000_harden_official_auth_and_observation_trust.sql)
 * defines the allowed values as:
 *   'SUBMITTED' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'ACTIONABLE'
 *
 * This module:
 *   - Exports the `ObservationStatus` union type mirroring the DB constraint
 *   - Exports `getObservationStatusMeta()` for labels + CSS colour classes
 *   - Exports `OBSERVATION_STATUS_FILTER_GROUPS` used by filter tabs in the UI
 *
 * NOTE: Do NOT confuse with `user_profiles.verification_status`, which has its
 * own separate set of values ('UNVERIFIED', 'PENDING_OFFICIAL_VERIFICATION',
 * 'OFFICIAL_VERIFIED', 'REJECTED') and lives in auth-domains.ts.
 */

/** The five valid values for field_observations.status in the database. */
export type ObservationStatus =
  | "SUBMITTED"
  | "PENDING_VERIFICATION"
  | "VERIFIED"
  | "REJECTED"
  | "ACTIONABLE";

/** Which tab-group a given status belongs to in the filter UI. */
export type ObservationFilterGroup =
  | "all"
  | "verified"
  | "pending"
  | "rejected"
  | "actionable";

export interface ObservationStatusMeta {
  /** Human-readable display label. */
  label: string;
  /**
   * Tailwind-compatible CSS classes for the status badge background, text, and border.
   * Uses the project's design-token colour variables (risk-low, risk-moderate, etc.).
   */
  badgeClass: string;
  /** Which filter tab this status belongs to. */
  filterGroup: Exclude<ObservationFilterGroup, "all">;
}

/**
 * Returns display metadata for a given `field_observations.status` value.
 * Falls back to a "Pending" style for any unknown/undefined value so the UI
 * never silently shows blank or crashes.
 *
 * @example
 * const { label, badgeClass } = getObservationStatusMeta(obs.status);
 */
export function getObservationStatusMeta(
  status: string | null | undefined,
): ObservationStatusMeta {
  const normalized = status ? status.trim().toUpperCase() : "";
  switch (normalized) {
    case "SUBMITTED":
      return {
        label: "Submitted",
        badgeClass:
          "bg-blue-500/15 text-blue-400 border-blue-500/40",
        filterGroup: "pending",
      };

    case "PENDING_VERIFICATION":
      return {
        label: "Pending Verification",
        badgeClass:
          "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40",
        filterGroup: "pending",
      };

    case "PENDING":
      return {
        label: "Pending",
        badgeClass:
          "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40",
        filterGroup: "pending",
      };

    case "VERIFIED":
      return {
        label: "Verified",
        badgeClass:
          "bg-risk-low/15 text-risk-low border-risk-low/40",
        filterGroup: "verified",
      };

    case "REJECTED":
      return {
        label: "Rejected",
        badgeClass:
          "bg-secondary/50 text-muted-foreground border-border",
        filterGroup: "rejected",
      };

    case "ACTIONABLE":
      return {
        label: "Actionable",
        badgeClass:
          "bg-risk-high/15 text-risk-high border-risk-high/40",
        filterGroup: "actionable",
      };

    default:
      // Unknown value — treat as pending so the UI never silently hides records
      return {
        label: status ? String(status) : "Pending",
        badgeClass:
          "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40",
        filterGroup: "pending",
      };
  }
}

/**
 * Checks whether an observation's status matches a given filter group tab.
 * Uses getObservationStatusMeta so the filtering logic strictly mirrors the badge display.
 */
export function matchesObservationStatusFilter(
  status: string | null | undefined,
  filter: ObservationFilterGroup,
): boolean {
  if (filter === "all") return true;
  return getObservationStatusMeta(status).filterGroup === filter;
}

/**
 * Maps UI filter tab names to the database status values they match.
 * Kept for reference and strict enum typing.
 */
export const OBSERVATION_STATUS_FILTER_GROUPS: Record<
  Exclude<ObservationFilterGroup, "all">,
  ObservationStatus[]
> = {
  pending: ["SUBMITTED", "PENDING_VERIFICATION"],
  verified: ["VERIFIED"],
  actionable: ["ACTIONABLE"],
  rejected: ["REJECTED"],
};
