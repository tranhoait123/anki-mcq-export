import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AnalysisResult,
  MCQ,
  ProcessingSession,
  ProcessingState,
} from '../types';
import MCQDisplay from './MCQDisplay';
import EmptyResultsState from './results/EmptyResultsState';
import ExportStatus from './results/ExportStatus';
import ProcessingProgress from './results/ProcessingProgress';
import ResultsToolbar from './results/ResultsToolbar';
import ResumeSessionBanner from './results/ResumeSessionBanner';

interface ResultsPanelProps {
  analysis: AnalysisResult | null;
  analyzing: boolean;
  currentCount: number;
  downloadCSV: () => void;
  downloadDOCX: () => void;
  exportAction: 'downloadCsv' | 'downloadDocx' | null;
  filesCount: number;
  handleClearAllData: () => void;
  handleDeleteMCQ: (id: string) => void;
  handleDiscardResumeSession: () => void;
  handleResumeSession: () => void;
  handleTogglePause: (isProcessing: boolean) => void;
  handleUpdateMCQ: (updatedMCQ: MCQ) => void;
  isSplitView: boolean;
  loading: boolean;
  mcqs: MCQ[];
  processingState: ProcessingState;
  displayedProgressStatus: string;
  resultsPanelRef: React.RefObject<HTMLDivElement | null>;
  resumeSession: ProcessingSession | null;
}

const ResultsPanel: React.FC<ResultsPanelProps> = ({
  analysis,
  analyzing,
  currentCount,
  downloadCSV,
  downloadDOCX,
  exportAction,
  filesCount,
  handleClearAllData,
  handleDeleteMCQ,
  handleDiscardResumeSession,
  handleResumeSession,
  handleTogglePause,
  handleUpdateMCQ,
  isSplitView,
  loading,
  mcqs,
  processingState,
  displayedProgressStatus,
  resultsPanelRef,
  resumeSession,
}) => (
  <div ref={resultsPanelRef} className={`min-w-0 ${isSplitView ? 'col-span-6 h-full min-h-0 space-y-4 overflow-y-auto pr-1' : 'space-y-5'}`}>
    {resumeSession && !loading && (
      <ResumeSessionBanner
        handleDiscardResumeSession={handleDiscardResumeSession}
        handleResumeSession={handleResumeSession}
        resumeSession={resumeSession}
      />
    )}

    {isSplitView && filesCount === 0 && (
      <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg flex items-center gap-3">
        <AlertTriangle size={20} />
        <div>
          <strong>Chưa có tài liệu!</strong> Vui lòng tắt chế độ So sánh, tải file lên và trích xuất câu hỏi trước.
        </div>
      </div>
    )}

    {loading && (
      <ProcessingProgress
        analysis={analysis}
        currentCount={currentCount}
        displayedProgressStatus={displayedProgressStatus}
        handleTogglePause={handleTogglePause}
        loading={loading}
        processingState={processingState}
      />
    )}

    {mcqs.length > 0 && !loading && !isSplitView && (
      <ResultsToolbar
        downloadCSV={downloadCSV}
        downloadDOCX={downloadDOCX}
        exportAction={exportAction}
        handleClearAllData={handleClearAllData}
        mcqCount={mcqs.length}
      />
    )}

    <div className={isSplitView ? 'min-h-0' : 'min-h-[400px] min-w-0'}>
      {exportAction && (
        <ExportStatus exportAction={exportAction} />
      )}
      <MCQDisplay
        mcqs={mcqs}
        onUpdate={handleUpdateMCQ}
        onDelete={handleDeleteMCQ}
        scrollContainerRef={resultsPanelRef}
        useWindowScroll={!isSplitView}
      />

      {!loading && mcqs.length === 0 && !analyzing && filesCount === 0 && (
        <EmptyResultsState />
      )}
    </div>
  </div>
);

export default ResultsPanel;
