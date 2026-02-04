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
    const boxStyle = "padding: 12px; margin-bottom: 8px; border-radius: 8px; border-left: 4px solid;";

    return `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; font-size: 14px;">
        <div style="${boxStyle} border-color: #f43f5e; background-color: #fff1f2; color: #881337;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px;">
            🎯 ĐÁP ÁN CỐT LÕI
          </div>
          ${exp.core}
        </div>

        <div style="${boxStyle} border-color: #9ca3af; background-color: #f9fafb; color: #4b5563; font-style: italic;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px; font-style: normal;">
            📚 BẰNG CHỨNG
          </div>
          <div>
            ${exp.evidence}
          </div>
        </div>

        <div style="${boxStyle} border-color: #4f46e5; background-color: #eef2ff; color: #3730a3;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px;">
            💡 PHÂN TÍCH SÂU (CHẨN ĐOÁN PHÂN BIỆT)
          </div>
          ${exp.analysis}
        </div>

        ${exp.warning ? `
        <div style="${boxStyle} border-color: #d97706; background-color: #fffbeb; color: #92400e;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px;">
             ⚠️ CẢNH BÁO LÂM SÀNG
          </div>
          ${exp.warning}
        </div>` : ''}

        <div style="margin-top: 16px; border-top: 1px dashed #e5e7eb; padding-top: 12px; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between;">
           <span>📊 ĐỘ KHÓ: <b>${difficulty}</b></span>
           <span>🧠 TƯ DUY: <b>${depth}</b></span>
        </div>
      </div>
  `.replace(/\s+/g, ' ').trim();
};
