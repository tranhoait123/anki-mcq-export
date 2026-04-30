import { UploadedFile } from '../../types';
import { parseNativeDocxMcqs } from '../../core/docxNative';

type UploadNotification = {
  type: 'info' | 'warning';
  message: string;
};

interface PreparedDocxUpload {
  content: string;
  fileEnhancements: Partial<UploadedFile>;
  notification?: UploadNotification;
}

export const sanitizeUploadedHtml = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:text/html')) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return template.innerHTML;
};

export const htmlToPlainText = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;
  return (template.content.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const prepareDocxUpload = async (fileName: string, docxBuffer: ArrayBuffer): Promise<PreparedDocxUpload> => {
  const [mammoth, nativeDocx] = await Promise.all([
    import('mammoth'),
    parseNativeDocxMcqs(docxBuffer).catch((error) => {
      console.warn('DOCX native parser fallback:', error);
      return null;
    }),
  ]);
  const result = await mammoth.convertToHtml({ arrayBuffer: docxBuffer });
  let content = sanitizeUploadedHtml(result.value);
  if (!content.trim()) content = '<p>Không tìm thấy văn bản trực tiếp trong file Word.</p>';

  const plainText = nativeDocx?.plainText?.trim() || htmlToPlainText(content);
  const nativeMcqCount = nativeDocx?.mcqs.length || 0;
  const structuredBlockCount = nativeDocx?.structuredBlockCount || nativeMcqCount;
  const markedAnswerCount = nativeDocx?.mcqs.filter((mcq) => Boolean(mcq.correctAnswer)).length || 0;
  const structuredText = nativeDocx?.structuredText || nativeDocx?.nativeText || '';
  const docxImageParts = (nativeDocx?.embeddedImages || [])
    .filter((image) => image.base64.length > 200)
    .map((image) => ({
      name: image.name,
      mimeType: image.mimeType,
      content: image.base64,
      index: image.index,
    }));
  const docxImageCount = docxImageParts.length;
  const unsupportedImageNote = nativeDocx?.unsupportedImageCount
    ? ` Bỏ qua ${nativeDocx.unsupportedImageCount} ảnh không hỗ trợ Vision.`
    : '';

  if (docxImageCount > 0) {
    return {
      content,
      fileEnhancements: {
        plainText,
        nativeText: nativeMcqCount >= 4 && markedAnswerCount > 0 ? nativeDocx?.nativeText : undefined,
        structuredText: structuredBlockCount >= 4 ? structuredText : undefined,
        nativeMcqCount,
        structuredMcqCount: structuredBlockCount,
        docxImageCount,
        docxImageParts,
        docxMode: 'hybrid',
        docxNotice: structuredBlockCount >= 4
          ? `Đã đọc ${structuredBlockCount} block câu từ Word và sẽ quét thêm ${docxImageCount} ảnh nhúng bằng Vision.${unsupportedImageNote}`
          : `DOCX chủ yếu chứa ảnh. App sẽ quét ${docxImageCount} ảnh nhúng bằng Vision.${unsupportedImageNote}`,
      },
      notification: {
        type: 'info',
        message: `DOCX "${fileName}" có ${docxImageCount} ảnh nhúng; app sẽ quét thêm bằng Vision.`,
      },
    };
  }

  if (nativeMcqCount >= 4 && nativeDocx?.nativeText && markedAnswerCount > 0) {
    return {
      content,
      fileEnhancements: {
        plainText,
        nativeText: nativeDocx.nativeText,
        structuredText,
        nativeMcqCount,
        structuredMcqCount: structuredBlockCount,
        docxImageCount,
        docxImageParts,
        docxMode: 'native',
        docxNotice: `DOCX native: nhận diện ${nativeMcqCount} câu, giữ highlight đáp án.${unsupportedImageNote}`,
      },
    };
  }

  if (structuredBlockCount >= 4 && structuredText) {
    return {
      content,
      fileEnhancements: {
        plainText,
        structuredText,
        nativeMcqCount,
        structuredMcqCount: structuredBlockCount,
        docxImageCount,
        docxImageParts,
        docxMode: 'structuredFallback',
        docxNotice: `Đã tách được ${structuredBlockCount} block câu theo marker Câu/Question; AI sẽ giữ từng block và suy luận phần còn thiếu.${unsupportedImageNote}`,
      },
      notification: {
        type: 'info',
        message: `DOCX "${fileName}" đã tách ${structuredBlockCount} block câu theo cấu trúc, AI sẽ suy luận phần còn thiếu.`,
      },
    };
  }

  if (plainText.length >= 300) {
    return {
      content,
      fileEnhancements: {
        plainText,
        nativeMcqCount,
        docxImageCount,
        docxImageParts,
        docxMode: 'textFallback',
        docxNotice: `Không nhận diện đủ cấu trúc A/B/C/D; app sẽ dùng văn bản sạch để AI quét.${unsupportedImageNote}`,
      },
      notification: {
        type: 'info',
        message: `DOCX "${fileName}" chưa tách được MCQ native, sẽ dùng fallback văn bản sạch.`,
      },
    };
  }

  return {
    content,
    fileEnhancements: {
      plainText,
      nativeMcqCount,
      docxImageCount,
      docxImageParts,
      docxMode: 'visionRecommended',
      docxNotice: `DOCX gần như không có text thật. Nên xuất Word sang PDF hoặc ảnh rõ rồi tải lại để dùng Vision.${unsupportedImageNote}`,
    },
    notification: {
      type: 'warning',
      message: `DOCX "${fileName}" có rất ít text. Nên chuyển sang PDF/ảnh để quét Vision.`,
    },
  };
};
