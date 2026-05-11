import React from 'react';
import {
  AnalysisResult,
  DuplicateInfo,
  MCQ,
  ProcessingSession,
  UploadedFile,
} from '../types';
import { db } from '../core/db';
import { getPersistableFiles } from '../utils/appHelpers';

interface UseAppStateEffectsParams {
  activeSessionRef: React.MutableRefObject<ProcessingSession | null>;
  analysis: AnalysisResult | null;
  analysisRef: React.MutableRefObject<AnalysisResult | null>;
  duplicates: DuplicateInfo[];
  duplicatesRef: React.MutableRefObject<DuplicateInfo[]>;
  files: UploadedFile[];
  filesRef: React.MutableRefObject<UploadedFile[]>;
  isLoaded: boolean;
  mcqs: MCQ[];
  mcqsRef: React.MutableRefObject<MCQ[]>;
  persistMcqs: (items: MCQ[]) => Promise<void>;
  resumeSession: ProcessingSession | null;
  setFailedBatchIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setRetryFailedAttempted: React.Dispatch<React.SetStateAction<boolean>>;
}

export const useAppStateEffects = ({
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
}: UseAppStateEffectsParams) => {
  const previousFilesSignatureRef = React.useRef<string | null>(null);
  const previousPersistedFilesSignatureRef = React.useRef<string | null>(null);
  const previousPersistedMcqsSignatureRef = React.useRef<string | null>(null);

  // Save MCQs on change
  React.useEffect(() => {
    if (!isLoaded) return;
    if (activeSessionRef.current) return;
    const signature = `${mcqs.length}:${mcqs.map(mcq => [
      mcq.id,
      mcq.question,
      (mcq.options || []).join('\u0001'),
      mcq.correctAnswer,
      mcq.source,
      mcq.difficulty,
      mcq.depthAnalysis,
      mcq.explanation?.core,
      mcq.explanation?.evidence,
      mcq.explanation?.analysis,
      mcq.explanation?.warning,
    ].join('\u0002')).join('|')}`;
    if (signature === previousPersistedMcqsSignatureRef.current) return;

    const timeoutId = window.setTimeout(() => {
      previousPersistedMcqsSignatureRef.current = signature;
      void persistMcqs(mcqs);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [activeSessionRef, isLoaded, mcqs, persistMcqs]);

  // Save uploaded files on change so reload/reset doesn't force re-upload
  React.useEffect(() => {
    if (!isLoaded) return;
    const persistableFiles = getPersistableFiles(files);
    const signature = persistableFiles
      .map(file => `${file.id}:${file.name}:${file.type}:${file.contentHash || file.content.length}:${file.nativeMcqCount || 0}:${file.docxImageCount || 0}`)
      .join('|');
    if (signature === previousPersistedFilesSignatureRef.current) return;

    const timeoutId = window.setTimeout(() => {
      previousPersistedFilesSignatureRef.current = signature;
      void db.saveFiles(persistableFiles);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [files, isLoaded]);

  React.useEffect(() => {
    filesRef.current = files;
  }, [files, filesRef]);

  React.useEffect(() => {
    mcqsRef.current = mcqs;
  }, [mcqs, mcqsRef]);

  React.useEffect(() => {
    duplicatesRef.current = duplicates;
  }, [duplicates, duplicatesRef]);

  React.useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis, analysisRef]);

  // Reset lỗi khi file thay đổi để tránh lệch Index
  React.useEffect(() => {
    if (!isLoaded) return;
    const signature = files.map((file) => file.id).join('|');
    if (previousFilesSignatureRef.current === null) {
      previousFilesSignatureRef.current = signature;
      return;
    }
    if (signature !== previousFilesSignatureRef.current && files.length > 0 && !activeSessionRef.current && !resumeSession) {
      setFailedBatchIndices([]);
      setRetryFailedAttempted(false);
    }
    previousFilesSignatureRef.current = signature;
  }, [activeSessionRef, files, isLoaded, resumeSession, setFailedBatchIndices, setRetryFailedAttempted]);
};
