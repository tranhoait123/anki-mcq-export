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
import UploadDropZone from './fileUploader/UploadDropZone';
import UploadedFileList from './fileUploader/UploadedFileList';
import { prepareDocxUpload } from './fileUploader/docxUploadPreparation';

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
