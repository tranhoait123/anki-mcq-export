import { UploadedFile } from '../../types';

export const getDocxModeBadge = (file: UploadedFile) => {
  if (file.docxMode === 'hybrid') return {
    text: `DOCX hybrid: ${file.nativeMcqCount || file.structuredMcqCount || 0} câu / ${file.docxImageCount || 0} ảnh`,
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  };
  if (file.docxMode === 'native') return {
    text: `DOCX native: ${file.nativeMcqCount || 0} câu`,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  };
  if (file.docxMode === 'structuredFallback') return {
    text: `DOCX structured: ${file.structuredMcqCount || file.nativeMcqCount || 0} câu`,
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  };
  if (file.docxMode === 'textFallback') return {
    text: 'DOCX text fallback',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  };
  if (file.docxMode === 'visionRecommended') return {
    text: 'Nên dùng PDF/Ảnh',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  };
  return null;
};

export const getPdfModeBadge = (file: UploadedFile) => {
  if (file.type !== 'application/pdf') return null;
  if (file.pdfMode === 'safeHybrid') return {
    text: `PDF hybrid: ${file.pdfTextBatchCount || 0} text / ${file.pdfVisionBatchCount || 0} vision`,
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  };
  if (file.pdfMode === 'textOnlyCandidate') return {
    text: `PDF text: ${file.pdfTextMcqCount || 0} câu`,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  };
  return {
    text: 'PDF vision',
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  };
};
