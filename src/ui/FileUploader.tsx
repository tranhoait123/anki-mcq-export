import React, { useCallback, useState } from 'react';
import { UploadedFile } from '../types';
import { toast } from 'sonner';
import {
  CHUNK_SIZE,
  MAX_FILE_SIZE,
  readSliceAsArrayBuffer,
  readSliceAsBase64,
  readSliceAsText,
} from './fileUploader/fileReaders';
import { hashStringSha256 } from '../utils/hash';
import { measureAsync, yieldToMain } from '../utils/performance';
import UploadDropZone from './fileUploader/UploadDropZone';
import UploadedFileList from './fileUploader/UploadedFileList';
import { prepareDocxUpload } from './fileUploader/docxUploadPreparation';

export const estimateMarkdownQuestions = (text: string): number => {
  if (!text) return 0;
  // 1. Đếm số câu hỏi trực tiếp dựa trên nhãn bắt đầu dòng: "Câu 1:", "Q2.", hoặc trong thẻ Markdown "## Q031", "**Câu 2**"
  const questionMatches = text.match(/^(?:\s*#+\s*|\s*\*+\s*)*(?:câu|cau|question|q|case)\s*(?:hỏi|số|thu|thứ)?\s*\d+/gim) || [];
  if (questionMatches.length > 0) {
    return questionMatches.length;
  }

  // 2. Fallback: Nếu không dùng nhãn "Câu X", đếm số phương án lựa chọn (A, B, C, D) chia cho 4. Hỗ trợ markdown list "- A."
  const optionMatches = text.match(/^\s*(?:-\s*|\*\s*)?[A-D][.:)-]\s+/gim) || [];
  if (optionMatches.length > 0) {
    return Math.max(1, Math.round(optionMatches.length / 4));
  }

  // 3. Fallback 2: Đếm số check-list trắc nghiệm dạng Markdown "- [ ]"
  const checklistMatches = text.match(/^\s*-\s+\[\s*\]\s+/gm) || [];
  if (checklistMatches.length > 0) {
    return Math.max(1, Math.round(checklistMatches.length / 4));
  }

  // 4. Nếu không khớp gì cả, ước tính theo số đoạn văn có độ dài vừa phải chia cho 5
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 30);
  return Math.max(0, Math.round(blocks.length / 5));
};

interface FileUploaderProps {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
}

const FileUploader: React.FC<FileUploaderProps> = ({ files, setFiles }) => {

  const updateFileProgress = useCallback((fileName: string, progress: number) => {
    setFiles(prev => prev.map(f => {
      if (f.name === fileName) {
        return { ...f, progress };
      }
      return f;
    }));
  }, [setFiles]);

  const processFile = useCallback(async (file: File) => measureAsync(`upload.processFile(${file.name})`, async () => {
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

          await yieldToMain();
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

          await yieldToMain();
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
        const preparedDocx = await prepareDocxUpload(file.name, docxBuffer);
        content = preparedDocx.content;
        fileEnhancements = preparedDocx.fileEnhancements;
        if (preparedDocx.notification?.type === 'warning') {
          toast.warning(preparedDocx.notification.message);
        } else if (preparedDocx.notification?.type === 'info') {
          toast.info(preparedDocx.notification.message);
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

          await yieldToMain();
        }

        const isMd = file.name.toLowerCase().endsWith('.md') || file.type === 'text/markdown';
        if (isMd) {
          const mcqCount = estimateMarkdownQuestions(content);
          fileEnhancements = {
            isMarkdown: true,
            markdownMcqCount: mcqCount,
            markdownNotice: `Markdown: Phát hiện ước tính khoảng ${mcqCount} câu trắc nghiệm.`,
          };
        }
      }

      const contentHash = await measureAsync(`upload.hash(${file.name})`, () => hashStringSha256(content));

      // Update the file content and remove processing flag
      setFiles(prev => prev.map(f => {
        if (f.name === file.name) {
          return { ...f, content, contentHash, ...fileEnhancements, isProcessing: false, progress: 100 };
        }
        return f;
      }));

    } catch (error) {
      console.error("Error processing file:", error);
      // Remove the failed file
      setFiles(prev => prev.filter(f => f.name !== file.name));
      toast.error(`Lỗi khi đọc file ${file.name}: ${error instanceof Error ? error.message : "Định dạng không hỗ trợ"}`);
    }
  }), [files, setFiles, updateFileProgress]);

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
      <UploadDropZone
        isDragActive={isDragActive}
        onDragActiveChange={setIsDragActive}
        onDropFiles={handleDrop}
        onInputChange={handleInputChange}
      />

      <UploadedFileList files={files} onRemoveFile={removeFile} />
    </div>
  );
};

export default FileUploader;
