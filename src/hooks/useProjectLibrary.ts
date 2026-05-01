import React from 'react';
import { toast } from 'sonner';
import {
  AnalysisResult,
  AppSettings,
  DuplicateInfo,
  MCQ,
  StudyProject,
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
  files: UploadedFile[];
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
  files,
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
  const [showLibrary, setShowLibrary] = React.useState(false);
  const [projects, setProjects] = React.useState<StudyProject[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);

  const refreshProjects = React.useCallback(async () => {
    const nextProjects = await db.getAllProjects();
    setProjects(nextProjects);
    return nextProjects;
  }, []);

  React.useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const autoSaveCurrentProject = React.useCallback(async (override?: {
    mcqs?: MCQ[];
    duplicates?: DuplicateInfo[];
    analysis?: AnalysisResult | null;
    settings?: AppSettings;
  }) => {
    const snapshotMcqs = override?.mcqs || mcqs;
    if (files.length === 0 || snapshotMcqs.length === 0) return null;

    const persistableFiles = getPersistableFiles(files);
    const fingerprint = await hashFiles(persistableFiles);
    const existing = activeProjectId ? await db.getProject(activeProjectId) : null;
    const reusableProject = existing?.filesFingerprint === fingerprint ? existing : null;

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
  }, [activeProjectId, analysis, duplicates, files, mcqs, refreshProjects, settings]);

  const openProject = React.useCallback(async (project: StudyProject) => {
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
    setAnalysis,
    setCurrentCount,
    setDuplicates,
    setFailedBatchIndices,
    setFiles,
    setMcqs,
    setRetryFailedAttempted,
  ]);

  const renameProject = React.useCallback(async (projectId: string, name: string) => {
    const project = await db.getProject(projectId);
    const cleanName = name.trim();
    if (!project || !cleanName) return;
    await db.saveProject({ ...project, name: cleanName, updatedAt: Date.now() });
    await refreshProjects();
    toast.success('Đã đổi tên bộ đề.');
  }, [refreshProjects]);

  const deleteProject = React.useCallback(async (project: StudyProject) => {
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
  }, [activeProjectId, confirm, refreshProjects]);

  const clearActiveProject = React.useCallback(() => setActiveProjectId(null), []);

  return {
    activeProjectId,
    autoSaveCurrentProject,
    clearActiveProject,
    deleteProject,
    openProject,
    projects,
    refreshProjects,
    renameProject,
    setShowLibrary,
    showLibrary,
  };
};
