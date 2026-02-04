import * as pdfjsLib from 'pdfjs-dist';

// "Solid" Static Worker Strategy:
// Load worker from the public directory (Same Origin).
// This avoids CORS issues that Blob Workers face when fetching other assets.
// pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// Local Assets Strategy:
// All assets (Worker, CMaps, Fonts) are served locally from public/ for 100% offline stability.
// Use Absolute path (window.location.origin) to ensure resolution is always correct.
const getAssetUrl = (path: string) => {
    return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
};

const CMAP_URL = getAssetUrl('/cmaps/');
const STANDARD_FONT_DATA_URL = getAssetUrl('/standard_fonts/');

export const convertPdfToImages = async (base64OrUrl: string): Promise<string[]> => {
    try {
        console.log(`Worker Status: Using static worker at ${pdfjsLib.GlobalWorkerOptions.workerSrc}`);

        const loadingTask = pdfjsLib.getDocument({
            url: base64OrUrl,
            // cMapUrl: CMAP_URL,
            // cMapPacked: true,
            // standardFontDataUrl: STANDARD_FONT_DATA_URL,
        });

        const pdf = await loadingTask.promise;
        const pageCount = pdf.numPages;
        const images: string[] = [];

        console.log(`📄 PDF Loaded: ${pageCount} pages.`);

        for (let i = 1; i <= pageCount; i++) {
            try {
                const page = await pdf.getPage(i);

                // High resolution scale (2.0 = 144-200 DPIish, good for OCR)
                const scale = 2.0;
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) continue;

                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext: any = {
                    canvasContext: context,
                    viewport: viewport,
                };

                await page.render(renderContext).promise;

                // Convert to base64 JPEG
                const imgData = canvas.toDataURL('image/jpeg', 0.85); // 0.85 quality is enough
                images.push(imgData);
            } catch (pageError) {
                console.error(`Error rendering page ${i}:`, pageError);
                // Continue to next page if one fails? Or fail all? 
                // Let's try to continue to save what we can.
            }
        }

        if (images.length === 0) {
            throw new Error("No images were successfully rendered from PDF.");
        }

        return images;
    } catch (error: any) {
        console.error("PDF Rasterization Fatal Error:", error);
        // Extract meaningful message
        const msg = error?.message || "Unknown error";
        throw new Error(`Lỗi xử lý PDF (${msg}). Vui lòng kiểm tra lại file hoặc kết nối mạng (cần tải Font/CMap).`);
    }
};
