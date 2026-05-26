import { MCQ } from '../types';
import { isOptionCorrect } from '../utils/text';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const ACCENT_COLOR = '0F766E';
const ACCENT_FILL = 'DFF7EF';
const SECTION_COLOR = '1E293B';
const MUTED_COLOR = '64748B';
const PAGE_BG = 'F8FAFC';
const BORDER_COLOR = 'CBD5E1';
const TABLE_HEADER_FILL = 'F1F5F9';
const QUESTION_FILL = 'EFF6FF';
const OPTION_FILL = 'FFFFFF';
const OPTION_CORRECT_FILL = 'DFF7EF';
const DOCX_TABLE_WIDTH_TWIPS = 9360;
const MAX_MARKDOWN_TABLE_COLUMNS = 6;

type DocxChild = any;

export const sanitizeDocxText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const cleanQuestion = (text: unknown): string => {
  let cleaned = sanitizeDocxText(text);
  // Remove generated tags entirely for a seamless reading experience
  cleaned = cleaned.replace(/\[TÌNH HUỐNG\]\s*/gi, '');
  cleaned = cleaned.replace(/\[TÌNH HUỐNG LÂM SÀNG\]\s*/gi, '');
  cleaned = cleaned.replace(/\[CÂU HỎI\]\s*/gi, '');
  // Strip <<<MCQ ...>>> wrappers
  cleaned = cleaned.replace(/^\s*<<<[^>]+>>>\s*/i, '');
  // Strip Question/Câu prefixes, strictly requiring a number or colon/dot to avoid eating words like "Câu hỏi"
  cleaned = cleaned.replace(/^\s*(?:(?:Câu|Question|Bài)(?:\s*\d+[:.]?|\s*[:.])\s+|\d+[:.]\s+)/i, '');
  // Strip trailing options safely: ONLY if preceded by a newline or sentence terminator like ?, :, or .
  cleaned = cleaned.replace(/(^|\n|<br>|<br\/>|<br \/>|\t|[?:.]\s+)(A[.)]\s+[\s\S]*?(?:\s+|^)B[.)]\s+[\s\S]*?(?:\s+|^)C[.)]\s+[\s\S]*)$/i, '$1');
  return cleaned.trim();
};

const cleanOption = (text: unknown): string =>
  sanitizeDocxText(text).replace(/^[A-Ea-e]\s*[:.)]\s*/, '').trim();

export const getCorrectLetter = (mcq: MCQ): string => {
  const safeMcq = mcq || ({} as MCQ);
  const options = Array.isArray(safeMcq.options) ? safeMcq.options : [];
  const correctIndex = options.findIndex((opt, index) => isOptionCorrect(opt, safeMcq.correctAnswer || '', index));
  if (correctIndex !== -1) return OPTION_LETTERS[correctIndex];
  return sanitizeDocxText(safeMcq.correctAnswer || '').match(/^[A-E]/i)?.[0]?.toUpperCase() || 'A';
};

const getSafeOptions = (mcq: Partial<MCQ> | null | undefined): string[] => {
  const options = Array.isArray(mcq?.options) ? mcq.options : [];
  return options.slice(0, OPTION_LETTERS.length).map(cleanOption);
};

const getSafeExplanation = (mcq: Partial<MCQ> | null | undefined) => ({
  core: sanitizeDocxText(mcq?.explanation?.core),
  evidence: sanitizeDocxText(mcq?.explanation?.evidence),
  analysis: sanitizeDocxText(mcq?.explanation?.analysis),
  warning: sanitizeDocxText(mcq?.explanation?.warning),
});

const createRuns = async (text: string, bold = false, options: any = {}) => {
  const { TextRun } = await import('docx');
  const clean = sanitizeDocxText(text);
  const runDefaults = {
    bold,
    color: options.color,
    size: options.size,
    italics: options.italics,
  };
  if (!clean) return [new TextRun({ text: '', ...runDefaults })];

  const runs = [];
  const pattern = /\*\*(.*?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean)) !== null) {
    if (match.index > lastIndex) runs.push(new TextRun({ text: clean.slice(lastIndex, match.index), ...runDefaults }));
    runs.push(new TextRun({ text: match[1], ...runDefaults, bold: true }));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < clean.length) runs.push(new TextRun({ text: clean.slice(lastIndex), ...runDefaults }));
  return runs.length > 0 ? runs : [new TextRun({ text: clean, ...runDefaults })];
};

const paragraph = async (text: string, options: any = {}) => {
  const { AlignmentType, Paragraph } = await import('docx');
  return new Paragraph({
    children: await createRuns(text, options.bold, { color: options.color, size: options.size, italics: options.italics }),
    alignment: options.alignment ?? AlignmentType.LEFT,
    spacing: options.spacing ?? { after: 120 },
    heading: options.heading,
    bullet: options.bullet,
    shading: options.shading,
    border: options.border,
    indent: options.indent,
  });
};

const sectionHeading = async (label: string, color = SECTION_COLOR) => {
  const { AlignmentType, Paragraph, TextRun } = await import('docx');
  return new Paragraph({
    children: [new TextRun({ text: label, bold: true, color })],
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

const safeCellText = (value: unknown): string => sanitizeDocxText(value).replace(/\n+/g, ' ');

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
  if (maxColumns > MAX_MARKDOWN_TABLE_COLUMNS) {
    throw new Error(`Markdown table has ${maxColumns} columns, over the safe DOCX limit`);
  }
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
        shading: rowIndex === 0 ? { fill: TABLE_HEADER_FILL } : undefined,
        margins: { top: 90, bottom: 90, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: safeCellText(row[cellIndex] || ''), bold: rowIndex === 0 })],
            alignment: AlignmentType.LEFT,
            spacing: { after: 0 },
          }),
        ],
      })),
    })),
  });
};

const createFallbackRows = async (rows: string[][]): Promise<DocxChild[]> => {
  const children: DocxChild[] = [];
  for (const row of rows) {
    children.push(await paragraph(row.map(safeCellText).filter(Boolean).join(' - '), { spacing: { after: 80 } }));
  }
  return children;
};

const textBlockParagraphs = async (label: string, text: string, color = SECTION_COLOR) => {
  const value = sanitizeDocxText(text);
  if (!value) return [];
  const children: DocxChild[] = [await sectionHeading(label, color)];

  for (const block of splitMarkdownBlocks(value)) {
    if (block.type === 'table') {
      try {
        children.push(await createDocxTable(block.rows));
      } catch {
        children.push(...await createFallbackRows(block.rows));
      }
      continue;
    }

    for (const line of block.lines) {
      children.push(await paragraph(line, { spacing: { after: 80 } }));
    }
  }
  return children;
};

const createThinBorder = (color = BORDER_COLOR) => ({
  top: { color, space: 1, style: 'single', size: 2 },
  bottom: { color, space: 1, style: 'single', size: 2 },
  left: { color, space: 1, style: 'single', size: 2 },
  right: { color, space: 1, style: 'single', size: 2 },
});

const createOverviewTable = async (safeMcqs: Partial<MCQ>[]) => {
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

  const difficultyCounts = new Map<string, number>();
  for (const mcq of safeMcqs) {
    const difficulty = sanitizeDocxText(mcq?.difficulty) || 'Chưa phân loại';
    difficultyCounts.set(difficulty, (difficultyCounts.get(difficulty) || 0) + 1);
  }

  const rows = [
    ['Phân bố', 'Số câu'],
    ...(difficultyCounts.size > 0
      ? Array.from(difficultyCounts.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'vi'))
        .map(([difficulty, count]) => [difficulty, String(count)])
      : [['Chưa có câu hỏi', '0']]),
  ];
  const columnWidths = [6500, DOCX_TABLE_WIDTH_TWIPS - 6500];

  return new Table({
    width: { size: DOCX_TABLE_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
    },
    rows: rows.map((row, rowIndex) => new TableRow({
      children: row.map((cell, cellIndex) => new TableCell({
        width: { size: columnWidths[cellIndex], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: rowIndex === 0 ? TABLE_HEADER_FILL : 'FFFFFF' },
        margins: { top: 110, bottom: 110, left: 140, right: 140 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: cell, bold: rowIndex === 0 })],
            alignment: cellIndex === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { after: 0 },
          }),
        ],
      })),
    })),
  });
};

const createOverview = async (safeMcqs: Partial<MCQ>[], sourceName: string): Promise<DocxChild[]> => {
  const { AlignmentType, HeadingLevel, PageBreak, Paragraph, TextRun } = await import('docx');
  const children: DocxChild[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Tài liệu ôn tập trắc nghiệm', bold: true, color: SECTION_COLOR })],
      spacing: { after: 140 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: `${sanitizeDocxText(sourceName)} | ${new Date().toLocaleDateString('vi-VN')} | ${safeMcqs.length} câu`,
        color: MUTED_COLOR,
      })],
      spacing: { after: 260 },
    }),
    await paragraph('Tổng quan', {
      bold: true,
      color: SECTION_COLOR,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 80, after: 120 },
    }),
    await createOverviewTable(safeMcqs),
    await paragraph('Ghi chú: đáp án đúng được đánh dấu ngay dưới từng câu để rà nhanh khi học hoặc in ra giấy.', {
      color: MUTED_COLOR,
      italics: true,
      spacing: { before: 220, after: safeMcqs.length > 0 ? 120 : 320 },
    }),
  ];

  if (safeMcqs.length > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
  return children;
};

const createQuestionHeader = async (index: number, question: string) => paragraph(`Câu ${index + 1}. ${question || 'Nội dung trống'}`, {
  bold: true,
  color: SECTION_COLOR,
  shading: { fill: QUESTION_FILL },
  border: createThinBorder('BFDBFE'),
  spacing: { before: index === 0 ? 0 : 260, after: 160 },
});

const createOptionsTable = async (rawOptions: string[], correctLetter: string) => {
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

  const options = rawOptions.length > 0 ? rawOptions : [''];
  const rows = options.map((option, index) => {
    const letter = OPTION_LETTERS[index] || '';
    const isCorrect = letter === correctLetter;
    return new TableRow({
      children: [
        new TableCell({
          width: { size: 720, type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: isCorrect ? ACCENT_COLOR : TABLE_HEADER_FILL },
          margins: { top: 90, bottom: 90, left: 90, right: 90 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: letter || '-', bold: true, color: isCorrect ? 'FFFFFF' : SECTION_COLOR })],
              alignment: AlignmentType.CENTER,
              spacing: { after: 0 },
            }),
          ],
        }),
        new TableCell({
          width: { size: DOCX_TABLE_WIDTH_TWIPS - 720, type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: isCorrect ? OPTION_CORRECT_FILL : OPTION_FILL },
          margins: { top: 90, bottom: 90, left: 140, right: 140 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: option || ' ', bold: isCorrect }),
                ...(isCorrect ? [new TextRun({ text: '  ✓', bold: true, color: ACCENT_COLOR })] : []),
              ],
              alignment: AlignmentType.LEFT,
              spacing: { after: 0 },
            }),
          ],
        }),
      ],
    });
  });

  return new Table({
    width: { size: DOCX_TABLE_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths: [720, DOCX_TABLE_WIDTH_TWIPS - 720],
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
    },
    rows,
  });
};

const createAnswerBox = async (correctLetter: string) => labeledParagraph('Đáp án đúng', correctLetter, {
  labelColor: ACCENT_COLOR,
  shading: { fill: ACCENT_FILL },
  border: createThinBorder('99F6E4'),
  spacing: { before: 160, after: 120 },
});

const createExplanationSections = async (explanation: ReturnType<typeof getSafeExplanation>): Promise<DocxChild[]> => {
  const sections = [
    ['Đáp án cốt lõi', explanation.core, ACCENT_COLOR],
    ['Bằng chứng', explanation.evidence, '475569'],
    ['Phân tích sâu', explanation.analysis, '4F46E5'],
    ['Cảnh báo', explanation.warning, 'B45309'],
  ] as const;
  const children: DocxChild[] = [];

  for (const [label, value, color] of sections) {
    try {
      children.push(...await textBlockParagraphs(label, value, color));
    } catch {
      const fallback = sanitizeDocxText(value);
      if (fallback) children.push(await paragraph(`${label}: ${fallback}`, { spacing: { after: 100 } }));
    }
  }

  return children;
};

const createMetadataLine = async (mcq: Partial<MCQ>): Promise<DocxChild[]> => {
  const meta = [
    mcq.source ? `Nguồn: ${sanitizeDocxText(mcq.source)}` : '',
    mcq.difficulty ? `Độ khó: ${sanitizeDocxText(mcq.difficulty)}` : '',
    mcq.depthAnalysis ? `Tư duy: ${sanitizeDocxText(mcq.depthAnalysis)}` : '',
  ].filter(Boolean).join(' | ');
  return meta
    ? [await paragraph(meta, { color: MUTED_COLOR, size: 18, spacing: { before: 100, after: 160 } })]
    : [];
};

const createMcqBlock = async (mcq: Partial<MCQ>, index: number): Promise<DocxChild[]> => {
  const question = cleanQuestion(mcq?.question);
  const options = getSafeOptions(mcq);
  const correctLetter = getCorrectLetter(mcq as MCQ);
  const explanation = getSafeExplanation(mcq);
  const children: DocxChild[] = [];

  try {
    children.push(await createQuestionHeader(index, question));
    children.push(await createOptionsTable(options, correctLetter));
    children.push(await createAnswerBox(correctLetter));
    children.push(...await createExplanationSections(explanation));
    children.push(...await createMetadataLine(mcq));
  } catch {
    children.push(await paragraph(`Câu ${index + 1}. ${question || 'Nội dung trống'}`, {
      bold: true,
      spacing: { before: index === 0 ? 0 : 260, after: 120 },
    }));
    for (const [optionIndex, option] of options.entries()) {
      children.push(await paragraph(`${OPTION_LETTERS[optionIndex]}. ${option}`, { spacing: { after: 80 } }));
    }
    children.push(await paragraph(`Đáp án đúng: ${correctLetter}`, { bold: true, spacing: { after: 120 } }));
  }

  return children;
};

export const buildStudyDocxBlob = async (mcqs: MCQ[], sourceName = 'MCQ Study Export'): Promise<Blob> => {
  const {
    Document,
    Packer,
    PageBreak,
    Paragraph,
  } = await import('docx');

  const safeMcqs = Array.isArray(mcqs) ? mcqs.filter(Boolean) : [];
  const children: DocxChild[] = await createOverview(safeMcqs, sourceName);

  for (const [index, mcq] of safeMcqs.entries()) {
    children.push(...await createMcqBlock(mcq, index));

    if (index < safeMcqs.length - 1 && (index + 1) % 12 === 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  const doc = new Document({
    creator: 'MCQ AnkiGen Pro',
    title: 'Tài liệu ôn tập trắc nghiệm',
    description: 'DOCX study export generated from MCQ AnkiGen Pro',
    background: { color: PAGE_BG },
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
};
