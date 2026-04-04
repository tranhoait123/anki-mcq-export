import { Explanation } from '../types';

export const formatRichText = (text: string): string => {
  if (!text) return "";
  let html = text;
  
  // Format Tables FIRST before replacing newlines
  if (html.includes('|')) {
    html = html.replace(/((?:\|[^\n]+\| *(?:\r?\n|$))+)/g, (match) => {
      const rows = match.trim().split('\n');
      let tableHtml = '<table border="1" cellpadding="5" style="border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; width: 100%; border-color: #e2e8f0; font-size: 0.9em;">';
      
      let isHeader = true;
      for (const row of rows) {
        if (row.includes('---')) continue; // Skip separator
        
        const cells = row.split('|').map(c => c.trim()).filter(c => c !== '');
        if (cells.length === 0) continue;

        tableHtml += '<tr>';
        for (const cell of cells) {
          if (isHeader) {
            tableHtml += `<th style="background-color: #f8fafc; text-align: left; padding: 6px;">${cell}</th>`;
          } else {
            tableHtml += `<td style="padding: 6px;">${cell}</td>`;
          }
        }
        tableHtml += '</tr>';
        isHeader = false;
      }
      tableHtml += '</table>';
      return tableHtml;
    });
  }

  // Blockquotes: > text
  html = html.replace(/^>\s*(.*)$/gm, '<blockquote style="border-left: 4px solid #cbd5e1; padding-left: 10px; margin-left: 0; color: #475569; font-style: italic; background: #f8fafc; padding: 8px; border-radius: 4px;">$1</blockquote>');

  // Bold: **text** -> <b>text</b>
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  // Italic: *text* -> <i>text</i>
  html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
  
  // Replace newlines with <br>, but avoid breaking HTML tags loosely
  html = html.replace(/\n(?!(<\/tr>|<\/td>|<\/table>|<table|<\/th>|<blockquote|<\/blockquote>))/gi, '<br>');

  return html;
};

export const buildAnkiHtml = (exp: Explanation, difficulty: string, depth: string) => {
  return `<b>🎯 ĐÁP ÁN CỐT LÕI</b><br>
${formatRichText(exp.core)}<br><br>

<b>📚 BẰNG CHỨNG</b><br>
${formatRichText(exp.evidence)}<br><br>

<b>💡 PHÂN TÍCH SÂU</b> (CHẨN ĐOÁN PHÂN BIỆT)<br>
${formatRichText(exp.analysis)}<br><br>

${exp.warning ? `<b>⚠️ CẢNH BÁO LÂM SÀNG</b><br>
${formatRichText(exp.warning)}<br><br>

` : ''}<b>📊 ĐỘ KHÓ:</b> <b>${difficulty}</b><br>
<b>🧠 TƯ DUY:</b> <b>${depth}</b>`.trim();
};
