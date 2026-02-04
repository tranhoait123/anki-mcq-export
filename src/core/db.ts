import { MCQ, AppSettings } from '../types';

const DB_NAME = 'AnkiGenProDB';
const DB_VERSION = 1;
const STORES = {
    MCQS: 'mcqs',
    SETTINGS: 'settings'
};

export class AppDB {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORES.MCQS)) {
                    db.createObjectStore(STORES.MCQS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS);
                }
            };

            request.onsuccess = (event: any) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event: any) => {
                reject(event.target.error);
            };
        });
    }

    async saveMCQs(mcqs: MCQ[]): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.MCQS], 'readwrite');
            const store = transaction.objectStore(STORES.MCQS);

            // Clear old data first if replacing the whole list
            // Or we can just put each. 
            // For App.tsx logic which saves the whole array, we clear and add.
            store.clear();

            mcqs.forEach(mcq => store.put(mcq));

            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getAllMCQs(): Promise<MCQ[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.MCQS], 'readonly');
            const store = transaction.objectStore(STORES.MCQS);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async saveSettings(settings: AppSettings): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.SETTINGS], 'readwrite');
            const store = transaction.objectStore(STORES.SETTINGS);
            store.put(settings, 'current');

            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getSettings(): Promise<AppSettings | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.SETTINGS], 'readonly');
            const store = transaction.objectStore(STORES.SETTINGS);
            const request = store.get('current');

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async clearAll(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.MCQS], 'readwrite');
            transaction.objectStore(STORES.MCQS).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }
}

export const db = new AppDB();
