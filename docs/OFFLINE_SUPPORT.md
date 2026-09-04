# Offline Capabilities & PWA Architecture Documentation
**System:** LandAlert-Nexus (SIH26001 — Northeast India Landslide Early Warning)  
**Version:** 1.0.0-PWA  
**Updated:** September 2026

---

## 1. Overview & Architectural Philosophy

LandAlert-Nexus is built for the disaster-prone, low-connectivity terrains of Northeast India (Manipur, Mizoram, Meghalaya, Nagaland, Arunachal Pradesh, Sikkim, Assam, Tripura). Mountain roads and disaster sites frequently experience complete cellular network collapse during extreme monsoonal downpours.

To protect field officers and district disaster management authorities (DDMAs), LandAlert-Nexus implements a dual-layer offline architecture:
1. **PWA App Shell & Asset Caching (Read-Path)**: Service Worker (`public/sw.js` and `vite-plugin-pwa`) precaches the application shell, OpenStreetMap tiles, and zone GeoJSON vector layers.
2. **Offline Observation Queue & Idempotent Sync (Write-Path)**: Client-side local engine (`src/lib/offline-manager.ts` and `src/lib/sync.service.ts`) queues field observations, GPS coordinates, and media files locally with UUIDv4 idempotency keys, re-uploading automatically upon reconnect.

---

## 2. Real Offline Capabilities (What Genuinely Works Without Network)

| Feature | Offline Behavior | Mechanism |
| :--- | :--- | :--- |
| **App Shell & UI Loading** | Instant load without network. Full dashboard shell renders. | Service Worker cache (`landalert-pwa-v1`) caching HTML, JS bundles, CSS, and typography fonts. |
| **Map Visualization** | Previously visited OpenStreetMap tiles remain visible. | Service Worker CacheFirst strategy on `*.tile.openstreetmap.org` (`landalert-tiles-v1`). |
| **Zone Footprints & Coordinates** | 15 Northeast India hill zones render on the map. | GeoJSON cached via NetworkFirst with local cache fallback (`/api/gis/zones.geojson`). |
| **Zone Risk & Road Details** | 24-hour snapshot package viewable across all 15 zones. | `localStorage` offline bundle (`landalert_offline_bundle_v1`) containing zone profiles, rainfall thresholds, and mapped roads. |
| **Field Observation Capture** | Field readings (rainfall mm, soil condition, visual cracks, road blockage) can be recorded. | Queued in `localStorage` (`landalert_field_observations_queue_v1`) with client timestamp and idempotency key. |
| **Geo-tagging & GPS Capture** | Device GPS latitude, longitude, and accuracy radius are captured offline via browser Geolocation API. | Hardware GPS chip operates independently of cellular data networks. |
| **Media Attachment Queueing** | Photos and videos up to limits (10MB/50MB) are preserved locally as data URLs in the offline queue. | Stored in offline queue until connection restored. |
| **Stale Data Warning** | Explicit banner displays: *"Last updated at [timestamp], may be outdated — live network recompute needed."* | Prevents operators from misinterpreting stale data as live readings. |

---

## 3. What Strictly Requires Active Connectivity

To maintain engineering integrity, the system **never simulates or fakes** capabilities that inherently require a live network:

1. **Live Rainfall & Weather Ingestion**:
   - Automated weather station (AWS) feeds and Open-Meteo API ingestion require live internet.
   - When offline, weather values reflect the last synced timestamp.
2. **Real-time ML Risk Score Recomputation**:
   - Running the logistic regression inference engine (`/api/recompute`) requires server execution against the PostgreSQL database.
3. **SMS Emergency Dispatch**:
   - Real SMS dispatch via the MSG91 gateway requires HTTP connectivity to `control.msg91.com`.
   - Outbound emergency alerts cannot be dispatched while the dispatcher's client is disconnected.
4. **Supabase Authentication & Role Verification**:
   - Signing in or verifying token signatures against Supabase Auth requires an active connection.
   - Cached sessions remain valid until token expiry.
5. **Permanent Storage Media Upload**:
   - Permanent upload to Supabase Storage (`/api/field-observations/upload`) requires network. The client queues media locally and auto-uploads upon reconnection.

---

## 4. Emergency Situational Awareness Warning Rule

> [!IMPORTANT]
> **Safety Critical Constraint**:
> Cached emergency risk data must never be rendered indistinguishably from live data.
> Whenever network connectivity drops, the UI displays an amber pulsing indicator:
> `⚠ Offline Mode — Cached Risk Data: Last updated at [timestamp] ([X]h ago), may be outdated — live network recompute needed.`
> If the local package is older than 24 hours, an `EXPIRED` status warns operators that thresholds and slope saturation indices may no longer reflect current ground conditions.

---

## 5. Verification & Testing Procedure

### A. Installability Verification
1. Run application over HTTPS or `localhost:8080`.
2. Inspect `manifest.json`: Confirm `display: standalone`, valid theme color `#0c0f14`, and 192x192 / 512x512 icons.
3. In Chrome/Edge DevTools > Application > Service Workers: Verify `sw.js` is activated and running.
4. Check browser address bar for the **Install LandAlert** icon.

### B. Offline Simulation Test
1. Load the dashboard online to pre-populate caches and map tiles.
2. Open DevTools > Network tab > toggle **Offline**.
3. Reload page (`Cmd+R` / `F5`):
   - Confirm page loads immediately from Service Worker cache.
   - Confirm amber warning banner appears: *"⚠ Offline Mode — Cached Risk Data"*.
   - Confirm zone map remains navigable with cached tiles.
4. Submit a Field Observation with GPS coordinates and an attached photo:
   - Notice success message: *"Offline mode: observation queued locally. Will synchronize automatically when network connectivity is restored."*
   - Verify entry in `localStorage` under `landalert_field_observations_queue_v1`.
5. Switch Network back to **Online**:
   - Notice auto-sync triggers.
   - Queued observation and media upload to backend; queue prunes to 0.
