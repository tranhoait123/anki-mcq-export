import { Explanation } from '../types';

export const formatRichText = (text: string): string => {
  if (!text) return "";
  let html = text;
  // Bold: **text** -> <b>text</b>
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  // Italic: *text* -> <i>text</i>
  html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
  // Newlines to <br> if needed, but usually Anki handles newlines in fields if quoted.
  // For safety in HTML fields:
  html = html.replace(/\n/g, '<br>');
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
