import React from 'react';
import { AppSettings, ProcessingController, UploadedFile } from '../types';
import { convertPdfToImages } from '../utils/pdfProcessor';
import { toast } from 'sonner';

interface UseFilePreparationOptions {
  files: UploadedFile[];
  settings: AppSettings;
  setProgressStatus: React.Dispatch<React.SetStateAction<string>>;
}

export const useFilePreparation = ({
  files,
  settings,
  setProgressStatus,
}: UseFilePreparationOptions) => {
  const prepareFiles = React.useCallback(async (
    controller?: ProcessingController,
    runtimeSettings?: AppSettings
  ): Promise<UploadedFile[]> => {
    const activeSettings = runtimeSettings || settings;
    const processedFiles: UploadedFile[] = [];

    const needsPdfRasterization = activeSettings.provider !== 'google';
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

      if (file.name.toLowerCase().endsWith('.csv')) {
        processedFiles.push({
          ...file,
          content: `FILE: ${file.name} (FORMAT: CSV - Each row is a record)\n${file.content}\n`,
        });
        continue;
      }

      processedFiles.push(file);
    }

    return processedFiles;
  }, [files, setProgressStatus, settings]);

  return { prepareFiles };
};
