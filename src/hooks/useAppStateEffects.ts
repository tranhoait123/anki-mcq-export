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
}: UseAppStateEffectsParams) => {
  const previousFilesSignatureRef = React.useRef<string | null>(null);

  // Save MCQs on change
  React.useEffect(() => {
    if (!isLoaded) return;
    if (activeSessionRef.current) return;
    void persistMcqs(mcqs);
  }, [activeSessionRef, isLoaded, mcqs, persistMcqs]);

  // Save uploaded files on change so reload/reset doesn't force re-upload
  React.useEffect(() => {
    if (!isLoaded) return;
    db.saveFiles(getPersistableFiles(files));
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
    }
    previousFilesSignatureRef.current = signature;
  }, [activeSessionRef, files, isLoaded, resumeSession, setFailedBatchIndices]);
};
