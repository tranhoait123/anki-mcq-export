import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

const getWorker = async (): Promise<Worker> => {
    if (!workerPromise) {
        workerPromise = (async () => {
            const Tesseract = await import('tesseract.js');
            const worker = await Tesseract.createWorker('vie', 1);
            return worker;
        })();
    }
    return workerPromise;
};

export const extractTextWithTesseract = async (
    imageSource: string | File,
    onProgress?: (progress: number) => void
): Promise<string> => {
    onProgress?.(0);
    try {
        const worker = await getWorker();

        const ret = await worker.recognize(imageSource);

        // Do NOT terminate worker. Keep it alive for reuse.
        onProgress?.(100);
        return ret.data.text;
    } catch (error) {
        console.error("Tesseract OCR Error:", error);
        // If worker crashed, reset promise so we try to create a new one next time
        workerPromise = null;
        throw new Error("OCR Failed: " + (error as any).message);
    }
};
