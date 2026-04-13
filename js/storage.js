'use strict';

/**
 * Passlock Storage — IndexedDB wrapper.
 * Stores the encrypted vault blob. No data ever leaves this device.
 */
const Storage = (() => {

  const DB_NAME = 'passlock_db';
  const DB_VER  = 1;
  const STORE   = 'vault';
  const KEY     = 'v1';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function save(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: KEY, ...record });
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function load() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function exists() {
    return (await load()) !== null;
  }

  return { save, load, exists };
})();
