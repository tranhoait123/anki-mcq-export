import React from 'react';
import {
  AnalysisResult,
  AuditResult,
  DuplicateInfo,
  MCQ,
  ProcessingSession,
  ProcessingState,
  UploadedFile,
} from '../types';
import ControlPanel from './ControlPanel';
import ResultsPanel from './ResultsPanel';
import SourcePreviewPanel from './SourcePreviewPanel';

interface AppWorkspaceProps {
  analysis: AnalysisResult | null;
  analyzing: boolean;
  audit: AuditResult | null;
  currentCount: number;
  displayedProgressStatus: string;
  downloadCSV: () => void;
  downloadDOCX: () => void;
  duplicates: DuplicateInfo[];
  exportAction: 'downloadCsv' | 'downloadDocx' | null;
  failedBatchIndices: number[];
  files: UploadedFile[];
  handleAnalyze: () => void;
  handleClearAllData: () => void;
  handleDeleteMCQ: (id: string) => void;
  handleDiscardResumeSession: () => void;
  handleGenerate: () => void;
  handleResumeSession: () => void;
  handleRetryFailed: () => void;
  handleTogglePause: (isProcessing: boolean) => void;
  handleUpdateMCQ: (updatedMCQ: MCQ) => void;
  isSplitView: boolean;
  loading: boolean;
  mcqs: MCQ[];
  ocrMode: 'gemini' | 'tesseract';
  previewUrl: string | null;
  processingState: ProcessingState;
  resultsPanelRef: React.RefObject<HTMLDivElement | null>;
  retryFailedAttempted: boolean;
  resumeSession: ProcessingSession | null;
  setFiles: (files: UploadedFile[]) => void;
  setShowAudit: (show: boolean) => void;
  setShowDuplicates: (show: boolean) => void;
  showAudit: boolean;
}

const AppWorkspace: React.FC<AppWorkspaceProps> = ({
  analysis,
  analyzing,
  audit,
  currentCount,
  displayedProgressStatus,
  downloadCSV,
  downloadDOCX,
  duplicates,
  exportAction,
  failedBatchIndices,
  files,
  handleAnalyze,
  handleClearAllData,
  handleDeleteMCQ,
  handleDiscardResumeSession,
  handleGenerate,
  handleResumeSession,
  handleRetryFailed,
  handleTogglePause,
  handleUpdateMCQ,
  isSplitView,
  loading,
  mcqs,
  ocrMode,
  previewUrl,
  processingState,
  resultsPanelRef,
  retryFailedAttempted,
  resumeSession,
  setFiles,
  setShowAudit,
  setShowDuplicates,
  showAudit,
}) => (
  <main className={`mx-auto transition-all duration-300 ${isSplitView ? 'grid h-[calc(100dvh-72px)] min-h-0 max-w-full grid-cols-12 gap-5 overflow-hidden p-4' : 'grid max-w-6xl grid-cols-1 gap-8 p-6 lg:grid-cols-12'}`}>
    {isSplitView && files.length > 0 && (
      <SourcePreviewPanel file={files[0]} previewUrl={previewUrl} />
    )}

    <ControlPanel
      analysis={analysis}
      analyzing={analyzing}
      audit={audit}
      duplicates={duplicates}
      failedBatchIndices={failedBatchIndices}
      files={files}
      handleAnalyze={handleAnalyze}
      handleGenerate={handleGenerate}
      handleRetryFailed={handleRetryFailed}
      isSplitView={isSplitView}
      loading={loading}
      ocrMode={ocrMode}
      retryFailedAttempted={retryFailedAttempted}
      setFiles={setFiles}
      setShowAudit={setShowAudit}
      setShowDuplicates={setShowDuplicates}
      showAudit={showAudit}
    />

    <ResultsPanel
      analysis={analysis}
      analyzing={analyzing}
      currentCount={currentCount}
      displayedProgressStatus={displayedProgressStatus}
      downloadCSV={downloadCSV}
      downloadDOCX={downloadDOCX}
      exportAction={exportAction}
      filesCount={files.length}
      handleClearAllData={handleClearAllData}
      handleDeleteMCQ={handleDeleteMCQ}
      handleDiscardResumeSession={handleDiscardResumeSession}
      handleResumeSession={handleResumeSession}
      handleTogglePause={handleTogglePause}
      handleUpdateMCQ={handleUpdateMCQ}
      isSplitView={isSplitView}
      loading={loading}
      mcqs={mcqs}
      processingState={processingState}
      resultsPanelRef={resultsPanelRef}
      resumeSession={resumeSession}
    />
  </main>
);

export default AppWorkspace;
