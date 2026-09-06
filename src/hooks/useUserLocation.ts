/**
 * src/hooks/useUserLocation.ts
 * ============================
 * Shared Geolocation hook for LandAlert-Nexus.
 * Uses Capacitor Geolocation for native/mobile platforms with fallback to
 * navigator.geolocation for standard browsers.
 * Caches detected location in session memory to prevent continuous permission re-prompts.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation as CapGeolocation } from "@capacitor/geolocation";

export interface CachedLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
}

// Session-level memory cache so multiple components and re-renders share the same session location
let sessionLocationCache: CachedLocation | null = null;

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

  const [location, setLocation] = useState<CachedLocation | null>(sessionLocationCache);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string | null>(() => {
    if (sessionLocationCache) {
      return `GPS Acquired: ${sessionLocationCache.lat.toFixed(4)}°N, ${sessionLocationCache.lng.toFixed(4)}°E (±${Math.round(sessionLocationCache.accuracy || 5)}m)`;
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

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const requestLocation = useCallback(
    async (opts?: { force?: boolean }): Promise<CachedLocation | null> => {
      const force = opts?.force ?? false;
      console.log("[useUserLocation] requestLocation called. force =", force, "sessionLocationCache =", sessionLocationCache);

      // Return cached location if available and refresh not forced
      if (!force && sessionLocationCache) {
        console.log("[useUserLocation] Returning cached location:", sessionLocationCache);
        if (isMountedRef.current) {
          setLocation(sessionLocationCache);
          setLoading(false);
          setError(null);
        }
        return sessionLocationCache;
      }

      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
        setStatusText("Acquiring GPS location…");
      }

      // 1. Native Mobile Platform (Capacitor)
      const isNative = Capacitor.isNativePlatform();
      console.log("[useUserLocation] Checking platform. Capacitor.isNativePlatform() =", isNative);
      if (isNative) {
        try {
          console.log("[useUserLocation] Calling CapGeolocation.checkPermissions()...");
          const perm = await CapGeolocation.checkPermissions();
          console.log("[useUserLocation] CapGeolocation.checkPermissions() result:", perm);
          if (perm.location !== "granted") {
            console.log("[useUserLocation] Requesting native permissions...");
            const req = await CapGeolocation.requestPermissions();
            console.log("[useUserLocation] CapGeolocation.requestPermissions() result:", req);
            if (req.location !== "granted") {
              console.log("[useUserLocation] Native permission denied branch hit.");
              if (isMountedRef.current) {
                setPermissionDenied(true);
                setError("GPS permission denied by user");
                setStatusText("GPS permission denied by user");
                setLoading(false);
              }
              return null;
            }
          }

          console.log("[useUserLocation] Calling CapGeolocation.getCurrentPosition()...");
          const pos = await CapGeolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 10000,
          });
          console.log("[useUserLocation] CapGeolocation.getCurrentPosition() success:", pos);

          const res: CachedLocation = {
            lat: Number(pos.coords.latitude.toFixed(5)),
            lng: Number(pos.coords.longitude.toFixed(5)),
            accuracy: Number(pos.coords.accuracy ? pos.coords.accuracy.toFixed(1) : "5.0"),
            capturedAt: new Date(pos.timestamp).toISOString(),
          };

          sessionLocationCache = res;

          if (isMountedRef.current) {
            setLocation(res);
            setPermissionDenied(false);
            setLoading(false);
            setError(null);
            setStatusText(
              `GPS Acquired (Native): ${res.lat.toFixed(4)}°N, ${res.lng.toFixed(4)}°E (±${Math.round(res.accuracy || 5)}m)`,
            );
          }
          return res;
        } catch (err: any) {
          console.warn("[useUserLocation] Native Geolocation failed, falling back to browser API:", err);
        }
      }

      // 2. Web Browser Fallback (navigator.geolocation)
      const hasNavGeo = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
      console.log("[useUserLocation] Checking browser geolocation support. navigator.geolocation =", hasNavGeo);
      if (!hasNavGeo) {
        console.log("[useUserLocation] Browser geolocation NOT supported branch hit.");
        if (isMountedRef.current) {
          setError("Browser geolocation not supported");
          setStatusText("Browser geolocation not supported");
          setLoading(false);
        }
        return null;
      }

      console.log("[useUserLocation] Calling navigator.geolocation.getCurrentPosition()...");
      return new Promise<CachedLocation | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            console.log("[useUserLocation] navigator.geolocation SUCCESS callback hit:", {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
            const res: CachedLocation = {
              lat: Number(pos.coords.latitude.toFixed(5)),
              lng: Number(pos.coords.longitude.toFixed(5)),
              accuracy: Number(pos.coords.accuracy ? pos.coords.accuracy.toFixed(1) : "5.0"),
              capturedAt: new Date(pos.timestamp).toISOString(),
            };

            sessionLocationCache = res;

            if (isMountedRef.current) {
              setLocation(res);
              setPermissionDenied(false);
              setLoading(false);
              setError(null);
              setStatusText(
                `GPS Acquired: ${res.lat.toFixed(4)}°N, ${res.lng.toFixed(4)}°E (±${Math.round(res.accuracy || 5)}m)`,
              );
            }
            resolve(res);
          },
          (err) => {
            console.warn("[useUserLocation] navigator.geolocation ERROR callback hit. code =", err.code, "message =", err.message);
            const isDenied = err.code === 1; // PERMISSION_DENIED
            if (isMountedRef.current) {
              if (isDenied) {
                setPermissionDenied(true);
              }
              setError(err.message || "Location request failed");
              setStatusText(`GPS error: ${err.message}`);
              setLoading(false);
            }
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        );
      });
    },
    [],
  );

  useEffect(() => {
    if (autoRequest && !sessionLocationCache) {
      requestLocation({ force: false });
    }
  }, [autoRequest, requestLocation]);

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
