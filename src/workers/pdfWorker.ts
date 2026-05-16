/// <reference lib="webworker" />

import * as pdfjsLib from 'pdfjs-dist';

self.onmessage = async (e: MessageEvent) => {
  const { action, payload, jobId } = e.data;

  if (action === 'convertPdfToImages') {
    try {
      const { base64OrUrl, pageRange, cmapUrl, standardFontDataUrl, rasterConfig } = payload;
      if (typeof OffscreenCanvas === 'undefined') {
        throw new Error("PDF_WORKER_OFFSCREEN_CANVAS_UNAVAILABLE");
      }
      
      const loadingTask = pdfjsLib.getDocument({
        url: base64OrUrl,
        cMapUrl: cmapUrl,
        cMapPacked: true,
        standardFontDataUrl: standardFontDataUrl,
        // This file already runs inside a dedicated worker; avoid spawning a
        // nested pdf.js worker, which can fail in bundled browser workers.
        disableWorker: true,
      } as any);

      const pdf = await loadingTask.promise;
      const pageCount = pdf.numPages;
      const images: string[] = [];
      const start = Math.max(1, pageRange?.start || 1);
      const end = Math.min(pageCount, pageRange?.end || pageCount);

      for (let i = start; i <= end; i++) {
        try {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: rasterConfig?.scale || 2.0 });

          const canvas = new OffscreenCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d');

          if (!context) {
            throw new Error("PDF_WORKER_CANVAS_CONTEXT_UNAVAILABLE");
          }

          const renderContext: any = {
            canvasContext: context,
            viewport: viewport,
          };
          await page.render(renderContext).promise;

          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: rasterConfig?.jpegQuality || 0.85 });
          const reader = new FileReaderSync();
          const base64 = reader.readAsDataURL(blob);
          images.push(base64);
        } catch (pageError) {
          console.debug(`PDF worker skipped page ${i}:`, pageError);
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
