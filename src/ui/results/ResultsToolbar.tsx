import { AlertTriangle, Download, FileText, Loader2 } from 'lucide-react';

interface ResultsToolbarProps {
  downloadCSV: () => void;
  downloadDOCX: () => void;
  exportAction: 'downloadCsv' | 'downloadDocx' | null;
  handleClearAllData: () => void;
  mcqCount: number;
}

const ResultsToolbar: React.FC<ResultsToolbarProps> = ({
  downloadCSV,
  downloadDOCX,
  exportAction,
  handleClearAllData,
  mcqCount,
}) => (
  <div className="sticky top-16 z-20 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 sm:p-5">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:flex-1 xl:justify-start">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Kết quả</h2>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
              <span data-testid="result-count" className="sr-only">{mcqCount}</span>
              {mcqCount} câu
            </span>
          </div>
          <button
            onClick={handleClearAllData}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2 text-xs font-black text-rose-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/25 dark:text-rose-300 dark:hover:bg-rose-950/45"
          >
            <AlertTriangle size={14} /> Xóa toàn bộ dữ liệu
          </button>
        </div>

      </div>

      <div className="flex flex-wrap gap-2 xl:justify-end">
        <button
          onClick={downloadCSV}
          data-testid="export-csv-button"
          disabled={exportAction !== null}
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-[0_14px_32px_-18px_rgba(5,150,105,0.85)] transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {exportAction === 'downloadCsv' ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} Xuất CSV Anki
        </button>
        <button
          onClick={downloadDOCX}
          disabled={exportAction !== null}
          className="inline-flex items-center gap-2 rounded-2xl border border-sky-200/80 bg-sky-50 px-5 py-3 text-sm font-bold text-sky-700 shadow-[0_14px_32px_-22px_rgba(14,165,233,0.65)] transition-all hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300 dark:hover:bg-sky-950/35"
          title="Xuất file Word để học trực tiếp"
        >
          {exportAction === 'downloadDocx' ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />} Xuất DOCX
        </button>
      </div>
    </div>
  </div>
);

export default ResultsToolbar;
