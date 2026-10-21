/**
 * High-Performance IndexedDB Storage Utility for Large Video Blobs and Render Jobs.
 * Replaces localStorage (5MB text-only limit) with multi-gigabyte persistent browser storage.
 */

const DB_NAME = 'VideoRenderDB';
const DB_VERSION = 1;

export const STORES = {
  RENDERED_FILES: 'renderedFiles',
  RENDER_QUEUE: 'renderQueue',
  SAVED_PREVIEWS: 'savedPreviews',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function getIndexedDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in browser environments'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORES.RENDERED_FILES)) {
        db.createObjectStore(STORES.RENDERED_FILES);
      }
      if (!db.objectStoreNames.contains(STORES.RENDER_QUEUE)) {
        db.createObjectStore(STORES.RENDER_QUEUE);
      }
      if (!db.objectStoreNames.contains(STORES.SAVED_PREVIEWS)) {
        db.createObjectStore(STORES.SAVED_PREVIEWS);
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      dbPromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

/**
 * Saves a binary video or zip Blob to IndexedDB without choking browser memory.
 */
export async function saveRenderedBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await getIndexedDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.RENDERED_FILES, 'readwrite');
      const store = tx.objectStore(STORES.RENDERED_FILES);
      const req = store.put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Could not save rendered blob for ${key}:`, err);
  }
}

/**
 * Retrieves a binary video or zip Blob from IndexedDB.
 */
export async function getRenderedBlob(key: string): Promise<Blob | null> {
  try {
    const db = await getIndexedDB();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORES.RENDERED_FILES, 'readonly');
      const store = tx.objectStore(STORES.RENDERED_FILES);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Could not retrieve rendered blob for ${key}:`, err);
    return null;
  }
}

/**
 * Deletes a stored blob from IndexedDB.
 */
export async function deleteRenderedBlob(key: string): Promise<void> {
  try {
    const db = await getIndexedDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.RENDERED_FILES, 'readwrite');
      const store = tx.objectStore(STORES.RENDERED_FILES);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Could not delete rendered blob for ${key}:`, err);
  }
}

/**
 * Saves persistent queue items or settings to IndexedDB.
 */
export async function saveToStorage<T>(storeName: string, key: string, data: T): Promise<void> {
  try {
    const db = await getIndexedDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Could not save data to ${storeName}/${key}:`, err);
  }
}

/**
 * Loads data from IndexedDB.
 */
export async function getFromStorage<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await getIndexedDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Could not retrieve data from ${storeName}/${key}:`, err);
    return null;
  }
}
