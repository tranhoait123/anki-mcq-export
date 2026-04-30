import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Explanation, MCQ } from '../types';
import MCQCard from './mcqDisplay/MCQCard';
import MCQToolbar from './mcqDisplay/MCQToolbar';
import { MCQViewMode } from './mcqDisplay/types';
import VirtualizedMCQList from './mcqDisplay/VirtualizedMCQList';

interface MCQDisplayProps {
  mcqs: MCQ[];
  onDelete?: (id: string) => void;
  onUpdate?: (updatedMCQ: MCQ) => void;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  useWindowScroll?: boolean;
}

const LIST_VIRTUALIZATION_THRESHOLD = 80;
const DIFFICULTY_ORDER = ['Easy', 'Medium', 'Hard'] as const;

const MCQDisplay: React.FC<MCQDisplayProps> = ({ mcqs, onUpdate, onDelete, scrollContainerRef, useWindowScroll = false }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MCQ | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<MCQViewMode>('preview');
  const [requestedScrollIndex, setRequestedScrollIndex] = useState<number | null>(null);
  const questionViewportRef = useRef<HTMLDivElement | null>(null);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const toolbarStickyTopClass = useWindowScroll ? 'top-16' : 'top-0';
  const layoutSpacingClass = useWindowScroll ? 'space-y-8' : 'space-y-4';
  const splitReadingMode = !useWindowScroll;
  const constrainQuestionScroll = useWindowScroll && mcqs.length > 0;
  const questionScrollContainerRef = constrainQuestionScroll ? questionViewportRef : scrollContainerRef;
  const compactCards = splitReadingMode || constrainQuestionScroll;

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
        compact={compactCards}
        editForm={editingId === mcq.id ? editForm : null}
        idx={idx}
        isEditing={editingId === mcq.id}
        mcq={mcq}
        onChange={handleChange}
        onDelete={onDelete}
        onEditCancel={handleEditCancel}
        onEditSave={handleEditSave}
        onEditStart={handleEditStart}
        onExplanationChange={handleExplanationChange}
        onOptionChange={handleOptionChange}
        viewMode={viewMode}
      />
    </div>
  );

  const questionListContent = mcqs.length > 0 && filtered.length === 0 ? (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
      Không tìm thấy câu hỏi phù hợp với bộ lọc hiện tại.
    </div>
  ) : isLargeList ? (
    <VirtualizedMCQList
      editingId={editingId}
      editForm={editForm}
      items={filtered}
      onScrollRequestHandled={() => setRequestedScrollIndex(null)}
      renderCard={renderCard}
      requestedScrollIndex={requestedScrollIndex}
      scrollContainerRef={questionScrollContainerRef}
      useWindowScroll={!constrainQuestionScroll && useWindowScroll}
      viewMode={viewMode}
    />
  ) : (
    <div className={`${compactCards ? 'space-y-4 pb-6' : 'space-y-8 pb-20'}`}>
      {filtered.map((mcq, idx) => (
        <React.Fragment key={mcq.id}>
          {renderCard(mcq, idx)}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className={layoutSpacingClass}>
      <MCQToolbar
        difficultyFilter={difficultyFilter}
        filteredCount={filtered.length}
        mcqCount={mcqs.length}
        onDifficultyFilterChange={setDifficultyFilter}
        onScrollToTop={() => scrollToQuestionIndex(0)}
        onSearchTermChange={setSearchTerm}
        onViewModeChange={setViewMode}
        searchTerm={searchTerm}
        splitReadingMode={splitReadingMode}
        toolbarStickyTopClass={toolbarStickyTopClass}
        uniqueDifficulties={uniqueDifficulties}
        viewMode={viewMode}
      />

      {constrainQuestionScroll ? (
        <div
          ref={questionViewportRef}
          className="mcq-question-viewport h-[calc(100dvh-180px)] min-h-[880px] overflow-y-auto overscroll-contain rounded-[2rem] pr-2"
        >
          {questionListContent}
        </div>
      ) : (
        questionListContent
      )}
    </div>
  );
};

export default MCQDisplay;
