import { Explanation } from '../types';

export const formatRichText = (text: string): string => {
  if (!text) return "";
  let html = text;
  
  // Format Tables FIRST before replacing newlines
  // This regex matches standard Markdown tables (even without leading | )
  if (html.includes('|')) {
    html = html.replace(/((?:^|\n)[ \t]*(?:\|?.*?\|.*?\n)+(?:\|?[ \t]*:?-+:?[ \t]*\|?.*?\n)(?:\|?.*?\|.*?(?:\n|$))+)/g, (match) => {
      const rows = match.trim().split('\n');
      let tableHtml = '<table border="1" cellpadding="5" style="border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; width: 100%; border-color: #e2e8f0; font-size: 0.9em; background-color: white;">';
      
      let isHeader = true;
      for (const row of rows) {
        if (row.includes('---')) {
          isHeader = false;
          continue; // Skip separator
        }
        
        let cleanedRow = row.trim();
        if (cleanedRow.startsWith('|')) cleanedRow = cleanedRow.substring(1);
        if (cleanedRow.endsWith('|')) cleanedRow = cleanedRow.substring(0, cleanedRow.length - 1);
        
        const cells = cleanedRow.split('|').map(c => c.trim());
        if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) continue;

        tableHtml += '<tr>';
        for (const cell of cells) {
          if (isHeader) {
            tableHtml += `<th style="background-color: #f8fafc; text-align: left; padding: 6px; border: 1px solid #e2e8f0;">${cell}</th>`;
          } else {
            tableHtml += `<td style="padding: 6px; border: 1px solid #e2e8f0;">${cell}</td>`;
          }
        }
        tableHtml += '</tr>';
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
  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; background: #ffffff; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0; text-align: left;">
      <div style="margin-bottom: 16px;">
        <div style="font-weight: bold; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
          🎯 ĐÁP ÁN CỐT LÕI
        </div>
        <div style="font-size: 14px;">${formatRichText(exp.core)}</div>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="font-weight: bold; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
          📚 BẰNG CHỨNG
        </div>
        <div style="font-size: 14px;">${formatRichText(exp.evidence)}</div>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="font-weight: bold; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
          💡 PHÂN TÍCH SÂU (CHẨN ĐOÁN PHÂN BIỆT)
        </div>
        <div style="font-size: 14px;">${formatRichText(exp.analysis)}</div>
      </div>

      ${exp.warning ? `
      <div style="margin-bottom: 16px;">
        <div style="font-weight: bold; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
          ⚠️ CẢNH BÁO LÂM SÀNG
        </div>
        <div style="font-size: 14px;">${formatRichText(exp.warning)}</div>
      </div>` : ''}

      <div style="border-top: 1px solid #f1f5f9; padding-top: 12px; font-size: 13px; color: #475569;">
        <div style="margin-bottom: 4px;">📊 <b>ĐỘ KHÓ:</b> ${difficulty}</div>
        <div>🧠 <b>TƯ DUY:</b> ${formatRichText(depth)}</div>
      </div>
    </div>
  `.replace(/\s+/g, ' ').trim();
};
