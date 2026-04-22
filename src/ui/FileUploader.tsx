import React, { useCallback, useState } from 'react';
import { UploadCloud, FileText, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { UploadedFile } from '../types';
import { toast } from 'sonner';
import { parseNativeDocxMcqs } from '../core/docxNative';

interface FileUploaderProps {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
}

// 3MB chunk size (Divisible by 3 to ensure safe Base64 concatenation for PDFs)
const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const sanitizeUploadedHtml = (html: string): string => {
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

const htmlToPlainText = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;
  return (template.content.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

const getDocxModeBadge = (file: UploadedFile) => {
  if (file.docxMode === 'hybrid') return {
    text: `DOCX hybrid: ${file.nativeMcqCount || file.structuredMcqCount || 0} câu / ${file.docxImageCount || 0} ảnh`,
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  };
  if (file.docxMode === 'native') return {
    text: `DOCX native: ${file.nativeMcqCount || 0} câu`,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  };
  if (file.docxMode === 'structuredFallback') return {
    text: `DOCX structured: ${file.structuredMcqCount || file.nativeMcqCount || 0} câu`,
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  };
  if (file.docxMode === 'textFallback') return {
    text: 'DOCX text fallback',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  };
  if (file.docxMode === 'visionRecommended') return {
    text: 'Nên dùng PDF/Ảnh',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  };
  return null;
};

const getPdfModeBadge = (file: UploadedFile) => {
  if (file.type !== 'application/pdf') return null;
  if (file.pdfMode === 'safeHybrid') return {
    text: `PDF hybrid: ${file.pdfTextBatchCount || 0} text / ${file.pdfVisionBatchCount || 0} vision`,
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  };
  if (file.pdfMode === 'textOnlyCandidate') return {
    text: `PDF text: ${file.pdfTextMcqCount || 0} câu`,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  };
  return {
    text: 'PDF vision',
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  };
};

const FileUploader: React.FC<FileUploaderProps> = ({ files, setFiles }) => {

  const updateFileProgress = useCallback((fileName: string, progress: number) => {
    setFiles(prev => prev.map(f => {
      if (f.name === fileName) {
        return { ...f, progress };
      }
      return f;
    }));
  }, [setFiles]);

  const readSliceAsText = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
  };

  const readSliceAsArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  };

  const readSliceAsBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // Remove data URL prefix (e.g., "data:application/octet-stream;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const processFile = useCallback(async (file: File) => {
    // Prevent duplicate processing
    if (files.some(f => f.name === file.name)) return;

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File ${file.name} vượt quá giới hạn 50MB. Vui lòng nén hoặc chia nhỏ file.`);
      return;
    }

    // Create a placeholder for the file being processed
    setFiles(prev => [
      ...prev,
      {
        id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: file.name,
        type: file.type,
        content: "",
        isProcessing: true,
        progress: 0
      }
    ]);

    try {
      let content = "";
      let fileEnhancements: Partial<UploadedFile> = {};
      let offset = 0;
      const totalSize = file.size;

      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        // PDF & Image Processing (treat as Base64 chunks)
        const chunks: string[] = [];

        while (offset < totalSize) {
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const chunkBase64 = await readSliceAsBase64(slice);
          chunks.push(chunkBase64);
          offset += CHUNK_SIZE;

          const progress = Math.min(99, Math.round((offset / totalSize) * 100));
          updateFileProgress(file.name, progress);

          // Yield to main thread
          await new Promise(r => setTimeout(r, 0));
        }
        content = chunks.join('');
        if (file.type === 'application/pdf') {
          fileEnhancements = {
            pdfMode: 'vision',
            pdfNotice: 'PDF sẽ dùng Safe Hybrid khi quét: text layer sạch sẽ chạy nhanh, batch nghi ngờ vẫn dùng Vision.',
          };
        }

      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.toLowerCase().endsWith('.docx')) {
        // DOCX Chunked Reading (Mammoth needs full buffer, so we aggregate chunks)
        const chunks: ArrayBuffer[] = [];

        while (offset < totalSize) {
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const chunkBuffer = await readSliceAsArrayBuffer(slice);
          chunks.push(chunkBuffer);
          offset += CHUNK_SIZE;

          const progress = Math.min(90, Math.round((offset / totalSize) * 100)); // Reserve last 10% for parsing
          updateFileProgress(file.name, progress);

          // Yield to main thread
          await new Promise(r => setTimeout(r, 0));
        }

        // Combine chunks
        const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
        const fullBuffer = new Uint8Array(totalLen);
        let pos = 0;
        for (const c of chunks) {
          fullBuffer.set(new Uint8Array(c), pos);
          pos += c.byteLength;
        }

        updateFileProgress(file.name, 95);
        const docxBuffer = fullBuffer.buffer.slice(0);
        const [mammoth, nativeDocx] = await Promise.all([
          import('mammoth'),
          parseNativeDocxMcqs(docxBuffer).catch((error) => {
            console.warn('DOCX native parser fallback:', error);
            return null;
          }),
        ]);
        const result = await mammoth.convertToHtml({ arrayBuffer: docxBuffer });
        content = sanitizeUploadedHtml(result.value);
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
          fileEnhancements = {
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
          };
          toast.info(`DOCX "${file.name}" có ${docxImageCount} ảnh nhúng; app sẽ quét thêm bằng Vision.`);
        } else if (nativeMcqCount >= 4 && nativeDocx?.nativeText && markedAnswerCount > 0) {
          fileEnhancements = {
            plainText,
            nativeText: nativeDocx.nativeText,
            structuredText,
            nativeMcqCount,
            structuredMcqCount: structuredBlockCount,
            docxImageCount,
            docxImageParts,
            docxMode: 'native',
            docxNotice: `DOCX native: nhận diện ${nativeMcqCount} câu, giữ highlight đáp án.${unsupportedImageNote}`,
          };
        } else if (structuredBlockCount >= 4 && structuredText) {
          fileEnhancements = {
            plainText,
            structuredText,
            nativeMcqCount,
            structuredMcqCount: structuredBlockCount,
            docxImageCount,
            docxImageParts,
            docxMode: 'structuredFallback',
            docxNotice: `Đã tách được ${structuredBlockCount} block câu theo marker Câu/Question; AI sẽ giữ từng block và suy luận phần còn thiếu.${unsupportedImageNote}`,
          };
          toast.info(`DOCX "${file.name}" đã tách ${structuredBlockCount} block câu theo cấu trúc, AI sẽ suy luận phần còn thiếu.`);
        } else if (plainText.length >= 300) {
          fileEnhancements = {
            plainText,
            nativeMcqCount,
            docxImageCount,
            docxImageParts,
            docxMode: 'textFallback',
            docxNotice: `Không nhận diện đủ cấu trúc A/B/C/D; app sẽ dùng văn bản sạch để AI quét.${unsupportedImageNote}`,
          };
          toast.info(`DOCX "${file.name}" chưa tách được MCQ native, sẽ dùng fallback văn bản sạch.`);
        } else {
          fileEnhancements = {
            plainText,
            nativeMcqCount,
            docxImageCount,
            docxImageParts,
            docxMode: 'visionRecommended',
            docxNotice: `DOCX gần như không có text thật. Nên xuất Word sang PDF hoặc ảnh rõ rồi tải lại để dùng Vision.${unsupportedImageNote}`,
          };
          toast.warning(`DOCX "${file.name}" có rất ít text. Nên chuyển sang PDF/ảnh để quét Vision.`);
        }

      } else {
        // Text Processing (txt, md, etc.)
        while (offset < totalSize) {
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const chunkText = await readSliceAsText(slice);
          content += chunkText;
          offset += CHUNK_SIZE;

          const progress = Math.min(99, Math.round((offset / totalSize) * 100));
          updateFileProgress(file.name, progress);

          // Yield to main thread
          await new Promise(r => setTimeout(r, 0));
        }
      }

      // Update the file content and remove processing flag
      setFiles(prev => prev.map(f => {
        if (f.name === file.name) {
          return { ...f, content, ...fileEnhancements, isProcessing: false, progress: 100 };
        }
        return f;
      }));

    } catch (error) {
      console.error("Error processing file:", error);
      // Remove the failed file
      setFiles(prev => prev.filter(f => f.name !== file.name));
      toast.error(`Lỗi khi đọc file ${file.name}: ${error instanceof Error ? error.message : "Định dạng không hỗ trợ"}`);
    }
  }, [files, setFiles, updateFileProgress]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    droppedFiles.forEach(processFile);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(processFile);
    }
    // Reset value to allow re-uploading same file if needed
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const [isDragActive, setIsDragActive] = useState(false);

  return (
    <div className="w-full space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(e) => { setIsDragActive(false); handleDrop(e); }}
        onClick={() => document.getElementById('fileInput')?.click()}
        className={`relative border-2 border-dashed rounded-3xl p-10 transition-all cursor-pointer group flex flex-col items-center justify-center text-center
          ${isDragActive
            ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/20 scale-[1.02]'
            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:border-indigo-400 hover:bg-white dark:hover:bg-slate-800'
          }`}
      >
        <input
          type="file"
          id="fileInput"
          multiple
          accept=".pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.webp,.heic"
          className="hidden"
          onChange={handleInputChange}
        />
        <div className="pro-gradient p-4 rounded-2xl shadow-lg shadow-indigo-100 dark:shadow-none mb-4 group-hover:scale-110 transition-all">
          <UploadCloud size={32} className="text-white" />
        </div>
        <div>
          <p className="font-black text-slate-800 dark:text-white uppercase tracking-tighter text-lg leading-tight">Kéo thả hoặc nhấn để tải tài liệu</p>
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mt-1 mb-4 text-center">Tài liệu tải lên phải có nội dung trắc nghiệm</p>
          <p className="inline-block px-4 py-1.5 bg-slate-200/50 dark:bg-slate-800 rounded-full text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest border border-slate-100 dark:border-slate-700">
            Hỗ trợ: PDF / Ảnh / Word (Tối đa 50MB/file)
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-gray-100 dark:border-slate-800 p-4">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Tài liệu đã chọn ({files.length})</h3>
          <ul className="space-y-2">
            {files.map((file, idx) => (
              <li key={idx} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-800 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition">
                <div className="flex items-center space-x-3 overflow-hidden flex-1">
                  <div className={`p-2 rounded ${file.isProcessing ? 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-100' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-100'}`}>
                    {file.isProcessing ? <Loader2 size={20} className="animate-spin" /> : <FileText size={20} />}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium truncate text-gray-700 dark:text-slate-200">{file.name}</span>
                    {file.isProcessing ? (
                      <div className="flex items-center space-x-2 mt-1">
                        <div className="h-1.5 w-full bg-amber-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 transition-all duration-300"
                            style={{ width: `${file.progress || 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-amber-600 font-medium w-8 text-right">{file.progress || 0}%</span>
                      </div>
                    ) : (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-400">Đã sẵn sàng</span>
                        {getDocxModeBadge(file) && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${getDocxModeBadge(file)?.className}`}
                            title={file.docxNotice}
                          >
                            {(file.docxMode === 'visionRecommended' || file.docxMode === 'hybrid') && <ImageIcon size={10} className="mr-1 inline" />}
                            {getDocxModeBadge(file)?.text}
                          </span>
                        )}
                        {getPdfModeBadge(file) && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${getPdfModeBadge(file)?.className}`}
                            title={file.pdfNotice}
                          >
                            {getPdfModeBadge(file)?.text}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeFile(idx)}
                  className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30 transition ml-2"
                  disabled={file.isProcessing}
                >
                  <X size={18} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FileUploader;
