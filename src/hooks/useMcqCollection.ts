import React from 'react';
import { MCQ } from '../types';
import { db } from '../core/db';
import { createDuplicateLookup } from '../utils/dedupe';
import { mergeSortedMcqs, sortMcqsByQuestionNumber } from '../utils/appHelpers';
import { measureAsync, measureSync } from '../utils/performance';

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

  const setVisibleMcqs = React.useCallback(async (items: MCQ[]) => {
    const sorted = sortMcqsByQuestionNumber(items);
    mcqsRef.current = sorted;
    setMcqs(sorted);
    if (!activeSessionRef.current) {
      await persistMcqs(sorted);
    }
    return sorted;
  }, [activeSessionRef, mcqsRef, persistMcqs, setMcqs]);

  const appendVisibleMcqs = React.useCallback(async (items: MCQ[], options: { persist?: boolean } = {}) => {
    const uniqueNew = await measureAsync(`dedupe.appendVisibleMcqs(${items.length})`, async () => {
      const lookup = createDuplicateLookup(mcqsRef.current);
      const nextUnique: MCQ[] = [];
      for (const question of items) {
        const result = lookup.find(question);
        if (!result.isDup) {
          nextUnique.push(question);
          lookup.add(question);
        }
      }
      return nextUnique;
    });
    if (uniqueNew.length === 0) return [];
    const merged = mergeSortedMcqs(mcqsRef.current, uniqueNew);
    mcqsRef.current = merged;
    setMcqs(merged);
    if (activeSessionRef.current) {
      if (options.persist !== false) await db.upsertMCQs(uniqueNew);
    } else {
      await persistMcqs(merged);
    }
    return uniqueNew;
  }, [activeSessionRef, mcqsRef, persistMcqs, setMcqs]);

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
