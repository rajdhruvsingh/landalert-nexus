/**
 * LandAlert-Nexus PWA Service Worker
 * (SIH26001 - Northeast India Landslide Early Warning)
 *
 * Implements:
 * 1. App shell caching for offline view
 * 2. Tile caching for OpenStreetMap tiles (CacheFirst)
 * 3. GeoJSON & offline bundle caching for zones (NetworkFirst)
 * 4. Stale-data offline fallback indicators
 */

const CACHE_NAME = "landalert-pwa-v1";
const MAP_CACHE = "landalert-tiles-v1";
const DATA_CACHE = "landalert-data-v1";

const APP_SHELL_URLS = [
  "/",
  "/manifest.json",
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_URLS).catch((err) => {
        console.warn("[SW] App shell precache warning:", err);
      });
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (![CACHE_NAME, MAP_CACHE, DATA_CACHE].includes(key)) {
            return caches.delete(key);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== "GET") return;

  // 1. OpenStreetMap tiles -> CacheFirst
  if (url.hostname.includes("tile.openstreetmap.org")) {
    event.respondWith(
      caches.open(MAP_CACHE).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(request)
            .then((networkResponse) => {
              if (networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => {
              // Return blank or fallback if offline and tile not cached
              return new Response("", { status: 504, statusText: "Tile offline" });
            });
        });
      }),
    );
    return;
  }

  // 2. Zone GeoJSON & Offline Bundle -> NetworkFirst with Cache Fallback
  if (url.pathname.includes("/api/gis/zones.geojson") || url.pathname.includes("/api/sync/package")) {
    event.respondWith(
      caches.open(DATA_CACHE).then((cache) => {
        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(async () => {
            const cached = await cache.match(request);
            if (cached) {
              const headers = new Headers(cached.headers);
              headers.set("X-LandAlert-Cached", "true");
              headers.set("X-LandAlert-Cache-Time", new Date().toISOString());
              return new Response(cached.body, {
                status: 200,
                statusText: "OK (Offline Cache)",
                headers,
              });
            }
            return new Response(
              JSON.stringify({ error: "Offline: No cached zone data available" }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          });
      }),
    );
    return;
  }

  // 3. Navigation / HTML pages -> NetworkFirst with Shell fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("/");
        if (cached) return cached;
        return new Response("LandAlert-Nexus Offline", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }),
    );
    return;
  }

  // 4. Static assets (JS, CSS, fonts, images) -> Stale-while-revalidate
  if (
    url.pathname.match(/\.(js|css|png|jpg|svg|ico|woff2|woff)$/) ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
  }
});
