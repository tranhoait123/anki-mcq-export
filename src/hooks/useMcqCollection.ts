import React from 'react';
import { MCQ } from '../types';
import { db } from '../core/db';
import { findDuplicate } from '../utils/dedupe';
import { sortMcqsByQuestionNumber } from '../utils/appHelpers';

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
    const uniqueNew: MCQ[] = [];
    for (const question of newList) {
      const result = findDuplicate(question, [...existingList, ...uniqueNew]);
      if (!result.isDup) uniqueNew.push(question);
    }
    return uniqueNew;
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

  const appendVisibleMcqs = React.useCallback(async (items: MCQ[]) => {
    const uniqueNew = uniqueAgainst(items, mcqsRef.current);
    if (uniqueNew.length === 0) return [];
    await setVisibleMcqs([...mcqsRef.current, ...uniqueNew]);
    return uniqueNew;
  }, [mcqsRef, setVisibleMcqs, uniqueAgainst]);

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
