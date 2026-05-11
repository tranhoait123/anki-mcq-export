import React from 'react';
import { toast } from 'sonner';
import {
  AnalysisResult,
  AppSettings,
  DuplicateInfo,
  MCQ,
  StudyProject,
  StudyProjectSummary,
  UploadedFile,
} from '../types';
import { db } from '../core/db';
import { hashFiles } from '../core/brain';
import { getPersistableFiles, sortMcqsByQuestionNumber } from '../utils/appHelpers';
import { buildProjectSnapshot } from '../utils/projectLibrary';
import { ConfirmDialogOptions } from './useConfirmDialog';

interface UseProjectLibraryParams {
  analysis: AnalysisResult | null;
  clearResumeSession: () => Promise<void>;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  duplicates: DuplicateInfo[];
  enabled: boolean;
  files: UploadedFile[];
  isLoaded: boolean;
  mcqs: MCQ[];
  settings: AppSettings;
  setAnalysis: React.Dispatch<React.SetStateAction<AnalysisResult | null>>;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateInfo[]>>;
  setFailedBatchIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  setMcqs: React.Dispatch<React.SetStateAction<MCQ[]>>;
  setRetryFailedAttempted: React.Dispatch<React.SetStateAction<boolean>>;
}

export const useProjectLibrary = ({
  analysis,
  clearResumeSession,
  confirm,
  duplicates,
  enabled,
  files,
  isLoaded,
  mcqs,
  settings,
  setAnalysis,
  setCurrentCount,
  setDuplicates,
  setFailedBatchIndices,
  setFiles,
  setMcqs,
  setRetryFailedAttempted,
}: UseProjectLibraryParams) => {
  const [showLibrary, setShowLibraryState] = React.useState(false);
  const [projects, setProjects] = React.useState<StudyProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);

  const refreshProjects = React.useCallback(async () => {
    if (!enabled) {
      setProjects([]);
      return [];
    }
    const nextProjects = await db.getProjectSummaries();
    setProjects(nextProjects);
    return nextProjects;
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) {
      setProjects([]);
      setShowLibraryState(false);
      setActiveProjectId(null);
      return;
    }
    void refreshProjects();
  }, [enabled, refreshProjects]);

  const autoSaveCurrentProject = React.useCallback(async (override?: {
    mcqs?: MCQ[];
    duplicates?: DuplicateInfo[];
    analysis?: AnalysisResult | null;
    settings?: AppSettings;
  }) => {
    if (!enabled) return null;
    const snapshotMcqs = override?.mcqs || mcqs;
    if (files.length === 0 || snapshotMcqs.length === 0) return null;

    const persistableFiles = getPersistableFiles(files);
    const fingerprint = await hashFiles(persistableFiles);
    const existing = activeProjectId ? await db.getProject(activeProjectId) : null;
    const existingProjects = existing?.filesFingerprint === fingerprint ? [] : await db.getProjectSummaries();
    const matchingProject = existingProjects.find(project => project.filesFingerprint === fingerprint) || null;
    const reusableProject = existing?.filesFingerprint === fingerprint ? existing : matchingProject;

    const project = await buildProjectSnapshot({
      existing: reusableProject,
      files: persistableFiles,
      mcqs: snapshotMcqs,
      duplicates: override?.duplicates || duplicates,
      analysis: override?.analysis === undefined ? analysis : override.analysis,
      settings: override?.settings || settings,
    });

    await db.saveProject(project);
    setActiveProjectId(project.id);
    await refreshProjects();
    return project;
  }, [activeProjectId, analysis, duplicates, enabled, files, mcqs, refreshProjects, settings]);

  const saveCurrentProject = React.useCallback(async () => {
    if (!enabled) {
      toast.info('Thư viện bộ đề đang tắt để giảm lag. Bật lại trong Cài đặt nâng cao nếu cần lưu/mở bộ đề.');
      return;
    }
    const project = await autoSaveCurrentProject();
    if (project) {
      toast.success(`Đã lưu "${project.name}" vào thư viện.`);
    } else {
      toast.error('Chưa có đủ file và câu hỏi để lưu project.');
    }
  }, [autoSaveCurrentProject, enabled]);

  const ensureCurrentProjectSaved = React.useCallback(async () => {
    if (!enabled) return;
    if (!isLoaded || activeProjectId || files.length === 0 || mcqs.length === 0) return;

    try {
      const persistableFiles = getPersistableFiles(files);
      const fingerprint = await hashFiles(persistableFiles);
      const existingProjects = await db.getProjectSummaries();
      const existingProject = existingProjects.find(project => project.filesFingerprint === fingerprint);
      if (existingProject) {
        const refreshedProject = await buildProjectSnapshot({
          existing: existingProject,
          files: persistableFiles,
          mcqs,
          duplicates,
          analysis,
          settings,
        });
        await db.saveProject(refreshedProject);
        setActiveProjectId(refreshedProject.id);
        await refreshProjects();
        return;
      }

      const project = await buildProjectSnapshot({
        files: persistableFiles,
        mcqs,
        duplicates,
        analysis,
        settings,
      });
      await db.saveProject(project);
      setActiveProjectId(project.id);
      await refreshProjects();
    } catch (error) {
      console.warn('Project library backfill failed:', error);
    }
  }, [activeProjectId, analysis, duplicates, enabled, files, isLoaded, mcqs, refreshProjects, settings]);

  const setShowLibrary = React.useCallback((show: boolean) => {
    if (!show) {
      setShowLibraryState(false);
      return;
    }

    if (!enabled) {
      setShowLibraryState(false);
      toast.info('Thư viện bộ đề đang tắt để giảm lag. Bật lại trong Cài đặt nâng cao nếu cần dùng.');
      return;
    }

    setShowLibraryState(true);
    void ensureCurrentProjectSaved();
  }, [enabled, ensureCurrentProjectSaved]);

  const openProject = React.useCallback(async (project: StudyProject) => {
    if (!enabled) return;
    await clearResumeSession();
    const sortedMcqs = sortMcqsByQuestionNumber(project.mcqs || []);
    setFiles(project.files || []);
    setMcqs(sortedMcqs);
    setDuplicates(project.duplicates || []);
    setAnalysis(project.analysis || null);
    setCurrentCount(sortedMcqs.length);
    setFailedBatchIndices([]);
    setRetryFailedAttempted(false);
    setActiveProjectId(project.id);
    await db.saveFiles(project.files || []);
    await db.saveMCQs(sortedMcqs);
    toast.success(`Đã mở "${project.name}" từ thư viện.`);
  }, [
    clearResumeSession,
    enabled,
    setAnalysis,
    setCurrentCount,
    setDuplicates,
    setFailedBatchIndices,
    setFiles,
    setMcqs,
    setRetryFailedAttempted,
  ]);

  const renameProject = React.useCallback(async (projectId: string, name: string) => {
    if (!enabled) return;
    const project = await db.getProject(projectId);
    const cleanName = name.trim();
    if (!project || !cleanName) return;
    await db.saveProject({ ...project, name: cleanName, updatedAt: Date.now() });
    await refreshProjects();
    toast.success('Đã đổi tên bộ đề.');
  }, [enabled, refreshProjects]);

  const deleteProject = React.useCallback(async (project: StudyProjectSummary) => {
    if (!enabled) return;
    const ok = await confirm({
      title: 'Xóa project khỏi thư viện?',
      body: `"${project.name}" sẽ bị xóa khỏi thư viện. Dữ liệu đang mở hiện tại không bị ảnh hưởng.`,
      confirmLabel: 'Xóa project',
      variant: 'danger',
      onConfirm: async () => {
        await db.deleteProject(project.id);
      },
    });
    if (!ok) return;
    if (activeProjectId === project.id) setActiveProjectId(null);
    await refreshProjects();
    toast.success('Đã xóa project khỏi thư viện.');
  }, [activeProjectId, confirm, enabled, refreshProjects]);

  const clearActiveProject = React.useCallback(() => setActiveProjectId(null), []);
  const loadProject = React.useCallback((projectId: string) => {
    if (!enabled) return Promise.resolve(null);
    return db.getProject(projectId);
  }, [enabled]);

  return {
    activeProjectId,
    autoSaveCurrentProject,
    clearActiveProject,
    deleteProject,
    loadProject,
    openProject,
    projects,
    refreshProjects,
    renameProject,
    saveCurrentProject,
    setShowLibrary,
    showLibrary,
  };
};
