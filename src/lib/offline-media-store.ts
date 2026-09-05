/**
 * src/lib/offline-media-store.ts
 * ==============================
 * Authoritative Client-Side IndexedDB Storage for Field Observation Photos & Videos.
 * 
 * Guarantees:
 * - Large media blobs are stored in IndexedDB, NEVER in localStorage
 * - Works offline for photo capture and video attachment
 * - Provides memory fallback for SSR / test environments
 * - Enables safe staged media uploads when network connection is restored
 */

const DB_NAME = "landalert_offline_media_db";
const DB_VERSION = 1;
const STORE_NAME = "media_blobs";

export interface StoredOfflineMedia {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
  size: number;
  storedAt: string;
}

// In-memory fallback map for non-browser / test environments
const memoryMediaMap = new Map<string, StoredOfflineMedia>();

function getIndexedDB(): IDBFactory | null {
  if (typeof window !== "undefined" && window.indexedDB) {
    return window.indexedDB;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).indexedDB) {
    return (globalThis as any).indexedDB;
  }
  return null;
}

function openDatabase(): Promise<IDBDatabase | null> {
  const idb = getIndexedDB();
  if (!idb) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn("[IndexedDB] Could not open media database, using fallback:", request.error);
        resolve(null);
      };
    } catch (err) {
      console.warn("[IndexedDB] Exception opening database:", err);
      resolve(null);
    }
  });
}

/**
 * Saves a media file or blob into IndexedDB with a unique identifier.
 */
export async function saveOfflineMedia(
  id: string,
  data: Blob | File | string,
  meta: { name: string; mimeType: string; size: number },
): Promise<void> {
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (typeof data === "string" && data.startsWith("data:")) {
    const parts = data.split(",");
    const mime = parts[0]?.match(/:(.*?);/)?.[1] || meta.mimeType || "application/octet-stream";
    const bstr = atob(parts[1] || "");
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    blob = new Blob([u8arr], { type: mime });
  } else {
    blob = new Blob([data], { type: meta.mimeType });
  }

  const record: StoredOfflineMedia = {
    id,
    blob,
    name: meta.name,
    mimeType: meta.mimeType || blob.type,
    size: meta.size || blob.size,
    storedAt: new Date().toISOString(),
  };

  const db = await openDatabase();
  if (!db) {
    memoryMediaMap.set(id, record);
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = () => {
        memoryMediaMap.set(id, record);
        resolve();
      };
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        memoryMediaMap.set(id, record);
        resolve();
      };
    } catch {
      memoryMediaMap.set(id, record);
      resolve();
    }
  });
}

/**
 * Retrieves a media file from IndexedDB by ID.
 */
export async function getOfflineMedia(id: string): Promise<StoredOfflineMedia | null> {
  if (memoryMediaMap.has(id)) {
    return memoryMediaMap.get(id) || null;
  }

  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        resolve(req.result || null);
      };
      req.onerror = () => {
        resolve(null);
      };
      tx.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Deletes a media item from IndexedDB after successful upload.
 */
export async function deleteOfflineMedia(id: string): Promise<void> {
  memoryMediaMap.delete(id);

  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      tx.oncomplete = () => db.close();
    } catch {
      resolve();
    }
  });
}

/**
 * Lists all IDs stored in the offline media store.
 */
export async function getAllOfflineMediaIds(): Promise<string[]> {
  const ids = Array.from(memoryMediaMap.keys());
  const db = await openDatabase();
  if (!db) return ids;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();

      req.onsuccess = () => {
        const dbKeys = (req.result || []).map(String);
        const combined = Array.from(new Set([...ids, ...dbKeys]));
        resolve(combined);
      };
      req.onerror = () => resolve(ids);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(ids);
    }
  });
}
