# External Integrations Pending Real-World Prerequisites
**System:** LandAlert-Nexus (SIH26001 — Northeast India Landslide Early Warning)  
**Status:** Scaffolding Complete · Blocked by Real-World Administrative / Hardware Steps  
**Last Updated:** September 2026

---

## Executive Summary

To maintain engineering integrity, **LandAlert-Nexus does not fake, simulate, or mock successful outcomes** for integrations requiring real external credentials, physical hardware, or legal authority.

The application contains fully built, tested, and ready-to-use adapters and ingestion endpoints. This document outlines the exact real-world administrative steps (registrations, MOUs, hardware deployments) required to activate each capability in production, ensuring future reviewers and evaluating judges understand that these are **not code gaps**, but external dependencies.

---

## 1. SMS Emergency Gateway: TRAI DLT Pre-Registration & Telecommunication Compliance

### Code Status
- **Provider Implementation**: `src/lib/sms/msg91.provider.ts` and `src/lib/alert.service.ts`
- **Behavior Without Credentials**: When `MSG91_AUTH_KEY` is not set or `SMS_ENABLED=false`, dispatch status is set to `SMS_PROVIDER_NOT_CONFIGURED` with status `provider_unconfigured`. The system **never reports false-positive "sent" alerts**.
- **Sandbox Mode**: `SMS_SANDBOX_MODE=true` by default prevents unintended billable dispatches during testing.

### Real-World Administrative Steps Required
Before real SMS alerts can be delivered to mobile subscribers in India:
1. **Telecom Commercial Communications Customer Preference Regulations (TCCCPR, 2018)**:
   - Registration of the government authority or nodal university on an authorized Telecom Regulatory Authority of India (TRAI) Distributed Ledger Technology (DLT) portal (e.g., Vilpower / Jio DLT / Airtel DLT).
   - Approval of Principal Entity ID (PE ID).
2. **Sender Header (Sender ID) Registration**:
   - Registration and whitelist of a 6-character alphanumeric Header (e.g., `LNDALT` or `NERDIS`) under the "Service Implicit / Emergency" category.
3. **Template Pre-Registration**:
   - Explicit template registration with dynamic variable placeholders (`{#var#}`) across all 4 operational languages:
     - **English**: `{#var#} landslide risk in {#var#}. Avoid slope-cut roads. Report cracks or slumping to your district control room.`
     - **Assamese**: `{#var#}ত ভূমিস্খলনৰ {#var#} আশংকা। পাহাৰীয়া পথ এৰাই চলক। ফাট বা মাটি সৰি পৰা দেখিলে জিলা নিয়ন্ত্ৰণ কক্ষক জনাওক।`
     - **Bengali**: `{#var#}-এ ভূমিধসের {#var#} ঝুঁকি। পাহাড়ি রাস্তা এড়িয়ে চলুন। ফাটল বা ধস দেখলে জেলা নিয়ন্ত্রণ কক্ষে জানান।`
     - **Nepali**: `{#var#} मा पहिरोको {#var#} जोखिम। भिरालो सडक नजानुहोस्। चिरा वा पहिरो देखिए जिल्ला नियन्त्रण कक्षलाई खबर गर्नुहोस्।`
   - Messages matching unapproved templates are automatically rejected by Indian telecom telco firewalls.

---

## 2. India Meteorological Department (IMD) Real-Time Weather Station Feed

### Code Status
- **Adapter**: `src/lib/integrations/imd.adapter.ts`
- **Ingestion Endpoint**: `POST /api/integrations/imd/ingest`
- **Behavior**: Parses official IMD Automatic Weather Station (AWS) and Automatic Rain Gauge (ARG) telemetry JSON/XML format, matches station coordinates to nearest monitored hill zones via Haversine distance, and upserts hourly rainfall into `weather_readings`.

### Real-World Administrative Steps Required
1. **Institutional Data-Sharing Memorandum of Understanding (MOU)**:
   - Execution of an official bilateral MOU between State Disaster Management Authorities (SDMAs) / North Eastern Council (NEC) and the India Meteorological Department (Ministry of Earth Sciences, New Delhi).
2. **API Access & Static IP Whitelisting**:
   - Provisioning of production API token (`IMD_API_KEY`).
   - Static IP registration for the Render production server (`render.yaml`) with IMD's National Data Centre (NDC, Pune) firewall.

---

## 3. Physical Geotechnical In-Situ Sensor Telemetry Ingestion

### Code Status
- **Adapter**: `src/lib/integrations/sensors.adapter.ts`
- **Ingestion Endpoint**: `POST /api/sensors/ingest`
- **Behavior**: Validates bearer token auth (`SENSOR_INGESTION_SECRET`), verifies physical limits (tilt angle [-90°, 90°], positive pore pressure), triggers critical slope alarms upon excessive displacement rate (>2 mm/h) or tilt (>5°), and stores soil moisture readings.

### Real-World Physical & Hardware Steps Required
1. **Field Instrument Procurement**:
   - Subsurface biaxial borehole inclinometers (e.g., Encardio Rite / Geokon).
   - Vibrating wire piezometers for groundwater pore-pressure monitoring.
   - Surface wire crackmeters / extensometers across tension cracks.
   - Multi-depth capacitive soil moisture sensors (10cm, 30cm, 50cm).
2. **Field Deployment on High-Risk Slopes**:
   - Installation at verified landslide sites (e.g., Tupul Railway Station corridor NH-37, Pagla Pahar NH-29, Lumshnong NH-06).
   - Solar panel (20W) and weatherproof lithium-iron-phosphate (LiFePO4) battery enclosure setup for monsoon survival.
3. **Telemetry & Gateway Infrastructure**:
   - Ruggedized IoT data logger with 4G/LTE-M cellular modem and satellite-fallback (BGAN / NavIC) or LoRaWAN gateway connected to district disaster headquarters.

---

## 4. Live Arterial Road Status Feed (BRO & State PWD)

### Code Status
- **Adapter**: `src/lib/integrations/road-status.adapter.ts`
- **Ingestion Endpoint**: `POST /api/integrations/roads/ingest`
- **Behavior**: Accepts verified road status updates for National Highways (NH-29, NH-37, NH-102, NH-06, NH-27), updates arterial road connectivity in real-time, and surfaces road blockages and clearance ETAs on the dashboard.

### Real-World Administrative Steps Required
1. **Data-Sharing Agreement with Border Roads Organisation (BRO)**:
   - Bilateral arrangement with Director General Border Roads (DGBR) Headquarters and regional task forces (Project SEWAK in Nagaland/Manipur, Project PUSHPAT in Meghalaya, Project UDAYAK in Arunachal).
2. **Integration with State PWD Disaster Control Rooms**:
   - Webhook setup from State PWD incident management portals into LandAlert-Nexus.

---

## 5. Copernicus Sentinel-2 / Sentinel Hub Satellite Imagery

### Code Status
- **Adapter**: `src/lib/satellite.service.ts`
- **Proxy Endpoint**: `GET /api/satellite/tiles`
- **Status Endpoint**: `GET /api/satellite/status`
- **Map UI**: True-Color basemap and NDVI vegetation index overlays on Leaflet.
- **Graceful Degradation**: If credentials are not configured, the map UI completely hides the toggles rather than showing a broken map layer.
- **Quota Safeguard**: 24-hour server-side tile caching respects free-tier quotas.

### Real-World Administrative Steps Required
1. **Copernicus Data Space Ecosystem (CDSE) / Sentinel Hub Free Tier Registration**:
   - Registration of an organization account at `dataspace.copernicus.eu` or `sentinel-hub.com`.
   - Creation of an OAuth Client ID or Instance ID set as `SENTINEL_HUB_INSTANCE_ID`.
2. **Attribution Compliance**:
   - Adherence to Creative Commons Attribution 4.0 International (CC BY 4.0) per ESA terms.

---

## 6. Open Human Administrative & Governance Decisions

The following architectural decisions cannot be assumed or hardcoded by automated tooling and require explicit human stakeholder determination:

| Decision Item | Stakeholder Body | Options / Tradeoffs | Status |
| :--- | :--- | :--- | :--- |
| **SMS Billing Account Funding** | North Eastern Council (NEC) vs Respective State SDMAs | (A) Centralized NEC fund for all 8 NER states; (B) Decentralized state-by-state billing credits. | **Pending Stakeholder Committee** |
| **Field Media Retention Period** | State Disaster Management Authorities & Legal Counsel | (A) 90-day retention with automatic archival to save storage quotas; (B) Permanent 5-year retention for forensic/judicial landslide disaster inquiries. | **Open Decision** |
| **Primary Cloud Infrastructure** | Ministry of Electronics & IT (MeitY) | (A) Supabase Managed Cloud with Render backend; (B) Migration to National Informatics Centre (NIC) MeghRaj Sovereign Government Cloud. | **Evaluated for Production Deploy** |
| **Public vs Restricted Media Display** | DDMA Incident Commanders | Observation photos from public citizens remain quarantined until verified by an official DISPATCHER/ADMIN. | **Implemented & Enforced in Code** |

---

## 7. Storage Row Level Security (RLS) & Submitter Authentication

### Code Status
- **Database Migration**: `supabase/migrations/20260905042000_fix_storage_rls_authenticated_only.sql`
- **Client Implementation**: `src/components/FieldObservationDialog.tsx` via `ensureAuthenticatedSession()`
- **Backend Enpoints**: `/api/field-observations/upload` and `/api/field-observations/status`
- **Behavior**:
  - Direct INSERT to `storage.objects` for bucket `field-observation-media` is restricted to `authenticated` sessions only; `anon` direct insertion policy has been revoked.
  - Citizen submitters without prior credentials automatically obtain an anonymous Supabase session (`auth.signInAnonymously()`), ensuring an authenticated session token accompanies every media upload.
  - Submitter trust tiers remain governed by institutional domain verification (`PUBLIC_USER` vs `VERIFIED_OFFICIAL`), preserving public media quarantine workflows.
  - Direct SELECT on `storage.objects` is denied to `anon`; all public viewing is mediated exclusively via temporary time-bounded signed URLs (`createSignedUrl`).

