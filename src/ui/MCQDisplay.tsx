import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { MCQ, Explanation } from '../types';
import { CheckCircle2, Search, Quote, Lightbulb, AlertTriangle, Target, Eye, PenLine, Trash2, Filter, FileText, ArrowUp } from 'lucide-react';
import { buildAnkiHtml, formatRichText } from '../core/anki';
import { isOptionCorrect } from '../utils/text';

interface MCQDisplayProps {
  mcqs: MCQ[];
  onUpdate?: (updatedMCQ: MCQ) => void;
  onDelete?: (id: string) => void;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  useWindowScroll?: boolean;
}

const LIST_VIRTUALIZATION_THRESHOLD = 80;
const OVERSCAN_COUNT = 6;
const CARD_GAP = 32;
const PREVIEW_CARD_ESTIMATE = 500;
const EDIT_CARD_ESTIMATE = 900;
const DIFFICULTY_ORDER = ['Easy', 'Medium', 'Hard'] as const;

const getEstimatedHeight = (viewMode: 'edit' | 'preview', isEditing: boolean) => (
  isEditing ? EDIT_CARD_ESTIMATE : viewMode === 'preview' ? PREVIEW_CARD_ESTIMATE : 650
);

const getOffsetTopRelativeToAncestor = (element: HTMLElement, ancestor: HTMLElement) => {
  let offset = 0;
  let current: HTMLElement | null = element;

  while (current && current !== ancestor) {
    offset += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }

  return offset;
};

const binarySearchIndex = (positions: number[], target: number) => {
  let low = 0;
  let high = positions.length - 1;
  let result = positions.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (positions[mid] >= target) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
};

const RichExplanation: React.FC<{ exp: Explanation }> = ({ exp }) => {
  return (
    <div className="space-y-4 mt-6 text-sm">
      <div className="bg-rose-50/50 dark:bg-rose-900/10 border-l-4 border-rose-500 p-4 rounded-r-xl transition-all hover:bg-rose-50 dark:hover:bg-rose-900/20">
        <div className="flex items-start gap-3">
          <div className="bg-rose-500 p-1.5 rounded-lg text-white shadow-sm">
            <Target size={14} />
          </div>
          <div className="flex-1 overflow-hidden">
            <span className="font-bold text-rose-900 dark:text-rose-200 block text-[10px] uppercase tracking-wider mb-1">Đáp án cốt lõi</span>
            <div
              className="anki-html text-slate-700 dark:text-slate-300 leading-relaxed font-medium prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: formatRichText(exp.core) }}
            />
          </div>
        </div>
      </div>

      <div className="bg-indigo-50/50 dark:bg-indigo-900/10 border-l-4 border-indigo-500 p-4 rounded-r-xl transition-all hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
        <div className="flex items-start gap-3">
          <div className="bg-indigo-500 p-1.5 rounded-lg text-white shadow-sm">
            <Lightbulb size={14} />
          </div>
          <div className="flex-1 overflow-hidden">
            <span className="font-bold text-indigo-900 dark:text-indigo-200 block text-[10px] uppercase tracking-wider mb-1">Phân tích chuyên sâu</span>
            <div
              className="anki-html text-slate-700 dark:text-slate-300 leading-relaxed prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: formatRichText(exp.analysis) }}
            />
          </div>
        </div>
      </div>

      <div className="bg-slate-50/50 dark:bg-slate-800/20 border-l-4 border-slate-400 p-4 rounded-r-xl transition-all hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <div className="flex items-start gap-3">
          <div className="bg-slate-500 p-1.5 rounded-lg text-white shadow-sm">
            <Quote size={14} />
          </div>
          <div className="flex-1 overflow-hidden italic">
            <span className="font-bold text-slate-900 dark:text-slate-200 block text-[10px] uppercase tracking-wider mb-1 not-italic">Bằng chứng y khoa</span>
            <div
              className="anki-html text-slate-600 dark:text-slate-400 leading-relaxed prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: formatRichText(exp.evidence) }}
            />
          </div>
        </div>
      </div>

      {exp.warning && (
        <div className="bg-amber-50/50 dark:bg-amber-900/10 border-l-4 border-amber-500 p-4 rounded-r-xl transition-all hover:bg-amber-50 dark:hover:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <div className="bg-amber-500 p-1.5 rounded-lg text-white shadow-sm">
              <AlertTriangle size={14} />
            </div>
            <div className="flex-1 overflow-hidden">
              <span className="font-bold text-amber-900 dark:text-amber-200 block text-[10px] uppercase tracking-wider mb-1">Lưu ý lâm sàng</span>
              <div
                className="anki-html text-slate-700 dark:text-slate-300 leading-relaxed prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: formatRichText(exp.warning) }}
              />
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
            <div key={i} className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${isOptionCorrect(opt, data.correctAnswer, i) ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'text-slate-500'}`}>
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${isOptionCorrect(opt, data.correctAnswer, i) ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                {String.fromCharCode(65 + i)}
              </span>
              <span className={`text-sm ${isOptionCorrect(opt, data.correctAnswer, i) ? 'font-bold text-emerald-900 dark:text-emerald-400' : ''}`}>{opt}</span>
            </div>
          ))}
        </div>

        <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
          <span className="text-[10px] font-black text-slate-400 tracking-widest uppercase mb-4 block">Giao diện Anki</span>
          <div dangerouslySetInnerHTML={{ __html: htmlContent }} className="anki-html p-6 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-inner" />
        </div>
      </div>
    );
  }

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
            className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${isOptionCorrect(opt, data.correctAnswer, i)
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

interface VirtualizedMCQListProps {
  items: MCQ[];
  editingId: string | null;
  editForm: MCQ | null;
  viewMode: 'edit' | 'preview';
  renderCard: (mcq: MCQ, idx: number) => React.ReactNode;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  useWindowScroll?: boolean;
  requestedScrollIndex: number | null;
  onScrollRequestHandled: () => void;
}

const VirtualizedMCQList: React.FC<VirtualizedMCQListProps> = ({
  items,
  editingId,
  viewMode,
  renderCard,
  scrollContainerRef,
  useWindowScroll = false,
  requestedScrollIndex,
  onScrollRequestHandled
}) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [itemHeights, setItemHeights] = useState<Record<string, number>>({});
  const [viewportRange, setViewportRange] = useState({ start: 0, end: Math.min(items.length, 20) });
  const [showScrollTop, setShowScrollTop] = useState(false);

  const measurements = useMemo(() => {
    const positions: number[] = [];
    const heights: number[] = [];
    let totalHeight = 0;

    for (const item of items) {
      positions.push(totalHeight);
      const estimated = itemHeights[item.id] ?? getEstimatedHeight(viewMode, editingId === item.id);
      const heightWithGap = estimated + CARD_GAP;
      heights.push(heightWithGap);
      totalHeight += heightWithGap;
    }

    return { positions, heights, totalHeight };
  }, [editingId, itemHeights, items, viewMode]);

  const measureItem = (id: string, node: HTMLDivElement | null) => {
    if (!node) return;
    const nextHeight = Math.ceil(node.getBoundingClientRect().height);
    setItemHeights(prev => {
      const current = prev[id];
      if (current && Math.abs(current - nextHeight) < 4) return prev;
      return { ...prev, [id]: nextHeight };
    });
  };

  const scrollToIndex = (index: number, align: 'start' | 'center' = 'start') => {
    if (index < 0 || index >= items.length || !listRef.current) return;

    const targetTop = measurements.positions[index];
    const targetHeight = measurements.heights[index] ?? getEstimatedHeight(viewMode, editingId === items[index].id);

    if (useWindowScroll || !scrollContainerRef?.current) {
      const listRect = listRef.current.getBoundingClientRect();
      const absoluteTop = window.scrollY + listRect.top;
      const viewportHeight = window.innerHeight;
      const scrollTop = align === 'center'
        ? Math.max(0, absoluteTop + targetTop - (viewportHeight / 2) + (targetHeight / 2))
        : Math.max(0, absoluteTop + targetTop - 96);

      window.scrollTo({ top: scrollTop, behavior: 'smooth' });
      return;
    }

    const scrollEl = scrollContainerRef.current;
    const relativeTop = getOffsetTopRelativeToAncestor(listRef.current, scrollEl) + targetTop;
    const nextTop = align === 'center'
      ? Math.max(0, relativeTop - (scrollEl.clientHeight / 2) + (targetHeight / 2))
      : Math.max(0, relativeTop - 24);

    scrollEl.scrollTo({ top: nextTop, behavior: 'smooth' });
  };

  useEffect(() => {
    if (!items.length) {
      setViewportRange({ start: 0, end: 0 });
      return;
    }

    const updateViewport = () => {
      if (!listRef.current) return;

      const listEl = listRef.current;
      let visibleStart = 0;
      let visibleEnd = measurements.totalHeight;

      if (useWindowScroll || !scrollContainerRef?.current) {
        const listRect = listEl.getBoundingClientRect();
        visibleStart = Math.max(0, -listRect.top);
        visibleEnd = Math.min(measurements.totalHeight, visibleStart + window.innerHeight);
        setShowScrollTop(window.scrollY > 640);
      } else {
        const scrollEl = scrollContainerRef.current;
        const relativeTop = getOffsetTopRelativeToAncestor(listEl, scrollEl);
        visibleStart = Math.max(0, scrollEl.scrollTop - relativeTop);
        visibleEnd = Math.min(measurements.totalHeight, visibleStart + scrollEl.clientHeight);
        setShowScrollTop(scrollEl.scrollTop > 400);
      }

      const start = Math.max(0, binarySearchIndex(measurements.positions, Math.max(0, visibleStart - 300)) - OVERSCAN_COUNT);
      const endPosition = visibleEnd + 300;
      let end = binarySearchIndex(measurements.positions, endPosition) + OVERSCAN_COUNT + 1;
      if (end < start + 1) end = start + 1;
      if (end > items.length) end = items.length;

      setViewportRange(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    updateViewport();

    const scrollTarget = useWindowScroll || !scrollContainerRef?.current ? window : scrollContainerRef.current;
    scrollTarget.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', updateViewport);

    return () => {
      scrollTarget.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [items.length, measurements.positions, measurements.totalHeight, scrollContainerRef, useWindowScroll]);

  useEffect(() => {
    if (!editingId) return;
    const editingIndex = items.findIndex(item => item.id === editingId);
    if (editingIndex >= 0) scrollToIndex(editingIndex, 'center');
  }, [editingId, items, measurements.positions]);

  useEffect(() => {
    if (requestedScrollIndex === null) return;
    scrollToIndex(requestedScrollIndex);
    onScrollRequestHandled();
  }, [onScrollRequestHandled, requestedScrollIndex]);

  const visibleItems = items.slice(viewportRange.start, viewportRange.end);

  return (
    <div className="space-y-6">
      <div ref={listRef} className="relative" style={{ height: measurements.totalHeight }}>
        {visibleItems.map((mcq, visibleIndex) => {
          const idx = viewportRange.start + visibleIndex;
          return (
            <div
              key={mcq.id}
              ref={(node) => measureItem(mcq.id, node)}
              className="absolute left-0 right-0"
              style={{ top: measurements.positions[idx], paddingBottom: CARD_GAP }}
            >
              {renderCard(mcq, idx)}
            </div>
          );
        })}
      </div>

      {showScrollTop && (
        <button
          type="button"
          onClick={() => scrollToIndex(0)}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-wider text-white shadow-xl transition hover:scale-105 dark:bg-indigo-600"
        >
          <ArrowUp size={14} />
          Lên đầu
        </button>
      )}
    </div>
  );
};

const MCQDisplay: React.FC<MCQDisplayProps> = ({ mcqs, onUpdate, onDelete, scrollContainerRef, useWindowScroll = false }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MCQ | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('preview');
  const [requestedScrollIndex, setRequestedScrollIndex] = useState<number | null>(null);

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const uniqueDifficulties = useMemo(
    () => {
      const difficulties = Array.from(new Set(mcqs.map(m => m.difficulty).filter(Boolean)));
      const order = new Map(DIFFICULTY_ORDER.map((value, index) => [value.toLowerCase(), index]));

      return difficulties.sort((a, b) => {
        const aRank = order.get(a.toLowerCase());
        const bRank = order.get(b.toLowerCase());

        if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
        if (aRank !== undefined) return -1;
        if (bRank !== undefined) return 1;
        return a.localeCompare(b);
      });
    },
    [mcqs]
  );

  const filtered = useMemo(
    () => mcqs.filter(m => {
      const matchSearch = m.question.toLowerCase().includes(deferredSearchTerm.toLowerCase());
      const matchDifficulty = difficultyFilter === 'all' ? true : m.difficulty === difficultyFilter;
      return matchSearch && matchDifficulty;
    }),
    [mcqs, deferredSearchTerm, difficultyFilter]
  );

  const isLargeList = filtered.length >= LIST_VIRTUALIZATION_THRESHOLD;

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

  const scrollToQuestionIndex = (index: number) => {
    if (isLargeList) {
      setRequestedScrollIndex(index);
      return;
    }
    const cards = document.querySelectorAll<HTMLElement>('[data-mcq-index]');
    const exactMatch = Array.from(cards).find(node => Number(node.dataset.mcqIndex) === index);
    if (exactMatch) {
      exactMatch.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const renderCard = (mcq: MCQ, idx: number) => (
    <div data-mcq-index={idx}>
      <MCQCard
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
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="glass sticky top-16 z-40 rounded-3xl p-4 transition-all hover:shadow-lg">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-1 items-center gap-3 rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-800/50">
              <Search className="text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Tìm câu hỏi..."
                className="flex-1 bg-transparent border-none p-0 text-sm focus:ring-0 placeholder:text-slate-400"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex bg-slate-100 dark:bg-slate-800/50 p-1.5 rounded-2xl">
              <button
                onClick={() => setViewMode('preview')}
                className={`px-4 py-2 text-[11px] font-black rounded-xl flex items-center gap-2 transition-all uppercase tracking-tight ${viewMode === 'preview' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-white' : 'text-slate-500'}`}
              >
                <Eye size={13} /> Review
              </button>
              <button
                onClick={() => setViewMode('edit')}
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
                  onChange={(e) => setDifficultyFilter(e.target.value)}
                  className="min-w-[110px] bg-transparent border-none text-xs font-bold text-slate-600 focus:ring-0 cursor-pointer dark:text-slate-300"
                >
                  <option value="all">Tất cả độ khó</option>
                  {uniqueDifficulties.map(diff => (
                    <option key={diff} value={diff}>{diff}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                {filtered.length} / {mcqs.length} câu
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
              onClick={() => scrollToQuestionIndex(0)}
              className="inline-flex items-center gap-2 self-start rounded-2xl bg-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-tight text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700 lg:self-auto"
            >
              <ArrowUp size={13} />
              Lên đầu
            </button>
          </div>
        </div>
      </div>

      {mcqs.length > 0 && filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
          Không tìm thấy câu hỏi phù hợp với bộ lọc hiện tại.
        </div>
      ) : isLargeList ? (
        <VirtualizedMCQList
          items={filtered}
          editingId={editingId}
          editForm={editForm}
          viewMode={viewMode}
          renderCard={renderCard}
          scrollContainerRef={scrollContainerRef}
          useWindowScroll={useWindowScroll}
          requestedScrollIndex={requestedScrollIndex}
          onScrollRequestHandled={() => setRequestedScrollIndex(null)}
        />
      ) : (
        <div className="space-y-8 pb-20">
          {filtered.map((mcq, idx) => (
            <React.Fragment key={mcq.id}>
              {renderCard(mcq, idx)}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

export default MCQDisplay;
