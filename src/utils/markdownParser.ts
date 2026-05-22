/**
 * Simple, robust and secure client-side Markdown to HTML parser for MCQ exports.
 * Avoids heavy library dependencies while providing beautiful preview for medical MCQs.
 */

export const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const parseMarkdownToHtml = (markdown: string): string => {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  const htmlLines: string[] = [];
  
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  let inBlockquote = false;

  const closeListIfNeeded = () => {
    if (inList) {
      htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
      listType = null;
    }
  };

  const closeBlockquoteIfNeeded = () => {
    if (inBlockquote) {
      htmlLines.push('</div></blockquote>');
      inBlockquote = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    // 1. Handle empty lines
    if (trimmedLine === '') {
      closeListIfNeeded();
      closeBlockquoteIfNeeded();
      htmlLines.push('<div class="h-2"></div>');
      continue;
    }

    // Escape raw content for security, but we will selectively apply styling HTML tags
    let line = escapeHtml(rawLine);
    let lineTrimmed = line.trim();

    // 2. Handle Blockquotes (clinical vignettes or note blocks)
    if (lineTrimmed.startsWith('&gt;')) {
      closeListIfNeeded();
      
      let blockContent = lineTrimmed.slice(4).trim();
      // Remove additional space if exists
      if (blockContent.startsWith(' ')) {
        blockContent = blockContent.slice(1);
      }

      // Inline formatting
      blockContent = applyInlineFormatting(blockContent);

      if (!inBlockquote) {
        htmlLines.push('<blockquote class="border-l-4 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 px-4 py-3 rounded-r my-2 text-slate-700 dark:text-slate-300 italic"><div class="space-y-1">');
        inBlockquote = true;
      }
      htmlLines.push(`<p>${blockContent}</p>`);
      continue;
    } else {
      closeBlockquoteIfNeeded();
    }

    // 3. Handle Headers (# Title)
    const headerMatch = lineTrimmed.match(/^(\#{1,6})\s+(.+)$/);
    if (headerMatch) {
      closeListIfNeeded();
      const level = headerMatch[1].length;
      const content = applyInlineFormatting(headerMatch[2]);
      
      const sizes: Record<number, string> = {
        1: 'text-2xl font-extrabold text-indigo-700 dark:text-indigo-400 mt-6 mb-3 pb-1 border-b border-slate-200 dark:border-slate-800',
        2: 'text-xl font-bold text-slate-800 dark:text-slate-100 mt-5 mb-2',
        3: 'text-lg font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-2',
        4: 'text-base font-semibold text-slate-700 dark:text-slate-300 mt-3 mb-1',
        5: 'text-sm font-semibold text-slate-600 dark:text-slate-400 mt-2 mb-1',
        6: 'text-xs font-semibold text-slate-500 dark:text-slate-500 mt-2 mb-1',
      };
      
      const className = sizes[level] || sizes[3];
      htmlLines.push(`<h${level} class="${className}">${content}</h${level}>`);
      continue;
    }

    // 4. Handle Lists (unordered and ordered)
    const ulMatch = lineTrimmed.match(/^([*\-+])\s+(.+)$/);
    const olMatch = lineTrimmed.match(/^(\d+)\.\s+(.+)$/);

    if (ulMatch) {
      const content = applyInlineFormatting(ulMatch[2]);
      if (!inList || listType !== 'ul') {
        closeListIfNeeded();
        htmlLines.push('<ul class="list-disc pl-6 space-y-1 my-2 text-slate-600 dark:text-slate-300">');
        inList = true;
        listType = 'ul';
      }
      htmlLines.push(`<li>${content}</li>`);
      continue;
    } else if (olMatch) {
      const content = applyInlineFormatting(olMatch[2]);
      if (!inList || listType !== 'ol') {
        closeListIfNeeded();
        htmlLines.push('<ol class="list-decimal pl-6 space-y-1 my-2 text-slate-600 dark:text-slate-300">');
        inList = true;
        listType = 'ol';
      }
      htmlLines.push(`<li>${content}</li>`);
      continue;
    } else {
      closeListIfNeeded();
    }

    // 5. Normal paragraphs or MCQ option formatting
    // If the line starts with A., B., C., D., E., A), B), C), D), E) or [A], [B] etc.
    const mcqOptionMatch = lineTrimmed.match(/^([A-Ea-e])\s*([.:)\-\]])\s*(.+)$/);
    if (mcqOptionMatch) {
      const optionLetter = mcqOptionMatch[1].toUpperCase();
      const separator = mcqOptionMatch[2];
      const optionContent = applyInlineFormatting(mcqOptionMatch[3]);
      
      htmlLines.push(
        `<div class="flex items-start gap-2 pl-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/50 rounded transition-colors duration-150">` +
        `<span class="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-xs font-bold text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50">${optionLetter}</span>` +
        `<span class="text-slate-700 dark:text-slate-300 pt-0.5">${optionContent}</span>` +
        `</div>`
      );
      continue;
    }

    // Match question indicators like "Câu 1:", "Q2." to highlight questions!
    const questionMatch = lineTrimmed.match(/^((?:Câu|Question|Q|Case)\s*\d+[:.)\-]*)\s*(.*)$/i);
    if (questionMatch) {
      const questionPrefix = questionMatch[1];
      const questionContent = applyInlineFormatting(questionMatch[2]);
      htmlLines.push(
        `<div class="font-bold text-slate-800 dark:text-slate-100 mt-4 mb-2 pb-1 border-b border-slate-100 dark:border-slate-800/50 flex items-start gap-2">` +
        `<span class="px-2 py-0.5 bg-indigo-600 text-white rounded text-xs tracking-wide uppercase font-semibold">${questionPrefix}</span>` +
        `<span>${questionContent}</span>` +
        `</div>`
      );
      continue;
    }

    // Ordinary Paragraph
    const formattedParagraph = applyInlineFormatting(lineTrimmed);
    htmlLines.push(`<p class="text-slate-700 dark:text-slate-300 leading-relaxed">${formattedParagraph}</p>`);
  }

  // Cleanup lingering tags
  closeListIfNeeded();
  closeBlockquoteIfNeeded();

  return htmlLines.join('\n');
};

const applyInlineFormatting = (text: string): string => {
  let result = text;

  // 1. Bold: **text** or __text__
  result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // 2. Italic: *text* or _text_
  result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');
  result = result.replace(/_(.*?)_/g, '<em>$1</em>');

  // 3. Inline code: `code`
  result = result.replace(/`(.*?)`/g, '<code class="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-xs text-rose-500 font-mono">$1</code>');

  return result;
};
