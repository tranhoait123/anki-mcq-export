import React from 'react';
import { MCQ } from '../types';
import { db } from '../core/db';
import { createDuplicateLookup } from '../utils/dedupe';
import { filterUniqueVisibleMcqs, mergeSortedMcqs, sortMcqsByQuestionNumber } from '../utils/appHelpers';
import { measureSync } from '../utils/performance';

interface UseMcqCollectionOptions {
  activeSessionRef: React.MutableRefObject<unknown>;
  mcqsRef: React.MutableRefObject<MCQ[]>;
  setMcqs: React.Dispatch<React.SetStateAction<MCQ[]>>;
}

export const useMcqCollection = ({
  activeSessionRef,
  mcqsRef,
  setMcqs,
}: UseMcqCollectionOptions) => {
  const mcqPersistChainRef = React.useRef<Promise<void>>(Promise.resolve());

  const uniqueAgainst = React.useCallback((newList: MCQ[], existingList: MCQ[]): MCQ[] => {
    return measureSync(`dedupe.uniqueAgainst(${newList.length}x${existingList.length})`, () => {
      const lookup = createDuplicateLookup(existingList);
      const uniqueNew: MCQ[] = [];
      for (const question of newList) {
        const result = lookup.find(question);
        if (!result.isDup) {
          uniqueNew.push(question);
          lookup.add(question);
        }
      }
      return uniqueNew;
    });
  }, []);

  const persistMcqs = React.useCallback(async (items: MCQ[]) => {
    mcqPersistChainRef.current = mcqPersistChainRef.current
      .catch(() => undefined)
      .then(() => db.saveMCQs(items));
    await mcqPersistChainRef.current;
  }, []);

  const commitVisibleMcqs = React.useCallback((items: MCQ[]) => {
    mcqsRef.current = items;
    React.startTransition(() => {
      setMcqs(items);
    });
  }, [mcqsRef, setMcqs]);

  const setVisibleMcqs = React.useCallback(async (items: MCQ[]) => {
    const sorted = sortMcqsByQuestionNumber(items);
    commitVisibleMcqs(sorted);
    if (!activeSessionRef.current) {
      await persistMcqs(sorted);
    }
    return sorted;
  }, [activeSessionRef, commitVisibleMcqs, persistMcqs]);

  const appendVisibleMcqs = React.useCallback(async (items: MCQ[], options: { persist?: boolean } = {}) => {
    const uniqueNew = measureSync(`visible.appendUnique(${items.length}x${mcqsRef.current.length})`, () =>
      filterUniqueVisibleMcqs(items, mcqsRef.current)
    );
    if (uniqueNew.length === 0) return [];
    const merged = mergeSortedMcqs(mcqsRef.current, uniqueNew);
    commitVisibleMcqs(merged);
    if (activeSessionRef.current) {
      if (options.persist !== false) await db.upsertMCQs(uniqueNew);
    } else {
      await persistMcqs(merged);
    }
    return uniqueNew;
  }, [activeSessionRef, commitVisibleMcqs, mcqsRef, persistMcqs]);

  const deduplicateQuestions = React.useCallback((newList: MCQ[], existingList: MCQ[]): MCQ[] => (
    uniqueAgainst(newList, existingList)
  ), [uniqueAgainst]);

  return {
    appendVisibleMcqs,
    deduplicateQuestions,
    persistMcqs,
    setVisibleMcqs,
    uniqueAgainst,
  };
};
