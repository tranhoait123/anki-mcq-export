import { FileText } from 'lucide-react';
import { UploadedFile } from '../types';
import { isDocxFile } from '../utils/appHelpers';

interface SourcePreviewPanelProps {
  file: UploadedFile;
  previewUrl: string | null;
}

const SourcePreviewPanel: React.FC<SourcePreviewPanelProps> = ({ file, previewUrl }) => (
  <div className="col-span-6 flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
    <div className="p-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shadow-sm">
      <span className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
        <FileText size={16} className="text-indigo-600" /> Tài liệu gốc
      </span>
      <span className="text-xs text-slate-500 truncate max-w-[200px]">{file.name}</span>
    </div>
    <div className={`min-h-0 flex-1 overflow-auto bg-slate-500/10 p-3 ${isDocxFile(file) ? '' : 'flex items-center justify-center'}`}>
      {previewUrl && file.type === 'application/pdf' ? (
        <iframe
          src={previewUrl}
          className="w-full h-full rounded shadow-sm bg-white"
          title="PDF Preview"
        />
      ) : previewUrl && file.type.startsWith('image/') ? (
        <img
          src={previewUrl}
          className="max-w-full max-h-full object-contain rounded shadow-sm"
          alt="Preview"
        />
      ) : isDocxFile(file) && file.content ? (
        <article
          className="docx-preview mx-auto min-h-full w-full max-w-4xl rounded-xl bg-white px-10 py-8 text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
          dangerouslySetInnerHTML={{ __html: file.content }}
        />
      ) : (
        <div className="text-center text-slate-500">
          <p>Chưa có bản xem trước cho định dạng này.</p>
          <p className="text-xs mt-2 opacity-70">Hỗ trợ xem trước PDF, hình ảnh và Word DOCX.</p>
        </div>
      )}
    </div>
  </div>
);

export default SourcePreviewPanel;
