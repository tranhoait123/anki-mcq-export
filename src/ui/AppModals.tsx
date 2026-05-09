import React from 'react';
import { AppSettings, DuplicateInfo, MCQ, StudyProject, StudyProjectSummary } from '../types';
import { ConfirmDialogOptions, ConfirmDialogState } from '../hooks/useConfirmDialog';
import ConfirmModal from './ConfirmModal';
import DuplicatesReviewModal from './DuplicatesReviewModal';
import ProjectLibraryModal from './ProjectLibraryModal';
import SettingsModal from './SettingsModal';

interface AppModalsProps {
  duplicates: DuplicateInfo[];
  handleKeepAllDuplicates: () => void;
  handleReplaceDuplicate: (originalId: string, newMcq: MCQ, dupId: string) => void;
  handleSkipDuplicate: (dupId: string) => void;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  confirmState: ConfirmDialogState;
  handleConfirmCancel: () => void;
  handleConfirmSubmit: () => void;
  handleDeleteProject: (project: StudyProjectSummary) => Promise<void>;
  handleLoadProject: (projectId: string) => Promise<StudyProject | null>;
  restoreDuplicate: (dupId: string) => void;
  handleOpenProject: (project: StudyProject) => Promise<void>;
  handleRenameProject: (projectId: string, name: string) => Promise<void>;
  handleSaveCurrentProject: () => Promise<void>;
  activeProjectId: string | null;
  loading: boolean;
  mcqs: MCQ[];
  projects: StudyProjectSummary[];
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setShowDuplicates: (show: boolean) => void;
  setShowLibrary: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  settings: AppSettings;
  showDuplicates: boolean;
  showLibrary: boolean;
  showSettings: boolean;
}

const AppModals: React.FC<AppModalsProps> = ({
  duplicates,
  handleKeepAllDuplicates,
  handleReplaceDuplicate,
  handleSkipDuplicate,
  confirm,
  confirmState,
  handleConfirmCancel,
  handleConfirmSubmit,
  handleDeleteProject,
  handleLoadProject,
  handleOpenProject,
  handleRenameProject,
  handleSaveCurrentProject,
  activeProjectId,
  loading,
  mcqs,
  projects,
  restoreDuplicate,
  setSettings,
  setShowDuplicates,
  setShowLibrary,
  setShowSettings,
  settings,
  showDuplicates,
  showLibrary,
  showSettings,
}) => (
  <>
    <SettingsModal
      show={showSettings}
      onClose={() => setShowSettings(false)}
      settings={settings}
      setSettings={setSettings}
      confirm={confirm}
    />
    <DuplicatesReviewModal
      show={showDuplicates}
      onClose={() => setShowDuplicates(false)}
      duplicates={duplicates}
      onRestore={restoreDuplicate}
      onSkip={handleSkipDuplicate}
      onReplace={handleReplaceDuplicate}
      onKeepAll={handleKeepAllDuplicates}
    />
    <ProjectLibraryModal
      activeProjectId={activeProjectId}
      currentMcqs={mcqs}
      loading={loading}
      onClose={() => setShowLibrary(false)}
      onDeleteProject={handleDeleteProject}
      onLoadProject={handleLoadProject}
      onOpenProject={handleOpenProject}
      onRenameProject={handleRenameProject}
      onSaveCurrentProject={handleSaveCurrentProject}
      projects={projects}
      show={showLibrary}
    />
    <ConfirmModal
      state={confirmState}
      onCancel={handleConfirmCancel}
      onConfirm={handleConfirmSubmit}
    />
  </>
);

export default AppModals;
