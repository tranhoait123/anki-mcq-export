import React from 'react';
import { UploadCloud } from 'lucide-react';

interface UploadDropZoneProps {
  isDragActive: boolean;
  onDragActiveChange: (isActive: boolean) => void;
  onDropFiles: (event: React.DragEvent<HTMLDivElement>) => void;
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const UploadDropZone: React.FC<UploadDropZoneProps> = ({
  isDragActive,
  onDragActiveChange,
  onDropFiles,
  onInputChange,
}) => (
  <div
    onDragOver={(e) => { e.preventDefault(); onDragActiveChange(true); }}
    onDragLeave={() => onDragActiveChange(false)}
    onDrop={(e) => { onDragActiveChange(false); onDropFiles(e); }}
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
      data-testid="file-input"
      multiple
      accept=".pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.webp,.heic"
      className="hidden"
      onChange={onInputChange}
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
);

export default UploadDropZone;
