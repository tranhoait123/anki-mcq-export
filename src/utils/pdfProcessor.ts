import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình worker cho pdfjs (dùng CDN để tránh lỗi build Vite phức tạp)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export const convertPdfToImages = async (base64OrUrl: string): Promise<string[]> => {
    try {
        const loadingTask = pdfjsLib.getDocument(base64OrUrl);
        const pdf = await loadingTask.promise;
        const pageCount = pdf.numPages;
        const images: string[] = [];

        console.log(`📄 PDF Loaded: ${pageCount} pages.`);

        for (let i = 1; i <= pageCount; i++) {
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
        }

        return images;
    } catch (error) {
        console.error("PDF Rasterization Error:", error);
        throw new Error("Không thể chuyển đổi PDF sang ảnh. Vui lòng thử lại file khác.");
    }
};
