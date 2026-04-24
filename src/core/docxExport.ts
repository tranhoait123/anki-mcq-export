import { MCQ } from '../types';
import { isOptionCorrect } from '../utils/text';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const ACCENT_COLOR = '0F766E';
const ACCENT_FILL = 'DFF7EF';
const SECTION_COLOR = '1E293B';
const DOCX_TABLE_WIDTH_TWIPS = 9360;

export const sanitizeDocxText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const cleanQuestion = (text: unknown): string =>
  sanitizeDocxText(text).replace(/^(?:Câu|Question|Bài)\s*\d+[:.]\s*/i, '').replace(/^\d+[:.]\s*/, '').trim();

const cleanOption = (text: unknown): string =>
  sanitizeDocxText(text).replace(/^[A-Ea-e]\s*[:.)]\s*/, '').trim();

export const getCorrectLetter = (mcq: MCQ): string => {
  const options = Array.isArray(mcq.options) ? mcq.options : [];
  const correctIndex = options.findIndex((opt, index) => isOptionCorrect(opt, mcq.correctAnswer || '', index));
  if (correctIndex !== -1) return OPTION_LETTERS[correctIndex];
  return sanitizeDocxText(mcq.correctAnswer || '').match(/^[A-E]/i)?.[0]?.toUpperCase() || 'A';
};

const createRuns = async (text: string, bold = false) => {
  const { TextRun } = await import('docx');
  const clean = sanitizeDocxText(text);
  if (!clean) return [new TextRun({ text: '', bold })];

  const runs = [];
  const pattern = /\*\*(.*?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean)) !== null) {
    if (match.index > lastIndex) runs.push(new TextRun({ text: clean.slice(lastIndex, match.index), bold }));
    runs.push(new TextRun({ text: match[1], bold: true }));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < clean.length) runs.push(new TextRun({ text: clean.slice(lastIndex), bold }));
  return runs.length > 0 ? runs : [new TextRun({ text: clean, bold })];
};

const paragraph = async (text: string, options: any = {}) => {
  const { AlignmentType, Paragraph } = await import('docx');
  return new Paragraph({
    children: await createRuns(text, options.bold),
    alignment: options.alignment ?? AlignmentType.LEFT,
    spacing: options.spacing ?? { after: 120 },
    heading: options.heading,
    bullet: options.bullet,
    shading: options.shading,
  });
};

const sectionHeading = async (label: string) => {
  const { AlignmentType, Paragraph, TextRun } = await import('docx');
  return new Paragraph({
    children: [new TextRun({ text: label, bold: true, color: SECTION_COLOR })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 180, after: 80 },
  });
};

const labeledParagraph = async (label: string, text: string, options: any = {}) => {
  const { AlignmentType, Paragraph, TextRun } = await import('docx');
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: options.labelColor }),
      ...(await createRuns(text)),
    ],
    alignment: options.alignment ?? AlignmentType.LEFT,
    spacing: options.spacing ?? { after: 100 },
    shading: options.shading,
  });
};

interface MarkdownTableBlock {
  type: 'table';
  rows: string[][];
}

interface TextBlock {
  type: 'text';
  lines: string[];
}

type ContentBlock = MarkdownTableBlock | TextBlock;

const isMarkdownTableLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 4;
};

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));

const parseTableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => sanitizeDocxText(cell));

const getTableColumnWidths = (columnCount: number): number[] => {
  const safeColumnCount = Math.max(1, columnCount);
  const baseWidth = Math.floor(DOCX_TABLE_WIDTH_TWIPS / safeColumnCount);
  const widths = Array(safeColumnCount).fill(baseWidth);
  widths[safeColumnCount - 1] += DOCX_TABLE_WIDTH_TWIPS - (baseWidth * safeColumnCount);
  return widths;
};

export const splitMarkdownBlocks = (text: string): ContentBlock[] => {
  const lines = sanitizeDocxText(text).split('\n');
  const blocks: ContentBlock[] = [];
  let textLines: string[] = [];
  let tableRows: string[][] = [];

  const flushText = () => {
    const cleanLines = textLines.map(line => line.trim()).filter(Boolean);
    if (cleanLines.length > 0) blocks.push({ type: 'text', lines: cleanLines });
    textLines = [];
  };

  const flushTable = () => {
    const rows = tableRows.filter(row => !isSeparatorRow(row) && row.some(cell => cell.trim()));
    if (rows.length >= 2) {
      blocks.push({ type: 'table', rows });
    } else if (rows.length === 1) {
      blocks.push({ type: 'text', lines: [rows[0].join(' - ')] });
    }
    tableRows = [];
  };

  for (const line of lines) {
    if (isMarkdownTableLine(line)) {
      flushText();
      tableRows.push(parseTableRow(line));
      continue;
    }
    flushTable();
    textLines.push(line);
  }

  flushTable();
  flushText();
  return blocks;
};

const createDocxTable = async (rows: string[][]) => {
  const {
    AlignmentType,
    BorderStyle,
    Paragraph,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    VerticalAlignTable,
    WidthType,
  } = await import('docx');
  const maxColumns = Math.max(...rows.map(row => row.length));
  const columnWidths = getTableColumnWidths(maxColumns);
  return new Table({
    width: { size: DOCX_TABLE_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
    },
    rows: rows.map((row, rowIndex) => new TableRow({
      children: Array.from({ length: maxColumns }, (_, cellIndex) => new TableCell({
        width: { size: columnWidths[cellIndex], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: rowIndex === 0 ? { fill: 'F1F5F9' } : undefined,
        margins: { top: 90, bottom: 90, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: sanitizeDocxText(row[cellIndex] || ''), bold: rowIndex === 0 })],
            alignment: AlignmentType.LEFT,
            spacing: { after: 0 },
          }),
        ],
      })),
    })),
  });
};

const textBlockParagraphs = async (label: string, text: string) => {
  const value = sanitizeDocxText(text);
  if (!value) return [];
  const children: any[] = [await sectionHeading(label)];

  for (const block of splitMarkdownBlocks(value)) {
    if (block.type === 'table') {
      try {
        children.push(await createDocxTable(block.rows));
      } catch {
        for (const row of block.rows) children.push(await paragraph(row.join(' - '), { spacing: { after: 80 } }));
      }
      continue;
    }

    for (const line of block.lines) {
      children.push(await paragraph(line, { spacing: { after: 80 } }));
    }
  }
  return children;
};

export const buildStudyDocxBlob = async (mcqs: MCQ[], sourceName = 'MCQ Study Export'): Promise<Blob> => {
  const {
    AlignmentType,
    Document,
    HeadingLevel,
    Packer,
    PageBreak,
    Paragraph,
    TextRun,
  } = await import('docx');

  const safeMcqs = Array.isArray(mcqs) ? mcqs : [];
  const children: any[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Tài liệu ôn tập trắc nghiệm', bold: true })],
      spacing: { after: 160 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${sanitizeDocxText(sourceName)} • ${new Date().toLocaleDateString('vi-VN')} • ${safeMcqs.length} câu` })],
      spacing: { after: 320 },
    }),
  ];

  for (const [index, mcq] of safeMcqs.entries()) {
    const correctLetter = getCorrectLetter(mcq);
    const rawOptions = Array.isArray(mcq.options) ? mcq.options : [];
    const explanation = mcq.explanation || { core: '', evidence: '', analysis: '', warning: '' };

    children.push(await paragraph(`Câu ${index + 1}. ${cleanQuestion(mcq.question) || 'Nội dung trống'}`, {
      bold: true,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: index === 0 ? 0 : 260, after: 160 },
    }));

    for (let optionIndex = 0; optionIndex < Math.min(rawOptions.length, OPTION_LETTERS.length); optionIndex++) {
      const letter = OPTION_LETTERS[optionIndex];
      const isCorrect = letter === correctLetter;
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${letter}. `, bold: true }),
          new TextRun({ text: cleanOption(rawOptions[optionIndex]) || ' ', bold: isCorrect }),
          ...(isCorrect ? [new TextRun({ text: '  ✓', bold: true })] : []),
        ],
        spacing: { after: 80 },
      }));
    }

    children.push(await labeledParagraph('Đáp án đúng', correctLetter, {
      labelColor: ACCENT_COLOR,
      shading: { fill: ACCENT_FILL },
      spacing: { before: 160, after: 120 },
    }));
    children.push(...await textBlockParagraphs('Đáp án cốt lõi', explanation.core));
    children.push(...await textBlockParagraphs('Bằng chứng', explanation.evidence));
    children.push(...await textBlockParagraphs('Phân tích sâu', explanation.analysis));
    children.push(...await textBlockParagraphs('Cảnh báo', explanation.warning));

    const meta = [
      mcq.source ? `Nguồn: ${sanitizeDocxText(mcq.source)}` : '',
      mcq.difficulty ? `Độ khó: ${sanitizeDocxText(mcq.difficulty)}` : '',
      mcq.depthAnalysis ? `Tư duy: ${sanitizeDocxText(mcq.depthAnalysis)}` : '',
    ].filter(Boolean).join(' | ');
    if (meta) children.push(await paragraph(meta, { spacing: { after: 160 } }));

    if (index < safeMcqs.length - 1 && (index + 1) % 12 === 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  const doc = new Document({
    creator: 'MCQ AnkiGen Pro',
    title: 'Tài liệu ôn tập trắc nghiệm',
    description: 'DOCX study export generated from MCQ AnkiGen Pro',
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
};
