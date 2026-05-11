import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettings, MCQ, UploadedFile } from '../types';

vi.mock('react', async () => {
  const actual: any = await vi.importActual('react');
  return {
    ...actual,
    default: {
      ...actual.default,
      useState: vi.fn((initial: any) => [initial, vi.fn()]),
      useEffect: vi.fn((effect: () => void | (() => void)) => effect()),
      useCallback: vi.fn((callback: any) => callback),
    },
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../core/db', () => ({
  db: {
    deleteProject: vi.fn(),
    getProject: vi.fn(),
    getProjectSummaries: vi.fn(),
    saveFiles: vi.fn(),
    saveMCQs: vi.fn(),
    saveProject: vi.fn(),
  },
}));

vi.mock('../core/brain', () => ({
  hashFiles: vi.fn(),
}));

import { toast } from 'sonner';
import { hashFiles } from '../core/brain';
import { db } from '../core/db';
import { useProjectLibrary } from './useProjectLibrary';

const settings: AppSettings = {
  apiKey: '',
  shopAIKeyKey: '',
  provider: 'google',
  model: 'gemini-3.1-flash-lite-preview',
  customPrompt: '',
  projectLibraryEnabled: true,
};

const file: UploadedFile = {
  id: 'file-1',
  name: 'demo.pdf',
  type: 'application/pdf',
  content: 'content',
};

const mcq: MCQ = {
  id: 'q1',
  question: 'Câu 1. Nội dung?',
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: { core: '', evidence: '', analysis: '', warning: '' },
  source: '',
  difficulty: 'Medium',
  depthAnalysis: '',
};

const useTestProjectLibrary = (enabled: boolean) => useProjectLibrary({
  analysis: null,
  clearResumeSession: vi.fn(),
  confirm: vi.fn(),
  duplicates: [],
  enabled,
  files: [file],
  isLoaded: true,
  mcqs: [mcq],
  settings: { ...settings, projectLibraryEnabled: enabled },
  setAnalysis: vi.fn(),
  setCurrentCount: vi.fn(),
  setDuplicates: vi.fn(),
  setFailedBatchIndices: vi.fn(),
  setFiles: vi.fn(),
  setMcqs: vi.fn(),
  setRetryFailedAttempted: vi.fn(),
});

describe('useProjectLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not read, hash, or save project data when disabled', async () => {
    const library = useTestProjectLibrary(false);

    expect(await library.refreshProjects()).toEqual([]);
    expect(await library.autoSaveCurrentProject()).toBeNull();
    await library.saveCurrentProject();
    library.setShowLibrary(true);

    expect(db.getProjectSummaries).not.toHaveBeenCalled();
    expect(db.saveProject).not.toHaveBeenCalled();
    expect(hashFiles).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it('keeps existing refresh behavior when enabled', async () => {
    (db.getProjectSummaries as any).mockResolvedValue([{ id: 'project-1', name: 'Demo' }]);
    const library = useTestProjectLibrary(true);

    await expect(library.refreshProjects()).resolves.toEqual([{ id: 'project-1', name: 'Demo' }]);

    expect(db.getProjectSummaries).toHaveBeenCalled();
  });
});
