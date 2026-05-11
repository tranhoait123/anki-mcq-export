import { Archive, Download, FileText, Loader2, Moon, Pause, Play, ScanText, Settings, Sparkles, Sun } from 'lucide-react';
import { ProcessingState } from '../types';

interface MobileActionBarProps {
  analyzing: boolean;
  darkMode: boolean;
  downloadCSV: () => void;
  downloadDOCX: () => void;
  exportAction: 'downloadCsv' | 'downloadDocx' | null;
  filesCount: number;
  handleAnalyze: () => void;
  handleGenerate: () => void;
  handleTogglePause: (isProcessing: boolean) => void;
  loading: boolean;
  mcqCount: number;
  processingState: ProcessingState;
  projectLibraryEnabled: boolean;
  setDarkMode: (value: boolean) => void;
  setShowLibrary: (value: boolean) => void;
  setShowSettings: (value: boolean) => void;
  hasAnalysis: boolean;
}

const iconButtonClass = 'flex h-11 min-w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition active:scale-95 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';

const MobileActionBar: React.FC<MobileActionBarProps> = ({
  analyzing,
  darkMode,
  downloadCSV,
  downloadDOCX,
  exportAction,
  filesCount,
  handleAnalyze,
  handleGenerate,
  handleTogglePause,
  loading,
  mcqCount,
  processingState,
  projectLibraryEnabled,
  setDarkMode,
  setShowLibrary,
  setShowSettings,
  hasAnalysis,
}) => {
  const primaryAction = loading ? (
    <button
      onClick={() => handleTogglePause(loading)}
      className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white shadow-lg active:scale-[0.98]"
    >
      {processingState === 'running' ? <Pause size={18} /> : <Play size={18} />}
      {processingState === 'running' ? 'Tạm dừng' : 'Tiếp tục'}
    </button>
  ) : !hasAnalysis ? (
    <button
      onClick={handleAnalyze}
      disabled={analyzing || filesCount === 0}
      className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-lg disabled:opacity-50 active:scale-[0.98]"
    >
      {analyzing ? <Loader2 className="animate-spin" size={18} /> : <ScanText size={18} />}
      Quét
    </button>
  ) : (
    <button
      onClick={handleGenerate}
      disabled={filesCount === 0}
      className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-lg disabled:opacity-50 active:scale-[0.98] dark:bg-indigo-600"
    >
      <Sparkles size={18} /> Trích xuất
    </button>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 py-2 shadow-[0_-16px_40px_-24px_rgba(15,23,42,0.7)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 sm:hidden">
      <div className="mx-auto flex max-w-xl items-center gap-2">
        {primaryAction}
        {mcqCount > 0 && !loading ? (
          <>
            <button
              onClick={downloadCSV}
              disabled={exportAction !== null}
              className={iconButtonClass}
              title="Xuất CSV"
            >
              {exportAction === 'downloadCsv' ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
            </button>
            <button
              onClick={downloadDOCX}
              disabled={exportAction !== null}
              className={iconButtonClass}
              title="Xuất DOCX"
            >
              {exportAction === 'downloadDocx' ? <Loader2 className="animate-spin" size={18} /> : <FileText size={18} />}
            </button>
          </>
        ) : null}
        {projectLibraryEnabled && (
          <button onClick={() => setShowLibrary(true)} className={iconButtonClass} title="Thư viện">
            <Archive size={18} />
          </button>
        )}
        <button onClick={() => setShowSettings(true)} className={iconButtonClass} title="Cài đặt">
          <Settings size={18} />
        </button>
        <button onClick={() => setDarkMode(!darkMode)} className={iconButtonClass} title="Sáng/tối">
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </div>
  );
};

export default MobileActionBar;
