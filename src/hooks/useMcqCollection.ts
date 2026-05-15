import React from 'react';
import { MCQ } from '../types';
import { db } from '../core/db';
import { createDuplicateLookup } from '../utils/dedupe';
import { getVisibleMcqIdentity, mergeSortedMcqs, sortMcqsByQuestionNumber } from '../utils/appHelpers';
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
  const visibleLookupRef = React.useRef<{
    identities: Set<string>;
    ids: Set<string>;
    source: MCQ[] | null;
  }>({ identities: new Set(), ids: new Set(), source: null });

  const rebuildVisibleLookup = React.useCallback((items: MCQ[]) => {
    visibleLookupRef.current = {
      identities: new Set(items.map(getVisibleMcqIdentity).filter(Boolean)),
      ids: new Set(items.map(item => item.id).filter(Boolean)),
      source: items,
    };
    return visibleLookupRef.current;
  }, []);

  const getVisibleLookup = React.useCallback(() => {
    const current = visibleLookupRef.current;
    if (current.source !== mcqsRef.current) return rebuildVisibleLookup(mcqsRef.current);
    return current;
  }, [mcqsRef, rebuildVisibleLookup]);

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
    rebuildVisibleLookup(items);
    React.startTransition(() => {
      setMcqs(items);
    });
  }, [mcqsRef, rebuildVisibleLookup, setMcqs]);

  const setVisibleMcqs = React.useCallback(async (items: MCQ[]) => {
    const sorted = sortMcqsByQuestionNumber(items);
    commitVisibleMcqs(sorted);
    if (!activeSessionRef.current) {
      await persistMcqs(sorted);
    }
    return sorted;
  }, [activeSessionRef, commitVisibleMcqs, persistMcqs]);

  const appendVisibleMcqs = React.useCallback(async (items: MCQ[], options: { persist?: boolean } = {}) => {
    const uniqueNew = measureSync(`visible.appendUnique(${items.length}x${mcqsRef.current.length})`, () => {
      const lookup = getVisibleLookup();
      const unique: MCQ[] = [];
      for (const item of items) {
        const identity = getVisibleMcqIdentity(item);
        if ((item.id && lookup.ids.has(item.id)) || (identity && lookup.identities.has(identity))) continue;
        unique.push(item);
        if (item.id) lookup.ids.add(item.id);
        if (identity) lookup.identities.add(identity);
      }
      return unique;
    });
    if (uniqueNew.length === 0) return [];
    const merged = mergeSortedMcqs(mcqsRef.current, uniqueNew);
    commitVisibleMcqs(merged);
    if (activeSessionRef.current) {
      if (options.persist !== false) await db.upsertMCQs(uniqueNew);
    } else {
      await persistMcqs(merged);
    }
    return uniqueNew;
  }, [activeSessionRef, commitVisibleMcqs, getVisibleLookup, mcqsRef, persistMcqs]);

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
