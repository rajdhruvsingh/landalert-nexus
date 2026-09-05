/**
 * src/lib/offline-manager.ts
 * ==========================
 * Client-Side Offline Storage, Queue, and Synchronization Engine.
 *
 * Implements:
 * - Reactive browser online/offline status detection
 * - Resilient localStorage queue for field observations with idempotency keys
 * - Offline package download & 24-hour cache expiration tracking
 * - Automatic background synchronization upon network reconnection
 */

import { useEffect, useState, useCallback } from "react";
import type { FieldObservationInput, OfflinePackage, SyncResult } from "./sync.service";
import { submitFieldObservationsServerFn, getOfflinePackageServerFn } from "./monitoring.functions";

const OFFLINE_QUEUE_KEY = "landalert_field_observations_queue_v1";
const OFFLINE_PACKAGE_KEY = "landalert_offline_bundle_v1";

export interface CachedBundleStatus {
  package: OfflinePackage | null;
  cachedAt: string | null;
  validUntil: string | null;
  isExpired: boolean;
  ageHours: number;
}

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as unknown as { localStorage?: Storage }).localStorage
  ) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}

/**
 * Custom React hook that monitors real-time network connectivity.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

export type ConnectivityState = "api_reachable" | "api_unavailable" | "browser_offline";

/**
 * Truthfully checks browser network state and backend API reachability.
 */
export function useConnectivityStatus(): {
  isOnline: boolean;
  apiReachable: boolean;
  connectivityState: ConnectivityState;
  checkHealth: () => Promise<boolean>;
} {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
  const [apiReachable, setApiReachable] = useState<boolean>(true);

  const checkHealth = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) {
      setIsOnline(false);
      setApiReachable(false);
      return false;
    }
    setIsOnline(true);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch("/api/health", { signal: ctrl.signal });
      clearTimeout(timer);
      const ok = res.ok;
      setApiReachable(ok);
      return ok;
    } catch {
      setApiReachable(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      setIsOnline(true);
      checkHealth();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setApiReachable(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    checkHealth();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkHealth]);

  const connectivityState: ConnectivityState = !isOnline
    ? "browser_offline"
    : !apiReachable
    ? "api_unavailable"
    : "api_reachable";

  return { isOnline, apiReachable, connectivityState, checkHealth };
}

/**
 * Retrieves the local offline observation queue from localStorage.
 */
export function getQueuedObservations(): FieldObservationInput[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read offline observation queue:", err);
    return [];
  }
}

/**
 * Appends a new field observation to the offline queue with an idempotency key.
 */
export function queueObservation(
  observation: Omit<FieldObservationInput, "idempotency_key" | "client_timestamp"> & {
    idempotency_key?: string;
    client_timestamp?: string;
  },
): FieldObservationInput {
  const currentQueue = getQueuedObservations();
  const idKey =
    observation.idempotency_key ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  const fullRecord: FieldObservationInput = {
    ...observation,
    idempotency_key: idKey,
    client_timestamp: observation.client_timestamp || new Date().toISOString(),
  };

  const updatedQueue = [...currentQueue, fullRecord];
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updatedQueue));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("landalert-queue-updated"));
      }
    } catch (err) {
      console.error("Failed to save observation to storage:", err);
    }
  }

  return fullRecord;
}

/**
 * Removes successfully synchronized records from the queue using acknowledged keys.
 */
export function pruneQueue(acknowledgedKeys: string[]): void {
  if (!acknowledgedKeys.length) return;
  const storage = getStorage();
  if (!storage) return;

  const current = getQueuedObservations();
  const ackSet = new Set(acknowledgedKeys);
  const remaining = current.filter(
    (item) => !item.idempotency_key || !ackSet.has(item.idempotency_key),
  );
  try {
    storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("landalert-queue-updated"));
    }
  } catch (err) {
    console.error("Failed to prune offline queue:", err);
  }
}

/**
 * Clears the entire offline queue (e.g. on manual reset or test teardown).
 */
export function clearOfflineQueue(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(OFFLINE_QUEUE_KEY);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("landalert-queue-updated"));
    }
  } catch (err) {
    console.error("Failed to clear offline queue:", err);
  }
}

async function uploadQueuedMediaItem(
  mediaIdOrDataUrl: string,
  filename: string,
  zoneId: number,
  fallbackMime = "image/jpeg",
): Promise<string | null> {
  if (typeof window === "undefined" || typeof fetch === "undefined") return null;
  try {
    let blob: Blob | null = null;
    // Check IndexedDB store first
    const { getOfflineMedia, deleteOfflineMedia } = await import("./offline-media-store");
    const stored = await getOfflineMedia(mediaIdOrDataUrl);
    if (stored) {
      blob = stored.blob;
      filename = stored.name || filename;
    } else if (mediaIdOrDataUrl.startsWith("data:")) {
      const arr = mediaIdOrDataUrl.split(",");
      if (arr.length >= 2) {
        const mimeMatch = arr[0]?.match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : fallbackMime;
        const bstr = atob(arr[1] || "");
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        blob = new Blob([u8arr], { type: mime || fallbackMime });
      }
    }

    if (!blob) return null;

    const fd = new FormData();
    fd.append("file", blob, filename);
    fd.append("zoneId", String(zoneId));

    let authHeader = "";
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const session = (await supabase.auth.getSession()).data.session;
      if (session?.access_token) {
        authHeader = `Bearer ${session.access_token}`;
      } else {
        const citizenToken =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("landalert_citizen_token")
            : null;
        authHeader = `Bearer ${citizenToken || `citizen_sync_${Date.now()}`}`;
      }
    } catch {
      authHeader = `Bearer citizen_sync_${Date.now()}`;
    }

    const headers: Record<string, string> = {
      Authorization: authHeader,
    };

    const res = await fetch("/api/field-observations/upload", {
      method: "POST",
      headers,
      body: fd,
    });
    if (res.ok) {
      const data = await res.json();
      if (stored) {
        await deleteOfflineMedia(mediaIdOrDataUrl).catch(() => {});
      }
      return data.url;
    }
  } catch (err) {
    console.warn("Failed to upload offline-queued media:", err);
  }
  return null;
}

/**
 * Synchronizes all queued observations with the authoritative backend.
 */
export async function syncOfflineObservations(): Promise<SyncResult> {
  const queue = getQueuedObservations();
  if (queue.length === 0) {
    return {
      success: true,
      receivedCount: 0,
      syncedCount: 0,
      skippedDuplicates: 0,
      acknowledgedKeys: [],
    };
  }

  // Pre-process offline media items if network is restored
  const processedQueue = await Promise.all(
    queue.map(async (obs) => {
      if (!obs.media_metadata || !Array.isArray(obs.media_metadata)) return obs;

      const newUrls: string[] = [...(obs.media_urls || [])];
      const newMetadata = await Promise.all(
        obs.media_metadata.map(async (meta: any) => {
          const mediaKey = meta.id || meta.url;
          if (mediaKey && (mediaKey.startsWith("offline_") || mediaKey.startsWith("data:"))) {
            const uploadedUrl = await uploadQueuedMediaItem(
              mediaKey,
              meta.name || "field_evidence",
              obs.zone_id,
              meta.mimeType,
            );
            if (uploadedUrl) {
              if (!newUrls.includes(uploadedUrl)) newUrls.push(uploadedUrl);
              return { ...meta, url: uploadedUrl };
            }
          }
          return meta;
        }),
      );
      return {
        ...obs,
        media_urls: newUrls.filter((u) => !u.startsWith("data:") && !u.startsWith("offline_")),
        media_metadata: newMetadata,
      };
    }),
  );

  try {
    const result = await submitFieldObservationsServerFn({
      data: { observations: processedQueue },
    });

    if (result.acknowledgedKeys?.length) {
      pruneQueue(result.acknowledgedKeys);
    }

    if (!result.success || (result.errors && result.errors.length > 0)) {
      const storage = getStorage();
      if (storage) {
        const remaining = getQueuedObservations();
        const updated = remaining.map((item) => ({
          ...item,
          retry_count: (item.retry_count || 0) + 1,
          queue_status: "FAILED" as const,
          last_error: result.errors?.[0] || "Sync rejected by server",
        }));
        storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated));
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("landalert-queue-updated"));
        }
      }
    }

    return result;
  } catch (err) {
    console.error("Offline sync error:", err);
    const errorMsg = err instanceof Error ? err.message : "Sync connection failed";
    const storage = getStorage();
    if (storage) {
      const remaining = getQueuedObservations();
      const updated = remaining.map((item) => ({
        ...item,
        retry_count: (item.retry_count || 0) + 1,
        queue_status: "FAILED" as const,
        last_error: errorMsg,
      }));
      storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("landalert-queue-updated"));
      }
    }

    return {
      success: false,
      receivedCount: queue.length,
      syncedCount: 0,
      skippedDuplicates: 0,
      acknowledgedKeys: [],
      errors: [errorMsg],
    };
  }
}

/**
 * Reads cached offline package and checks 24-hour expiration policy.
 */
export function getCachedOfflinePackage(): CachedBundleStatus {
  const storage = getStorage();
  if (!storage) {
    return {
      package: null,
      cachedAt: null,
      validUntil: null,
      isExpired: false,
      ageHours: 0,
    };
  }

  try {
    const raw = storage.getItem(OFFLINE_PACKAGE_KEY);
    if (!raw) {
      return {
        package: null,
        cachedAt: null,
        validUntil: null,
        isExpired: false,
        ageHours: 0,
      };
    }

    const pkg = JSON.parse(raw) as OfflinePackage;
    const cachedAt = pkg.cache_policy?.cached_at ?? new Date().toISOString();
    const validUntil = pkg.cache_policy?.valid_until ?? new Date(Date.now() + 864e5).toISOString();
    const ageMs = Date.now() - new Date(cachedAt).getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    const isExpired = Date.now() > new Date(validUntil).getTime();

    return {
      package: pkg,
      cachedAt,
      validUntil,
      isExpired,
      ageHours: Number(ageHours.toFixed(1)),
    };
  } catch (err) {
    console.error("Failed to parse cached offline package:", err);
    return {
      package: null,
      cachedAt: null,
      validUntil: null,
      isExpired: false,
      ageHours: 0,
    };
  }
}

/**
 * Downloads the fresh offline bundle from the backend and persists it locally.
 */
export async function downloadAndCacheOfflinePackage(): Promise<OfflinePackage> {
  const pkg = await getOfflinePackageServerFn();
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(OFFLINE_PACKAGE_KEY, JSON.stringify(pkg));
    } catch (err) {
      console.warn("Unable to persist offline bundle to storage:", err);
    }
  }
  return pkg as OfflinePackage;
}

/**
 * Hook to manage offline queue status and provide sync trigger.
 */
export function useOfflineQueue() {
  const isOnline = useOnlineStatus();
  const [queueCount, setQueueCount] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const refreshQueueCount = useCallback(() => {
    setQueueCount(getQueuedObservations().length);
  }, []);

  useEffect(() => {
    refreshQueueCount();
    if (typeof window !== "undefined") {
      window.addEventListener("landalert-queue-updated", refreshQueueCount);
      window.addEventListener("storage", refreshQueueCount);
      return () => {
        window.removeEventListener("landalert-queue-updated", refreshQueueCount);
        window.removeEventListener("storage", refreshQueueCount);
      };
    }
    return undefined;
  }, [refreshQueueCount]);

  const triggerSync = useCallback(async () => {
    const liveOnline = typeof navigator !== "undefined" ? navigator.onLine : isOnline;
    if (!liveOnline) {
      throw new Error("Device is currently offline. Connect to network to synchronize pending queue.");
    }
    setSyncing(true);
    try {
      const res = await syncOfflineObservations();
      setLastSyncResult(res);
      refreshQueueCount();
      return res;
    } finally {
      setSyncing(false);
    }
  }, [isOnline, refreshQueueCount]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline) {
      const currentQueue = getQueuedObservations();
      if (currentQueue.length > 0) {
        triggerSync();
      }
    }
  }, [isOnline, triggerSync]);

  return {
    isOnline,
    queueCount,
    syncing,
    lastSyncResult,
    refreshQueueCount,
    triggerSync,
  };
}
