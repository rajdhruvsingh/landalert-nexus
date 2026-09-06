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
4. **Machine Learning Model Isolation (Option A)**: The production ML model (`v0.2-lr-trained`, 19 canonical features) remains untouched. Satellite deformation is strictly treated as an independent observational evidence layer.

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

## 5. Precise Deployment & Operations Guide

### A. CDSE Account Setup
1. Register for a free Copernicus Data Space Ecosystem account at [https://dataspace.copernicus.eu](https://dataspace.copernicus.eu).
2. Verify email and accept the ESA Copernicus terms of service.
3. Validate login against the CDSE portal.

### B. CDSE Credentials Configuration
Store credentials securely in the worker environment:
```bash
CDSE_USERNAME="your-registered-email@domain.com"
CDSE_PASSWORD="your-secure-password"
```
Never commit credentials to git. The `.gitignore` enforces exclusion of all `.env` files.

### C. External Worker Provisioning Options
Deploy the dedicated worker container on any cloud compute provider:
- **AWS EC2**: `c6i.2xlarge` or `r6i.xlarge` (8 vCPU, 16–32 GB RAM, 100 GB gp3 SSD).
- **AWS Batch / ECS**: Fargate or EC2 compute environment with 16 GB task memory.
- **GCP Compute Engine**: `c2-standard-4` or `n2-standard-4` (16 GB RAM, 100 GB Persistent Disk SSD).
- **GCP Cloud Run / Batch**: Batch task definition with 16 GB memory reservation.
- **Self-hosted Kubernetes**: Worker DaemonSet or KEDA-scaled Deployment with persistent volume claim (PVC).

### D. Minimum Hardware Requirements
- **RAM**: Minimum 16 GB (recommended 32 GB for multi-swath processing).
- **Storage**: Minimum 100 GB SSD scratch disk. (Pre-flight audit enforces $\ge 30\text{ GB}$ free before download).
- **CPU**: 4+ vCPU cores.

### E. Docker Deployment
Build the container image:
```bash
docker build -t landalert-insar-worker -f workers/insar/Dockerfile.insar .
```
Run using Docker Compose:
```bash
docker compose -f docker-compose.worker.yml up -d
```

### F. Environment Variables Manifest
| Variable | Required | Description |
| :--- | :--- | :--- |
| `CDSE_USERNAME` | Yes | Copernicus CDSE email |
| `CDSE_PASSWORD` | Yes | Copernicus CDSE password |
| `SUPABASE_URL` | Yes | Supabase REST endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role secret |
| `SATELLITE_STORAGE_PATH` | No | Cache path (default: `/data/insar_cache`) |
| `MIN_DISK_FREE_GB` | No | Minimum free disk required (default: `30.0`) |

### G. Storage Management & Cost Control
- **Temporary Scratch Volume**: Raw `.SAFE.zip` scenes (8–16 GB per pair) and unwrapped matrix files are stored in `/data/insar_workspace` during processing.
- **Automatic Cleanup**: Upon job completion or permanent failure, `storage.cleanup_job_scratch(job_id)` purges raw archives, keeping container disk usage constant.
- **Persistent Products**: Geocoded deformation GeoTIFFs, mean velocity rasters, and metadata are archived in `/data/insar_cache/products` or uploaded to object storage.
- **Cost Scaling**: The worker can be started on-demand when jobs are queued in Supabase (`QUEUED` count > 0) and stopped/scaled to zero when the queue is drained.

### H. Supabase Database Setup
Ensure migrations are applied:
1. `supabase/migrations/20260906120000_satellite_insar_pipeline.sql`
2. `supabase/migrations/20260906130000_insar_worker_pipeline.sql`

### I. Worker Startup & Self-Test
Verify that all binaries, storage headroom, and configurations are intact:
```bash
python3 workers/insar/worker.py --self-test
```
Example JSON output:
```json
{
  "worker_id": "insar-worker-node-1",
  "pipeline_version": "v1.2.0-isce2-snaphu",
  "checks": {
    "snaphu_installed": true,
    "gdal_installed": true,
    "storage_headroom": {
      "path": "/data/insar_workspace",
      "free_gb": 82.4,
      "required_gb": 30.0,
      "sufficient": true
    },
    "cdse_configured": true,
    "supabase_configured": true
  },
  "all_passed": true,
  "operational_readiness": "OPERATIONAL"
}
```

### J. Health Verification
The REST API exposes:
`GET /api/satellite/health`
Returns:
- `service_status`: `SERVICE_AVAILABLE`
- `satellite_data_status`: `SATELLITE_DATA_AVAILABLE` (or `PENDING_CONFIGURATION`)
- `worker_architecture`: `ASYNCHRONOUS_DEDICATED_WORKER`
- `cdse_auth`: `{ configured: boolean, missing: string[] }`

### K. Triggering the First Real InSAR Job
Dispatch job via API:
```bash
curl -X POST https://landalert-nexus.onrender.com/api/satellite/jobs \
  -H "Content-Type: application/json" \
  -d '{"cellId": "cell-27.25-88.50"}'
```
Returns HTTP `202 Accepted` with `jobId`.

### L. Monitoring & Observability
Poll job status:
```bash
curl "https://landalert-nexus.onrender.com/api/satellite/jobs?jobId=<JOB_ID>"
```
Observe worker logs:
```bash
docker logs -f landalert-insar-worker
```

### M. Troubleshooting & Failure Recovery
- `INVALID_CREDENTIALS`: Verify `CDSE_USERNAME` and `CDSE_PASSWORD` on the CDSE portal.
- `INSUFFICIENT_PROCESSING_STORAGE`: Expand worker persistent disk to $\ge 100\text{ GB}$.
- `LOW_COHERENCE`: Expected over dense subtropical rainforest; cell marked `UNAVAILABLE` with `LOW_COHERENCE` or `SAR_DECORRELATION_DENSE_CANOPY`.
- `TRANSIENT_NETWORK_TIMEOUT`: Handled automatically by exponential backoff retry.

### N. Security Audit
- No credentials or tokens are printed in worker logs.
- Worker runs under unprivileged non-root user `insarworker` (`UID 1001`).
- All `.SAFE` and intermediate rasters are excluded in `.gitignore`.

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

## 7. Machine Learning Isolation & Scientific Claims Policy

- **Model Isolation**: Production logistic regression model `v0.2-lr-trained` retains its canonical 19-feature vector (`slope_degrees`, `rainfall_7d_mm`, etc.). Model weights are **not modified**.
- **Observational Indicator**: Satellite ground deformation velocity ($\text{mm/year}$) and displacement ($\text{mm}$) are exposed as an **independent geological observation** alongside the heuristic risk score.
- **Scientific Claims**:
  - We do **not** claim "InSAR improves model accuracy" until historical validation across confirmed landslide catalogs is performed.
  - We do **not** claim "real-time deformation"; measurements represent multi-temporal interferometric velocity across Sentinel-1 revisit cycles (6–12 days).
  - All deformation measurements are explicitly designated as **LOS (Line-Of-Sight) deformation**, never uncalibrated vertical displacement.
- **Future ML Feature Interfaces**:
  - `insar_los_velocity`
  - `insar_cumulative_displacement`
  - `insar_trend`
  - `insar_coherence`
  - `insar_valid_coverage`
  - `insar_observation_age`
