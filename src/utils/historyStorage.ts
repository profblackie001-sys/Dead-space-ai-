import { GenerationHistoryItem } from '../types';

const DB_NAME = 'DeadSpaceAI_HistoryDB';
const DB_VERSION = 1;
const STORE_NAME = 'generations';

type HistoryListener = (items: GenerationHistoryItem[]) => void;
const listeners: Set<HistoryListener> = new Set();

// In-memory fallback if IndexedDB fails
let memoryFallback: GenerationHistoryItem[] = [];
let isIndexedDbAvailable = true;

function notifyListeners(items: GenerationHistoryItem[]) {
  listeners.forEach((fn) => {
    try {
      fn(items);
    } catch (e) {
      console.error('Error in history listener:', e);
    }
  });
}

/**
 * Open IndexedDB connection
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      isIndexedDbAvailable = false;
      return reject(new Error('IndexedDB not supported'));
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        isIndexedDbAvailable = false;
        reject(request.error);
      };
    } catch (err) {
      isIndexedDbAvailable = false;
      reject(err);
    }
  });
}

/**
 * Save a new generation to history
 */
export async function saveGenerationHistoryItem(item: GenerationHistoryItem): Promise<void> {
  if (!isIndexedDbAvailable) {
    memoryFallback = [item, ...memoryFallback.filter((i) => i.id !== item.id)];
    notifyListeners([...memoryFallback]);
    return;
  }

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);

      req.onsuccess = async () => {
        // Fetch fresh list and notify listeners
        const all = await getGenerationHistoryItems();
        notifyListeners(all);
        resolve();
      };

      req.onerror = () => {
        console.warn('Failed to save to IndexedDB, using memory fallback:', req.error);
        memoryFallback = [item, ...memoryFallback.filter((i) => i.id !== item.id)];
        notifyListeners([...memoryFallback]);
        resolve();
      };
    });
  } catch (err) {
    console.warn('IndexedDB unavailable, falling back to memory:', err);
    memoryFallback = [item, ...memoryFallback.filter((i) => i.id !== item.id)];
    notifyListeners([...memoryFallback]);
  }
}

/**
 * Fetch all generations from history sorted newest first
 */
export async function getGenerationHistoryItems(): Promise<GenerationHistoryItem[]> {
  if (!isIndexedDbAvailable) {
    return [...memoryFallback].sort((a, b) => b.timestamp - a.timestamp);
  }

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const results = (req.result || []) as GenerationHistoryItem[];
        results.sort((a, b) => b.timestamp - a.timestamp);
        resolve(results);
      };

      req.onerror = () => {
        console.warn('Error reading IndexedDB history:', req.error);
        resolve([...memoryFallback].sort((a, b) => b.timestamp - a.timestamp));
      };
    });
  } catch (err) {
    console.warn('Error accessing IndexedDB:', err);
    return [...memoryFallback].sort((a, b) => b.timestamp - a.timestamp);
  }
}

/**
 * Delete a single item by id
 */
export async function deleteGenerationHistoryItem(id: string): Promise<void> {
  memoryFallback = memoryFallback.filter((i) => i.id !== id);

  if (!isIndexedDbAvailable) {
    notifyListeners([...memoryFallback]);
    return;
  }

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = async () => {
        const all = await getGenerationHistoryItems();
        notifyListeners(all);
        resolve();
      };

      req.onerror = async () => {
        const all = await getGenerationHistoryItems();
        notifyListeners(all);
        resolve();
      };
    });
  } catch (err) {
    console.warn('Error deleting from IndexedDB:', err);
    notifyListeners([...memoryFallback]);
  }
}

/**
 * Clear all history items
 */
export async function clearAllGenerationHistory(): Promise<void> {
  memoryFallback = [];

  if (!isIndexedDbAvailable) {
    notifyListeners([]);
    return;
  }

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => {
        notifyListeners([]);
        resolve();
      };

      req.onerror = () => {
        notifyListeners([]);
        resolve();
      };
    });
  } catch (err) {
    console.warn('Error clearing IndexedDB:', err);
    notifyListeners([]);
  }
}

/**
 * Subscribe to history changes
 */
export function subscribeToHistory(listener: HistoryListener): () => void {
  listeners.add(listener);
  // Initial load
  getGenerationHistoryItems().then((items) => {
    listener(items);
  });

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Helper: Format time in seconds to mm:ss or hh:mm:ss
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}s`;
}

/**
 * Helper: Format bytes
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
