import React from 'react';
import {
  DuplicateInfo,
  MCQ,
  ProcessingSession,
  UploadedFile,
} from '../types';
import { db } from '../core/db';
import { ConfirmDialogOptions } from './useConfirmDialog';

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
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  onAfterClear?: () => void;
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
  confirm,
  onAfterClear,
}: UseClearAllDataParams) => {
  const handleClearAllData = async () => {
    await confirm({
      title: 'Xóa dữ liệu hiện tại?',
      body: 'File đang mở, câu hỏi, phiên dang dở và cache AI sẽ bị xóa. Thư viện bộ đề đã lưu vẫn được giữ lại.',
      confirmLabel: 'Xóa dữ liệu',
      variant: 'danger',
      onConfirm: async () => {
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
        onAfterClear?.();
        await db.clearAll();
      },
    });
  };

  return { handleClearAllData };
};
