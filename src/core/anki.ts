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
  const boxStyle = "padding: 12px; margin-bottom: 8px; border-radius: 8px; border-left: 4px solid;";

  return `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; font-size: 14px;">
        <div style="${boxStyle} border-color: #f43f5e; background-color: #fff1f2; color: #881337;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; align-items: center; gap: 4px;">
            🎯 ĐÁP ÁN CỐT LÕI
          </div>
          ${formatRichText(exp.core)}
        </div>

        <div style="${boxStyle} border-color: #9ca3af; background-color: #f9fafb; color: #4b5563; font-style: italic;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; align-items: center; gap: 4px; font-style: normal;">
            📚 BẰNG CHỨNG
          </div>
          <div style="font-style: normal;">
            ${formatRichText(exp.evidence)}
          </div>
        </div>

        <div style="${boxStyle} border-color: #4f46e5; background-color: #eef2ff; color: #3730a3;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; align-items: center; gap: 4px;">
            💡 PHÂN TÍCH SÂU (CHẨN ĐOÁN PHÂN BIỆT)
          </div>
          ${formatRichText(exp.analysis)}
        </div>

        ${exp.warning ? `
        <div style="${boxStyle} border-color: #d97706; background-color: #fffbeb; color: #92400e;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; align-items: center; gap: 4px;">
             ⚠️ CẢNH BÁO LÂM SÀNG
          </div>
          ${formatRichText(exp.warning)}
        </div>` : ''}

        <div style="margin-top: 16px; border-top: 1px dashed #e5e7eb; padding-top: 12px; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between;">
           <span>📊 ĐỘ KHÓ: <b>${difficulty}</b></span>
           <span>🧠 TƯ DUY: <b>${depth}</b></span>
        </div>
      </div>
  `.replace(/\s+/g, ' ').trim();
};
