import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { MCQ } from '../../types';
import { MCQViewMode } from './types';

const OVERSCAN_COUNT = 6;
const CARD_GAP = 32;
const PREVIEW_CARD_ESTIMATE = 500;
const EDIT_CARD_ESTIMATE = 900;

const getEstimatedHeight = (viewMode: MCQViewMode, isEditing: boolean) => (
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

interface VirtualizedMCQListProps {
  editingId: string | null;
  editForm: MCQ | null;
  items: MCQ[];
  onScrollRequestHandled: () => void;
  renderCard: (mcq: MCQ, idx: number) => React.ReactNode;
  requestedScrollIndex: number | null;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  useWindowScroll?: boolean;
  viewMode: MCQViewMode;
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
  const observerRef = useRef<ResizeObserver | null>(null);
  const measuredNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());

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

  useEffect(() => {
    observerRef.current = new ResizeObserver((entries) => {
      let changed = false;
      const nextHeights: Record<string, number> = {};
      
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const id = target.dataset.id;
        if (!id) continue;
        const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height);
        nextHeights[id] = height;
        changed = true;
      }

      if (changed) {
        setItemHeights(prev => {
          let updated = false;
          const merged = { ...prev };
          for (const id in nextHeights) {
            if (!merged[id] || Math.abs(merged[id] - nextHeights[id]) >= 2) {
              merged[id] = nextHeights[id];
              updated = true;
            }
          }
          return updated ? merged : prev;
        });
      }
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const measureItem = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      if (measuredNodesRef.current.get(id) !== node) {
        if (measuredNodesRef.current.has(id)) {
          observerRef.current?.unobserve(measuredNodesRef.current.get(id)!);
        }
        node.dataset.id = id;
        observerRef.current?.observe(node);
        measuredNodesRef.current.set(id, node);
        
        // Đo đạc lập tức ở frame đầu tiên để tránh chớp
        const h = Math.ceil(node.getBoundingClientRect().height);
        setItemHeights(prev => {
          if (!prev[id] || Math.abs(prev[id] - h) >= 2) {
            return { ...prev, [id]: h };
          }
          return prev;
        });
      }
    } else {
      const existing = measuredNodesRef.current.get(id);
      if (existing) {
        observerRef.current?.unobserve(existing);
        measuredNodesRef.current.delete(id);
      }
    }
  }, []);

  const scrollToIndex = useCallback((index: number, align: 'start' | 'center' = 'start') => {
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
  }, [editingId, items, measurements.heights, measurements.positions, scrollContainerRef, useWindowScroll, viewMode]);

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
  }, [editingId, items, measurements.positions, scrollToIndex]);

  useEffect(() => {
    if (requestedScrollIndex === null) return;
    scrollToIndex(requestedScrollIndex);
    onScrollRequestHandled();
  }, [onScrollRequestHandled, requestedScrollIndex, scrollToIndex]);

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
              className={`absolute left-0 right-0 ${mcq.id.startsWith('mcq-stream-') ? 'animate-stream-in' : ''}`}
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

export default VirtualizedMCQList;
