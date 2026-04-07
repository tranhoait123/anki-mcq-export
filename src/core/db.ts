import { MCQ, AppSettings } from '../types';

const DB_NAME = 'AnkiGenProDB';
const DB_VERSION = 3;
const STORES = {
    MCQS: 'mcqs',
    SETTINGS: 'settings',
    CACHES: 'caches',
    MARKDOWN: 'markdown'
};

export interface CacheEntry {
    id: string; // fileHash_modelName_apiKeyHash
    cacheName: string;
    expiresAt: number;
    modelName: string;
}

export interface MarkdownEntry {
    id: string; // fileHash
    content: string;
    createdAt: number;
}

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
                if (!db.objectStoreNames.contains(STORES.CACHES)) {
                    db.createObjectStore(STORES.CACHES, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.MARKDOWN)) {
                    db.createObjectStore(STORES.MARKDOWN, { keyPath: 'id' });
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
            store.clear();

            mcqs.forEach(mcq => {
                // Đảm bảo mỗi MCQ luôn có ID trước khi lưu (phòng trường hợp AI trích xuất thiếu)
                if (!mcq.id) {
                    mcq.id = `mcq-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
                }
                store.put(mcq);
            });

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

    async saveCache(entry: CacheEntry): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.CACHES], 'readwrite');
            const store = transaction.objectStore(STORES.CACHES);
            store.put(entry);
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async saveMarkdown(entry: MarkdownEntry): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.MARKDOWN], 'readwrite');
            const store = transaction.objectStore(STORES.MARKDOWN);
            const request = store.put(entry);

            request.onsuccess = () => resolve();
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getMarkdown(id: string): Promise<MarkdownEntry | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.MARKDOWN], 'readonly');
            const store = transaction.objectStore(STORES.MARKDOWN);
            const request = store.get(id);

            request.onsuccess = (e: any) => resolve(e.target.result || null);
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getCache(id: string): Promise<CacheEntry | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.CACHES], 'readonly');
            const store = transaction.objectStore(STORES.CACHES);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async deleteCache(id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.CACHES], 'readwrite');
            const store = transaction.objectStore(STORES.CACHES);
            store.delete(id);
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async clearAll(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.MCQS, STORES.CACHES, STORES.MARKDOWN], 'readwrite');
            transaction.objectStore(STORES.MCQS).clear();
            transaction.objectStore(STORES.CACHES).clear();
            transaction.objectStore(STORES.MARKDOWN).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }
}

export const db = new AppDB();
