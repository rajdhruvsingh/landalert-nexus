/**
 * src/lib/auth-domains.ts
 * =======================
 * Pure client/server-safe institutional domain validation and authorization state mapping.
 * Contains no Node or server-only dependencies.
 */

export interface InstitutionalDomain {
  domain: string;
  institutionName: string;
  category: "central_geological" | "central_space" | "central_disaster" | "state_disaster" | "state_gov";
  region: string;
}

export const TRUSTED_INSTITUTIONAL_DOMAINS: Record<string, InstitutionalDomain> = {
  "gsi.gov.in": {
    domain: "gsi.gov.in",
    institutionName: "Geological Survey of India (GSI)",
    category: "central_geological",
    region: "National / NER",
  },
  "nesac.gov.in": {
    domain: "nesac.gov.in",
    institutionName: "North Eastern Space Applications Centre (NESAC / ISRO)",
    category: "central_space",
    region: "North Eastern Region",
  },
  "ndma.gov.in": {
    domain: "ndma.gov.in",
    institutionName: "National Disaster Management Authority (NDMA)",
    category: "central_disaster",
    region: "National",
  },
  "nic.in": {
    domain: "nic.in",
    institutionName: "National Informatics Centre (Govt. of India)",
    category: "central_disaster",
    region: "National",
  },
  // North-Eastern State Government Disaster Authorities & Portals
  "assam.gov.in": {
    domain: "assam.gov.in",
    institutionName: "Assam State Disaster Management Authority (ASDMA)",
    category: "state_disaster",
    region: "Assam",
  },
  "mizoram.gov.in": {
    domain: "mizoram.gov.in",
    institutionName: "Disaster Management & Rehabilitation, Govt. of Mizoram",
    category: "state_disaster",
    region: "Mizoram",
  },
  "meghalaya.gov.in": {
    domain: "meghalaya.gov.in",
    institutionName: "Meghalaya State Disaster Management Authority (MSDMA)",
    category: "state_disaster",
    region: "Meghalaya",
  },
  "nagaland.gov.in": {
    domain: "nagaland.gov.in",
    institutionName: "Nagaland State Disaster Management Authority (NSDMA)",
    category: "state_disaster",
    region: "Nagaland",
  },
  "manipur.gov.in": {
    domain: "manipur.gov.in",
    institutionName: "Relief & Disaster Management, Govt. of Manipur",
    category: "state_disaster",
    region: "Manipur",
  },
  "tripura.gov.in": {
    domain: "tripura.gov.in",
    institutionName: "Tripura State Disaster Management Authority (TDMA)",
    category: "state_disaster",
    region: "Tripura",
  },
  "arunachal.gov.in": {
    domain: "arunachal.gov.in",
    institutionName: "Disaster Management Dept., Govt. of Arunachal Pradesh",
    category: "state_disaster",
    region: "Arunachal Pradesh",
  },
  "sikkim.gov.in": {
    domain: "sikkim.gov.in",
    institutionName: "Sikkim State Disaster Management Authority (SSDMA)",
    category: "state_disaster",
    region: "Sikkim",
  },
};

export type AppUserRole = "PUBLIC_USER" | "VERIFIED_OFFICIAL" | "DISPATCHER" | "ADMIN";
export type OfficialVerificationStatus =
  | "UNVERIFIED"
  | "PENDING_OFFICIAL_VERIFICATION"
  | "OFFICIAL_VERIFIED"
  | "REJECTED";

/**
 * Validates whether an email belongs to an institutional government/scientific domain.
 */
export function evaluateEmailDomain(email: string): {
  isInstitutional: boolean;
  institutionInfo?: InstitutionalDomain | undefined;
  suggestedStatus: OfficialVerificationStatus;
  suggestedRole: AppUserRole;
} {
  const parts = email.toLowerCase().trim().split("@");
  if (parts.length !== 2) {
    return {
      isInstitutional: false,
      suggestedStatus: "UNVERIFIED",
      suggestedRole: "PUBLIC_USER",
    };
  }

  const domain = parts[1]!;
  // Check exact domain or subdomains (e.g. dm.assam.gov.in)
  for (const [key, info] of Object.entries(TRUSTED_INSTITUTIONAL_DOMAINS)) {
    if (domain === key || domain.endsWith(`.${key}`)) {
      return {
        isInstitutional: true,
        institutionInfo: info,
        suggestedStatus: "PENDING_OFFICIAL_VERIFICATION",
        suggestedRole: "PUBLIC_USER", // Remains public until explicitly approved
      };
    }
  }

  return {
    isInstitutional: false,
    suggestedStatus: "UNVERIFIED",
    suggestedRole: "PUBLIC_USER",
  };
}

/**
 * Derives user-facing operational authorization label for UI badges.
 * Follows strict state hierarchy:
 * 1. ADMIN -> "System Administrator"
 * 2. DISPATCHER -> "Emergency Dispatcher"
 * 3. VERIFIED_OFFICIAL -> "Verified Official"
 * 4. Eligible Government Domain -> "Official account — Verification pending"
 * 5. Public / Google Account -> "Authenticated — Standard User"
 */
export function getUserAuthorizationState(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
} | null): {
  badge: string;
  role: AppUserRole;
  status: OfficialVerificationStatus;
  tone: "neutral" | "warning" | "success" | "primary";
} {
  if (!user || !user.email) {
    return {
      badge: "Anonymous Observer",
      role: "PUBLIC_USER",
      status: "UNVERIFIED",
      tone: "neutral",
    };
  }

  const rawRole = String(user.user_metadata?.["role"] ?? "").toUpperCase();
  const rawStatus = String(user.user_metadata?.["verification_status"] ?? "").toUpperCase();
  const dispatchAuth = Boolean(user.user_metadata?.["dispatch_authorized"]);

  if (rawRole === "ADMIN") {
    return {
      badge: "System Administrator",
      role: "ADMIN",
      status: "OFFICIAL_VERIFIED",
      tone: "primary",
    };
  }

  if (rawRole === "DISPATCHER" || dispatchAuth) {
    return {
      badge: "Emergency Dispatcher",
      role: "DISPATCHER",
      status: "OFFICIAL_VERIFIED",
      tone: "primary",
    };
  }

  if (rawRole === "VERIFIED_OFFICIAL" || rawStatus === "OFFICIAL_VERIFIED") {
    return {
      badge: "Verified Official",
      role: "VERIFIED_OFFICIAL",
      status: "OFFICIAL_VERIFIED",
      tone: "success",
    };
  }

  // Check institutional eligibility
  const domainEval = evaluateEmailDomain(user.email);
  if (domainEval.isInstitutional) {
    return {
      badge: "Official account — Verification pending",
      role: "PUBLIC_USER",
      status: "PENDING_OFFICIAL_VERIFICATION",
      tone: "warning",
    };
  }

  return {
    badge: "Authenticated — Standard User",
    role: "PUBLIC_USER",
    status: "UNVERIFIED",
    tone: "neutral",
  };
}
