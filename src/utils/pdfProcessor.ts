// Local Assets Strategy:
// CMaps and fonts are served locally from public/ for offline stability.
const getAssetUrl = (path: string) => {
    return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
};

const CMAP_URL = getAssetUrl('/cmaps/');
const STANDARD_FONT_DATA_URL = getAssetUrl('/standard_fonts/');

export type PdfPageQuality = 'goodText' | 'suspect' | 'scanOrEmpty';

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

const QUESTION_MARKER_PATTERN = /(?:^|\n)\s*(?:câu|cau|question|q)\s*\d+\s*[:.)-]/gi;
const OPTION_MARKER_PATTERN = /(?:^|\n)\s*(?:\(?[A-E]\)?\s*[\.:)-])/gi;
const QUESTION_LINE_PATTERN = /^(?:câu|cau|question|q)\s*\d+\s*[:.)-]/i;
const OPTION_LINE_PATTERN = /^\(?([A-E])\)?\s*[\.:)-]\s*(.+)$/i;
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

const normalizePdfText = (value: string): string =>
    value
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

export const scorePdfTextPage = (text: string, pageNumber = 1): PdfTextPage => {
    const cleanText = normalizePdfText(text);
    const charCount = cleanText.length;
    const weirdCharRatio = getWeirdCharRatio(cleanText);
    const mcqMarkerCount = countMatches(cleanText, QUESTION_MARKER_PATTERN);
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
    const blocks: { question: string[]; options: { letter: string; text: string }[] }[] = [];
    let current: { question: string[]; options: { letter: string; text: string }[] } | null = null;

    const flush = () => {
        if (current && current.question.length > 0 && current.options.length >= 4) {
            const letters = current.options.slice(0, 4).map((option) => option.letter).join('');
            const uniqueLetters = new Set(current.options.map((option) => option.letter));
            if (letters === 'ABCD' && uniqueLetters.size === current.options.length) blocks.push(current);
        }
        current = null;
    };

    for (const line of lines) {
        const optionMatch = line.match(OPTION_LINE_PATTERN);
        if (QUESTION_LINE_PATTERN.test(line)) {
            flush();
            current = { question: [line], options: [] };
            continue;
        }
        if (optionMatch && current) {
            current.options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
            continue;
        }
        if (!current) {
            current = { question: [line], options: [] };
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

    return blocks.map((block, index) => [
        `<<<MCQ ${index + 1}>>>`,
        `Question: ${block.question.join(' ').replace(/\s+/g, ' ').trim()}`,
        ...block.options.map((option) => `${option.letter}. ${option.text.replace(/\s+/g, ' ').trim()}`),
    ].join('\n'));
};

const buildStructuredPdfText = (blocks: string[]): string => `[PDF_TEXT_MCQ_COUNT: ${blocks.length}]\n\n${blocks.join('\n\n')}`;

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

    for (const range of ranges) {
        const rangePages = pages.slice(range.start - 1, range.end);
        const allGood = rangePages.length > 0 && rangePages.every((page) => page.quality === 'goodText');
        if (allGood) {
            const joinedText = rangePages.map((page) => page.text).join('\n\n');
            const blocks = parseMcqBlocksFromText(joinedText);
            const sparseBlockRisk = joinedText.length > 2500 && blocks.length < 2;
            if (blocks.length > 0 && !sparseBlockRisk) {
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

    const detectedMcqCount = textBatches.reduce((total, batch) => total + batch.expectedQuestions, 0);
    const mode = textBatches.length === 0 ? 'vision' : (visionPageRanges.length === 0 ? 'textOnlyCandidate' : 'safeHybrid');
    return { pageCount, pages, textBatches, visionPageRanges, detectedMcqCount, mode };
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

export const analyzePdfTextLayer = async (base64OrUrl: string, pagesPerChunk = 3, overlap = 1, structuredBatchSize = 10): Promise<PdfTextAnalysis> => {
    const pdf = await openPdf(base64OrUrl);
    const samplePages = Math.min(3, pdf.numPages);
    const sampled: PdfTextPage[] = [];

    for (let pageNumber = 1; pageNumber <= samplePages; pageNumber++) {
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

export const convertPdfToImages = async (base64OrUrl: string, pageRange?: PdfPageRange): Promise<string[]> => {
    try {
        const pdf = await openPdf(base64OrUrl);
        const pageCount = pdf.numPages;
        const images: string[] = [];
        const start = Math.max(1, pageRange?.start || 1);
        const end = Math.min(pageCount, pageRange?.end || pageCount);

        for (let i = start; i <= end; i++) {
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
