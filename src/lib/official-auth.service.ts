/**
 * src/lib/official-auth.service.ts
 * =================================
 * Authoritative Government Official Identification, Role-Based Access Control,
 * Observation Trust Verification, and Immutable Audit Logging.
 *
 * Core Boundaries:
 * 1. Email Domain Matching != Dispatch Authorization
 *    Institutional domains establish candidate eligibility (PENDING_OFFICIAL_VERIFICATION).
 *    Emergency dispatch authority is an explicit grant (DISPATCHER role).
 * 2. Unverified Observation != Trigger for Emergency Dispatch
 *    Public reports are recorded as UNVERIFIED input signals for official triage.
 * 3. Emergency Dispatch != Automatic
 *    ML risk levels and sensor thresholds produce alerts and recommendations.
 *    Only an authorized DISPATCHER or ADMIN can authorize official emergency dispatches.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── 1. Centralized Institutional Domain Allowlist ───────────────────────────

export {
  type InstitutionalDomain,
  type AppUserRole,
  type OfficialVerificationStatus,
  TRUSTED_INSTITUTIONAL_DOMAINS,
  evaluateEmailDomain,
  getUserAuthorizationState,
} from "./auth-domains";
import {
  type AppUserRole,
  type OfficialVerificationStatus,
  evaluateEmailDomain,
} from "./auth-domains";

export interface UserProfileRecord {
  id: string;
  email: string;
  full_name?: string | null;
  institution?: string | null;
  department?: string | null;
  designation?: string | null;
  role: AppUserRole;
  verification_status: OfficialVerificationStatus;
  dispatch_authorized: boolean;
  verified_by?: string | null;
  verified_at?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

// In-memory profiles and audit store fallback for environments where Supabase table is hydrating
const localProfileStore = new Map<string, UserProfileRecord>();
const localAuditLogStore: Array<{
  id: number;
  actor_user_id: string;
  actor_email?: string | undefined;
  actor_role: string;
  institution?: string | undefined;
  action: string;
  target_type: string;
  target_id: string;
  timestamp: string;
  result: string;
  details?: Record<string, unknown> | undefined;
  reason?: string | undefined;
}> = [];

/**
 * Resolves or initializes a user profile from the database, enforcing strict role defaults.
 */
export async function resolveUserProfile(
  userId: string,
  email: string,
  userMetadata?: Record<string, unknown>,
): Promise<UserProfileRecord> {
  const domainEval = evaluateEmailDomain(email);

  try {
    const { data: existing, error } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (!error && existing) {
      return {
        id: existing.id,
        email: existing.email,
        full_name: existing.full_name,
        institution: existing.institution,
        department: existing.department,
        designation: existing.designation,
        role: existing.role as AppUserRole,
        verification_status: existing.verification_status as OfficialVerificationStatus,
        dispatch_authorized: Boolean(existing.dispatch_authorized),
        verified_by: existing.verified_by,
        verified_at: existing.verified_at,
        notes: existing.notes,
      };
    }
  } catch {
    // Database fallback below
  }

  // Check memory store
  const mem = localProfileStore.get(userId);
  if (mem) return mem;

  // Initialize fresh profile
  const profile: UserProfileRecord = {
    id: userId,
    email,
    full_name: (userMetadata?.["full_name"] as string) || (userMetadata?.["name"] as string) || null,
    institution: domainEval.institutionInfo?.institutionName ?? null,
    role: "PUBLIC_USER",
    verification_status: domainEval.suggestedStatus,
    dispatch_authorized: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  localProfileStore.set(userId, profile);

  try {
    await supabaseAdmin.from("user_profiles").upsert({
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name ?? null,
      institution: profile.institution ?? null,
      role: profile.role,
      verification_status: profile.verification_status,
      dispatch_authorized: profile.dispatch_authorized,
    });
  } catch {
    // Silently continue if table is hydrating
  }

  return profile;
}

/**
 * Immutable Audit Logging function.
 */
export async function logAuditEvent(params: {
  actorUserId: string;
  actorEmail?: string | undefined;
  actorRole: AppUserRole | string;
  institution?: string | undefined;
  action:
    | "OFFICIAL_VERIFICATION_APPROVED"
    | "OFFICIAL_VERIFICATION_REJECTED"
    | "DISPATCH_AUTHORIZATION_GRANTED"
    | "DISPATCH_AUTHORIZATION_REVOKED"
    | "EMERGENCY_DISPATCH_AUTHORIZED"
    | "EMERGENCY_DISPATCH_REJECTED"
    | "OBSERVATION_SUBMITTED"
    | "OBSERVATION_VERIFIED"
    | "OBSERVATION_REJECTED"
    | "SIMULATION_ATTEMPT_BLOCKED";
  targetType: "user_profile" | "field_observation" | "alert" | "system";
  targetId: string;
  result: "SUCCESS" | "FORBIDDEN" | "FAILED";
  details?: Record<string, unknown> | undefined;
  reason?: string | undefined;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = {
    id: localAuditLogStore.length + 1,
    actor_user_id: params.actorUserId,
    actor_email: params.actorEmail,
    actor_role: params.actorRole,
    institution: params.institution,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId,
    timestamp,
    result: params.result,
    details: params.details,
    reason: params.reason,
  };

  localAuditLogStore.push(entry);

  try {
    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: params.actorUserId,
      actor_email: params.actorEmail ?? null,
      actor_role: params.actorRole,
      institution: params.institution ?? null,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      timestamp,
      result: params.result,
      details: (params.details as any) ?? {},
      reason: params.reason ?? null,
    });
  } catch {
    // Fallback in memory
  }
}

/**
 * Server-side authorization check for Emergency Dispatch.
 * Returns true only if the user is authenticated and has DISPATCHER or ADMIN role.
 */
export async function verifyDispatcherAuthorization(
  actor: { userId: string; email?: string; role: AppUserRole; dispatchAuthorized: boolean; institution?: string },
  zoneId: number,
  justification: string,
): Promise<{ authorized: boolean; reason?: string }> {
  if (!actor.userId) {
    return { authorized: false, reason: "Authentication required for emergency dispatch." };
  }

  const hasDispatcherPrivileges =
    actor.role === "DISPATCHER" || actor.role === "ADMIN" || actor.dispatchAuthorized;

  if (!hasDispatcherPrivileges) {
    await logAuditEvent({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      actorRole: actor.role,
      institution: actor.institution,
      action: "EMERGENCY_DISPATCH_REJECTED",
      targetType: "alert",
      targetId: `zone-${zoneId}`,
      result: "FORBIDDEN",
      reason: `User role ${actor.role} does not possess DISPATCHER authorization.`,
    });
    return {
      authorized: false,
      reason: "Forbidden: Emergency dispatch requires authorized DISPATCHER or ADMIN credentials.",
    };
  }

  if (!justification || justification.trim().length < 8) {
    return {
      authorized: false,
      reason: "An official operational justification (min 8 chars) is required for emergency dispatch.",
    };
  }

  return { authorized: true };
}

/**
 * Updates official verification status of an institutional candidate (ADMIN only).
 */
export async function updateOfficialVerification(
  adminProfile: UserProfileRecord,
  targetUserId: string,
  approval: {
    verified: boolean;
    grantDispatch: boolean;
    notes?: string;
  },
): Promise<{ success: boolean; profile?: UserProfileRecord; error?: string }> {
  if (adminProfile.role !== "ADMIN") {
    await logAuditEvent({
      actorUserId: adminProfile.id,
      actorRole: adminProfile.role,
      action: "OFFICIAL_VERIFICATION_REJECTED",
      targetType: "user_profile",
      targetId: targetUserId,
      result: "FORBIDDEN",
      reason: "Only ADMIN role can verify institutional accounts.",
    });
    return { success: false, error: "Only administrators can perform official verifications." };
  }

  let profile = localProfileStore.get(targetUserId);
  if (!profile) {
    try {
      const { data } = await supabaseAdmin
        .from("user_profiles")
        .select("*")
        .eq("id", targetUserId)
        .maybeSingle();
      if (data) {
        profile = {
          id: data.id,
          email: data.email,
          role: data.role as AppUserRole,
          verification_status: data.verification_status as OfficialVerificationStatus,
          dispatch_authorized: data.dispatch_authorized,
        };
      }
    } catch {}
  }

  if (!profile) {
    return { success: false, error: "User profile not found." };
  }

  const newRole: AppUserRole = approval.grantDispatch
    ? "DISPATCHER"
    : approval.verified
      ? "VERIFIED_OFFICIAL"
      : "PUBLIC_USER";

  const newStatus: OfficialVerificationStatus = approval.verified ? "OFFICIAL_VERIFIED" : "REJECTED";

  profile.role = newRole;
  profile.verification_status = newStatus;
  profile.dispatch_authorized = approval.grantDispatch;
  profile.verified_by = adminProfile.id;
  profile.verified_at = new Date().toISOString();
  profile.notes = approval.notes ?? null;

  localProfileStore.set(targetUserId, profile);

  try {
    await supabaseAdmin
      .from("user_profiles")
      .update({
        role: newRole,
        verification_status: newStatus,
        dispatch_authorized: profile.dispatch_authorized,
        verified_by: profile.verified_by,
        verified_at: profile.verified_at,
        notes: profile.notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetUserId);
  } catch {}

  await logAuditEvent({
    actorUserId: adminProfile.id,
    actorEmail: adminProfile.email,
    actorRole: adminProfile.role,
    action: approval.verified ? "OFFICIAL_VERIFICATION_APPROVED" : "OFFICIAL_VERIFICATION_REJECTED",
    targetType: "user_profile",
    targetId: targetUserId,
    result: "SUCCESS",
    details: { assignedRole: newRole, dispatchAuthorized: profile.dispatch_authorized },
    reason: approval.notes,
  });

  return { success: true, profile };
}

/**
 * Verifies or rejects a ground field observation (VERIFIED_OFFICIAL, DISPATCHER, or ADMIN only).
 */
export async function verifyGroundObservation(
  officialProfile: UserProfileRecord,
  observationId: string,
  decision: {
    status: "OFFICIAL_VERIFIED" | "REJECTED";
    verificationNotes: string;
    isTrainingEligible?: boolean;
  },
): Promise<{ success: boolean; error?: string }> {
  const authorized =
    officialProfile.role === "VERIFIED_OFFICIAL" ||
    officialProfile.role === "DISPATCHER" ||
    officialProfile.role === "ADMIN";

  if (!authorized) {
    return {
      success: false,
      error: "Only verified government officials and dispatchers can verify observations.",
    };
  }

  const isEligible = Boolean(decision.status === "OFFICIAL_VERIFIED" && decision.isTrainingEligible);

  try {
    await supabaseAdmin
      .from("field_observations")
      .update({
        status: decision.status,
        verified_by: officialProfile.id,
        verified_at: new Date().toISOString(),
        verification_notes: decision.verificationNotes,
        is_training_eligible: isEligible,
      })
      .eq("id", observationId);
  } catch {}

  await logAuditEvent({
    actorUserId: officialProfile.id,
    actorEmail: officialProfile.email,
    actorRole: officialProfile.role,
    institution: officialProfile.institution ?? undefined,
    action: decision.status === "OFFICIAL_VERIFIED" ? "OBSERVATION_VERIFIED" : "OBSERVATION_REJECTED",
    targetType: "field_observation",
    targetId: observationId,
    result: "SUCCESS",
    details: { isTrainingEligible: isEligible },
    reason: decision.verificationNotes,
  });

  return { success: true };
}

/**
 * Resolves or initializes a user profile (alias for backward compatibility).
 */
export const getOrCreateUserProfile = resolveUserProfile;

/**
 * Authenticates a Bearer token and returns the caller's UserProfileRecord.
 */
export async function authenticateToken(authHeader?: string | null): Promise<UserProfileRecord | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return await resolveUserProfile(user.id, user.email || "", user.user_metadata);
  } catch {
    return null;
  }
}
