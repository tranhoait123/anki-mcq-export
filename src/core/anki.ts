import { Explanation } from '../types';

// Minified styles for Anki & Preview - Maximum efficiency, 100% stable
const ANKI_STYLES = `<style>.m-t{width:100%;border-collapse:collapse;margin:10px 0;border:1px solid #8884;font-size:.9em}.m-t th{background:#8882;text-align:left;padding:6px;border:1px solid #8882}.m-t td{padding:6px;border:1px solid #8881}.m-q{border-left:4px solid #6366f1;padding:8px;margin:10px 0;background:#8881;font-style:italic}</style>`;

export const formatRichText = (text: any): string => {
  if (typeof text !== 'string') return "";
  let html = text;
  
  if (html.includes('|')) {
    html = html.replace(/((?:\|[^\n]+\| *(?:\r?\n|$))+)/g, (match) => {
      const rows = match.trim().split('\n');
      let tableHtml = '<table class="m-t">';
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

  html = html.replace(/^>\s*(.*)$/gm, '<blockquote class="m-q">$1</blockquote>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
  html = html.replace(/\n(?!(<\/tr>|<\/td>|<\/table>|<table|<\/th>|<blockquote|<\/blockquote>))/gi, '<br>');
  return html;
};

export const buildAnkiHtml = (exp: Explanation, difficulty: string, depth: string) => {
  if (!exp) return "<i>Dữ liệu lỗi.</i>";
  const content = `<b>🎯 ĐÁP ÁN CỐT LÕI</b><br>${formatRichText(exp.core || "")}<br><br><b>📚 BẰNG CHỨNG</b><br>${formatRichText(exp.evidence || "")}<br><br><b>💡 PHÂN TÍCH SÂU</b><br>${formatRichText(exp.analysis || "")}<br><br>${exp.warning ? `<b>⚠️ CẢNH BÁO</b><br>${formatRichText(exp.warning)}<br><br>` : ''}<b>📊 ĐỘ KHÓ:</b> <b>${difficulty || "N/A"}</b><br><b>🧠 TƯ DUY:</b> <b>${depth || "N/A"}</b>`;
  return ANKI_STYLES + content;
};
