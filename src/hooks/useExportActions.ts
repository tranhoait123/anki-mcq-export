import { useState } from 'react';
import { toast } from 'sonner';
import { MCQ, UploadedFile } from '../types';
import { buildAnkiHtml, formatRichText } from '../core/anki';
import { buildStudyDocxBlob } from '../core/docxExport';
import { isOptionCorrect } from '../utils/text';
import { cleanText } from '../utils/appHelpers';

export type ExportAction = 'downloadCsv' | 'downloadDocx' | null;

export const getExportBaseName = (files: UploadedFile[], prefix: 'ANKI' | 'DOCX') => {
  if (files.length === 0) return prefix === 'ANKI' ? 'Anki_Export' : 'MCQ_Study';
  const baseName = files[0].name.replace(/\.[^/.]+$/, '');
  return prefix === 'ANKI'
    ? `[ANKI]_${baseName.replace(/[^a-zA-Z0-9]/g, '_')}`
    : `[DOCX]_${baseName.replace(/[^a-zA-Z0-9]/g, '_')}`;
};

export const getExportSourceName = (files: UploadedFile[]) => {
  if (files.length === 0) return 'MCQ Study Export';
  return files[0].name.replace(/\.[^/.]+$/, '');
};

export const generateCSVData = (mcqs: MCQ[]) => {
  if (mcqs.length === 0) return '';

  const headers = ['Question', 'A', 'B', 'C', 'D', 'E', 'CorrectAnswer', 'ExplanationHTML', 'Source'];
  const rows = mcqs.map((m, idx) => {
    try {
      const esc = (t: string) => `"${(t || '').replace(/"/g, '""')}"`;

      const cleanQ = cleanText(m.question || 'Nội dung trống', 'question');
      const formattedQ = formatRichText(cleanQ);

      const rawOps = Array.isArray(m.options) ? m.options : [];
      const ops = [...rawOps];
      while (ops.length < 5) ops.push('');
      const cleanOps = ops.map(o => formatRichText(cleanText(o || '', 'option')));

      const correctIndex = rawOps.findIndex((opt, i) => isOptionCorrect(opt, m.correctAnswer || '', i));
      const correctLetter = correctIndex !== -1
        ? String.fromCharCode(65 + correctIndex)
        : ((m.correctAnswer || '').match(/^[A-E]/i)?.[0]?.toUpperCase() || m.correctAnswer || 'A');

      let explanationHtml = '';
      if (m.explanation && typeof m.explanation === 'object') {
        explanationHtml = buildAnkiHtml(m.explanation, m.difficulty || 'Trung bình', m.depthAnalysis || 'Vận dụng');
      } else if (typeof m.explanation === 'string') {
        explanationHtml = formatRichText(m.explanation);
      } else {
        explanationHtml = '<i>Không có giải thích.</i>';
      }

      return [esc(formattedQ), ...cleanOps.map(esc), esc(correctLetter), esc(explanationHtml), esc(m.source || '')].join(',');
    } catch (err) {
      console.warn(`Lỗi tại câu ${idx + 1}:`, err);
      return null;
    }
  }).filter(Boolean);

  return '\uFEFF' + [headers.join(','), ...rows].join('\n');
};

export const useExportActions = (mcqs: MCQ[], files: UploadedFile[]) => {
  const [exportAction, setExportAction] = useState<ExportAction>(null);

  const downloadCSV = async () => {
    setExportAction('downloadCsv');
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      let csv: string | null = '';
      try {
        csv = generateCSVData(mcqs);
      } catch (e: any) {
        toast.error(`📄 Lỗi tạo file CSV: ${e.message}. Hãy thử xuất lại hoặc đổi sang định dạng khác.`);
        csv = null;
      }
      if (!csv) return;

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const filename = getExportBaseName(files, 'ANKI');

      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Tải file thành công! Lưu ý khi Import vào Anki: 1. Chọn dấu phẩy (Comma) - 2. Tích chọn 'Allow HTML in fields'", {
        duration: 6000,
      });
    } finally {
      setExportAction(null);
    }
  };

  const downloadDOCX = async () => {
    if (mcqs.length === 0) {
      toast.error('Chưa có câu hỏi để xuất DOCX.');
      return;
    }

    setExportAction('downloadDocx');
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      const filename = getExportBaseName(files, 'DOCX');
      const sourceName = getExportSourceName(files);

      const blob = await buildStudyDocxBlob(mcqs, sourceName);
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.docx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Đã xuất file DOCX để học trực tiếp.');
    } catch (e: any) {
      toast.error(`📄 Lỗi tạo file DOCX: ${e.message || 'Không rõ lỗi'}. CSV hiện tại không bị ảnh hưởng.`);
    } finally {
      setExportAction(null);
    }
  };

  return {
    exportAction,
    downloadCSV,
    downloadDOCX,
  };
};
