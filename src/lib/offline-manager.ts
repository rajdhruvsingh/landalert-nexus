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
  } catch (err) {
    console.error("Failed to prune offline queue:", err);
  }
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

  try {
    const result = await submitFieldObservationsServerFn({
      data: { observations: queue },
    });

    if (result.acknowledgedKeys?.length) {
      pruneQueue(result.acknowledgedKeys);
    }

    return result;
  } catch (err) {
    console.error("Offline sync error:", err);
    return {
      success: false,
      receivedCount: queue.length,
      syncedCount: 0,
      skippedDuplicates: 0,
      acknowledgedKeys: [],
      errors: [err instanceof Error ? err.message : "Sync connection failed"],
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
  }, [refreshQueueCount]);

  const triggerSync = useCallback(async () => {
    if (!isOnline) return null;
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
