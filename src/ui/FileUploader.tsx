import React, { useCallback } from 'react';
import { UploadCloud, FileText, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { UploadedFile } from '../types';
import mammoth from 'mammoth';

interface FileUploaderProps {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
}

// 3MB chunk size (Divisible by 3 to ensure safe Base64 concatenation for PDFs)
const CHUNK_SIZE = 3 * 1024 * 1024;

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

    // Create a placeholder for the file being processed
    setFiles(prev => [
      ...prev,
      {
        name: file.name,
        type: file.type,
        content: "",
        isProcessing: true,
        progress: 0
      }
    ]);

    try {
      let content = "";
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

      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
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
        const result = await mammoth.extractRawText({ arrayBuffer: fullBuffer.buffer });
        content = result.value;
        if (!content.trim()) throw new Error("Không tìm thấy văn bản trong file Word");

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
          return { ...f, content, isProcessing: false, progress: 100 };
        }
        return f;
      }));

    } catch (error) {
      console.error("Error processing file:", error);
      // Remove the failed file
      setFiles(prev => prev.filter(f => f.name !== file.name));
      alert(`Lỗi khi đọc file ${file.name}: ${error instanceof Error ? error.message : "Định dạng không hỗ trợ"}`);
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

  return (
    <div className="w-full space-y-4">
      <div
        className="border-2 border-dashed border-indigo-300 bg-indigo-50 rounded-lg p-8 text-center hover:bg-indigo-100 transition-colors cursor-pointer"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => document.getElementById('fileInput')?.click()}
      >
        <input
          type="file"
          id="fileInput"
          multiple
          accept=".pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.webp,.heic"
          className="hidden"
          onChange={handleInputChange}
        />
        <div className="flex flex-col items-center justify-center text-indigo-600">
          <UploadCloud size={48} className="mb-2" />
          <p className="font-semibold text-lg">Kéo thả hoặc nhấn để tải tài liệu</p>
          <p className="text-sm text-indigo-400 mt-1">Hỗ trợ: PDF, Ảnh (PNG/JPG), Word, Text</p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-500 mb-2 uppercase tracking-wide">Tài liệu đã chọn ({files.length})</h3>
          <ul className="space-y-2">
            {files.map((file, idx) => (
              <li key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 transition">
                <div className="flex items-center space-x-3 overflow-hidden flex-1">
                  <div className={`p-2 rounded ${file.isProcessing ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    {file.isProcessing ? <Loader2 size={20} className="animate-spin" /> : <FileText size={20} />}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium truncate text-gray-700">{file.name}</span>
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
                      <span className="text-xs text-gray-400">Đã sẵn sàng</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeFile(idx)}
                  className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition ml-2"
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