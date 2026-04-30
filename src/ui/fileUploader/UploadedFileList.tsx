import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { UploadedFile } from '../../types';
import { getDocxModeBadge, getPdfModeBadge } from './fileBadges';

interface UploadedFileListProps {
  files: UploadedFile[];
  onRemoveFile: (index: number) => void;
}

const UploadedFileList: React.FC<UploadedFileListProps> = ({ files, onRemoveFile }) => {
  if (files.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-gray-100 dark:border-slate-800 p-4">
      <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Tài liệu đã chọn ({files.length})</h3>
      <ul className="space-y-2">
        {files.map((file, idx) => {
          const docxModeBadge = getDocxModeBadge(file);
          const pdfModeBadge = getPdfModeBadge(file);

          return (
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
                      {docxModeBadge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${docxModeBadge.className}`}
                          title={file.docxNotice}
                        >
                          {(file.docxMode === 'visionRecommended' || file.docxMode === 'hybrid') && <ImageIcon size={10} className="mr-1 inline" />}
                          {docxModeBadge.text}
                        </span>
                      )}
                      {pdfModeBadge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${pdfModeBadge.className}`}
                          title={file.pdfNotice}
                        >
                          {pdfModeBadge.text}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => onRemoveFile(idx)}
                className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30 transition ml-2"
                disabled={file.isProcessing}
              >
                <X size={18} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default UploadedFileList;
