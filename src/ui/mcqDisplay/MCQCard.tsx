import React from 'react';
import { CheckCircle2, FileText, Filter, PenLine, Trash2 } from 'lucide-react';
import { Explanation, MCQ } from '../../types';
import { buildAnkiHtml } from '../../core/anki';
import { isOptionCorrect } from '../../utils/text';
import RichExplanation from './RichExplanation';
import { MCQViewMode } from './types';

interface MCQCardProps {
  compact?: boolean;
  editForm: MCQ | null;
  idx: number;
  isEditing: boolean;
  mcq: MCQ;
  onChange: (field: keyof MCQ, value: any) => void;
  onDelete?: (id: string) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onEditStart: (mcq: MCQ) => void;
  onExplanationChange: (field: keyof Explanation, value: string) => void;
  onOptionChange: (idx: number, value: string) => void;
  viewMode: MCQViewMode;
}

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
  onDelete,
  compact = false
}: MCQCardProps) => {
  const data = isEditing && editForm ? editForm : mcq;
  const cardPaddingClass = compact ? 'p-6' : 'p-8';
  const cardRadiusClass = compact ? 'rounded-2xl' : 'rounded-3xl';
  const questionTextClass = compact ? 'text-lg' : 'text-xl';
  const headerGapClass = compact ? 'gap-3 mb-4' : 'gap-4 mb-6';
  const badgeSizeClass = compact ? 'w-9 h-9 rounded-xl' : 'w-10 h-10 rounded-2xl';

  if (viewMode === 'preview' && !isEditing) {
    const htmlContent = buildAnkiHtml(data.explanation, data.difficulty, data.depthAnalysis);
    return (
      <div className={`glass ${cardRadiusClass} ${cardPaddingClass} pro-shadow transition-all group hover:-translate-y-1`}>
        <div className={`flex ${headerGapClass}`}>
          <div className={`${badgeSizeClass} bg-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-lg shadow-indigo-200 dark:shadow-none shrink-0`}>
            #{idx + 1}
          </div>
          <div className={`${questionTextClass} font-bold text-slate-900 dark:text-white leading-relaxed pt-1`}>
            {data.question}
          </div>
        </div>

        <div className={`${compact ? 'space-y-2 mb-5 ml-12' : 'space-y-3 mb-8 ml-14'}`}>
          {data.options.map((opt, i) => (
            <div key={i} className={`flex items-center gap-3 ${compact ? 'p-2.5' : 'p-3'} rounded-2xl transition-all ${isOptionCorrect(opt, data.correctAnswer, i) ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'text-slate-500'}`}>
              <span className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-xl flex items-center justify-center font-black text-xs ${isOptionCorrect(opt, data.correctAnswer, i) ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                {String.fromCharCode(65 + i)}
              </span>
              <span className={`text-sm ${isOptionCorrect(opt, data.correctAnswer, i) ? 'font-bold text-emerald-900 dark:text-emerald-400' : ''}`}>{opt}</span>
            </div>
          ))}
        </div>

        <div className={`${compact ? 'pt-4' : 'pt-6'} border-t border-slate-100 dark:border-slate-800`}>
          <span className={`text-[10px] font-black text-slate-400 tracking-widest uppercase ${compact ? 'mb-3' : 'mb-4'} block`}>Giao diện Anki</span>
          <div dangerouslySetInnerHTML={{ __html: htmlContent }} className={`anki-html ${compact ? 'p-4' : 'p-6'} bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-inner`} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`glass ${cardRadiusClass} ${cardPaddingClass} transition-all pro-shadow ${isEditing ? 'ring-2 ring-indigo-500 bg-white dark:bg-slate-900' : 'group hover:-translate-y-1'}`}
      onKeyDown={isEditing ? (e) => {
        if (e.key === 'Escape') onEditCancel();
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onEditSave();
      } : undefined}
    >
      <div className={`flex justify-between items-start ${headerGapClass}`}>
        <div className={`flex ${compact ? 'gap-3' : 'gap-4'} flex-1`}>
          <div className={`${badgeSizeClass} pro-gradient flex items-center justify-center text-white font-black text-sm shadow-lg shrink-0`}>
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
              <div className={`${questionTextClass} font-bold text-slate-800 dark:text-slate-100 leading-relaxed pt-1`}>
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

      <div className={`grid grid-cols-1 md:grid-cols-2 ${compact ? 'gap-2 mb-5 md:ml-12' : 'gap-3 mb-6 md:ml-14'} ml-0`}>
        {data.options.map((opt, i) => (
          <div
            key={i}
            className={`${compact ? 'p-3' : 'p-4'} rounded-2xl border-2 transition-all flex items-center gap-3 ${isOptionCorrect(opt, data.correctAnswer, i)
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500/30'
              : 'bg-white dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 hover:border-indigo-200'
            }`}
          >
            <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${isOptionCorrect(opt, data.correctAnswer, i) ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
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
                  <div className={`w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center ${isOptionCorrect(opt, data.correctAnswer, i) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                    {isOptionCorrect(opt, data.correctAnswer, i) && <CheckCircle2 size={12} className="text-white" />}
                  </div>
                </div>
              </div>
            ) : (
              <span className={`text-sm leading-tight ${isOptionCorrect(opt, data.correctAnswer, i) ? 'font-bold text-emerald-900 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}>{opt}</span>
            )}
          </div>
        ))}
      </div>

      <div className={`${compact ? 'pt-4 md:ml-12' : 'pt-6 md:ml-14'} border-t border-slate-100 dark:border-slate-800 ml-0`}>
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
            <RichExplanation exp={mcq.explanation} compact={compact} />
            <div className={`${compact ? 'mt-5' : 'mt-8'} flex flex-wrap gap-2`}>
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

export default MCQCard;
