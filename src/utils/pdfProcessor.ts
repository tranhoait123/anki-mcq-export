import { applySharedCaseContextToBlocks } from './sharedCaseContext';
import { hashStringSha256 } from './hash';
import { measureAsync, yieldToMain } from './performance';

// Local Assets Strategy:
// CMaps and fonts are served locally from public/ for offline stability.
const getAssetUrl = (path: string) => {
    return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
};

const CMAP_URL = getAssetUrl('/cmaps/');
const STANDARD_FONT_DATA_URL = getAssetUrl('/standard_fonts/');
const pdfTextAnalysisCache = new Map<string, Promise<PdfTextAnalysis>>();
const pdfRasterCache = new Map<string, Promise<string[]>>();
let pdfWorkerUnavailableForSession = false;

export type PdfPageQuality = 'goodText' | 'suspect' | 'scanOrEmpty';
export type PdfRasterQuality = 'standard' | 'high';

export interface PdfTextPage {
    pageNumber: number;
    text: string;
    charCount: number;
    weirdCharRatio: number;
    mcqMarkerCount: number;
    optionMarkerCount: number;
    lineCount: number;
    avgLineLength: number;
    multiColumnRisk: boolean;
    tableRisk: boolean;
    quality: PdfPageQuality;
    reason: string;
}

export interface PdfPageRange {
    start: number;
    end: number;
}

export interface PdfTextBatch {
    text: string;
    expectedQuestions: number;
    pageRange: PdfPageRange;
}

export interface PdfTextAnalysis {
    pageCount: number;
    pages: PdfTextPage[];
    textBatches: PdfTextBatch[];
    visionPageRanges: PdfPageRange[];
    detectedMcqCount: number;
    mode: 'vision' | 'safeHybrid' | 'textOnlyCandidate';
}

export interface PdfRasterConfig {
    scale: number;
    jpegQuality: number;
}

export interface PdfRasterOptions {
    quality?: PdfRasterQuality;
}

const QUESTION_MARKER_PATTERN = /(?:^|\n)\s*(?:câu|cau|question|q)\s*\d+\s*[:.)-]/gi;
const BARE_QUESTION_MARKER_PATTERN = /(?:^|\n)\s*(?:\d{1,3}|[IVX]{1,8})\s*[\.)-]\s+[A-ZÀ-Ỹ\p{Lu}]/gu;
const OPTION_MARKER_PATTERN = /(?:^|\n)\s*(?:\(?[A-E]\)?\s*[\.:)-])/gi;
const QUESTION_LINE_PATTERN = /^(?:câu|cau|question|q)\s*\d+\s*[:.)-]/i;
const BARE_NUMBERED_QUESTION_LINE_PATTERN = /^(?:\d{1,3}|[IVX]{1,8})\s*[\.)-]\s+\S/i;
const OPTION_LINE_PATTERN = /^\(?([A-E])\)?\s*[\.:)-]\s*(.+)$/i;
const ANSWER_KEY_LINE_PATTERN = /^(?:đáp\s*án|dap\s*an|đáp\s*án\s*đúng|dap\s*an\s*dung|answer|correct\s*answer|key)\s*(?:đúng|dung)?\s*[:：.\-]?\s*(?:\(?([A-E])\)?|([A-E])\s*[\.:)-])/i;
const SAME_LINE_OPTIONS_PATTERN = /\bA\s*[\.:)-].+\bB\s*[\.:)-].+\bC\s*[\.:)-].+\bD\s*[\.:)-]/i;

interface PdfTextGeometry {
    x: number;
    y: number;
    width: number;
    text: string;
}

interface PdfPageGeometryMetrics {
    multiColumnRisk: boolean;
}

const INLINE_QUESTION_MARKER_PATTERN = /([^\n])(?:[^\S\n]+)((?:Câu|Cau|Question|Q)\s*\d{1,4}\s*[:.)-])/g;

const normalizeInlineQuestionBoundaries = (value: string): string =>
    value.replace(INLINE_QUESTION_MARKER_PATTERN, '$1\n$2');

const normalizePdfText = (value: string): string =>
    normalizeInlineQuestionBoundaries(value)
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const getWeirdCharRatio = (text: string): number => {
    const compact = text.replace(/\s/g, '');
    if (!compact) return 1;
    const weird = [...compact].filter((char) => !/[\p{L}\p{N}.,;:!?()[\]{}'"%+\-=/<>°–—_`~^&|#@*$✓✔☑✅]/u.test(char)).length;
    return weird / compact.length;
};

const countMatches = (text: string, pattern: RegExp): number => {
    pattern.lastIndex = 0;
    return text.match(pattern)?.length || 0;
};

const countMcqMarkers = (text: string): number => {
    const keywordMatches = countMatches(text, QUESTION_MARKER_PATTERN);
    if (keywordMatches > 0) return keywordMatches;
    return countMatches(text, BARE_QUESTION_MARKER_PATTERN);
};

export const countPdfQuestionMarkers = (text: string): number =>
    countMcqMarkers(normalizePdfText(text));

export const getPdfRasterConfig = (quality: PdfRasterQuality = 'standard'): PdfRasterConfig => (
    quality === 'high'
        ? { scale: 2.8, jpegQuality: 0.92 }
        : { scale: 2.0, jpegQuality: 0.85 }
);

export const splitPdfRangeForVisionRecovery = (range: PdfPageRange): PdfPageRange[] => {
    const start = Math.max(1, Math.floor(range.start));
    const end = Math.max(start, Math.floor(range.end));
    if (end - start + 1 <= 2) return [{ start, end }];

    const ranges: PdfPageRange[] = [];
    for (let page = start; page < end; page++) {
        ranges.push({ start: page, end: Math.min(end, page + 1) });
    }
    return ranges;
};

export const scorePdfTextPage = (text: string, pageNumber = 1): PdfTextPage => {
    const cleanText = normalizePdfText(text);
    const charCount = cleanText.length;
    const weirdCharRatio = getWeirdCharRatio(cleanText);
    const mcqMarkerCount = countMcqMarkers(cleanText);
    const optionMarkerCount = countMatches(cleanText, OPTION_MARKER_PATTERN);
    const lines = cleanText ? cleanText.split(/\n+/).map((line) => line.trim()).filter(Boolean) : [];
    const lineCount = lines.length;
    const avgLineLength = lineCount > 0 ? charCount / lineCount : 0;
    const tableRisk = lines.some((line) => SAME_LINE_OPTIONS_PATTERN.test(line)) || (lineCount > 40 && avgLineLength < 18);

    let quality: PdfPageQuality = 'suspect';
    let reason = 'Text layer thiếu marker MCQ rõ ràng.';

    if (charCount < 120) {
        quality = 'scanOrEmpty';
        reason = 'Text layer quá ít, nhiều khả năng là scan hoặc ảnh.';
    } else if (tableRisk) {
        reason = 'Text layer có dấu hiệu bảng/cột lựa chọn cùng dòng.';
    } else if (charCount >= 450 && weirdCharRatio <= 0.08 && lineCount >= 6 && avgLineLength >= 18 && (mcqMarkerCount >= 1 || optionMarkerCount >= 3)) {
        quality = 'goodText';
        reason = 'Text layer đủ dài, ít ký tự lạ và có marker MCQ.';
    } else if (weirdCharRatio > 0.08) {
        reason = 'Text layer có quá nhiều ký tự lạ.';
    } else if (lineCount < 4) {
        reason = 'Text layer quá ít dòng, dễ bị dính layout.';
    } else if (avgLineLength < 18) {
        reason = 'Text layer có quá nhiều dòng ngắn, dễ là bảng/cột bị vỡ.';
    }

    return {
        pageNumber,
        text: cleanText,
        charCount,
        weirdCharRatio,
        mcqMarkerCount,
        optionMarkerCount,
        lineCount,
        avgLineLength,
        multiColumnRisk: false,
        tableRisk,
        quality,
        reason,
    };
};

export const detectPdfMultiColumnRisk = (items: PdfTextGeometry[], pageWidth: number): boolean => {
    if (items.length < 20 || pageWidth <= 0) return false;
    const rows = new Map<number, PdfTextGeometry[]>();
    items.forEach((item) => {
        if (!item.text.trim()) return;
        const rowKey = Math.round(item.y / 4) * 4;
        rows.set(rowKey, [...(rows.get(rowKey) || []), item]);
    });

    let riskyRows = 0;
    rows.forEach((rowItems) => {
        if (rowItems.length < 3) return;
        const sorted = [...rowItems].sort((a, b) => a.x - b.x);
        const rowTextLength = sorted.reduce((total, item) => total + item.text.trim().length, 0);
        if (rowTextLength < 20) return;
        const minX = sorted[0].x;
        const maxX = Math.max(...sorted.map((item) => item.x + Math.max(0, item.width || 0)));
        const hasLeft = sorted.some((item) => item.x < pageWidth * 0.42);
        const hasRight = sorted.some((item) => item.x > pageWidth * 0.58);
        if (hasLeft && hasRight && maxX - minX > pageWidth * 0.48) riskyRows++;
    });

    return riskyRows >= 4;
};

const applyGeometryMetrics = (page: PdfTextPage, metrics: PdfPageGeometryMetrics): PdfTextPage => {
    if (!metrics.multiColumnRisk || page.quality !== 'goodText') return { ...page, multiColumnRisk: metrics.multiColumnRisk };
    return {
        ...page,
        multiColumnRisk: true,
        quality: 'suspect',
        reason: 'Text layer có dấu hiệu 2 cột hoặc reading order không chắc chắn.',
    };
};

const buildPageRanges = (pageCount: number, pagesPerChunk = 3, overlap = 1): PdfPageRange[] => {
    const ranges: PdfPageRange[] = [];
    const step = Math.max(1, pagesPerChunk - overlap);
    for (let start = 1; start <= pageCount; start += step) {
        const end = Math.min(pageCount, start + pagesPerChunk - 1);
        ranges.push({ start, end });
        if (end === pageCount) break;
    }
    return ranges;
};

const parseMcqBlocksFromText = (text: string): string[] => {
    const lines = normalizePdfText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const blocks: { question: string[]; options: { letter: string; text: string }[]; correctAnswer?: string; isStartedAsQuestion?: boolean }[] = [];
    let current: { question: string[]; options: { letter: string; text: string }[]; correctAnswer?: string; isStartedAsQuestion?: boolean } | null = null;

    const getAnswerKeyLetter = (line: string): string => {
        const match = line.match(ANSWER_KEY_LINE_PATTERN);
        return (match?.[1] || match?.[2] || '').toUpperCase();
    };

    const flush = () => {
        if (current && current.question.length > 0 && current.options.length >= 2) {
            const uniqueLetters = new Set(current.options.map((option) => option.letter));
            if (uniqueLetters.size >= 2) blocks.push(current);
        }
        current = null;
    };

    const isLikelyQuestionBoundaryAfterOptions = (line: string, nextLine = ''): boolean => {
        if (!current || current.options.length < 2) return false;
        if (OPTION_LINE_PATTERN.test(line)) return false;
        if (QUESTION_LINE_PATTERN.test(line)) return true;
        if (nextLine && OPTION_LINE_PATTERN.test(nextLine)) return true;
        return BARE_NUMBERED_QUESTION_LINE_PATTERN.test(line) && (line.includes('?') || line.length >= 18);
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const nextLine = lines[index + 1] || '';
        const optionMatch = line.match(OPTION_LINE_PATTERN);
        const answerKeyLetter = getAnswerKeyLetter(line);
        if (QUESTION_LINE_PATTERN.test(line)) {
            flush();
            current = { question: [line], options: [], isStartedAsQuestion: true };
            continue;
        }
        if (isLikelyQuestionBoundaryAfterOptions(line, nextLine)) {
            flush();
            current = { question: [line], options: [], isStartedAsQuestion: true };
            continue;
        }
        if (current && current.options.length === 0 && !current.isStartedAsQuestion) {
            const isBareQuestion = BARE_NUMBERED_QUESTION_LINE_PATTERN.test(line) && (line.includes('?') || line.length >= 18);
            if (isBareQuestion) {
                flush();
                current = { question: [line], options: [], isStartedAsQuestion: true };
                continue;
            }
        }
        if (optionMatch && current) {
            current.options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
            continue;
        }
        if (answerKeyLetter && current && current.options.length >= 2) {
            current.correctAnswer = answerKeyLetter;
            continue;
        }
        if (!current) {
            const startsAsBareQuestion = BARE_NUMBERED_QUESTION_LINE_PATTERN.test(line) && (line.includes('?') || line.length >= 18);
            current = { question: [line], options: [], isStartedAsQuestion: startsAsBareQuestion };
            continue;
        }
        if (current.options.length > 0) {
            const last = current.options[current.options.length - 1];
            last.text = `${last.text} ${line}`.trim();
        } else {
            current.question.push(line);
        }
    }
    flush();

    const hasRealQuestionBlocks = blocks.some((b) => b.isStartedAsQuestion);
    const validBlocks = blocks.filter((block) => {
        if (block.isStartedAsQuestion) return true;
        if (hasRealQuestionBlocks) return false;
        const questionText = block.question.join(' ').trim();
        return questionText.length >= 30;
    });

    const structuredBlocks = validBlocks.map((block, index) => [
        `<<<MCQ ${index + 1}>>>`,
        `Question: ${block.question.join(' ').replace(/\s+/g, ' ').trim()}`,
        ...block.options.map((option) => `${option.letter === block.correctAnswer ? '✅ ' : ''}${option.letter}. ${option.text.replace(/\s+/g, ' ').trim()}`),
    ].join('\n'));

    return applySharedCaseContextToBlocks(text, structuredBlocks);
};

const buildStructuredPdfText = (blocks: string[]): string => `[PDF_TEXT_MCQ_COUNT: ${blocks.length}]\n\n${blocks.join('\n\n')}`;

const normalizeBlockFingerprint = (block: string): string =>
    block
        .replace(/^<<<MCQ\s+\d+>>>\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

const chunkBlocks = (blocks: string[], batchSize = 10): string[][] => {
    const chunks: string[][] = [];
    const safeBatchSize = Math.max(1, Math.floor(batchSize));
    for (let i = 0; i < blocks.length; i += safeBatchSize) chunks.push(blocks.slice(i, i + safeBatchSize));
    return chunks;
};

export const buildPdfTextAnalysisFromPages = (pages: PdfTextPage[], pagesPerChunk = 3, overlap = 1, structuredBatchSize = 10): PdfTextAnalysis => {
    const pageCount = pages.length;
    const ranges = buildPageRanges(pageCount, pagesPerChunk, overlap);
    const textBatches: PdfTextBatch[] = [];
    const visionPageRanges: PdfPageRange[] = [];
    const seenBlockFingerprints = new Set<string>();

    for (const range of ranges) {
        const rangePages = pages.slice(range.start - 1, range.end);
        const allGood = rangePages.length > 0 && rangePages.every((page) => page.quality === 'goodText');
        if (allGood) {
            const joinedText = rangePages.map((page) => page.text).join('\n\n');
            const allBlocksOnRange = parseMcqBlocksFromText(joinedText);
            const blocks = allBlocksOnRange.filter((block) => {
                const fingerprint = normalizeBlockFingerprint(block);
                if (!fingerprint) return false;
                if (seenBlockFingerprints.has(fingerprint)) return false;
                seenBlockFingerprints.add(fingerprint);
                return true;
            });
            const sparseBlockRisk = joinedText.length > 2500 && blocks.length < 2;
            if (blocks.length > 0 && !sparseBlockRisk) {
                const rawQuestionCount = countPdfQuestionMarkers(joinedText);
                if (rawQuestionCount > allBlocksOnRange.length) {
                    textBatches.push({
                        text: `[PDF_TEXT_BATCH_COUNT: ${rawQuestionCount}]\n\n${joinedText}`,
                        expectedQuestions: rawQuestionCount,
                        pageRange: range,
                    });
                    continue;
                }

                chunkBlocks(blocks, structuredBatchSize).forEach((chunk) => {
                    textBatches.push({
                        text: buildStructuredPdfText(chunk),
                        expectedQuestions: chunk.length,
                        pageRange: range,
                    });
                });
                continue;
            }
        }
        visionPageRanges.push(range);
    }

    // Merge adjacent/overlapping vision ranges to avoid duplicate extraction
    const mergedVisionRanges: PdfPageRange[] = [];
    for (const range of visionPageRanges) {
        const last = mergedVisionRanges[mergedVisionRanges.length - 1];
        if (last && range.start <= last.end + 1) {
            last.end = Math.max(last.end, range.end);
        } else {
            mergedVisionRanges.push({ ...range });
        }
    }

    // Re-chunk merged vision ranges with overlap so page-boundary clinical stems
    // stay visible with the questions that continue on the next page.
    const finalVisionRanges: PdfPageRange[] = [];
    for (const merged of mergedVisionRanges) {
        const step = Math.max(1, pagesPerChunk - overlap);
        for (let start = merged.start; start <= merged.end; start += step) {
            finalVisionRanges.push({ start, end: Math.min(merged.end, start + pagesPerChunk - 1) });
            if (start + pagesPerChunk - 1 >= merged.end) break;
        }
    }

    const detectedMcqCount = textBatches.reduce((total, batch) => total + batch.expectedQuestions, 0);
    const mode = textBatches.length === 0 ? 'vision' : (finalVisionRanges.length === 0 ? 'textOnlyCandidate' : 'safeHybrid');
    return { pageCount, pages, textBatches, visionPageRanges: finalVisionRanges, detectedMcqCount, mode };
};

const loadPdfJs = async () => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
    ).toString();
    return pdfjsLib;
};

const openPdf = async (base64OrUrl: string) => {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({
        url: base64OrUrl,
        cMapUrl: CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
    });
    return loadingTask.promise;
};

const analyzePdfTextLayerUncached = async (base64OrUrl: string, pagesPerChunk = 3, overlap = 1, structuredBatchSize = 10): Promise<PdfTextAnalysis> => {
    const pdf = await openPdf(base64OrUrl);
    const samplePages = Math.min(3, pdf.numPages);
    const sampled: PdfTextPage[] = [];

    for (let pageNumber = 1; pageNumber <= samplePages; pageNumber++) {
        await yieldToMain();
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const items = content.items || [];
        const text = normalizePdfText(items.map((item: any) => item.str || '').join('\n'));
        sampled.push(applyGeometryMetrics(scorePdfTextPage(text, pageNumber), {
            multiColumnRisk: detectPdfMultiColumnRisk(items.map((item: any) => ({
                x: Number(item.transform?.[4] || 0),
                y: Number(item.transform?.[5] || 0),
                width: Number(item.width || 0),
                text: String(item.str || ''),
            })), viewport.width),
        }));
    }

    if (sampled.length > 0 && sampled.every((page) => page.quality === 'scanOrEmpty')) {
        const pages = Array.from({ length: pdf.numPages }, (_, index) => index < sampled.length ? sampled[index] : scorePdfTextPage('', index + 1));
        return {
            pageCount: pdf.numPages,
            pages,
            textBatches: [],
            visionPageRanges: buildPageRanges(pdf.numPages, pagesPerChunk, overlap),
            detectedMcqCount: 0,
            mode: 'vision',
        };
    }

    const pages = [...sampled];
    for (let pageNumber = samplePages + 1; pageNumber <= pdf.numPages; pageNumber++) {
        await yieldToMain();
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const items = content.items || [];
        const text = normalizePdfText(items.map((item: any) => item.str || '').join('\n'));
        pages.push(applyGeometryMetrics(scorePdfTextPage(text, pageNumber), {
            multiColumnRisk: detectPdfMultiColumnRisk(items.map((item: any) => ({
                x: Number(item.transform?.[4] || 0),
                y: Number(item.transform?.[5] || 0),
                width: Number(item.width || 0),
                text: String(item.str || ''),
            })), viewport.width),
        }));
    }

    return buildPdfTextAnalysisFromPages(pages, pagesPerChunk, overlap, structuredBatchSize);
};

export const analyzePdfTextLayer = async (base64OrUrl: string, pagesPerChunk = 3, overlap = 1, structuredBatchSize = 10): Promise<PdfTextAnalysis> => {
    const baseHash = await hashStringSha256(base64OrUrl);
    const cacheKey = `${baseHash}:${pagesPerChunk}:${overlap}:${structuredBatchSize}`;
    const cached = pdfTextAnalysisCache.get(cacheKey);
    if (cached) return cached;

    const analysisPromise = measureAsync(`pdf.analyzeTextLayer(${pagesPerChunk}/${overlap}/${structuredBatchSize})`, () =>
        analyzePdfTextLayerUncached(base64OrUrl, pagesPerChunk, overlap, structuredBatchSize)
    );
    pdfTextAnalysisCache.set(cacheKey, analysisPromise);
    try {
        return await analysisPromise;
    } catch (error) {
        pdfTextAnalysisCache.delete(cacheKey);
        throw error;
    }
};

const convertPdfToImagesInWorker = async (base64OrUrl: string, pageRange?: PdfPageRange, options: PdfRasterOptions = {}): Promise<string[]> => {
    if (pdfWorkerUnavailableForSession || typeof Worker === 'undefined' || typeof window === 'undefined') {
        throw new Error('PDF worker unavailable');
    }

    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/pdfWorker.ts', import.meta.url), { type: 'module' });
        const jobId = `pdf-raster-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const timeoutId = window.setTimeout(() => {
            worker.terminate();
            reject(new Error('PDF worker timed out'));
        }, 120000);

        const cleanup = () => {
            window.clearTimeout(timeoutId);
            worker.terminate();
        };

        worker.onmessage = (event: MessageEvent) => {
            if (event.data?.jobId !== jobId) return;
            cleanup();
            if (event.data.status === 'success') {
                resolve(event.data.data || []);
                return;
            }
            reject(new Error(event.data.error || 'PDF worker failed'));
        };

        worker.onerror = (event) => {
            cleanup();
            reject(event.error || new Error(event.message || 'PDF worker failed'));
        };

        worker.postMessage({
            action: 'convertPdfToImages',
            jobId,
            payload: {
                base64OrUrl,
                pageRange,
                rasterConfig: getPdfRasterConfig(options.quality),
                cmapUrl: CMAP_URL,
                standardFontDataUrl: STANDARD_FONT_DATA_URL,
            },
        });
    });
};

const convertPdfToImagesOnMainThread = async (base64OrUrl: string, pageRange?: PdfPageRange, options: PdfRasterOptions = {}): Promise<string[]> => {
    try {
        const pdf = await openPdf(base64OrUrl);
        const pageCount = pdf.numPages;
        const images: string[] = [];
        const start = Math.max(1, pageRange?.start || 1);
        const end = Math.min(pageCount, pageRange?.end || pageCount);
        const rasterConfig = getPdfRasterConfig(options.quality);

        for (let i = start; i <= end; i++) {
            try {
                await yieldToMain();
                const page = await pdf.getPage(i);

                const viewport = page.getViewport({ scale: rasterConfig.scale });

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

                // Nhường lại UI thread trước khi chạy thao tác nặng toDataURL
                await yieldToMain();
                
                // Convert to base64 JPEG
                const imgData = canvas.toDataURL('image/jpeg', rasterConfig.jpegQuality);
                images.push(imgData);
                
                // Nhường thêm 1 nhịp sau khi toDataURL xong (rất nặng CPU)
                await yieldToMain(10);
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

const convertPdfToImagesUncached = async (base64OrUrl: string, pageRange?: PdfPageRange, options: PdfRasterOptions = {}): Promise<string[]> => {
    if (!pdfWorkerUnavailableForSession) {
        try {
            return await measureAsync(`pdf.rasterize.worker.${options.quality || 'standard'}`, () => convertPdfToImagesInWorker(base64OrUrl, pageRange, options));
        } catch (workerError) {
            pdfWorkerUnavailableForSession = true;
            console.warn('PDF worker rasterization unavailable, falling back to main thread canvas:', workerError);
        }
    }

    return measureAsync(`pdf.rasterize.mainThread.${options.quality || 'standard'}`, () => convertPdfToImagesOnMainThread(base64OrUrl, pageRange, options));
};

export const convertPdfToImages = async (base64OrUrl: string, pageRange?: PdfPageRange, options: PdfRasterOptions = {}): Promise<string[]> => {
    const baseHash = await hashStringSha256(base64OrUrl);
    const rangeLabel = `${pageRange?.start || 1}-${pageRange?.end || 'all'}`;
    const quality = options.quality || 'standard';
    const cacheKey = `${baseHash}:${rangeLabel}:${quality}`;
    const cached = pdfRasterCache.get(cacheKey);
    if (cached) return cached;

    const rasterPromise = convertPdfToImagesUncached(base64OrUrl, pageRange, options);
    pdfRasterCache.set(cacheKey, rasterPromise);
    try {
        return await rasterPromise;
    } catch (error) {
        pdfRasterCache.delete(cacheKey);
        throw error;
    }
};
