import { AlertTriangle, Lightbulb, Quote, Target } from 'lucide-react';
import React from 'react';
import { Explanation } from '../../types';
import { formatRichText } from '../../core/anki';

interface RichExplanationProps {
  compact?: boolean;
  exp: Explanation;
}

const RichExplanation: React.FC<RichExplanationProps> = React.memo(({ exp, compact = false }) => {
  const spacingClass = compact ? 'space-y-3 mt-4' : 'space-y-4 mt-6';
  const blockPaddingClass = compact ? 'p-3' : 'p-4';
  const coreHtml = React.useMemo(() => formatRichText(exp.core), [exp.core]);
  const analysisHtml = React.useMemo(() => formatRichText(exp.analysis), [exp.analysis]);
  const evidenceHtml = React.useMemo(() => formatRichText(exp.evidence), [exp.evidence]);
  const warningHtml = React.useMemo(() => formatRichText(exp.warning), [exp.warning]);

  return (
    <div className={`${spacingClass} text-sm`}>
      <div className={`bg-rose-50/50 dark:bg-rose-900/10 border-l-4 border-rose-500 ${blockPaddingClass} rounded-r-xl transition-all hover:bg-rose-50 dark:hover:bg-rose-900/20`}>
        <div className="flex items-start gap-3">
          <div className="bg-rose-500 p-1.5 rounded-lg text-white shadow-sm">
            <Target size={14} />
          </div>
          <div className="flex-1 overflow-hidden">
            <span className="font-bold text-rose-900 dark:text-rose-200 block text-[10px] uppercase tracking-wider mb-1">Đáp án cốt lõi</span>
            <div
              className="anki-html text-slate-700 dark:text-slate-300 leading-relaxed font-medium prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: coreHtml }}
            />
          </div>
        </div>
      </div>

      <div className={`bg-indigo-50/50 dark:bg-indigo-900/10 border-l-4 border-indigo-500 ${blockPaddingClass} rounded-r-xl transition-all hover:bg-indigo-50 dark:hover:bg-indigo-900/20`}>
        <div className="flex items-start gap-3">
          <div className="bg-indigo-500 p-1.5 rounded-lg text-white shadow-sm">
            <Lightbulb size={14} />
          </div>
          <div className="flex-1 overflow-hidden">
            <span className="font-bold text-indigo-900 dark:text-indigo-200 block text-[10px] uppercase tracking-wider mb-1">Phân tích chuyên sâu</span>
            <div
              className="anki-html text-slate-700 dark:text-slate-300 leading-relaxed prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: analysisHtml }}
            />
          </div>
        </div>
      </div>

      <div className={`bg-slate-50/50 dark:bg-slate-800/20 border-l-4 border-slate-400 ${blockPaddingClass} rounded-r-xl transition-all hover:bg-slate-50 dark:hover:bg-slate-800/40`}>
        <div className="flex items-start gap-3">
          <div className="bg-slate-500 p-1.5 rounded-lg text-white shadow-sm">
            <Quote size={14} />
          </div>
          <div className="flex-1 overflow-hidden italic">
            <span className="font-bold text-slate-900 dark:text-slate-200 block text-[10px] uppercase tracking-wider mb-1 not-italic">Bằng chứng y khoa</span>
            <div
              className="anki-html text-slate-600 dark:text-slate-400 leading-relaxed prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: evidenceHtml }}
            />
          </div>
        </div>
      </div>

      {exp.warning && (
        <div className={`bg-amber-50/50 dark:bg-amber-900/10 border-l-4 border-amber-500 ${blockPaddingClass} rounded-r-xl transition-all hover:bg-amber-50 dark:hover:bg-amber-900/20`}>
          <div className="flex items-start gap-3">
            <div className="bg-amber-500 p-1.5 rounded-lg text-white shadow-sm">
              <AlertTriangle size={14} />
            </div>
            <div className="flex-1 overflow-hidden">
              <span className="font-bold text-amber-900 dark:text-amber-200 block text-[10px] uppercase tracking-wider mb-1">Lưu ý lâm sàng</span>
              <div
                className="anki-html text-slate-700 dark:text-slate-300 leading-relaxed prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: warningHtml }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default RichExplanation;
