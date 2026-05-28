import React from 'react';
import { AppSettings, ProcessingController, UploadedFile } from '../types';
import { extractTextWithTesseract } from '../core/vision';
import { convertPdfToImages } from '../utils/pdfProcessor';
import { toast } from 'sonner';

interface UseFilePreparationOptions {
  files: UploadedFile[];
  ocrMode: 'gemini' | 'tesseract';
  settings: AppSettings;
  setProgressStatus: React.Dispatch<React.SetStateAction<string>>;
}

export const useFilePreparation = ({
  files,
  ocrMode,
  settings,
  setProgressStatus,
}: UseFilePreparationOptions) => {
  const prepareFiles = React.useCallback(async (
    forcedMode?: 'gemini' | 'tesseract',
    controller?: ProcessingController,
    runtimeSettings?: AppSettings
  ): Promise<UploadedFile[]> => {
    const activeSettings = runtimeSettings || settings;
    const mode = forcedMode || ocrMode;
    let processedFiles: UploadedFile[] = [];

    const needsPdfRasterization = activeSettings.provider !== 'google' && mode !== 'gemini';
    for (const file of files) {
      await controller?.waitIfPaused();

      if (file.type === 'application/pdf' && needsPdfRasterization) {
        setProgressStatus(`Đang chuyển đổi PDF sang ảnh để tương thích với ${activeSettings.provider}...`);
        try {
          const pdfDataUrl = file.content.startsWith('data:') ? file.content : `data:application/pdf;base64,${file.content}`;
          const imageBase64s = await convertPdfToImages(pdfDataUrl, undefined, { quality: activeSettings.pdfVisionQuality ?? 'high' });

          imageBase64s.forEach((base64, index) => {
            const rawBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
            processedFiles.push({
              id: `${file.id}-page-${index}`,
              name: `${file.name.replace('.pdf', '')} - Trang ${index + 1}.jpg`,
              type: 'image/jpeg',
              size: Math.round(rawBase64.length * 0.75),
              content: rawBase64,
            });
          });
          continue;
        } catch (error: any) {
          console.error('PDF Conversion failed:', error);
          toast.error(`Lỗi chuyển đổi PDF ${file.name}: ${error.message}`);
        }
      }
      processedFiles.push(file);
    }

    if (mode === 'gemini') return processedFiles;

    setProgressStatus('Đang chạy Local OCR (Tesseract)...');

    const textProcessedFiles: UploadedFile[] = [];
    for (const file of processedFiles) {
      await controller?.waitIfPaused();

      if (file.type.startsWith('image/')) {
        try {
          const base64Content = `data:${file.type};base64,${file.content}`;
          const text = await extractTextWithTesseract(base64Content, (progress) => {
            setProgressStatus(`OCR ${file.name}: ${progress}%`);
          });
          textProcessedFiles.push({
            ...file,
            content: text,
            type: 'text/plain',
            name: `${file.name}.txt`,
          });
          continue;
        } catch (error) {
          console.error(`OCR Failed for ${file.name}`, error);
          textProcessedFiles.push(file);
          continue;
        }
      }
      if (file.name.toLowerCase().endsWith('.csv')) {
        textProcessedFiles.push({
          ...file,
          content: `FILE: ${file.name} (FORMAT: CSV - Each row is a record)\n${file.content}\n`,
        });
        continue;
      }
      textProcessedFiles.push(file);
    }

    return textProcessedFiles;
  }, [files, ocrMode, setProgressStatus, settings]);

  return { prepareFiles };
};
