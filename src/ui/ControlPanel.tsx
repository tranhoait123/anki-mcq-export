import { Info, Loader2, RotateCcw, ScanText, Sparkles } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { AnalysisResult, AuditResult, DuplicateInfo, UploadedFile } from '../types';
import AuditPanel from './AuditPanel';
import FileUploader from './FileUploader';

interface ControlPanelProps {
  analysis?: AnalysisResult | null;
  analyzing?: boolean;
  audit: AuditResult | null;
  detailedExplanation?: boolean;
  duplicates: DuplicateInfo[];
  failedBatchIndices: number[];
  files: UploadedFile[];
  handleAnalyze?: () => void;
  handleGenerate: () => void;
  handleRetryFailed: () => void;
  isSplitView: boolean;
  loading: boolean;
  onToggleDetailedExplanation?: (enabled: boolean) => void;
  retryFailedAttempted: boolean;
  setFiles: Dispatch<SetStateAction<UploadedFile[]>>;
  setShowAudit: (show: boolean) => void;
  setShowDuplicates: (show: boolean) => void;
  showAudit: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  audit,
  detailedExplanation,
  duplicates,
  failedBatchIndices,
  files,
  handleGenerate,
  handleRetryFailed,
  isSplitView,
  loading,
  onToggleDetailedExplanation,
  retryFailedAttempted,
  setFiles,
  setShowAudit,
  setShowDuplicates,
  showAudit,
}) => (
  <div className={`min-w-0 space-y-4 ${isSplitView ? 'hidden' : 'lg:sticky lg:top-[92px] lg:max-h-[calc(100dvh-112px)] lg:overflow-y-auto lg:pr-1'}`}>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
      <FileUploader files={files} setFiles={setFiles} />

      <div className="space-y-4">
        <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-2xl transition-all select-none">
          <div className="flex items-center gap-2.5">
            <Sparkles size={16} className={detailedExplanation ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              Giải chi tiết bằng AI
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(detailedExplanation)}
            onClick={() => onToggleDetailedExplanation?.(!detailedExplanation)}
            disabled={loading}
            className={`w-10 h-6 flex items-center rounded-full p-0.5 transition-colors focus:outline-none ${
              detailedExplanation ? 'bg-indigo-600 justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
            }`}
          >
            <div className="w-5 h-5 rounded-full bg-white shadow-sm transition-transform" />
          </button>
        </div>

        <button
          onClick={handleGenerate}
          data-testid="generate-button"
          disabled={loading || files.length === 0}
          className="w-full py-3.5 pro-gradient text-white font-black rounded-2xl hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-xl shadow-indigo-100 dark:shadow-none transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-xs sm:text-sm"
        >
          {loading ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <>
              <Sparkles size={18} />
              {detailedExplanation ? 'Trích xuất & giải chi tiết' : 'Trích xuất câu hỏi'}
            </>
          )}
        </button>

        {failedBatchIndices.length > 0 && !loading && !retryFailedAttempted && (
          <button
            onClick={handleRetryFailed}
            className="w-full py-3 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 font-extrabold rounded-2xl border-2 border-orange-200 dark:border-orange-800 hover:bg-orange-600 hover:text-white dark:hover:bg-orange-600 transition-all flex items-center justify-center gap-2 uppercase tracking-tighter text-xs"
          >
            <RotateCcw size={16} /> Quét lại {failedBatchIndices.length} phần bị lỗi
          </button>
        )}

        {failedBatchIndices.length > 0 && !loading && retryFailedAttempted && (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs font-bold leading-relaxed text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/20 dark:text-orange-300">
            Đã quét lại phần lỗi một lần. Nếu vẫn còn lỗi, hãy đổi model/API key hoặc chia nhỏ tài liệu rồi chạy lại từ đầu.
          </div>
        )}
      </div>
    </div>

    {audit && (
      <AuditPanel audit={audit} showAudit={showAudit} setShowAudit={setShowAudit} />
    )}

    {duplicates.length > 0 && (
      <div className="relative overflow-hidden rounded-2xl border border-orange-200 bg-white p-4 shadow-sm dark:border-orange-900/30 dark:bg-slate-900 group">
        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
          <RotateCcw size={48} className="text-orange-600 rotate-12" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-xl flex items-center justify-center shadow-inner">
              <Info size={20} />
            </div>
            <div>
              <h3 className="font-black text-slate-800 dark:text-white text-sm leading-none uppercase tracking-tighter">Phát hiện trùng lặp</h3>
              <span className="text-xs font-bold text-orange-600 dark:text-orange-400 mt-1 block">Có {duplicates.length} câu tương đồng cao</span>
            </div>
          </div>
          <button
            onClick={() => setShowDuplicates(true)}
            className="w-full py-3 bg-white dark:bg-slate-900 border-2 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-orange-600 dark:hover:bg-orange-600 hover:text-white transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <ScanText size={14} /> Kiểm tra ngay
          </button>
        </div>
      </div>
    )}
  </div>
);

export default ControlPanel;
