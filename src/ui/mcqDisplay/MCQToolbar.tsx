import { Eye, Filter, PenLine, Search } from 'lucide-react';
import { MCQViewMode } from './types';

interface MCQToolbarProps {
  difficultyFilter: string;
  filteredCount: number;
  mcqCount: number;
  onDifficultyFilterChange: (value: string) => void;
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
  onSearchTermChange,
  onViewModeChange,
  searchTerm,
  splitReadingMode,
  toolbarStickyTopClass,
  uniqueDifficulties,
  viewMode,
}) => (
  <div className={`glass sticky ${toolbarStickyTopClass} z-40 rounded-2xl ${splitReadingMode ? 'p-2.5' : 'p-3'} transition-all hover:shadow-lg`}>
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
      <div className="flex min-w-[220px] items-center gap-3 rounded-xl bg-slate-100 px-3 py-2.5 dark:bg-slate-800/50 xl:flex-[1_1_320px]">
        <Search className="shrink-0 text-slate-400" size={18} />
        <input
          type="text"
          placeholder="Tìm câu hỏi..."
          className="min-w-0 flex-1 bg-transparent border-none p-0 text-sm focus:ring-0 placeholder:text-slate-400"
          value={searchTerm}
          onChange={e => onSearchTermChange(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/50">
          <Filter className="shrink-0 text-slate-400" size={15} />
          <select
            value={difficultyFilter}
            onChange={(e) => onDifficultyFilterChange(e.target.value)}
            className="min-w-[108px] bg-transparent border-none text-xs font-bold text-slate-600 focus:ring-0 cursor-pointer dark:text-slate-300"
          >
            <option value="all">Tất cả độ khó</option>
            {uniqueDifficulties.map(diff => (
              <option key={diff} value={diff}>{diff}</option>
            ))}
          </select>
        </div>

        <div className="rounded-xl bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
          {filteredCount} / {mcqCount} câu
        </div>

        <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/50">
          <button
            onClick={() => onViewModeChange('preview')}
            className={`px-3 py-1.5 text-[11px] font-black rounded-lg flex items-center gap-2 transition-all uppercase tracking-tight ${viewMode === 'preview' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-white' : 'text-slate-500'}`}
          >
            <Eye size={13} /> Review
          </button>
          <button
            onClick={() => onViewModeChange('edit')}
            className={`px-3 py-1.5 text-[11px] font-black rounded-lg flex items-center gap-2 transition-all uppercase tracking-tight ${viewMode === 'edit' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500'}`}
          >
            <PenLine size={13} /> Soạn thảo
          </button>
        </div>

      </div>
    </div>

    {(searchTerm || difficultyFilter !== 'all') && (
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2 dark:border-slate-800/80">
        {searchTerm && (
          <div className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
            Từ khóa: {searchTerm}
          </div>
        )}

        {difficultyFilter !== 'all' && (
          <div className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
            Độ khó: {difficultyFilter}
          </div>
        )}
      </div>
    )}
  </div>
);

export default MCQToolbar;
