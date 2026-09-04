# LandAlert-Nexus: Authoritative Backend & ML API Documentation

This document specifies the authoritative REST API contracts, authentication mechanisms, data schemas, and error conventions for the LandAlert-Nexus Landslide Early Warning System (NER).

---

## 1. Authentication & Security Model

| Authentication Scheme    | Mechanism                                           | Scope                                                                                 |
| :----------------------- | :-------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **Public / Anonymous**   | No credentials required (read-only)                 | Health, risk predictions, GIS layers, offline sync packages                           |
| **Cron / Automated Job** | `Authorization: Bearer <CRON_SECRET>`       | Live weather ingestion (`/api/ingest-weather`), risk recomputation (`/api/recompute`) |
| **Service Role / Admin** | `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` | Direct database mutations, model activation, registry rollback                        |

All requests are protected by:

- Automatic timing-safe token verification against timing attacks (`timingSafeEqual`)
- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store` on dynamic inference and ingestion endpoints
- Input sanitation rejecting injection and malformed coordinates

---

## 2. API Endpoints

### 2.1 System Health

- **Method**: `GET`
- **Path**: `/api/health`
- **Authentication**: Public
- **Description**: Returns multi-subsystem operational health across API, PostgreSQL database, weather ingestion, active ML model artifact, and alert dispatchers.
- **Response Status**: `200 OK` (or `503 Service Unavailable` if database is down)
- **Response Example**:

```json
{
  "status": "healthy",
  "timestamp": "2026-09-04T14:30:00.000Z",
  "uptime_seconds": 3600,
  "components": {
    "api": { "status": "healthy", "message": "API server online and responsive" },
    "database": { "status": "healthy", "latency_ms": 12, "message": "Database connected" },
    "weather": {
      "status": "healthy",
      "latest_reading_age_hours": 2.4,
      "stale_zones_count": 0,
      "message": "Weather telemetry fresh"
    },
    "ml_model": {
      "status": "healthy",
      "active_model_version": "v0.2-lr-trained",
      "artifact_verified": true,
      "message": "Model verified"
    },
    "model_registry": {
      "status": "healthy",
      "active_model_count": 1,
      "message": "Registry invariant satisfied (1 active model)"
    },
    "alert_service": { "status": "healthy", "message": "Alert service operational" }
  }
}
```

---

### 2.2 Dedicated ML Subsystem Health

- **Method**: `GET`
- **Path**: `/api/ml/health`
- **Authentication**: Public
- **Description**: Exposes active model version, feature schema, dataset fingerprint, validation metrics, and telemetry fallback distribution.
- **Response Status**: `200 OK`
- **Response Example**:

```json
{
  "status": "healthy",
  "active_model_version": "v0.2-lr-trained",
  "model_type": "LogisticRegression (L2-penalized, standard-scaled)",
  "feature_schema_version": "v1.0.0",
  "dataset_fingerprint": "f1054c5041ad8e672a45899f42f037d1f7cd15cc6f55256d8d7d68388ed2aa26",
  "pr_auc": 0.5934,
  "recall_at_80_precision": 0.125,
  "artifact_path": "models/v0.2-lr-trained.json",
  "artifact_verified": true,
  "scientific_status": "DATA LIMITED (N=8 real NER landslides) — OPERATIONAL RISK MAPPING",
  "monitored_zones": 15,
  "soil_moisture_telemetry": {
    "measured_zones": 15,
    "fallback_zones": 0,
    "fallback_ratio_pct": 0.0
  },
  "retrain_trigger": {
    "trigger_active": false,
    "reason": "No new verified landslide labels arrived"
  },
  "timestamp": "2026-09-04T14:30:00.000Z"
}
```

---

### 2.3 Authoritative ML Risk Prediction

- **Method**: `GET`
- **Path**: `/api/risk-prediction`
- **Query Parameters**:
  - `zoneId` (integer, required, `1`–`15`): Target monitored zone identifier
  - `asOfDate` (ISO 8601 string, optional): As-of evaluation date for historical backtesting
- **Authentication**: Public
- **Description**: Invokes the canonical 19-feature extraction engine and active ML model (`v0.2-lr-trained`), returning calibrated probabilities, operational scores ($0$–$100$), discrete risk level, mathematical factor attributions, and data quality states. Persists prediction to `public.risk_predictions`.
- **Response Status**: `200 OK` (or `400 Bad Request` if input invalid)
- **Response Example**:

```json
{
  "status": "VALID",
  "zone_id": 1,
  "zone_name": "Tamenglong",
  "district": "Tamenglong",
  "state": "Manipur",
  "model_version": "v0.2-lr-trained",
  "feature_schema_version": "v1.0.0",
  "probability": 0.4576,
  "risk_score": 45.8,
  "risk_level": "Moderate",
  "explanation_narrative": "Main risk driver: terrain slope. Secondary contributors: historical proximity, seasonality...",
  "factor_attribution": {
    "top_categories": [
      { "category": "terrain_slope", "net_contribution": 0.905 },
      { "category": "historical_proximity", "net_contribution": 0.129 }
    ],
    "top_features": [
      {
        "feature": "slope_norm",
        "value": 0.204,
        "contribution": 0.276,
        "direction": "increases_risk"
      }
    ]
  },
  "data_freshness": {
    "latest_weather_timestamp": "2026-09-04T12:00:00Z",
    "weather_age_hours": 2.2,
    "soil_moisture_status": "measured"
  },
  "inference_timestamp": "2026-09-04T14:30:00.000Z",
  "persisted": true
}
```

---

### 2.4 Live Weather Ingestion

- **Method**: `POST`
- **Path**: `/api/ingest-weather`
- **Authentication**: Cron secret required (`Authorization: Bearer <CRON_SECRET>`)
- **Description**: Fetches 7-day observed rainfall and ERA5-Land hourly soil moisture from Open-Meteo with exponential backoff and physical bounds clamping ($[0, 1200]\text{ mm}$). Upserts to `public.weather_readings` idempotently and triggers `recompute_risk()`.
- **Response Status**: `200 OK` (or `401 Unauthorized`)
- **Response Example**:

```json
{
  "ok": true,
  "zones": 15,
  "readings": 120,
  "soilReadings": 105
}
```

---

### 2.5 Risk Recomputation

- **Method**: `POST`
- **Path**: `/api/recompute`
- **Authentication**: Cron secret required (`Authorization: Bearer <CRON_SECRET>`)
- **Description**: Triggers PL/pgSQL `recompute_risk()` across all 15 risk zones, refreshing scores, levels, explanations, and triggering alert dispatch when zones cross into `High` or `Severe`.
- **Response Status**: `200 OK` (or `401 Unauthorized`)

---

### 2.6 Alert Evaluation & Dispatch

- **Method**: `POST`
- **Path**: `/api/alerts/dispatch`
- **Authentication**: Bearer token (DISPATCHER/ADMIN role) or Cron secret (`Authorization: Bearer <CRON_SECRET>`)
- **Request Body**:

```json
{
  "zoneId": 1,
  "language": "en",
  "channel": "both",
  "idempotencyKey": "ALERT-MANUAL-1-20260904",
  "justification": "Verified tension cracks and threshold exceedance on NH-10 corridor"
}
```

- **Description**: Evaluates threshold logic (`High` or `Severe` required), applies 6-hour cooldown deduplication (with escalation override for High->Severe), constructs multilingual SMS payloads (EN, AS, BN, NE), dispatches to the configured SMS provider (MSG91), and persists an authoritative record to `public.alerts`.
- **Response Status**: `201 Created` (dispatched) or `200 OK` (cooldown suppressed or unconfigured)
- **Response Example**:

```json
{
  "dispatched": true,
  "reason": "Alert created; SMS provider not configured (MSG91_AUTH_KEY required for live dispatch)",
  "alertId": 42,
  "riskLevel": "Severe",
  "zoneId": 1,
  "dispatchStatus": "SMS_PROVIDER_NOT_CONFIGURED",
  "dispatchedAt": "2026-09-05T03:30:00.000Z"
}
```

#### Real SMS Dispatch Lifecycle & Honest Status Codes

LandAlert-Nexus integrates with a real SMS gateway (MSG91 preferred for India/NER delivery), abstracted behind the `SmsProvider` interface:

| `dispatch_status`               | `status`                 | Real Meaning                                                                                                                                                                          |
| :------------------------------ | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SMS_PROVIDER_NOT_CONFIGURED`   | `provider_unconfigured`  | **Default when unconfigured**. `MSG91_AUTH_KEY` is not present in the server environment or `SMS_ENABLED` is `false`. The system honestly records the alert without pretending it sent. |
| `SMS_SANDBOX_LOGGED`            | `sandbox_logged`         | **Default development mode** (`SMS_SANDBOX_MODE=true`). Validates payload structure and logs recipient mobile numbers without incurring carrier billing charges.                    |
| `SENT`                          | `sent`                   | Provider accepted the message for delivery. Provider message ID is captured in `provider_message_id`.                                                                                 |
| `DELIVERED`                     | `delivered`              | Downstream telecom carrier delivery receipt acknowledged.                                                                                                                             |
| `FAILED`                        | `failed`                 | Network failure, bad auth key, invalid recipient phone number, or gateway rejection. Error recorded in `last_error`.                                                                  |

#### Mandatory Production Prerequisites for Operators

To deliver real, live SMS alerts to citizens and emergency authorities in India:
1. **Environment Credentials**: Set `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, and set `SMS_ENABLED=true` and `SMS_SANDBOX_MODE=false`.
2. **TRAI DLT Pre-Registration (Mandatory in India)**:
   Under Telecom Regulatory Authority of India (TRAI) TCCCPR regulations, possessing MSG91 API keys alone is **insufficient** to deliver SMS in India. Operators must complete:
   - **Principal Entity (PE) Registration** on an Indian telecom DLT portal (Jio, Airtel, or BSNL DLT).
   - **Header / Sender ID Approval** (6-character alphabetic header, e.g., `LNDALT` or `DISMGT`).
   - **Template Registration**: Register the exact multilingual alert templates (`ALERT_TEMPLATES` in `alert.service.ts`) with approved dynamic variables (`{#var#}`). Unregistered messages will be rejected by telecom operators at carrier gateway level.

---

### 2.7 Offline Field Observation Sync

- **Method**: `POST`
- **Path**: `/api/sync/observations`
- **Authentication**: Public (Field Observer)
- **Request Body**:

```json
{
  "observations": [
    {
      "zone_id": 1,
      "observed_at": "2026-09-04T10:00:00Z",
      "client_timestamp": "2026-09-04T10:05:00Z",
      "rainfall_mm": 45.0,
      "road_status": "restricted",
      "observer_id": "observer_tamenglong_1",
      "idempotency_key": "OBS-1-1725444000000-tamenglong"
    }
  ]
}
```

- **Description**: Validates observation batch, enforces idempotency, resolves conflicts, and inserts into `public.field_observations`.
- **Response Status**: `200 OK` (or `422 Unprocessable Entity` if malformed)

---

### 2.8 Offline Cache Package Download

- **Method**: `GET`
- **Path**: `/api/sync/package`
- **Authentication**: Public
- **Description**: Downloads full offline package containing all 15 zones, precomputed polygon boundaries, road connectivity segments, active model weights and cutoffs, and cache validity policy (24-hour max freshness).
- **Response Status**: `200 OK`

---

### 2.9 GIS RFC 7946 GeoJSON Layers

- **Method**: `GET`
- **Paths**:
  - `/api/gis/zones.geojson` (15 hill zone polygons with live risk attributes)
  - `/api/gis/landslides.geojson` (Historical landslide points)
- **Authentication**: Public
- **Content-Type**: `application/geo+json; charset=utf-8`
- **Description**: Standards-compliant GeoJSON FeatureCollection in `EPSG:4326 (WGS84)` with closed polygon rings for direct consumption in QGIS, ArcGIS, Mapbox, or Leaflet.

---

### 2.8 Physical Geotechnical In-Situ Sensor Ingestion

- **Method**: `POST`
- **Path**: `/api/sensors/ingest`
- **Authentication**: `Authorization: Bearer <SENSOR_INGESTION_SECRET>`
- **Description**: Ingestion endpoint for geotechnical instrumentation (inclinometers, piezometers, crackmeters, and soil moisture probes). Enforces physical limits (e.g. angle -90° to 90°, non-negative pore pressure) and triggers critical warnings on rapid creep (>2 mm/h) or excessive slope tilt (>5°).

### 2.9 India Meteorological Department (IMD) Weather Station Telemetry

- **Method**: `POST`
- **Path**: `/api/integrations/imd/ingest`
- **Authentication**: Header `x-imd-key: <IMD_API_KEY>` or query parameter `?key=`
- **Description**: Ingests automated telemetry from IMD AWS (Automatic Weather Station) and ARG (Automatic Rain Gauge) units. Correlates station coordinates to monitored hill zones via Haversine distance and updates rainfall readings.

### 2.10 Live Arterial Road Status Ingestion (BRO & State PWD)

- **Method**: `POST`
- **Path**: `/api/integrations/roads/ingest`
- **Authentication**: `Authorization: Bearer <ROAD_STATUS_API_KEY>`
- **Description**: Ingests highway clearance and blockage notices from Border Roads Organisation (Project SEWAK / PUSHPAT) and State PWD units, updating arterial road connectivity in real time.

### 2.11 Satellite Imagery Status & Tile Proxy (Copernicus Sentinel-2)

- **Method**: `GET`
- **Path**: `/api/satellite/status` and `/api/satellite/tiles?layer=[TRUE-COLOR|NDVI]&z={z}&x={x}&y={y}`
- **Description**: Status endpoint returns credential configuration state. Tile proxy retrieves Sentinel-2 tiles with 24-hour server-side TTL caching. Gracefully disabled when `SENTINEL_HUB_INSTANCE_ID` is unconfigured.

---

## 3. Standard Error Envelopes

All errors return JSON with HTTP status code and machine-readable code:

```json
{
  "error": "zoneId must be an integer between 1 and 15 (NER monitored zones)",
  "code": "INVALID_ZONE_ID",
  "status": 400,
  "timestamp": "2026-09-04T14:30:00.000Z"
}
```

Standard error codes:

- `INVALID_INPUT`: General parameter validation failure
- `INVALID_ZONE_ID`: Zone identifier out of bounds
- `INVALID_DATE`: Malformed ISO 8601 date
- `FUTURE_DATE_NOT_ALLOWED`: As-of evaluation date in the future
- `UNAUTHORIZED`: Missing or invalid Bearer authorization token
- `NOT_FOUND`: Non-existent route or resource
- `DATABASE_ERROR`: Database query or RPC execution failure
- `INTERNAL_SERVER_ERROR`: Unhandled exception
