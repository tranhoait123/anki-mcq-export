
import React, { useState, useMemo } from 'react';
import { MCQ, Explanation } from '../types';
import { CheckCircle2, Search, Quote, Lightbulb, AlertTriangle, Target, Eye, PenLine, Trash2, Filter, FileText } from 'lucide-react';
import { buildAnkiHtml } from '../core/anki';

interface MCQDisplayProps {
  mcqs: MCQ[];
  onUpdate?: (updatedMCQ: MCQ) => void;
  onDelete?: (id: string) => void;
}

const RichExplanation: React.FC<{ exp: Explanation }> = ({ exp }) => {
  return (
    <div className="space-y-4 mt-6 text-sm">
      <div className="bg-rose-50/50 dark:bg-rose-900/10 border-l-4 border-rose-500 p-4 rounded-r-xl transition-all hover:bg-rose-50 dark:hover:bg-rose-900/20">
        <div className="flex items-start gap-3">
          <div className="bg-rose-500 p-1.5 rounded-lg text-white shadow-sm">
            <Target size={14} />
          </div>
          <div>
            <span className="font-bold text-rose-900 dark:text-rose-200 block text-[10px] uppercase tracking-wider mb-1">Đáp án cốt lõi</span>
            <span className="text-slate-700 dark:text-slate-300 leading-relaxed font-medium">{exp.core}</span>
          </div>
        </div>
      </div>

      <div className="bg-indigo-50/50 dark:bg-indigo-900/10 border-l-4 border-indigo-500 p-4 rounded-r-xl transition-all hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
        <div className="flex items-start gap-3">
          <div className="bg-indigo-500 p-1.5 rounded-lg text-white shadow-sm">
            <Lightbulb size={14} />
          </div>
          <div>
            <span className="font-bold text-indigo-900 dark:text-indigo-200 block text-[10px] uppercase tracking-wider mb-1">Phân tích chuyên sâu</span>
            <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{exp.analysis}</span>
          </div>
        </div>
      </div>

      <div className="bg-slate-50/50 dark:bg-slate-800/20 border-l-4 border-slate-400 p-4 rounded-r-xl transition-all hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <div className="flex items-start gap-3">
          <div className="bg-slate-500 p-1.5 rounded-lg text-white shadow-sm">
            <Quote size={14} />
          </div>
          <div className="italic">
            <span className="font-bold text-slate-900 dark:text-slate-200 block text-[10px] uppercase tracking-wider mb-1 not-italic">Bằng chứng y khoa</span>
            <span className="text-slate-600 dark:text-slate-400 leading-relaxed">{exp.evidence}</span>
          </div>
        </div>
      </div>

      {exp.warning && (
        <div className="bg-amber-50/50 dark:bg-amber-900/10 border-l-4 border-amber-500 p-4 rounded-r-xl transition-all hover:bg-amber-50 dark:hover:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <div className="bg-amber-500 p-1.5 rounded-lg text-white shadow-sm">
              <AlertTriangle size={14} />
            </div>
            <div>
              <span className="font-bold text-amber-900 dark:text-amber-200 block text-[10px] uppercase tracking-wider mb-1">Lưu ý lâm sàng</span>
              <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{exp.warning}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MCQCard = React.memo(({
  mcq,
  idx,
  isEditing,
  editForm,
  viewMode,
  onEditStart,
  onEditSave,
  onEditCancel,
  onChange,
  onOptionChange,
  onExplanationChange,
  onDelete
}: {
  mcq: MCQ;
  idx: number;
  isEditing: boolean;
  editForm: MCQ | null;
  viewMode: 'edit' | 'preview';
  onEditStart: (mcq: MCQ) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onChange: (field: keyof MCQ, value: any) => void;
  onOptionChange: (idx: number, value: string) => void;
  onExplanationChange: (field: keyof Explanation, value: string) => void;
  onDelete?: (id: string) => void;
}) => {
  const data = isEditing && editForm ? editForm : mcq;

  // Preview Mode
  if (viewMode === 'preview' && !isEditing) {
    const htmlContent = buildAnkiHtml(data.explanation, data.difficulty, data.depthAnalysis);
    return (
      <div className="glass rounded-3xl p-8 pro-shadow transition-all group hover:-translate-y-1">
        <div className="flex gap-4 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-lg shadow-indigo-200 dark:shadow-none shrink-0">
            #{idx + 1}
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white leading-relaxed pt-1.5">
            {data.question}
          </div>
        </div>

        <div className="space-y-3 mb-8 ml-14">
          {data.options.map((opt, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${opt === data.correctAnswer ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'text-slate-500'}`}>
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${opt === data.correctAnswer ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                {String.fromCharCode(65 + i)}
              </span>
              <span className={`text-sm ${opt === data.correctAnswer ? 'font-bold text-emerald-900 dark:text-emerald-400' : ''}`}>{opt}</span>
            </div>
          ))}
        </div>

        <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
          <span className="text-[10px] font-black text-slate-400 tracking-widest uppercase mb-4 block">Giao diện Anki</span>
          <div dangerouslySetInnerHTML={{ __html: htmlContent }} className="p-6 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-inner" />
        </div>
      </div>
    );
  }

  // Edit Mode
  return (
    <div
      className={`glass rounded-3xl p-8 transition-all pro-shadow ${isEditing ? 'ring-2 ring-indigo-500 bg-white dark:bg-slate-900' : 'group hover:-translate-y-1'}`}
      onKeyDown={isEditing ? (e) => {
        if (e.key === 'Escape') onEditCancel();
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onEditSave();
      } : undefined}
    >
      <div className="flex justify-between items-start gap-4 mb-6">
        <div className="flex gap-4 flex-1">
          <div className="w-10 h-10 rounded-2xl pro-gradient flex items-center justify-center text-white font-black text-sm shadow-lg shrink-0">
            #{idx + 1}
          </div>
          <div className="flex-1">
            {isEditing ? (
              <textarea
                className="w-full text-lg font-bold border-none bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500 dark:text-white"
                value={data.question}
                onChange={e => onChange('question', e.target.value)}
                rows={2}
              />
            ) : (
              <div className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-relaxed pt-1.5">
                {mcq.question}
              </div>
            )}
          </div>
        </div>

        {!isEditing && (
          <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onEditStart(mcq)}
              className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
              title="Chỉnh sửa"
            >
              <PenLine size={16} strokeWidth={2.5} />
            </button>
            {onDelete && (
              <button
                onClick={() => onDelete(mcq.id)}
                className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white transition-all shadow-sm"
                title="Xóa câu hỏi"
              >
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 ml-0 md:ml-14">
        {data.options.map((opt, i) => (
          <div
            key={i}
            className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${opt === data.correctAnswer
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500/30'
              : 'bg-white dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 hover:border-indigo-200'
              }`}
          >
            <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${opt === data.correctAnswer ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
              {String.fromCharCode(65 + i)}
            </span>
            {isEditing ? (
              <div className="flex-1 flex gap-3 items-center">
                <input
                  className="flex-1 bg-transparent border-none p-0 text-sm font-medium focus:ring-0"
                  value={opt}
                  onChange={e => onOptionChange(i, e.target.value)}
                />
                <div className="relative flex items-center cursor-pointer" onClick={() => onChange('correctAnswer', opt)}>
                  <div className={`w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center ${opt === data.correctAnswer ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                    {opt === data.correctAnswer && <CheckCircle2 size={12} className="text-white" />}
                  </div>
                </div>
              </div>
            ) : (
              <span className={`text-sm leading-tight ${opt === data.correctAnswer ? 'font-bold text-emerald-900 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}>{opt}</span>
            )}
          </div>
        ))}
      </div>

      <div className="pt-6 border-t border-slate-100 dark:border-slate-800 ml-0 md:ml-14">
        {isEditing ? (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-2 block">Đáp án cốt lõi</label>
                <textarea className="w-full bg-rose-50/50 dark:bg-rose-900/10 border-none rounded-2xl p-4 focus:ring-2 focus:ring-rose-500" rows={3} value={data.explanation.core} onChange={e => onExplanationChange('core', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-2 block">Phân tích sâu</label>
                <textarea className="w-full bg-indigo-50/50 dark:bg-indigo-900/10 border-none rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500" rows={3} value={data.explanation.analysis} onChange={e => onExplanationChange('analysis', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Bằng chứng tài liệu</label>
              <textarea className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 focus:ring-2 focus:ring-slate-400" rows={2} value={data.explanation.evidence} onChange={e => onExplanationChange('evidence', e.target.value)} />
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <button onClick={onEditCancel} className="px-6 py-2.5 text-slate-500 font-bold text-xs bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 transition-all">Hủy bỏ</button>
              <button onClick={onEditSave} className="px-8 py-2.5 text-white font-bold text-xs pro-gradient rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none hover:scale-105 transition-all">Lưu thay đổi</button>
            </div>
          </div>
        ) : (
          <>
            <RichExplanation exp={mcq.explanation} />
            <div className="mt-8 flex flex-wrap gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700">
                <Filter size={10} className="text-slate-400" />
                <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 tracking-wider uppercase">Độ khó: {mcq.difficulty}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700">
                <FileText size={10} className="text-slate-400" />
                <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 tracking-wider uppercase">Nguồn: {mcq.source}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

const MCQDisplay: React.FC<MCQDisplayProps> = ({ mcqs, onUpdate, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MCQ | null>(null);
  const [showWarningsOnly, setShowWarningsOnly] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');

  // Extract unique difficulties for the filter dropdown
  const uniqueDifficulties = useMemo(() =>
    Array.from(new Set(mcqs.map(m => m.difficulty).filter(Boolean))).sort()
    , [mcqs]);

  const filtered = useMemo(() =>
    mcqs.filter(m => {
      const matchSearch = m.question.toLowerCase().includes(searchTerm.toLowerCase());
      const matchWarning = showWarningsOnly ? (m.explanation.warning && m.explanation.warning.length > 0) : true;
      const matchDifficulty = difficultyFilter === 'all' ? true : m.difficulty === difficultyFilter;
      return matchSearch && matchWarning && matchDifficulty;
    }),
    [mcqs, searchTerm, showWarningsOnly, difficultyFilter]);

  const handleEditStart = (mcq: MCQ) => {
    setEditingId(mcq.id);
    setEditForm(JSON.parse(JSON.stringify(mcq)));
    setViewMode('edit');
  };

  const handleEditSave = () => {
    if (onUpdate && editForm) {
      onUpdate(editForm);
      setEditingId(null);
      setEditForm(null);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const handleChange = (field: keyof MCQ, value: any) => {
    if (!editForm) return;
    setEditForm(prev => ({ ...prev!, [field]: value }));
  };

  const handleExplanationChange = (field: keyof Explanation, value: string) => {
    if (!editForm) return;
    setEditForm(prev => ({
      ...prev!,
      explanation: { ...prev!.explanation, [field]: value }
    }));
  };

  const handleOptionChange = (idx: number, value: string) => {
    if (!editForm) return;
    setEditForm(prev => {
      const newOps = [...prev!.options];
      newOps[idx] = value;
      return { ...prev!, options: newOps };
    });
  };

  return (
    <div className="space-y-8">
      <div className="glass p-3 rounded-2xl sticky top-16 z-40 flex flex-wrap items-center gap-4 transition-all hover:shadow-lg">
        <div className="flex-1 flex items-center gap-3 px-3 py-2 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-transparent focus-within:border-indigo-500/50 transition-all min-w-[200px]">
          <Search className="text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Tìm kiếm nội dung..."
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder:text-slate-400"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Difficulty Filter */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-transparent focus-within:border-indigo-500/50 transition-all">
          <Filter className="text-slate-400" size={16} />
          <select
            value={difficultyFilter}
            onChange={(e) => setDifficultyFilter(e.target.value)}
            className="bg-transparent border-none text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-0 cursor-pointer min-w-[100px]"
          >
            <option value="all">Tất cả độ khó</option>
            {uniqueDifficulties.map(diff => (
              <option key={diff} value={diff}>{diff}</option>
            ))}
          </select>
        </div>

        <div className="flex bg-slate-100 dark:bg-slate-800/50 p-1.5 rounded-xl border border-transparent">
          <button
            onClick={() => setViewMode('edit')}
            className={`px-4 py-1.5 text-[10px] font-black rounded-lg flex items-center gap-1.5 transition-all uppercase tracking-tighter ${viewMode === 'edit' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500'}`}
          >
            <PenLine size={12} /> Soạn thảo
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`px-4 py-1.5 text-[10px] font-black rounded-lg flex items-center gap-1.5 transition-all uppercase tracking-tighter ${viewMode === 'preview' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-white' : 'text-slate-500'}`}
          >
            <Eye size={12} /> Review
          </button>
        </div>

        <button
          onClick={() => setShowWarningsOnly(!showWarningsOnly)}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[10px] font-black transition-all uppercase tracking-tighter border shadow-sm ${showWarningsOnly
            ? 'bg-amber-100 text-amber-700 border-amber-200'
            : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
            }`}
          title="Lọc các câu có cảnh báo/lưu ý"
        >
          <AlertTriangle size={12} strokeWidth={3} className={showWarningsOnly ? "fill-amber-700" : ""} />
          Lọc Cảnh Báo
        </button>

        <div className="hidden md:flex flex-col items-end px-3 border-l border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-black text-slate-400 tracking-tighter uppercase whitespace-nowrap">Kết quả</span>
          <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 leading-none">{filtered.length} câu</span>
        </div>
      </div>

      <div className="space-y-8 pb-20">
        {filtered.map((mcq, idx) => (
          <MCQCard
            key={mcq.id}
            mcq={mcq}
            idx={idx}
            isEditing={editingId === mcq.id}
            editForm={editingId === mcq.id ? editForm : null}
            viewMode={viewMode}
            onEditStart={handleEditStart}
            onEditSave={handleEditSave}
            onEditCancel={handleEditCancel}
            onChange={handleChange}
            onOptionChange={handleOptionChange}
            onExplanationChange={handleExplanationChange}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
};
export default MCQDisplay;
