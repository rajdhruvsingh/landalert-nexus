/**
 * src/hooks/useUserLocation.ts
 * ============================
 * Shared Geolocation hook for LandAlert-Nexus.
 * Uses Capacitor Geolocation for native/mobile platforms with fallback to
 * navigator.geolocation for standard browsers.
 * Caches detected location in memory and session/local storage to prevent continuous permission re-prompts.
 * Emits and listens to global location events so all components stay in sync.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface CachedLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
}

const LOCATION_STORAGE_KEY = "landalert_user_location";

function getStoredLocation(): CachedLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LOCATION_STORAGE_KEY) || localStorage.getItem(LOCATION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
        return parsed as CachedLocation;
      }
    }
  } catch {}
  return null;
}

function saveStoredLocation(loc: CachedLocation): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(loc);
    sessionStorage.setItem(LOCATION_STORAGE_KEY, serialized);
    localStorage.setItem(LOCATION_STORAGE_KEY, serialized);
  } catch {}
}

// Session-level memory cache initialized from persistent storage if available
let sessionLocationCache: CachedLocation | null = getStoredLocation();

/**
 * Standalone helper to capture or return cached user location.
 * Can be invoked on sign-in or app boot without needing a React component mount.
 */
export async function captureGlobalUserLocation(force = false): Promise<CachedLocation | null> {
  if (!force && sessionLocationCache) {
    return sessionLocationCache;
  }

  // Web Browser Geolocation API (navigator.geolocation)
  const hasNavGeo = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  if (!hasNavGeo) return null;

  return new Promise<CachedLocation | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const res: CachedLocation = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
          accuracy: Number(pos.coords.accuracy ? pos.coords.accuracy.toFixed(1) : "5.0"),
          capturedAt: new Date(pos.timestamp).toISOString(),
        };

        sessionLocationCache = res;
        saveStoredLocation(res);

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("landalert-location-captured", { detail: res }));
        }
        resolve(res);
      },
      (err) => {
        console.warn("[captureGlobalUserLocation] Browser geolocation error:", err.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

export interface UseUserLocationOptions {
  autoRequest?: boolean;
}

export interface UseUserLocationResult {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  capturedAt: string | null;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  statusText: string | null;
  requestLocation: (options?: { force?: boolean }) => Promise<CachedLocation | null>;
  clearError: () => void;
}

export function useUserLocation(options: UseUserLocationOptions = {}): UseUserLocationResult {
  const { autoRequest = false } = options;

  const [location, setLocation] = useState<CachedLocation | null>(() => sessionLocationCache || getStoredLocation());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string | null>(() => {
    const loc = sessionLocationCache || getStoredLocation();
    if (loc) {
      return `GPS Acquired: ${loc.lat.toFixed(4)}°N, ${loc.lng.toFixed(4)}°E (±${Math.round(loc.accuracy || 5)}m)`;
    }
    return null;
  });

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Listen to global location capture events across components & auth triggers
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleLocationCaptured = (e: Event) => {
      const detail = (e as CustomEvent<CachedLocation>).detail;
      if (detail && isMountedRef.current) {
        setLocation(detail);
        setPermissionDenied(false);
        setLoading(false);
        setError(null);
        setStatusText(
          `GPS Acquired: ${detail.lat.toFixed(4)}°N, ${detail.lng.toFixed(4)}°E (±${Math.round(detail.accuracy || 5)}m)`
        );
      }
    };
    window.addEventListener("landalert-location-captured", handleLocationCaptured);
    return () => {
      window.removeEventListener("landalert-location-captured", handleLocationCaptured);
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const requestLocation = useCallback(
    async (opts?: { force?: boolean }): Promise<CachedLocation | null> => {
      const force = opts?.force ?? false;

      // Return cached location if available and refresh not forced
      if (!force) {
        const cached = sessionLocationCache || getStoredLocation();
        if (cached) {
          if (isMountedRef.current) {
            setLocation(cached);
            setLoading(false);
            setError(null);
            setStatusText(
              `GPS Acquired: ${cached.lat.toFixed(4)}°N, ${cached.lng.toFixed(4)}°E (±${Math.round(cached.accuracy || 5)}m)`
            );
          }
          return cached;
        }
      }

      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
        setStatusText("Acquiring GPS location…");
      }

      const res = await captureGlobalUserLocation(force);

      if (isMountedRef.current) {
        setLoading(false);
        if (res) {
          setLocation(res);
          setPermissionDenied(false);
          setError(null);
          setStatusText(
            `GPS Acquired: ${res.lat.toFixed(4)}°N, ${res.lng.toFixed(4)}°E (±${Math.round(res.accuracy || 5)}m)`
          );
        } else {
          setError("Unable to retrieve device GPS coordinates");
        }
      }
      return res;
    },
    []
  );

  useEffect(() => {
    if (autoRequest) {
      const cached = sessionLocationCache || getStoredLocation();
      if (!cached) {
        requestLocation({ force: false });
      } else if (!location) {
        setLocation(cached);
      }
    }
  }, [autoRequest, requestLocation, location]);

  return {
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    accuracy: location?.accuracy ?? null,
    capturedAt: location?.capturedAt ?? null,
    loading,
    error,
    permissionDenied,
    statusText,
    requestLocation,
    clearError,
  };
}
