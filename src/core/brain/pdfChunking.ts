import { PDFDocument } from 'pdf-lib';
import { PdfPageRange } from '../../utils/pdfProcessor';

export const getPdfPageCount = async (base64Data: string): Promise<number> => {
  const doc = await PDFDocument.load(base64Data);
  return doc.getPageCount();
};

export const getPdfPageRanges = (totalPages: number, pagesPerChunk: number = 3, overlap: number = 1): PdfPageRange[] => {
  const ranges: PdfPageRange[] = [];
  const step = Math.max(1, pagesPerChunk - overlap);
  for (let start = 1; start <= totalPages; start += step) {
    const end = Math.min(totalPages, start + pagesPerChunk - 1);
    ranges.push({ start, end });
    if (end === totalPages) break;
  }
  return ranges;
};

export const splitPdfByRanges = async (base64Data: string, ranges: PdfPageRange[]): Promise<string[]> => {
  const pdfDoc = await PDFDocument.load(base64Data);
  const chunks: string[] = [];
  const totalPages = pdfDoc.getPageCount();

  for (const range of ranges) {
    const subDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: Math.max(0, range.end - range.start + 1) }, (_, k) => range.start - 1 + k);
    const validIndices = pageIndices.filter(index => index < totalPages);
    if (validIndices.length === 0) break;

    const copyPages = await subDoc.copyPages(pdfDoc, validIndices);
    copyPages.forEach((page) => subDoc.addPage(page));
    const base64 = await subDoc.saveAsBase64();
    chunks.push(base64);
  }
  return chunks;
};
