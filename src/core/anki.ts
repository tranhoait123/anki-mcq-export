import { Explanation } from '../types';

export const escapeHtml = (text: any): string => {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/\bon[a-z]+\s*=/gi, 'blocked-attr=')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:text/html')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const decodeBasicEntities = (text: string): string => text
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#x27;/gi, "'");

const cellTextFromHtml = (html: string): string => decodeBasicEntities(html)
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const extractSimpleHtmlTables = (text: string): { text: string; tables: string[] } => {
  const tables: string[] = [];
  const normalizedText = text.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableBlock) => {
    const rows: string[] = [];
    tableBlock.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_rowMatch, rowContent: string) => {
      const cells: string[] = [];
      rowContent.replace(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_cellMatch, tag: string, cellContent: string) => {
        cells.push(`<${tag.toLowerCase()}>${escapeHtml(cellTextFromHtml(cellContent))}</${tag.toLowerCase()}>`);
        return '';
      });
      if (cells.length > 0) rows.push(`<tr>${cells.join('')}</tr>`);
      return '';
    });

    if (rows.length === 0) return tableBlock;
    const token = `@@ANKI_TABLE_${tables.length}@@`;
    tables.push(`<table>${rows.join('')}</table>`);
    return token;
  });

  return { text: normalizedText, tables };
};

export const formatRichText = (text: any): string => {
  if (typeof text !== 'string') return "";
  const extractedTables = extractSimpleHtmlTables(text);
  let html = escapeHtml(extractedTables.text);
  
  if (html.includes('|')) {
    html = html.replace(/((?:\|[^\n]+\| *(?:\r?\n|$))+)/g, (match) => {
      const rows = match.trim().split('\n');
      let tableHtml = '<table>';
      let isHeader = true;
      for (const row of rows) {
        if (row.includes('---')) continue;
        const cells = row.split('|').map(c => c.trim()).filter(c => c !== '');
        if (cells.length === 0) continue;
        tableHtml += '<tr>';
        for (const cell of cells) {
          tableHtml += isHeader ? `<th>${cell}</th>` : `<td>${cell}</td>`;
        }
        tableHtml += '</tr>';
        isHeader = false;
      }
      return tableHtml + '</table>';
    });
  }

  extractedTables.tables.forEach((table, index) => {
    html = html.replace(`@@ANKI_TABLE_${index}@@`, table);
  });

  html = html.replace(/^(?:>|&gt;)\s*(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
  html = html.replace(/\n(?!(<\/tr>|<\/td>|<\/table>|<table|<\/th>|<blockquote|<\/blockquote>))/gi, '<br>');
  return html;
};

export const buildAnkiHtml = (exp: Explanation, difficulty: string, depth: string) => {
  if (!exp) return "<i>Dữ liệu lỗi.</i>";
  const content = `<b>🎯 ĐÁP ÁN CỐT LÕI</b><br>${formatRichText(exp.core || "")}<br><br><b>📚 BẰNG CHỨNG</b><br>${formatRichText(exp.evidence || "")}<br><br><b>💡 PHÂN TÍCH SÂU</b><br>${formatRichText(exp.analysis || "")}<br><br>${exp.warning ? `<b>⚠️ CẢNH BÁO</b><br>${formatRichText(exp.warning)}<br><br>` : ''}<b>📊 ĐỘ KHÓ:</b> <b>${escapeHtml(difficulty || "N/A")}</b><br><b>🧠 TƯ DUY:</b> <b>${escapeHtml(depth || "N/A")}</b>`;
  return content;
};
