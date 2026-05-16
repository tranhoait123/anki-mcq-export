import { vi } from 'vitest';

// Mock simple indexedDB to avoid "indexedDB is not defined" in Node environment
const mockIndexedDB = {
  open: (name: string, version: number) => {
    const request: any = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      result: {
        objectStoreNames: {
          contains: () => true,
        },
        createObjectStore: () => ({
          createIndex: () => {},
        }),
        transaction: () => ({
          objectStore: () => ({
            get: (id: any) => {
              const req: any = { onsuccess: null, onerror: null, result: null };
              setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
              return req;
            },
            put: (item: any) => {
              const req: any = { onsuccess: null, onerror: null };
              setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
              return req;
            },
            delete: (id: any) => {
              const req: any = { onsuccess: null, onerror: null };
              setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
              return req;
            },
            clear: () => {
              const req: any = { onsuccess: null, onerror: null };
              setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
              return req;
            },
            index: () => ({
              getAll: () => {
                const req: any = { onsuccess: null, onerror: null, result: [] };
                setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
                return req;
              }
            })
          }),
          oncomplete: null,
          onerror: null,
        }),
        close: () => {},
      },
    };
    // Simulate async success
    setTimeout(() => {
      if (request.onsuccess) {
        request.onsuccess({ target: request });
      }
    }, 0);
    return request;
  },
  deleteDatabase: () => ({ onsuccess: null, onerror: null }),
};

// Use vi.stubGlobal for Vitest
if (typeof global !== 'undefined') {
  (global as any).indexedDB = mockIndexedDB;
  (global as any).IDBDatabase = class {};
  (global as any).IDBTransaction = class {};
  (global as any).IDBRequest = class {};
  (global as any).IDBObjectStore = class {};
  (global as any).IDBIndex = class {};
  
  // Make Math.random deterministic for tests to avoid jitter issues
  const originalRandom = Math.random;
  Math.random = () => 0;
  (Math as any)._originalRandom = originalRandom;
}
