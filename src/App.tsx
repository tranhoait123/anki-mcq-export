import React, { useState } from 'react';
import { UploadedFile, MCQ, AnalysisResult, AuditResult, DuplicateInfo } from './types';
import AppHeader from './ui/AppHeader';
import AppModals from './ui/AppModals';
import AppWorkspace from './ui/AppWorkspace';
import { useExportActions } from './hooks/useExportActions';
import { useProcessingSession } from './hooks/useProcessingSession';
import { useProcessingControllerState } from './hooks/useProcessingControllerState';
import { usePersistedSettings } from './hooks/usePersistedSettings';
import { useUiPreferences } from './hooks/useUiPreferences';
import { useMcqCollection } from './hooks/useMcqCollection';
import { useFilePreparation } from './hooks/useFilePreparation';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useQuestionReviewActions } from './hooks/useQuestionReviewActions';
import { useRequestSettingsGuard } from './hooks/useRequestSettingsGuard';
import { useAnalysisWorkflow } from './hooks/useAnalysisWorkflow';
import { useGenerationPhase } from './hooks/useGenerationPhase';
import { useRetryFailedWorkflow } from './hooks/useRetryFailedWorkflow';
import { useResumeWorkflow } from './hooks/useResumeWorkflow';
import { useGenerateWorkflow } from './hooks/useGenerateWorkflow';
import { useAppStateEffects } from './hooks/useAppStateEffects';
import { useClearAllData } from './hooks/useClearAllData';

const App: React.FC = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [mcqs, setMcqs] = useState<MCQ[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [, setAuditing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [progressStatus, setProgressStatus] = useState("");
  const [currentCount, setCurrentCount] = useState(0);
  const [showAudit, setShowAudit] = useState(false);
  const [ocrMode] = useState<'gemini' | 'tesseract'>('gemini');
  const [duplicates, setDuplicates] = useState<DuplicateInfo[]>([]);
  const [failedBatchIndices, setFailedBatchIndices] = useState<number[]>([]);
  const [retryFailedAttempted, setRetryFailedAttempted] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const resultsPanelRef = React.useRef<HTMLDivElement | null>(null);
  const filesRef = React.useRef<UploadedFile[]>([]);
  const mcqsRef = React.useRef<MCQ[]>([]);
  const duplicatesRef = React.useRef<DuplicateInfo[]>([]);
  const analysisRef = React.useRef<AnalysisResult | null>(null);
  const { exportAction, downloadCSV, downloadDOCX } = useExportActions(mcqs, files);
  const {
    darkMode,
    deferredPrompt,
    handleInstallApp,
    isSplitView,
    previewUrl,
    setDarkMode,
    setIsSplitView,
  } = useUiPreferences(files);
  const {
    resumeSession,
    setResumeSession,
    activeSessionRef,
    persistSession,
    persistSessionSnapshot,
    updateActiveSession,
    clearResumeSession,
    buildSessionBase,
  } = useProcessingSession({ filesRef, mcqsRef, duplicatesRef, analysisRef });
  const {
    processingState,
    startProcessingController,
    clearProcessingController,
    waitWithController,
    handleTogglePause,
  } = useProcessingControllerState(activeSessionRef, persistSessionSnapshot);
  const {
    appendVisibleMcqs,
    deduplicateQuestions,
    persistMcqs,
    setVisibleMcqs,
  } = useMcqCollection({ activeSessionRef, mcqsRef, setMcqs });
  const {
    handleDeleteMCQ,
    handleKeepAllDuplicates,
    handleReplaceDuplicate,
    handleSkipDuplicate,
    handleUpdateMCQ,
    restoreDuplicate,
  } = useQuestionReviewActions({ duplicates, setDuplicates, setMcqs, setShowDuplicates });

  const { settings, setSettings, loadPersistedSettings } = usePersistedSettings(isLoaded);
  const { prepareFiles } = useFilePreparation({ files, ocrMode, settings, setProgressStatus });
  const {
    currentFilesRequireVision,
    getDetectedDocxMcqCount,
    getRequestSettings,
    validateProviderCredentials,
    warnVisionRecommendedDocx,
  } = useRequestSettingsGuard({ files, settings, setSettings });
  const {
    handleAnalyze,
    runAudit,
  } = useAnalysisWorkflow({
    currentFilesRequireVision,
    files,
    getDetectedDocxMcqCount,
    getRequestSettings,
    prepareFiles,
    setAnalysis,
    setAnalyzing,
    setAudit,
    setAuditing,
    setShowAudit,
    settings,
    validateProviderCredentials,
    warnVisionRecommendedDocx,
  });
  const { runGenerationPhase } = useGenerationPhase({
    activeSessionRef,
    appendVisibleMcqs,
    buildSessionBase,
    duplicatesRef,
    mcqsRef,
    persistMcqs,
    persistSession,
    setCurrentCount,
    setProgressStatus,
    updateActiveSession,
  });
  const { handleRetryFailed } = useRetryFailedWorkflow({
    analysis,
    clearProcessingController,
    clearResumeSession,
    currentFilesRequireVision,
    duplicatesRef,
    failedBatchIndices,
    files,
    getRequestSettings,
    ocrMode,
    prepareFiles,
    retryFailedAttempted,
    runGenerationPhase,
    setCurrentCount,
    setDuplicates,
    setFailedBatchIndices,
    setLoading,
    setProgressStatus,
    setRetryFailedAttempted,
    startProcessingController,
    warnVisionRecommendedDocx,
  });
  const {
    handleDiscardResumeSession,
    handleResumeSession,
  } = useResumeWorkflow({
    clearProcessingController,
    clearResumeSession,
    deduplicateQuestions,
    duplicatesRef,
    files,
    getDetectedDocxMcqCount,
    mcqsRef,
    prepareFiles,
    resumeSession,
    runGenerationPhase,
    setCurrentCount,
    setDuplicates,
    setFailedBatchIndices,
    setLoading,
    setProgressStatus,
    setVisibleMcqs,
    startProcessingController,
    warnVisionRecommendedDocx,
  });
  const { handleGenerate } = useGenerateWorkflow({
    analysis,
    clearProcessingController,
    clearResumeSession,
    currentFilesRequireVision,
    deduplicateQuestions,
    duplicatesRef,
    files,
    getDetectedDocxMcqCount,
    getRequestSettings,
    mcqsRef,
    ocrMode,
    prepareFiles,
    runAudit,
    runGenerationPhase,
    setAudit,
    setCurrentCount,
    setDuplicates,
    setFailedBatchIndices,
    setLoading,
    setMcqs,
    setProgressStatus,
    setRetryFailedAttempted,
    setShowAudit,
    setShowDuplicates,
    setVisibleMcqs,
    startProcessingController,
    validateProviderCredentials,
    waitWithController,
    warnVisionRecommendedDocx,
  });
  const { handleClearAllData } = useClearAllData({
    activeSessionRef,
    duplicatesRef,
    filesRef,
    mcqsRef,
    setDuplicates,
    setFailedBatchIndices,
    setFiles,
    setMcqs,
    setRetryFailedAttempted,
    setResumeSession,
  });

  useAppBootstrap({
    loadPersistedSettings,
    setAnalysis,
    setCurrentCount,
    setDuplicates,
    setFailedBatchIndices,
    setFiles,
    setIsLoaded,
    setMcqs,
    setResumeSession,
  });

  useAppStateEffects({
    activeSessionRef,
    analysis,
    analysisRef,
    duplicates,
    duplicatesRef,
    files,
    filesRef,
    isLoaded,
    mcqs,
    mcqsRef,
    persistMcqs,
    resumeSession,
    setFailedBatchIndices,
    setRetryFailedAttempted,
  });

  const displayedProgressStatus = processingState === 'paused'
    ? 'Đã tạm dừng an toàn. Nhấn "Tiếp tục" để chạy tiếp.'
    : processingState === 'pausing'
      ? 'Đang chờ batch hiện tại hoàn tất để tạm dừng an toàn...'
      : progressStatus;

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#020617] font-sans text-slate-800 dark:text-slate-100 transition-colors duration-300">
      <AppHeader
        darkMode={darkMode}
        deferredPrompt={deferredPrompt}
        filesCount={files.length}
        handleInstallApp={handleInstallApp}
        isSplitView={isSplitView}
        setDarkMode={setDarkMode}
        setIsSplitView={setIsSplitView}
        setShowSettings={setShowSettings}
      />

      <AppWorkspace
        analysis={analysis}
        analyzing={analyzing}
        audit={audit}
        currentCount={currentCount}
        displayedProgressStatus={displayedProgressStatus}
        downloadCSV={downloadCSV}
        downloadDOCX={downloadDOCX}
        duplicates={duplicates}
        exportAction={exportAction}
        failedBatchIndices={failedBatchIndices}
        files={files}
        handleAnalyze={handleAnalyze}
        handleClearAllData={handleClearAllData}
        handleDeleteMCQ={handleDeleteMCQ}
        handleDiscardResumeSession={handleDiscardResumeSession}
        handleGenerate={handleGenerate}
        handleResumeSession={handleResumeSession}
        handleRetryFailed={handleRetryFailed}
        handleTogglePause={handleTogglePause}
        handleUpdateMCQ={handleUpdateMCQ}
        isSplitView={isSplitView}
        loading={loading}
        mcqs={mcqs}
        ocrMode={ocrMode}
        previewUrl={previewUrl}
        processingState={processingState}
        resultsPanelRef={resultsPanelRef}
        retryFailedAttempted={retryFailedAttempted}
        resumeSession={resumeSession}
        setFiles={setFiles}
        setShowAudit={setShowAudit}
        setShowDuplicates={setShowDuplicates}
        showAudit={showAudit}
      />

      <AppModals
        duplicates={duplicates}
        handleKeepAllDuplicates={handleKeepAllDuplicates}
        handleReplaceDuplicate={handleReplaceDuplicate}
        handleSkipDuplicate={handleSkipDuplicate}
        restoreDuplicate={restoreDuplicate}
        setSettings={setSettings}
        setShowDuplicates={setShowDuplicates}
        setShowSettings={setShowSettings}
        settings={settings}
        showDuplicates={showDuplicates}
        showSettings={showSettings}
      />
    </div>
  );
};

export default App;
