/// <reference lib="webworker" />

import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình workerSrc nội bộ của pdfjs trong môi trường Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

self.onmessage = async (e: MessageEvent) => {
  const { action, payload, jobId } = e.data;

  if (action === 'convertPdfToImages') {
    try {
      const { base64OrUrl, pageRange, cmapUrl, standardFontDataUrl, rasterConfig } = payload;
      
      const loadingTask = pdfjsLib.getDocument({
        url: base64OrUrl,
        cMapUrl: cmapUrl,
        cMapPacked: true,
        standardFontDataUrl: standardFontDataUrl,
      });

      const pdf = await loadingTask.promise;
      const pageCount = pdf.numPages;
      const images: string[] = [];
      const start = Math.max(1, pageRange?.start || 1);
      const end = Math.min(pageCount, pageRange?.end || pageCount);

      for (let i = start; i <= end; i++) {
        try {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: rasterConfig?.scale || 2.0 });

          // Sử dụng OffscreenCanvas nếu trình duyệt hỗ trợ
          if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');
            
            if (context) {
              const renderContext: any = {
                canvasContext: context,
                viewport: viewport,
              };
              await page.render(renderContext).promise;
              
              const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: rasterConfig?.jpegQuality || 0.85 });
              const reader = new FileReaderSync();
              const base64 = reader.readAsDataURL(blob);
              images.push(base64);
            }
          } else {
            throw new Error("OffscreenCanvas not supported in this worker.");
          }
        } catch (pageError) {
          console.error(`Worker error rendering page ${i}:`, pageError);
        }
        
        // Nhường quyền cho worker xử lý message khác nếu cần
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (images.length === 0) {
        throw new Error("No images were successfully rendered from PDF.");
      }

      self.postMessage({ jobId, status: 'success', data: images });
    } catch (error: any) {
      self.postMessage({ jobId, status: 'error', error: error.message });
    }
  }
};
