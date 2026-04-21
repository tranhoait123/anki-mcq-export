import { MCQ } from '../types';
import { isOptionCorrect } from '../utils/text';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

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
  const { Paragraph } = await import('docx');
  return new Paragraph({
    children: await createRuns(text, options.bold),
    spacing: options.spacing ?? { after: 120 },
    heading: options.heading,
    bullet: options.bullet,
  });
};

const labeledParagraph = async (label: string, text: string) => {
  const { Paragraph, TextRun } = await import('docx');
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      ...(await createRuns(text)),
    ],
    spacing: { after: 100 },
  });
};

const textBlockParagraphs = async (label: string, text: string) => {
  const value = sanitizeDocxText(text);
  if (!value) return [];
  const paragraphs = [await labeledParagraph(label, value.split('\n')[0])];
  for (const line of value.split('\n').slice(1)) {
    if (line.trim()) paragraphs.push(await paragraph(line.trim(), { spacing: { after: 80 } }));
  }
  return paragraphs;
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

    children.push(await labeledParagraph('Đáp án đúng', correctLetter));
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
