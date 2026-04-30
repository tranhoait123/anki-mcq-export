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
    className={`relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition-all group sm:p-6
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
    <div className="pro-gradient mb-3 rounded-2xl p-3 shadow-lg shadow-indigo-100 transition-all group-hover:scale-110 dark:shadow-none">
      <UploadCloud size={26} className="text-white" />
    </div>
    <div>
      <p className="text-base font-black uppercase leading-tight tracking-tighter text-slate-800 dark:text-white">Kéo thả hoặc nhấn để tải tài liệu</p>
      <p className="mb-3 mt-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Tài liệu tải lên phải có nội dung trắc nghiệm</p>
      <p className="inline-block rounded-full border border-slate-100 bg-slate-200/50 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        Hỗ trợ: PDF / Ảnh / Word (Tối đa 50MB/file)
      </p>
    </div>
  </div>
);

export default UploadDropZone;
