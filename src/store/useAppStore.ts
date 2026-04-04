import { create } from 'zustand';
import { UploadedFile, MCQ, AnalysisResult, AuditResult, DuplicateInfo, AppSettings } from '../types';

interface AppState {
  files: UploadedFile[];
  mcqs: MCQ[];
  settings: AppSettings;
  analysis: AnalysisResult | null;
  audit: AuditResult | null;
  duplicates: DuplicateInfo[];
  
  // Actions
  setFiles: (files: UploadedFile[] | ((prev: UploadedFile[]) => UploadedFile[])) => void;
  setMcqs: (mcqs: MCQ[] | ((prev: MCQ[]) => MCQ[])) => void;
  setSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setAudit: (audit: AuditResult | null) => void;
  setDuplicates: (duplicates: DuplicateInfo[] | ((prev: DuplicateInfo[]) => DuplicateInfo[])) => void;
}

export const useAppStore = create<AppState>((set) => ({
  files: [],
  mcqs: [],
  settings: {
    apiKey: '',
    model: 'gemini-3.1-flash-lite-preview',
    customPrompt: ''
  },
  analysis: null,
  audit: null,
  duplicates: [],

  setFiles: (updater) => set((state) => ({ 
    files: typeof updater === 'function' ? updater(state.files) : updater 
  })),
  setMcqs: (updater) => set((state) => ({ 
    mcqs: typeof updater === 'function' ? updater(state.mcqs) : updater 
  })),
  setSettings: (updater) => set((state) => ({ 
    settings: typeof updater === 'function' ? updater(state.settings) : updater 
  })),
  setAnalysis: (analysis) => set({ analysis }),
  setAudit: (audit) => set({ audit }),
  setDuplicates: (updater) => set((state) => ({ 
    duplicates: typeof updater === 'function' ? updater(state.duplicates) : updater 
  })),
}));
