import React from 'react';
import { toast } from 'sonner';
import {
  AnalysisResult,
  AppSettings,
  AuditResult,
  ProcessingController,
  UploadedFile,
} from '../types';
import {
  analyzeDocument,
  auditMissingQuestions,
  translateErrorForUser,
} from '../core/brain';

interface UseAnalysisWorkflowParams {
  currentFilesRequireVision: () => boolean;
  files: UploadedFile[];
  getDetectedDocxMcqCount: () => number;
  getRequestSettings: (requiresVision?: boolean) => AppSettings;
  prepareFiles: (
    forcedMode?: 'gemini' | 'tesseract',
    controller?: ProcessingController,
    runtimeSettings?: AppSettings
  ) => Promise<UploadedFile[]>;
  setAnalysis: React.Dispatch<React.SetStateAction<AnalysisResult | null>>;
  setAnalyzing: React.Dispatch<React.SetStateAction<boolean>>;
  setAudit: React.Dispatch<React.SetStateAction<AuditResult | null>>;
  setAuditing: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAudit: React.Dispatch<React.SetStateAction<boolean>>;
  settings: AppSettings;
  validateProviderCredentials: (requestSettings: AppSettings) => boolean;
  warnVisionRecommendedDocx: () => boolean;
}

export const useAnalysisWorkflow = ({
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
}: UseAnalysisWorkflowParams) => {
  const handleAnalyze = async () => {
    if (files.length === 0) return;
    if (warnVisionRecommendedDocx()) return;
    const requestSettings = getRequestSettings(currentFilesRequireVision());

    if (!validateProviderCredentials(requestSettings)) return;

    setAnalyzing(true);
    setAnalysis(null);
    setAudit(null);
    try {
      if (settings.skipAnalysis) {
        const detectedDocxCount = getDetectedDocxMcqCount();
        setAnalysis({
          topic: detectedDocxCount > 0 ? "DOCX structured" : "Bỏ qua thuộc tính quét",
          estimatedCount: detectedDocxCount,
          questionRange: detectedDocxCount > 0 ? "Theo số block MCQ đã tách từ Word" : "Toàn bộ tài liệu",
          confidence: detectedDocxCount > 0 ? "High" : "N/A"
        });
        toast.info(detectedDocxCount > 0
          ? `Đã dùng số câu DOCX đã nhận diện: ${detectedDocxCount} câu.`
          : "Đã bỏ qua bước quét tài liệu.");
        setAnalyzing(false);
        return;
      }

      const filesToUse = await prepareFiles(undefined, undefined, requestSettings);
      const res = await analyzeDocument(filesToUse, requestSettings);
      setAnalysis(res);
      toast.success(`Phân tích thành công! Dự kiến có khoảng ${res.estimatedCount} câu hỏi.`);
    } catch (e: any) {
      toast.error(translateErrorForUser(e, 'Phân tích'));
    } finally {
      setAnalyzing(false);
    }
  };

  const runAudit = async (count: number, processedFiles?: UploadedFile[]) => {
    setAuditing(true);
    try {
      const requestSettings = getRequestSettings((processedFiles || files).some(file => file.type === 'application/pdf' || file.type.startsWith('image/')));
      const filesToUse = processedFiles || await prepareFiles(undefined, undefined, requestSettings);
      const res = await auditMissingQuestions(filesToUse, count, requestSettings);
      setAudit(res);
      setShowAudit(true);
    } catch (e) {
      console.error("Audit failed", e);
    } finally {
      setAuditing(false);
    }
  };

  return {
    handleAnalyze,
    runAudit,
  };
};
