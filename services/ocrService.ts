import Tesseract from 'tesseract.js';

let workerPromise: Promise<Tesseract.Worker> | null = null;

const getWorker = async (): Promise<Tesseract.Worker> => {
    if (!workerPromise) {
        workerPromise = (async () => {
            const worker = await Tesseract.createWorker('vie', 1, {
                logger: m => {
                    // Global logger - difficult to map to specific file progress here directly
                    // We can use a custom event or callback if needed, but for simplicity
                    // we might just rely on the recognize call's return or manage progress differently.
                    // However, Tesseract.js v5 createWorker doesn't accept logger in options the same way as before?
                    // Wait, the previous code used: await Tesseract.createWorker('vie', 1, { logger: ... })
                    // Let's keep it simple.
                }
            });
            return worker;
        })();
    }
    return workerPromise;
};

export const extractTextWithTesseract = async (
    imageSource: string | File,
    onProgress?: (progress: number) => void
): Promise<string> => {
    try {
        const worker = await getWorker();

        const ret = await worker.recognize(imageSource, {}, {
            logger: (m: any) => {
                if (m.status === 'recognizing text') {
                    onProgress?.(Math.round(m.progress * 100));
                }
            }
        });

        // Do NOT terminate worker. Keep it alive for reuse.
        return ret.data.text;
    } catch (error) {
        console.error("Tesseract OCR Error:", error);
        // If worker crashed, reset promise so we try to create a new one next time
        workerPromise = null;
        throw new Error("OCR Failed: " + (error as any).message);
    }
};
