import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDB } from './db';
import { AppSettings, MCQ, ProcessingSession, UploadedFile } from '../types';

type StoreRecord = {
  keyPath?: string;
  data: Map<any, any>;
};

type DatabaseRecord = {
  version: number;
  stores: Map<string, StoreRecord>;
};

const clone = <T,>(value: T): T => (
  value === undefined || value === null ? value : JSON.parse(JSON.stringify(value))
);

class FakeRequest {
  onsuccess: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onupgradeneeded: ((event: any) => void) | null = null;
  result: any;
  error: any;
}

class FakeObjectStore {
  constructor(
    private readonly store: StoreRecord,
    private readonly transaction: FakeTransaction
  ) {}

  private createRequest<T>(fn: () => T) {
    const request = new FakeRequest();
    this.transaction.touch();
    setTimeout(() => {
      try {
        request.result = fn();
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
      } finally {
        this.transaction.settle();
      }
    }, 0);
    return request;
  }

  put(value: any, key?: any) {
    return this.createRequest(() => {
      const resolvedKey = key ?? (this.store.keyPath ? value?.[this.store.keyPath] : undefined);
      this.store.data.set(resolvedKey, clone(value));
      return clone(value);
    });
  }

  get(key: any) {
    return this.createRequest(() => clone(this.store.data.get(key)));
  }

  getAll() {
    return this.createRequest(() => Array.from(this.store.data.values()).map((item) => clone(item)));
  }

  clear() {
    return this.createRequest(() => {
      this.store.data.clear();
      return undefined;
    });
  }

  delete(key: any) {
    return this.createRequest(() => {
      this.store.data.delete(key);
      return undefined;
    });
  }
}

class FakeTransaction {
  oncomplete: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  private pending = 0;
  private completed = false;

  constructor(
    private readonly record: DatabaseRecord,
    private readonly storeNames: string[]
  ) {}

  touch() {
    this.pending += 1;
  }

  settle() {
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending === 0 && !this.completed) {
      this.completed = true;
      setTimeout(() => this.oncomplete?.({ target: this }), 0);
    }
  }

  objectStore(name: string) {
    const store = this.record.stores.get(name);
    if (!store || !this.storeNames.includes(name)) {
      throw new Error(`Missing object store: ${name}`);
    }
    return new FakeObjectStore(store, this);
  }
}

class FakeDatabase {
  constructor(private readonly record: DatabaseRecord) {}

  get objectStoreNames() {
    return {
      contains: (name: string) => this.record.stores.has(name),
    };
  }

  createObjectStore(name: string, options?: { keyPath?: string }) {
    if (!this.record.stores.has(name)) {
      this.record.stores.set(name, { keyPath: options?.keyPath, data: new Map() });
    }
    return {};
  }

  transaction(storeNames: string | string[]) {
    return new FakeTransaction(this.record, Array.isArray(storeNames) ? storeNames : [storeNames]);
  }
}

class FakeIndexedDB {
  private readonly databases = new Map<string, DatabaseRecord>();

  open(name: string, version?: number) {
    const request = new FakeRequest();

    setTimeout(() => {
      const existing = this.databases.get(name);
      const nextVersion = version ?? existing?.version ?? 1;
      const needsUpgrade = !existing || nextVersion > existing.version;
      const record = existing || { version: nextVersion, stores: new Map<string, StoreRecord>() };
      if (needsUpgrade) record.version = nextVersion;
      this.databases.set(name, record);

      const db = new FakeDatabase(record);
      request.result = db;

      if (needsUpgrade) {
        request.onupgradeneeded?.({ target: { result: db } });
      }
      request.onsuccess?.({ target: { result: db } });
    }, 0);

    return request;
  }
}

const baseSettings: AppSettings = {
  apiKey: 'key',
  shopAIKeyKey: '',
  provider: 'google',
  model: 'gemini-3.1-flash-lite-preview',
  customPrompt: '',
  skipAnalysis: true,
  concurrencyLimit: 1,
  adaptiveBatching: true,
  batchingMode: 'safe',
};

const baseQuestion: MCQ = {
  id: 'mcq-1',
  question: 'Câu 1',
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: {
    core: 'core',
    evidence: 'evidence',
    analysis: 'analysis',
    warning: 'warning',
  },
  source: 'demo',
  difficulty: 'Medium',
  depthAnalysis: 'Standard',
};

const baseFile: UploadedFile = {
  id: 'file-1',
  name: 'demo.pdf',
  type: 'application/pdf',
  content: 'ZmFrZQ==',
};

const baseSession: ProcessingSession = {
  id: 'current',
  status: 'interrupted',
  phase: 'fallback',
  createdAt: 1,
  updatedAt: 2,
  filesFingerprint: 'abc',
  forcedOcrMode: 'tesseract',
  settingsSnapshot: baseSettings,
  analysisSnapshot: null,
  totalTopLevelBatches: 4,
  completedBatchIndices: [1, 2],
  failedBatchIndices: [4],
  failedBatchDetails: [],
  duplicatesSnapshot: [],
  autoSkippedCount: 0,
  currentCount: 12,
  resumeRetryIndices: [4],
  mcqsSnapshot: [baseQuestion],
  phaseQuestionsSnapshot: [baseQuestion],
  phaseDuplicatesSnapshot: [],
  phaseAutoSkippedCount: 0,
  phaseCurrentCount: 1,
  phaseComparisonBaselineCount: 1,
  phaseComparisonFailedBatchIndices: [4],
  phaseComparisonFailedBatchDetails: [],
};

const openLegacyDb = async () => {
  const idb = (globalThis as any).indexedDB;
  await new Promise<void>((resolve, reject) => {
    const request = idb.open('AnkiGenProDB', 4);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      db.createObjectStore('mcqs', { keyPath: 'id' });
      db.createObjectStore('settings');
      db.createObjectStore('caches', { keyPath: 'id' });
      db.createObjectStore('markdown', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = (event: any) => {
      const db = event.target.result;
      const tx = db.transaction(['mcqs', 'files'], 'readwrite');
      tx.objectStore('mcqs').put(baseQuestion);
      tx.objectStore('files').put(baseFile);
      tx.oncomplete = () => resolve();
      tx.onerror = (e: any) => reject(e.target.error);
    };
    request.onerror = (e: any) => reject(e.target.error);
  });
};

describe('AppDB session persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new FakeIndexedDB());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves, reads, and clears the current processing session', async () => {
    const appDb = new AppDB();
    await appDb.init();

    await appDb.saveSession(baseSession);
    expect(await appDb.getSession()).toEqual(baseSession);

    await appDb.clearSession();
    expect(await appDb.getSession()).toBeNull();
  });

  it('migrates a legacy database and keeps existing data while adding the sessions store', async () => {
    await openLegacyDb();

    const appDb = new AppDB();
    await appDb.init();

    expect(await appDb.getAllMCQs()).toEqual([baseQuestion]);
    expect(await appDb.getFiles()).toEqual([baseFile]);

    await appDb.saveSession(baseSession);
    expect(await appDb.getSession()).toEqual(baseSession);
  });

  it('clears files and sessions together during full reset', async () => {
    const appDb = new AppDB();
    await appDb.init();

    await appDb.saveMCQs([baseQuestion]);
    await appDb.saveFiles([baseFile]);
    await appDb.saveSession(baseSession);

    await appDb.clearAll();

    expect(await appDb.getAllMCQs()).toEqual([]);
    expect(await appDb.getFiles()).toEqual([]);
    expect(await appDb.getSession()).toBeNull();
  });
});
