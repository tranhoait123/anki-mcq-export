import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCcw, ScanText, Sparkles } from 'lucide-react';
import { AnalysisResult, AuditResult, DuplicateInfo, UploadedFile } from '../types';
import AuditPanel from './AuditPanel';
import FileUploader from './FileUploader';

interface ControlPanelProps {
  analysis: AnalysisResult | null;
  analyzing: boolean;
  audit: AuditResult | null;
  duplicates: DuplicateInfo[];
  failedBatchIndices: number[];
  files: UploadedFile[];
  handleAnalyze: () => void;
  handleGenerate: () => void;
  handleRetryFailed: () => void;
  isSplitView: boolean;
  loading: boolean;
  ocrMode: 'gemini' | 'tesseract';
  setFiles: (files: UploadedFile[]) => void;
  setShowAudit: (show: boolean) => void;
  setShowDuplicates: (show: boolean) => void;
  showAudit: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  analysis,
  analyzing,
  audit,
  duplicates,
  failedBatchIndices,
  files,
  handleAnalyze,
  handleGenerate,
  handleRetryFailed,
  isSplitView,
  loading,
  ocrMode,
  setFiles,
  setShowAudit,
  setShowDuplicates,
  showAudit,
}) => (
  <div className={`space-y-6 ${isSplitView ? 'hidden' : 'lg:col-span-4'}`}>
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-5">
      <FileUploader files={files} setFiles={setFiles} />

      {ocrMode === 'tesseract' && files.some(file => file.type.startsWith('image/')) && (
        <div className="text-xs bg-amber-50 text-amber-700 p-2 rounded border border-amber-100 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Đang dùng Local OCR (Offline). Tốc độ có thể chậm hơn Cloud.</span>
        </div>
      )}

      {!analysis ? (
        <button
          onClick={handleAnalyze}
          data-testid="analyze-button"
          disabled={analyzing || files.length === 0}
          className="w-full py-4 pro-gradient text-white font-black rounded-2xl hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-100 dark:shadow-none flex items-center justify-center gap-3 text-sm uppercase tracking-widest"
        >
          {analyzing ? <Loader2 className="animate-spin" size={18} /> : <><ScanText size={18} strokeWidth={2.5} /> Quét tài liệu</>}
        </button>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex justify-between items-center group">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500 p-1.5 rounded-lg text-white">
                <CheckCircle2 size={16} />
              </div>
              <span className="font-bold text-emerald-900 dark:text-emerald-400 text-xs uppercase tracking-tighter">Hệ thống đã sẵn sàng</span>
            </div>
            <span className="text-lg font-black text-emerald-600">{analysis.estimatedCount}</span>
          </div>

          <button
            onClick={handleGenerate}
            data-testid="generate-button"
            disabled={loading}
            className="w-full py-4 bg-slate-900 dark:bg-indigo-600 text-white font-black rounded-2xl hover:scale-[1.02] active:scale-95 shadow-xl transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
          >
            {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={18} /> Trích xuất câu hỏi</>}
          </button>

          {failedBatchIndices.length > 0 && !loading && (
            <button
              onClick={handleRetryFailed}
              className="w-full py-3 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 font-extrabold rounded-2xl border-2 border-orange-200 dark:border-orange-800 hover:bg-orange-600 hover:text-white dark:hover:bg-orange-600 transition-all flex items-center justify-center gap-2 uppercase tracking-tighter text-xs"
            >
              <RotateCcw size={16} /> Quét lại {failedBatchIndices.length} phần bị lỗi
            </button>
          )}
        </div>
      )}
    </div>

    {audit && (
      <AuditPanel audit={audit} showAudit={showAudit} setShowAudit={setShowAudit} />
    )}

    {duplicates.length > 0 && (
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-orange-200 dark:border-orange-900/30 overflow-hidden relative group">
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
