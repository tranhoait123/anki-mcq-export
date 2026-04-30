import { ArrowUp, Eye, Filter, PenLine, Search } from 'lucide-react';
import { MCQViewMode } from './types';

interface MCQToolbarProps {
  difficultyFilter: string;
  filteredCount: number;
  mcqCount: number;
  onDifficultyFilterChange: (value: string) => void;
  onScrollToTop: () => void;
  onSearchTermChange: (value: string) => void;
  onViewModeChange: (value: MCQViewMode) => void;
  searchTerm: string;
  splitReadingMode: boolean;
  toolbarStickyTopClass: string;
  uniqueDifficulties: string[];
  viewMode: MCQViewMode;
}

const MCQToolbar: React.FC<MCQToolbarProps> = ({
  difficultyFilter,
  filteredCount,
  mcqCount,
  onDifficultyFilterChange,
  onScrollToTop,
  onSearchTermChange,
  onViewModeChange,
  searchTerm,
  splitReadingMode,
  toolbarStickyTopClass,
  uniqueDifficulties,
  viewMode,
}) => (
  <div className={`glass sticky ${toolbarStickyTopClass} z-40 rounded-3xl ${splitReadingMode ? 'p-3' : 'p-4'} transition-all hover:shadow-lg`}>
    <div className={splitReadingMode ? 'space-y-3' : 'space-y-4'}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-3 rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-800/50">
          <Search className="text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Tìm câu hỏi..."
            className="flex-1 bg-transparent border-none p-0 text-sm focus:ring-0 placeholder:text-slate-400"
            value={searchTerm}
            onChange={e => onSearchTermChange(e.target.value)}
          />
        </div>

        <div className="flex bg-slate-100 dark:bg-slate-800/50 p-1.5 rounded-2xl">
          <button
            onClick={() => onViewModeChange('preview')}
            className={`px-4 py-2 text-[11px] font-black rounded-xl flex items-center gap-2 transition-all uppercase tracking-tight ${viewMode === 'preview' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-white' : 'text-slate-500'}`}
          >
            <Eye size={13} /> Review
          </button>
          <button
            onClick={() => onViewModeChange('edit')}
            className={`px-4 py-2 text-[11px] font-black rounded-xl flex items-center gap-2 transition-all uppercase tracking-tight ${viewMode === 'edit' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500'}`}
          >
            <PenLine size={13} /> Soạn thảo
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-slate-200/70 pt-3 dark:border-slate-800/80 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 dark:bg-slate-800/50">
            <Filter className="text-slate-400" size={16} />
            <select
              value={difficultyFilter}
              onChange={(e) => onDifficultyFilterChange(e.target.value)}
              className="min-w-[110px] bg-transparent border-none text-xs font-bold text-slate-600 focus:ring-0 cursor-pointer dark:text-slate-300"
            >
              <option value="all">Tất cả độ khó</option>
              {uniqueDifficulties.map(diff => (
                <option key={diff} value={diff}>{diff}</option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
            {filteredCount} / {mcqCount} câu
          </div>

          {searchTerm && (
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
              Từ khóa: {searchTerm}
            </div>
          )}

          {difficultyFilter !== 'all' && (
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
              Độ khó: {difficultyFilter}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onScrollToTop}
          className="inline-flex items-center gap-2 self-start rounded-2xl bg-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-tight text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700 lg:self-auto"
        >
          <ArrowUp size={13} />
          Lên đầu
        </button>
      </div>
    </div>
  </div>
);

export default MCQToolbar;
