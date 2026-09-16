"""
apps/authentication/domains.py
==============================
Centralized Government & Scientific Institutional Domain Whitelist.
"""

TRUSTED_INSTITUTIONAL_DOMAINS = {
    "gsi.gov.in": {
        "domain": "gsi.gov.in",
        "institution_name": "Geological Survey of India (GSI)",
        "category": "central_geological",
        "region": "National / NER",
    },
    "nesac.gov.in": {
        "domain": "nesac.gov.in",
        "institution_name": "North Eastern Space Applications Centre (NESAC / ISRO)",
        "category": "central_space",
        "region": "North Eastern Region",
    },
    "ndma.gov.in": {
        "domain": "ndma.gov.in",
        "institution_name": "National Disaster Management Authority (NDMA)",
        "category": "central_disaster",
        "region": "National",
    },
    "nic.in": {
        "domain": "nic.in",
        "institution_name": "National Informatics Centre (Govt. of India)",
        "category": "central_disaster",
        "region": "National",
    },
    "isro.gov.in": {
        "domain": "isro.gov.in",
        "institution_name": "Indian Space Research Organisation (ISRO)",
        "category": "central_space",
        "region": "National",
    },
    "imd.gov.in": {
        "domain": "imd.gov.in",
        "institution_name": "India Meteorological Department (IMD)",
        "category": "central_disaster",
        "region": "National",
    },
    "assam.gov.in": {
        "domain": "assam.gov.in",
        "institution_name": "Assam State Disaster Management Authority (ASDMA)",
        "category": "state_disaster",
        "region": "Assam",
    },
    "mizoram.gov.in": {
        "domain": "mizoram.gov.in",
        "institution_name": "Disaster Management & Rehabilitation, Govt. of Mizoram",
        "category": "state_disaster",
        "region": "Mizoram",
    },
    "meghalaya.gov.in": {
        "domain": "meghalaya.gov.in",
        "institution_name": "Meghalaya State Disaster Management Authority (MSDMA)",
        "category": "state_disaster",
        "region": "Meghalaya",
    },
    "nagaland.gov.in": {
        "domain": "nagaland.gov.in",
        "institution_name": "Nagaland State Disaster Management Authority (NSDMA)",
        "category": "state_disaster",
        "region": "Nagaland",
    },
    "manipur.gov.in": {
        "domain": "manipur.gov.in",
        "institution_name": "Relief & Disaster Management, Govt. of Manipur",
        "category": "state_disaster",
        "region": "Manipur",
    },
    "tripura.gov.in": {
        "domain": "tripura.gov.in",
        "institution_name": "Tripura State Disaster Management Authority (TDMA)",
        "category": "state_disaster",
        "region": "Tripura",
    },
    "arunachal.gov.in": {
        "domain": "arunachal.gov.in",
        "institution_name": "Disaster Management Dept., Govt. of Arunachal Pradesh",
        "category": "state_disaster",
        "region": "Arunachal Pradesh",
    },
    "sikkim.gov.in": {
        "domain": "sikkim.gov.in",
        "institution_name": "Sikkim State Disaster Management Authority (SSDMA)",
        "category": "state_disaster",
        "region": "Sikkim",
    },
}

def evaluate_email_domain(email: str):
    """
    Checks if email belongs to an institutional government/scientific domain.
    """
    if not email or "@" not in email:
        return {
            "is_institutional": False,
            "suggested_status": "UNVERIFIED",
            "suggested_role": "PUBLIC_USER",
        }

    parts = email.lower().strip().split("@")
    if len(parts) != 2:
        return {
            "is_institutional": False,
            "suggested_status": "UNVERIFIED",
            "suggested_role": "PUBLIC_USER",
        }

    domain = parts[1]
    for key, info in TRUSTED_INSTITUTIONAL_DOMAINS.items():
        if domain == key or domain.endswith(f".{key}"):
            return {
                "is_institutional": True,
                "institution_info": info,
                "suggested_status": "PENDING_OFFICIAL_VERIFICATION",
                "suggested_role": "PUBLIC_USER",
            }

    return {
        "is_institutional": False,
        "suggested_status": "UNVERIFIED",
        "suggested_role": "PUBLIC_USER",
    }
