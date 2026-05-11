import { Archive, Columns, DownloadCloud, Moon, Settings as SettingsIcon, Sun } from 'lucide-react';

interface AppHeaderProps {
  darkMode: boolean;
  deferredPrompt: any;
  filesCount: number;
  handleInstallApp: () => void;
  isSplitView: boolean;
  projectLibraryEnabled: boolean;
  setDarkMode: (value: boolean) => void;
  setIsSplitView: (value: boolean) => void;
  setShowLibrary: (value: boolean) => void;
  setShowSettings: (value: boolean) => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
  darkMode,
  deferredPrompt,
  filesCount,
  handleInstallApp,
  isSplitView,
  projectLibraryEnabled,
  setDarkMode,
  setIsSplitView,
  setShowLibrary,
  setShowSettings,
}) => (
  <header className="glass sticky top-0 z-50 flex items-center justify-between gap-3 px-3 py-3 transition-all sm:px-6 sm:py-4">
    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
      <img
        src={darkMode ? "/ponz-dark.png" : "/ponz-header.png"}
        alt="PonZ Logo"
        className="h-9 w-auto shrink-0 object-contain transition-transform hover:scale-105 sm:h-10"
      />
      <div className="ml-1 flex min-w-0 flex-col border-l-2 border-indigo-600/20 pl-3 dark:border-indigo-400/20 sm:pl-4">
        <h1 className="truncate text-base font-black leading-none tracking-tight text-slate-900 dark:text-white sm:text-xl">
          MCQ AnkiGen <span className="text-indigo-600 dark:text-indigo-400">Pro</span>
        </h1>
      </div>
    </div>

    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <div className="hidden md:flex flex-col items-end px-4 border-r border-slate-200 dark:border-slate-800 mr-2">
        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-0.5">AI MCQ Extraction & Solver Engine</span>
        <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Made by PonZ</span>
      </div>
      <div className="hidden bg-slate-100 p-1 dark:bg-slate-800/50 sm:flex sm:rounded-xl sm:mr-2">
        <button
          onClick={() => setDarkMode(false)}
          className={`p-2 rounded-lg transition-all ${!darkMode ? 'bg-white dark:bg-slate-700 shadow-sm text-amber-500' : 'text-slate-400'}`}
        >
          <Sun size={16} />
        </button>
        <button
          onClick={() => setDarkMode(true)}
          className={`p-2 rounded-lg transition-all ${darkMode ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-400' : 'text-slate-400'}`}
        >
          <Moon size={16} />
        </button>
      </div>

      {projectLibraryEnabled && (
        <button
          onClick={() => setShowLibrary(true)}
          className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:shadow-sm transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
          title="Thư viện bộ đề"
        >
          <Archive size={20} />
        </button>
      )}

      <button
        onClick={() => setShowSettings(true)}
        className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:shadow-sm transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
        title="Cài đặt"
      >
        <SettingsIcon size={20} />
      </button>

      {deferredPrompt && (
        <button
          onClick={handleInstallApp}
          className="hidden items-center gap-2 px-4 py-2 pro-gradient text-white rounded-xl hover:scale-105 transition-all text-xs font-black shadow-lg shadow-indigo-100 dark:shadow-none sm:flex"
          title="Cài đặt ứng dụng về máy"
        >
          <DownloadCloud size={16} />
          <span className="uppercase tracking-tighter">Tải App</span>
        </button>
      )}

      <button
        onClick={() => setIsSplitView(!isSplitView)}
        className={`p-2.5 rounded-xl transition-all border ${isSplitView ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200 dark:shadow-none' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 border-transparent hover:bg-white dark:hover:bg-slate-700'}`}
        title="Chế độ So sánh (Split View)"
        disabled={filesCount === 0}
      >
        <Columns size={20} />
      </button>
    </div>
  </header>
);

export default AppHeader;
