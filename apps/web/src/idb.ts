import type { StateStorage } from 'zustand/middleware';

/**
 * Минимальная обёртка над IndexedDB для zustand persist.
 * Oдин ключ — это «bucket» (например 'settings'), внутри — JSON.
 */

const DB_NAME = 'stfw-db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

async function getAll(): Promise<Record<string, string>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    const keys = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => {
      keys.onsuccess = () => {
        const out: Record<string, string> = {};
        const values = req.result as string[];
        (keys.result as IDBValidKey[]).forEach((key, i) => {
          out[String(key)] = values[i];
        });
        resolve(out);
      };
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
  });
}

async function set(key: string, value: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
  });
}

async function remove(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
  });
}

/** Падает на localStorage, если IndexedDB недоступна (приватный режим/старые ТВ). */
export const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const all = await getAll();
      return all[name] ?? null;
    } catch {
      return localStorage.getItem(name);
    }
  },
  setItem: async (name, value) => {
    try {
      await set(name, value);
    } catch {
      localStorage.setItem(name, value);
    }
  },
  removeItem: async (name) => {
    try {
      await remove(name);
    } catch {
      localStorage.removeItem(name);
    }
  },
};