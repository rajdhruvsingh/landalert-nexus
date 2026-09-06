# Satellite InSAR Ground Deformation Pipeline Documentation
**LandAlert-Nexus Scientific & Operational Architecture**

---

## 1. Executive Summary & Scientific Mandate

LandAlert-Nexus integrates satellite radar interferometry (InSAR) to observe millimeter-scale ground displacement across the eight states of the Northeastern Region (NER) of India:
- **Assam**
- **Arunachal Pradesh**
- **Manipur**
- **Meghalaya**
- **Mizoram**
- **Nagaland**
- **Sikkim**
- **Tripura**

InSAR provides millimeter-scale measurement of slope creep, subsidence, and pre-failure strain. This document details the dedicated asynchronous worker architecture that decouples heavy SAR computational processing from the lightweight Render Web service.

### Zero-Fabrication & Scientific Integrity Policy
1. **No Synthetic Ground Deformation**: Under no circumstance does LandAlert-Nexus generate, simulate, or output synthetic deformation values.
2. **No Fake Zero Fallbacks**: Cells lacking valid interferometric processing or coherence do **not** report `0.0 mm/year` as a substitute for missing data.
3. **Explicit Technical Justifications**: Missing or unprocessable areas report `status: "UNAVAILABLE"` along with explicit scientific reasons (`SAR_DECORRELATION_DENSE_CANOPY`, `PENDING_SAR_INTERFEROMETRIC_PROCESSING`, `INSUFFICIENT_ACQUISITIONS`, `LOW_COHERENCE`, `ORBIT_DATA_UNAVAILABLE`).
4. **Machine Learning Model Isolation (Option A)**: The production ML model (`v0.2-lr-trained`, 19 canonical features) remains untouched. Deformation is treated strictly as an independent observational indicator.

---

## 2. Decoupled Production Architecture

```
                   LANDALERT-NEXUS
                          │
                          ▼
                Render Web Service
                (Node/TanStack/Nitro)
                - Lightweight SSR frontend
                - REST API routes (/api/satellite/*)
                - Job Enqueueing (HTTP 202)
                          │
                          │ POST /api/satellite/jobs
                          ▼
                   Satellite Job
                     Database
                   (Supabase)
                          │
                          ▼
                 Asynchronous Worker
             (Dedicated Container / Node)
             - 16 GB+ RAM, 100 GB+ SSD
             - ISCE2 + SNAPHU + GDAL + MintPy
                          │
             ┌────────────┴────────────┐
             │                         │
             ▼                         ▼
      Copernicus CDSE            Orbit Provider
      Sentinel-1 SLC             POEORB / aux data
      (OAuth2 Bearer)            (Copernicus POD)
             │                         │
             └────────────┬────────────┘
                          ▼
                   SAR PROCESSING
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
       ISCE2            SNAPHU           GDAL
   (topsApp.py)      (Phase Unwrapping) (Geocoding)
         │                │                │
         └────────────────┼────────────────┘
                          ▼
                    InSAR Product
                          │
                          ▼
                Quality Control (QC)
                - Coherence >= 0.40
                - Valid pixels >= 20%
                - Canopy Decorrelation Detection
                          │
                          ▼
                 LOS Deformation
                 - Mean velocity (mm/year)
                 - Cumulative displacement (mm)
                 - Temporal trend
                          │
                          ▼
                Spatial Grid Cells
                (0.25-deg NER Cells)
                          │
                          ▼
                      Supabase
                - insar_deformation_products
                - insar_displacement_timeseries
                - satellite_processing_jobs
                          │
                          ▼
                   LandAlert API
                - /api/satellite/deformation
                - /api/satellite/jobs
                - /api/satellite/timeseries
                - /api/satellite/health
                          │
                          ▼
                       Frontend
                (SpatialLocationRiskPanel & RiskMap)
```

### Why Heavy Processing Is Decoupled from Render
- **Render Web Service Constraints**: 512 MB RAM limit, ephemeral filesystem, 10-second HTTP request timeout.
- **InSAR Processing Requirements**: A single pair of Sentinel-1 IW SLC scenes is $8 - 16\text{ GB}$. Co-registration, interferogram formation, and SNAPHU phase unwrapping require $\ge 16\text{ GB}$ RAM and $45 - 120\text{ minutes}$ of compute.
- **Solution**: The web service only enqueues jobs and queries results. The dedicated worker (`workers/insar/`) executes independently on high-compute infrastructure.

---

## 3. The 14 Explicit Worker Lifecycle States

Jobs transition through 14 explicit, verifiable stages:

| Stage | Description | Progress Pct |
| :--- | :--- | :--- |
| **`QUEUED`** | Job created by API with unique deterministic fingerprint; awaiting worker pickup. | 0% |
| **`RUNNING`** | Worker claimed job atomically using optimistic database lock. | 5% |
| **`DOWNLOADING`** | Streaming master and slave Sentinel-1 SLC archives from CDSE with SHA-256 verification. | 15% |
| **`PREPROCESSING`** | Staging workspace, verifying Precise Orbit Ephemerides (POEORB), generating `topsApp.xml`. | 25% |
| **`COREGISTERING`** | Sub-pixel co-registration with Enhanced Spectral Diversity (ESD) on burst overlaps. | 40% |
| **`INTERFEROGRAM`** | Differential phase interferogram formation and multilooking ($4 \times 1$). | 55% |
| **`UNWRAPPING`** | 2D Statistical-Cost Network-Flow phase unwrapping via SNAPHU. | 70% |
| **`ATMOSPHERIC_CORRECTION`** | Tropospheric phase screen estimation and filtering. | 80% |
| **`TIMESERIES`** | Multi-temporal SBAS/PS displacement inversion to LOS rate. | 85% |
| **`QUALITY_CONTROL`** | Evaluating coherence, valid pixel percentage, and canopy decorrelation. | 90% |
| **`AGGREGATING`** | Zonal aggregation into canonical 0.25-degree NER grid cells. | 95% |
| **`COMPLETED`** | Final geotiffs and metrics persisted to Supabase; raw SLC archives cleaned. | 100% |
| **`FAILED`** | Non-recoverable error recorded with failure code and message. | 0% |
| **`CANCELLED`** | Job cancelled by operator or superseded. | 0% |

---

## 4. Software Stack Rationale

**Selected Stack**: **ISCE2 (`topsApp.py`) + SNAPHU + MintPy + GDAL**

### Why this stack was selected:
1. **NASA/JPL/ESA Open Scientific Standard**: ISCE2 is specifically tailored for Sentinel-1 TOPS mode processing with built-in sub-swath burst extraction and Enhanced Spectral Diversity (ESD).
2. **Headless Linux / Container Ready**: Fully scriptable in Python without the heavy Java GUI / Desktop overhead and memory leak issues of ESA SNAP `gpt`.
3. **Robust Phase Unwrapping**: Native SNAPHU integration handles complex mountainous Himalayan phase gradients.
4. **Clean Decoupling**: MintPy provides standalone Small Baseline Subset (SBAS) multi-temporal inversion to compute velocity ($\text{mm/year}$) and cumulative displacement ($\text{mm}$).

---

## 5. Copernicus CDSE Setup & Authentication

### Environment Variables
Configure the following secrets in the worker environment (e.g. Docker environment or cloud secret manager):
```bash
CDSE_USERNAME="your-copernicus-email@domain.com"
CDSE_PASSWORD="your-copernicus-password"
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

### Authentication Flow
1. Worker issues POST to `https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token` with `client_id=cdse-public`.
2. Receives short-lived JWT access token; refreshes automatically when expiring within 60s.
3. Authenticates streaming requests to OData download endpoints with `Authorization: Bearer <token>`.

---

## 6. Scientific Quality Control (QC) Thresholds

| Metric | Threshold | Operational Action on Failure |
| :--- | :--- | :--- |
| **Mean Coherence ($\bar{\gamma}$)** | $\ge 0.40$ | Reject; mark cell as `status: UNAVAILABLE`, reason: `LOW_COHERENCE`. |
| **Valid Pixel Coverage** | $\ge 20\%$ | Reject; mark cell as `status: UNAVAILABLE`, reason: `INSUFFICIENT_VALID_PIXELS`. |
| **Temporal Baseline ($B_t$)** | $\ge 60\text{ days}$ | Reject rate calculation; mark as `TEMPORAL_BASELINE_INSUFFICIENT`. |
| **Epoch Count ($N$)** | $\ge 3\text{ acquisitions}$ | Reject time series; mark as `INSUFFICIENT_ACQUISITIONS`. |
| **Dense Forest Canopy** | $\bar{\gamma} < 0.35$ in evergreen forest | Flag tropical volume scattering; mark as `SAR_DECORRELATION_DENSE_CANOPY`. |

---

## 7. Operational Status Matrix

| Component | Status | Notes |
| :--- | :--- | :--- |
| **Application API Routes** | **IMPLEMENTED** | All `/api/satellite/*` endpoints live and tested. |
| **Database Migrations** | **IMPLEMENTED** | Schema supporting 14 states, fingerprints, timeseries, products. |
| **Frontend UI (RiskPanel & Map)** | **IMPLEMENTED** | Honest `UNAVAILABLE`, `PROCESSING`, and `AVAILABLE` rendering. |
| **Automated Tests** | **IMPLEMENTED** | 24 Section 28 tests passing cleanly in Vitest. |
| **Dedicated Worker Code** | **IMPLEMENTED** | Python daemon, CDSE client, orbit client, pipeline wrapper, QC. |
| **Container Specification** | **IMPLEMENTED** | `Dockerfile.insar` & `docker-compose.worker.yml` ready. |
| **CDSE Credentials** | **CONFIGURATION REQUIRED** | Requires setting `CDSE_USERNAME` and `CDSE_PASSWORD` on worker. |
| **Worker Hardware Instance** | **EXTERNAL INFRASTRUCTURE REQUIRED** | Requires deploying worker container on 16GB+ RAM / 100GB+ SSD node. |
| **Live Dynamic InSAR Run** | **NOT YET VALIDATED** | Pending configuration of CDSE secrets on external worker instance. |
