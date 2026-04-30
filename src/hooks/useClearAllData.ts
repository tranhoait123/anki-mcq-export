import React from 'react';
import {
  DuplicateInfo,
  MCQ,
  ProcessingSession,
  UploadedFile,
} from '../types';
import { db } from '../core/db';

interface UseClearAllDataParams {
  activeSessionRef: React.MutableRefObject<ProcessingSession | null>;
  duplicatesRef: React.MutableRefObject<DuplicateInfo[]>;
  filesRef: React.MutableRefObject<UploadedFile[]>;
  mcqsRef: React.MutableRefObject<MCQ[]>;
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateInfo[]>>;
  setFailedBatchIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  setMcqs: React.Dispatch<React.SetStateAction<MCQ[]>>;
  setRetryFailedAttempted: React.Dispatch<React.SetStateAction<boolean>>;
  setResumeSession: React.Dispatch<React.SetStateAction<ProcessingSession | null>>;
}

export const useClearAllData = ({
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
}: UseClearAllDataParams) => {
  const handleClearAllData = async () => {
    if (!confirm("Xóa toàn bộ dữ liệu hiện tại, file đã lưu, phiên dang dở và cache AI?")) return;
    setMcqs([]);
    mcqsRef.current = [];
    setFiles([]);
    filesRef.current = [];
    setDuplicates([]);
    duplicatesRef.current = [];
    setFailedBatchIndices([]);
    setRetryFailedAttempted(false);
    setResumeSession(null);
    activeSessionRef.current = null;
    await db.clearAll();
  };

  return { handleClearAllData };
};
