import { MCQ, AppSettings, ProcessingSession, StudyProject, StudyProjectSummary, UploadedFile } from '../types';

const DB_NAME = 'AnkiGenProDB';
const DB_VERSION = 7;
const STORES = {
    MCQS: 'mcqs',
    SETTINGS: 'settings',
    CACHES: 'caches',
    MARKDOWN: 'markdown',
    FILES: 'files',
    SESSIONS: 'sessions',
    PROJECTS: 'projects',
    PROJECT_SUMMARIES: 'projectSummaries'
};

const toProjectSummary = (project: StudyProject): StudyProjectSummary => ({
    id: project.id,
    name: project.name,
    filesFingerprint: project.filesFingerprint,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    settingsSummary: project.settingsSummary,
    stats: project.stats,
});

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
                if (!db.objectStoreNames.contains(STORES.FILES)) {
                    db.createObjectStore(STORES.FILES, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
                    db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
                    db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.PROJECT_SUMMARIES)) {
                    db.createObjectStore(STORES.PROJECT_SUMMARIES, { keyPath: 'id' });
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

    async saveFiles(files: UploadedFile[]): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.FILES], 'readwrite');
            const store = transaction.objectStore(STORES.FILES);
            store.clear();
            files.forEach(file => store.put(file));
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getFiles(): Promise<UploadedFile[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.FILES], 'readonly');
            const store = transaction.objectStore(STORES.FILES);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async clearFiles(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.FILES], 'readwrite');
            transaction.objectStore(STORES.FILES).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async saveSession(session: ProcessingSession): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.SESSIONS], 'readwrite');
            const store = transaction.objectStore(STORES.SESSIONS);
            store.put(session);
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getSession(): Promise<ProcessingSession | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.SESSIONS], 'readonly');
            const store = transaction.objectStore(STORES.SESSIONS);
            const request = store.get('current');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async updateSessionCheckpoint(partial: Partial<ProcessingSession>): Promise<ProcessingSession | null> {
        if (!this.db) await this.init();
        const current = await this.getSession();
        if (!current) return null;
        const next: ProcessingSession = {
            ...current,
            ...partial,
            id: 'current',
            updatedAt: partial.updatedAt ?? Date.now(),
        };
        await this.saveSession(next);
        return next;
    }

    async clearSession(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.SESSIONS], 'readwrite');
            transaction.objectStore(STORES.SESSIONS).delete('current');
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async saveProject(project: StudyProject): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.PROJECTS, STORES.PROJECT_SUMMARIES], 'readwrite');
            transaction.objectStore(STORES.PROJECTS).put(project);
            transaction.objectStore(STORES.PROJECT_SUMMARIES).put(toProjectSummary(project));
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getProject(id: string): Promise<StudyProject | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.PROJECTS], 'readonly');
            const store = transaction.objectStore(STORES.PROJECTS);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getAllProjects(): Promise<StudyProject[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.PROJECTS], 'readonly');
            const store = transaction.objectStore(STORES.PROJECTS);
            const request = store.getAll();
            request.onsuccess = () => {
                const projects = (request.result || []) as StudyProject[];
                resolve(projects.sort((a, b) => b.updatedAt - a.updatedAt));
            };
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async getProjectSummaries(): Promise<StudyProjectSummary[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.PROJECT_SUMMARIES], 'readonly');
            const store = transaction.objectStore(STORES.PROJECT_SUMMARIES);
            const request = store.getAll();
            request.onsuccess = () => {
                const projects = (request.result || []) as StudyProjectSummary[];
                if (projects.length > 0) {
                    resolve(projects.sort((a, b) => b.updatedAt - a.updatedAt));
                    return;
                }

                void this.getAllProjects()
                    .then((fullProjects) => {
                        const summaries = fullProjects.map(toProjectSummary).sort((a, b) => b.updatedAt - a.updatedAt);
                        if (summaries.length === 0) {
                            resolve([]);
                            return;
                        }
                        const writeTx = this.db!.transaction([STORES.PROJECT_SUMMARIES], 'readwrite');
                        const writeStore = writeTx.objectStore(STORES.PROJECT_SUMMARIES);
                        summaries.forEach(summary => writeStore.put(summary));
                        writeTx.oncomplete = () => resolve(summaries);
                        writeTx.onerror = (e: any) => reject(e.target.error);
                    })
                    .catch(reject);
            };
            request.onerror = (e: any) => reject(e.target.error);
        });
    }

    async deleteProject(id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.PROJECTS, STORES.PROJECT_SUMMARIES], 'readwrite');
            transaction.objectStore(STORES.PROJECTS).delete(id);
            transaction.objectStore(STORES.PROJECT_SUMMARIES).delete(id);
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
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

    async clearCaches(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.CACHES, STORES.MARKDOWN], 'readwrite');
            transaction.objectStore(STORES.CACHES).clear();
            transaction.objectStore(STORES.MARKDOWN).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }

    async clearAll(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORES.MCQS, STORES.CACHES, STORES.MARKDOWN, STORES.FILES, STORES.SESSIONS], 'readwrite');
            transaction.objectStore(STORES.MCQS).clear();
            transaction.objectStore(STORES.CACHES).clear();
            transaction.objectStore(STORES.MARKDOWN).clear();
            transaction.objectStore(STORES.FILES).clear();
            transaction.objectStore(STORES.SESSIONS).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e: any) => reject(e.target.error);
        });
    }
}

export const db = new AppDB();
