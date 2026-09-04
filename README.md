# Himalaya Sentinel

SIH26001 — AI-Based Early Warning and Landslide Risk Monitoring System (NER)

Complete Architecture, Repository Design, and AI Build Prompt

1. System Overview

A cloud-hosted, offline-tolerant platform that fuses rainfall/soil-moisture/terrain/satellite data with published NE-Himalaya rainfall-threshold research to classify landslide risk by zone, push multilingual alerts to district administrations and citizens, and let field officials/citizens report ground-truth hazards via geo-tagged photo uploads — all visualized on a live GIS dashboard.

Three user classes drive every design decision:

District Disaster Management Authorities — need the risk dashboard, alert dispatch console, road-connectivity view

Field officials / citizens (rural, low-connectivity NER villages) — need a lightweight mobile/PWA with offline-first reporting and SMS-based alerts (not just push notifications, since data connectivity is unreliable)

System/ML pipeline — ingests IMD + satellite + DEM data daily, recomputes risk scores, triggers alert rules

2. Architecture Diagram

flowchart TB
    subgraph External["External Data Sources"]
        IMD["IMD Rainfall API"]
        SMAP["SMAP/ESA CCI Soil Moisture"]
        BHUVAN["Bhuvan DEM & Susceptibility Layers"]
        GSI["GSI Landslide Inventory (Bhukosh)"]
    end

    subgraph Ingestion["Data Ingestion Layer"]
        SCHED["Scheduled Jobs (Celery Beat / cron)"]
        ETL["ETL Workers (Python)"]
    end

    subgraph Core["Core Backend (FastAPI)"]
        API["REST/GraphQL API"]
        RISK["Risk Engine: Threshold Model + ML Classifier"]
        ALERT["Alert Dispatcher (rules engine)"]
        AUTH["Auth Service (JWT, role-based)"]
    end

    subgraph Data["Data Layer"]
        PG["PostgreSQL + PostGIS"]
        REDIS["Redis (cache, queues, session risk state)"]
        S3["Object Storage (citizen photo/video uploads)"]
    end

    subgraph Clients["Client Applications"]
        WEB["React + Leaflet GIS Dashboard (authorities)"]
        PWA["Offline-first PWA / React Native (field officials, citizens)"]
    end

    subgraph Notify["Notification Layer"]
        SMS["SMS Gateway (MSG91/Twilio)"]
        PUSH["Push Notifications (FCM)"]
        I18N["Multilingual Templates"]
    end

    IMD --> SCHED
    SMAP --> SCHED
    BHUVAN --> SCHED
    GSI --> SCHED
    SCHED --> ETL --> PG
    PG --> RISK --> PG
    RISK --> ALERT --> SMS
    ALERT --> PUSH
    ALERT --> I18N
    API --> PG
    API --> REDIS
    API --> S3
    WEB --> API
    PWA --> API
    PWA -. offline queue .-> PWA


3. Tech Stack (chosen for feasibility, not resume-padding)

Layer Choice Why Backend API Python 3.11 + FastAPI Async, fast to build, native fit with ML stack ML/Risk engine scikit-learn / XGBoost on top of published I-D threshold equations Explainable, fast to train, defensible to judges (not a black box) Database PostgreSQL + PostGIS extension Native geospatial queries (point-in-polygon risk zones, road buffers) Cache/Queue Redis + Celery Scheduled ETL jobs, async alert dispatch Object storage AWS S3 / MinIO (self-hosted for demo) Citizen-uploaded photos/videos Web dashboard React + TypeScript + Leaflet.js (or Mapbox GL) GIS heatmaps, road overlays, standard and well-documented Field/citizen app PWA (React) with Workbox for offline sync, OR React Native if a native app is preferred Offline-first is a hard PS requirement — PWA is faster to build for a hackathon Notifications MSG91 or Twilio (SMS) + Firebase Cloud Messaging (push) SMS is non-negotiable for NER connectivity reality i18n react-i18next (frontend), template-based SMS strings (backend) Multilingual requirement (Assamese, Khasi, Bengali, Nepali, Mizo, Manipuri as relevant) Deployment (demo) Render/Railway (backend+DB) + Vercel (frontend), or a single Docker Compose stack on a cloud VM Free-tier friendly for a student budget CI/CD GitHub Actions Lint + test on every PR, auto-deploy on merge to main

4. ML / Risk Engine Design

Do not start with a deep learning black box — start from the peer-reviewed regional thresholds, then layer ML on top for refinement. This is both more feasible and more defensible to judges.

Baseline (Day 1 capability):

Implement the published Northeastern Himalaya moisture threshold: E(mm) = -11.10 + 0.62 * D(hr) for 24 < D < 1440 hr, and the Sikkim-specific I-D threshold I = 43.26 * D^-0.78.

Any station where cumulative/antecedent rainfall crosses its region-specific threshold → flagged "elevated risk."

Refinement layer (ML classifier):

Features: rainfall (current + antecedent 3/7/15/30-day), slope angle & aspect (from DEM), soil moisture proxy, land-use/land-cover, distance to historical landslide points, road density.

Model: Random Forest or XGBoost binary/multiclass classifier (Low/Moderate/High/Severe risk) trained on GSI's historical landslide inventory as positive labels and randomly sampled non-landslide terrain as negatives.

Output: a risk score per grid cell (e.g., 1km² or village-level polygon), re-computed on each scheduled ETL run.

Validation: report precision/recall/AUC against held-out historical events — this is your "measurable result" for judges, not a vague accuracy claim.

Explainability requirement: every alert must show why it fired (e.g., "72-hr cumulative rainfall of 210mm exceeds regional threshold of 180mm for this terrain class") — this builds trust with district officials and directly answers the "how do we trust an AI alert" judge objection.

5. Database Schema (core tables)

-- Spatial risk zones
CREATE TABLE risk_zones (
    id SERIAL PRIMARY KEY,
    zone_name VARCHAR(255),
    district VARCHAR(100),
    state VARCHAR(100),
    geom GEOMETRY(Polygon, 4326),
    current_risk_level VARCHAR(20), -- Low/Moderate/High/Severe
    last_computed_at TIMESTAMP
);

-- Rainfall + soil moisture time series
CREATE TABLE weather_readings (
    id SERIAL PRIMARY KEY,
    station_id VARCHAR(50),
    zone_id INT REFERENCES risk_zones(id),
    reading_time TIMESTAMP,
    rainfall_mm FLOAT,
    soil_moisture_pct FLOAT,
    source VARCHAR(50) -- 'IMD', 'SMAP', etc.
);

-- Historical landslide inventory (training labels)
CREATE TABLE historical_landslides (
    id SERIAL PRIMARY KEY,
    event_date DATE,
    geom GEOMETRY(Point, 4326),
    severity VARCHAR(20),
    source VARCHAR(50) -- 'GSI Bhukosh', etc.
);

-- Citizen/field reports
CREATE TABLE field_reports (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    geom GEOMETRY(Point, 4326),
    photo_url TEXT,
    video_url TEXT,
    description TEXT,
    report_type VARCHAR(50), -- 'crack', 'slope_movement', 'road_blocked'
    submitted_at TIMESTAMP,
    sync_status VARCHAR(20) -- for offline queue tracking
);

-- Alerts issued
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    zone_id INT REFERENCES risk_zones(id),
    risk_level VARCHAR(20),
    message TEXT,
    language VARCHAR(10),
    channel VARCHAR(20), -- 'sms', 'push', 'both'
    dispatched_at TIMESTAMP,
    explanation TEXT -- the "why this fired" text
);

-- Users (district officials, field officers, citizens)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) UNIQUE,
    role VARCHAR(20), -- 'admin', 'district_officer', 'field_officer', 'citizen'
    district VARCHAR(100),
    preferred_language VARCHAR(10)
);


6. Core API Endpoints

GET  /api/v1/risk-zones                 → all zones with current risk level (GeoJSON)
GET  /api/v1/risk-zones/{id}/history     → risk trend over time for one zone
GET  /api/v1/risk-zones/{id}/explanation → why this zone is at its current level
POST /api/v1/reports                     → submit a citizen/field report (supports offline queue replay)
GET  /api/v1/reports?zone_id=&status=    → list reports for verification
GET  /api/v1/alerts?district=&since=     → alert history
POST /api/v1/alerts/dispatch             → manually trigger an alert (admin override)
GET  /api/v1/dashboard/summary           → aggregated stats: risk severity counts, road status, forecast
POST /api/v1/auth/login                  → phone+OTP login
GET  /api/v1/weather/forecast?zone_id=   → IMD-linked forecast for a zone


7. Repository Structure

sih26001-landslide-ews/
├── .github/
│   └── workflows/
│       ├── backend-ci.yml
│       └── frontend-ci.yml
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── risk_zones.py
│   │   │   │   ├── reports.py
│   │   │   │   ├── alerts.py
│   │   │   │   └── auth.py
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   └── security.py
│   │   ├── db/
│   │   │   ├── models.py
│   │   │   └── session.py
│   │   ├── ml/
│   │   │   ├── threshold_model.py     # published I-D / moisture threshold equations
│   │   │   ├── risk_classifier.py     # RF/XGBoost model
│   │   │   ├── train.py
│   │   │   └── features.py
│   │   ├── ingestion/
│   │   │   ├── imd_client.py
│   │   │   ├── satellite_client.py
│   │   │   ├── dem_loader.py
│   │   │   └── scheduler.py           # Celery beat tasks
│   │   ├── alerts/
│   │   │   ├── rules_engine.py
│   │   │   ├── sms_gateway.py
│   │   │   ├── push_gateway.py
│   │   │   └── i18n_templates/
│   │   └── tests/
│   ├── alembic/                        # DB migrations
│   ├── requirements.txt
│   └── Dockerfile
├── frontend-dashboard/                 # React + Leaflet, for authorities
│   ├── src/
│   │   ├── components/
│   │   │   ├── RiskHeatmap.tsx
│   │   │   ├── RoadStatusPanel.tsx
│   │   │   ├── ForecastPanel.tsx
│   │   │   └── AlertConsole.tsx
│   │   ├── pages/
│   │   ├── i18n/
│   │   └── api/
│   ├── package.json
│   └── Dockerfile
├── field-app-pwa/                      # offline-first PWA, for citizens/field officials
│   ├── src/
│   │   ├── components/
│   │   │   ├── ReportForm.tsx
│   │   │   ├── OfflineQueue.ts
│   │   │   └── AlertFeed.tsx
│   │   ├── service-worker.ts
│   │   └── i18n/
│   └── package.json
├── ml-notebooks/                       # exploratory analysis, model validation reports
│   ├── 01_threshold_validation.ipynb
│   ├── 02_feature_engineering.ipynb
│   └── 03_model_evaluation.ipynb
├── data/
│   ├── raw/                            # .gitignored — large files not committed
│   ├── processed/
│   └── reference/                      # published threshold papers, GSI docs (PDFs)
├── infra/
│   ├── docker-compose.yml
│   └── terraform/ (optional, for cloud deploy)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── DEMO_SCRIPT.md
├── .env.example
├── .gitignore
└── README.md


8. Build Roadmap (phase-by-phase, mapped to a realistic team timeline)

Phase 0 — Setup (Day 1)

Init GitHub repo with structure above, branch protection on main, dev branch for integration

Docker Compose for local Postgres+PostGIS+Redis

CI pipeline skeleton (lint + test on PR)

Phase 1 — Data foundation (Days 2–4)

IMD rainfall ingestion client + scheduler

Load Bhuvan DEM + GSI historical landslide inventory into PostGIS

Implement and unit-test the published threshold equations against known events (validate against the paper's own reported cases first — cheap, high-confidence sanity check)

Phase 2 — Risk engine (Days 5–8)

Feature engineering pipeline (rainfall aggregates, slope, distance-to-history)

Train RF/XGBoost classifier, log precision/recall/AUC

Expose /risk-zones + /explanation endpoints

Phase 3 — Dashboard (Days 6–10, parallel with Phase 2)

React + Leaflet heatmap consuming /risk-zones GeoJSON

Road-status and forecast panels

Alert console for manual override

Phase 4 — Field app + offline (Days 8–12)

PWA report form with geo-tag + photo capture

Offline queue (IndexedDB) with background sync on reconnect

Multilingual UI strings

Phase 5 — Alerting (Days 11–13)

Rules engine (risk level threshold → alert trigger)

SMS gateway integration (sandbox/test credentials)

Multilingual SMS templates

Phase 6 — Integration, demo polish, judge-proofing (Days 13–15)

End-to-end test: simulate a rainfall spike → verify risk recompute → alert dispatch → dashboard update

Prepare the "why this fired" explanation UI — this is your strongest differentiator, don't leave it till the last hour

Record a fallback demo video in case of live network issues at the venue

9. The AI Build Prompt

Copy everything in the block below into your AI coding agent (e.g., Claude Code) as the initial instruction. It is self-contained and assumes the agent has terminal/repo access.

ROLE
You are acting as a senior full-stack + ML engineer building a hackathon prototype
for Smart India Hackathon 2026, Problem Statement SIH26001: "AI-Based Early Warning
and Landslide Risk Monitoring System in NER." You will build this incrementally,
phase by phase, committing working code at each phase boundary. Do not skip ahead
or attempt everything in one pass.

PROJECT CONTEXT
The North Eastern Region of India faces frequent rainfall-triggered landslides.
The government's own regional early warning system (GSI's LANDSLIP project) does
not yet cover NER (it's listed only as a planned future expansion state). Our
differentiation is: (1) NE-Himalaya-specific rainfall thresholds already published
in peer-reviewed research, applied to a region GSI hasn't covered yet, and (2) a
citizen-reporting layer that GSI's system lacks. We are NOT claiming to invent
landslide prediction — we are closing a real regional coverage gap. Keep this
framing in mind for any user-facing copy, README text, or demo narration you write.

HARD REQUIREMENTS (do not drop any of these — they are graded)
1. Ingest rainfall, soil moisture (satellite proxy, not physical sensors),
   satellite imagery, terrain/slope data, and historical landslide records.
2. Use an AI/ML model to classify risk zones (Low/Moderate/High/Severe), built
   ON TOP OF the published NE-Himalaya rainfall threshold equations, not as a
   black box replacing them:
   - NE Himalaya moisture threshold: E(mm) = -11.10 + 0.62 * D(hr), for 24 < D < 1440 hr
   - Sikkim intensity-duration threshold: I = 43.26 * D^-0.78 (I in mm/day, D in days)
3. Real-time alerts to district administrations and citizens via BOTH push
   notification AND SMS (SMS is non-negotiable — NER connectivity is unreliable).
4. GIS mapping (Leaflet or Mapbox) showing risk heatmaps over roads/villages/infra.
5. Citizen/field-official geo-tagged photo/video upload for cracks, slope
   movement, blocked roads.
6. Dashboards showing: risk severity levels, road connectivity status,
   weather-linked forecasts, emergency response prioritisation.
7. Multilingual notifications (at minimum: English, Assamese, Bengali; extend
   to Khasi/Nepali/Mizo/Manipuri if time permits).
8. Offline-first functionality for the field/citizen app — reports must queue
   locally and sync automatically when connectivity returns.
9. Every alert must include a human-readable explanation of WHY it fired
   (e.g., "72hr cumulative rainfall of 210mm exceeds this zone's threshold of
   180mm"). This is a differentiator — do not treat it as optional.

TECH STACK (do not substitute without asking)
- Backend: Python 3.11, FastAPI, SQLAlchemy, Celery + Redis for scheduled jobs
- DB: PostgreSQL with PostGIS extension
- ML: scikit-learn / XGBoost for the classifier layer on top of the threshold baseline
- Web dashboard: React + TypeScript + Leaflet.js
- Field app: React PWA with Workbox for offline sync (IndexedDB queue)
- SMS: abstract behind an interface (SmsGatewayInterface) so we can swap
  MSG91/Twilio without touching business logic — use a mock implementation
  for local dev
- Infra: Docker Compose for local dev; GitHub Actions for CI

REPOSITORY SETUP (do this first, as Phase 0)
1. Initialize a git repository with this exact top-level structure:
   backend/, frontend-dashboard/, field-app-pwa/, ml-notebooks/, data/,
   infra/, docs/, .github/workflows/
2. Add a .gitignore covering Python, Node, and data/raw/ (large files must
   never be committed — add a docs/DATA_SOURCES.md explaining where to
   download each dataset instead).
3. Set up docker-compose.yml with services: postgres (postgis/postgis image),
   redis, backend (FastAPI, hot-reload for dev).
4. Set up a GitHub Actions workflow that runs lint (ruff for Python, eslint
   for TS) and tests on every pull request.
5. Write an initial README.md with: problem statement summary, architecture
   diagram (mermaid), local setup instructions, and the differentiation
   framing from PROJECT CONTEXT above.
6. Commit this as the first commit on `main`, then create a `dev` branch
   for ongoing work. Use conventional commit messages (feat:, fix:, docs:, etc.)
   for every commit from here on.

BUILD ORDER — follow these phases strictly, in order. At the end of each
phase, run tests, commit, and give me a short status summary before moving on.

PHASE 1 — Data foundation
- Build an IMD rainfall ingestion client (if IMD's real API requires
  credentials we don't have yet, build against a realistic mock/fixture
  matching IMD's known data format, with a TODO marking where the real
  API key goes)
- Build a loader for DEM/slope data (assume GeoTIFF input from Bhuvan) into
  PostGIS
- Build a loader for the historical landslide inventory (CSV/GeoJSON input)
  into the historical_landslides table
- Implement threshold_model.py containing BOTH published equations above,
  with unit tests validating known example values from the source papers
- Deliverable: a script that, given a station's rainfall time series,
  correctly flags threshold exceedance per the equations above

PHASE 2 — Risk engine
- Build the feature engineering pipeline: rolling rainfall aggregates
  (3/7/15/30-day), slope angle from DEM, distance to nearest historical
  landslide point, land-use category if available
- Train an XGBoost or RandomForest classifier using historical_landslides
  as positive labels and randomly sampled non-landslide points as negatives
- Report precision, recall, F1, and AUC on a held-out test split — save
  these metrics to a markdown report in ml-notebooks/
- Expose GET /api/v1/risk-zones (GeoJSON) and GET /api/v1/risk-zones/{id}/explanation
- The explanation endpoint must return the specific threshold values and
  actual readings that drove the classification, in plain language

PHASE 3 — Dashboard (can run in parallel with Phase 2 once the API contract
for /risk-zones is agreed)
- React + Leaflet map rendering risk_zones as a color-coded heatmap
  (green/yellow/orange/red for Low/Moderate/High/Severe)
- Road overlay layer showing connectivity status
- A weather forecast panel per selected zone
- An alert console listing recent alerts with their explanation text visible

PHASE 4 — Field app + offline
- PWA with a report form: geo-tag (browser geolocation API), photo/video
  capture, report type selector, description field
- IndexedDB-backed offline queue: if POST /api/v1/reports fails due to no
  connectivity, queue locally and retry via a background sync event when
  connectivity returns
- Multilingual UI using react-i18next, starting with English/Assamese/Bengali

PHASE 5 — Alerting
- Rules engine: when a zone's risk level crosses into High or Severe,
  automatically create an alert record and dispatch it
- SMS gateway interface + mock implementation (log to console/file in dev)
- Multilingual SMS templates stored in alerts/i18n_templates/, selected by
  the recipient's preferred_language

PHASE 6 — Integration + demo readiness
- Write an end-to-end test/demo script (docs/DEMO_SCRIPT.md) that walks
  through: inject a simulated rainfall spike for one zone → confirm risk
  recompute → confirm alert dispatch (check mock SMS log) → confirm
  dashboard reflects the new risk level
- Ensure the explanation text is visibly surfaced in BOTH the dashboard
  alert console and the SMS template — this is the feature most likely
  to earn judge questions and it needs to be undeniably visible, not
  buried in an API response

CONSTRAINTS AND STYLE
- Prioritize a working end-to-end slice over a polished single component —
  after Phase 1, always keep the app in a runnable state.
- Do not fabricate data sources. Every ingestion client must either hit a
  real public API/dataset or clearly load from a documented fixture/mock
  with a comment explaining what real integration would require.
- Every ML claim in code comments or docs must be tied to an actual
  computed metric (precision/recall/AUC), never a placeholder number.
- Ask me before making any architectural substitution to the tech stack
  listed above.
- After each phase, summarize what was built, what's tested, and what's
  explicitly deferred, so I always know the true state of the project.


10. Judge-facing framing (keep this in your pocket for Q&A)

If asked "how is this different from GSI's LANDSLIP system": "LANDSLIP is a real, working government system — we're not trying to out-build it. NER is listed as a planned future expansion state, not yet an active pilot. We're applying NE-Himalaya-specific thresholds that already exist in peer-reviewed research to close that regional gap now, and adding a citizen-reporting layer GSI's system doesn't have."

If asked "why threshold model + ML instead of just deep learning": "Threshold models are explainable and already validated against real NE Himalaya events in published research — that's what lets every alert we send include a human-readable reason. A black-box deep model would give us a number with no way to explain it to a district officer deciding whether to evacuate a village."

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/02d6690c-3c6e-453b-a8e9-8b352c8f126e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
