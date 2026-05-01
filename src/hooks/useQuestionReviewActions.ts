import React from 'react';
import { toast } from 'sonner';
import { DuplicateInfo, MCQ } from '../types';
import { ConfirmDialogOptions } from './useConfirmDialog';

interface UseQuestionReviewActionsParams {
  duplicates: DuplicateInfo[];
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateInfo[]>>;
  setMcqs: React.Dispatch<React.SetStateAction<MCQ[]>>;
  setShowDuplicates: React.Dispatch<React.SetStateAction<boolean>>;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}

export const useQuestionReviewActions = ({
  duplicates,
  setDuplicates,
  setMcqs,
  setShowDuplicates,
  confirm,
}: UseQuestionReviewActionsParams) => {
  const restoreDuplicate = (dupId: string) => {
    const dup = duplicates.find(d => d.id === dupId);
    if (!dup || !dup.fullData) return;

    const restoredMcq: MCQ = {
      ...dup.fullData,
      id: `restored - ${Date.now()} `
    };
    setMcqs(prev => [...prev, restoredMcq]);
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
    toast.success("Đã khôi phục câu hỏi");
  };

  const handleSkipDuplicate = (dupId: string) => {
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
    toast.info("Đã loại bỏ câu trùng");
  };

  const handleReplaceDuplicate = (originalId: string, newMcq: MCQ, dupId: string) => {
    setMcqs(prev => prev.map(m => m.id === originalId ? { ...newMcq, id: originalId } : m));
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
    toast.success("Đã thay thế câu cũ bằng nội dung mới");
  };

  const handleKeepAllDuplicates = () => {
    const toRestore = duplicates.filter(d => d.fullData).map((d, i) => ({
      ...d.fullData,
      id: `restored-bulk-${Date.now()}-${i}`
    }));

    setMcqs(prev => [...prev, ...toRestore]);
    setDuplicates([]);
    setShowDuplicates(false);
    toast.success(`Đã khôi phục toàn bộ ${toRestore.length} câu hỏi bị loại`);
  };

  const handleUpdateMCQ = (updatedMCQ: MCQ) => {
    setMcqs(prev => prev.map(m => m.id === updatedMCQ.id ? updatedMCQ : m));
  };

  const handleDeleteMCQ = async (id: string) => {
    const ok = await confirm({
      title: 'Xóa câu hỏi này?',
      body: 'Câu hỏi sẽ bị xóa khỏi danh sách hiện tại. Thao tác này không xóa các project đã lưu trong thư viện.',
      confirmLabel: 'Xóa câu hỏi',
      variant: 'danger',
    });
    if (!ok) return;
    setMcqs(prev => prev.filter(m => m.id !== id));
    toast.success("Đã xóa câu hỏi");
  };

  return {
    handleDeleteMCQ,
    handleKeepAllDuplicates,
    handleReplaceDuplicate,
    handleSkipDuplicate,
    handleUpdateMCQ,
    restoreDuplicate,
  };
};
