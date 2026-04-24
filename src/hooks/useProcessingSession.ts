import React, { useRef, useState } from 'react';
import { AnalysisResult, AppSettings, DuplicateInfo, MCQ, ProcessingPhase, ProcessingSession, UploadedFile } from '../types';
import { db } from '../core/db';
import { hashFiles } from '../core/brain';
import { getPersistableFiles } from '../utils/appHelpers';

interface ProcessingSessionRefs {
  filesRef: React.RefObject<UploadedFile[]>;
  mcqsRef: React.RefObject<MCQ[]>;
  duplicatesRef: React.RefObject<DuplicateInfo[]>;
  analysisRef: React.RefObject<AnalysisResult | null>;
}

export const useProcessingSession = ({
  filesRef,
  mcqsRef,
  duplicatesRef,
  analysisRef,
}: ProcessingSessionRefs) => {
  const [resumeSession, setResumeSession] = useState<ProcessingSession | null>(null);
  const activeSessionRef = useRef<ProcessingSession | null>(null);
  const sessionPersistChainRef = useRef<Promise<void>>(Promise.resolve());

  const persistSession = async (session: ProcessingSession) => {
    activeSessionRef.current = session;
    setResumeSession(session);
    sessionPersistChainRef.current = sessionPersistChainRef.current
      .catch(() => undefined)
      .then(() => db.saveSession(session));
    await sessionPersistChainRef.current;
  };

  const persistSessionSnapshot = (session: ProcessingSession) => {
    sessionPersistChainRef.current = sessionPersistChainRef.current
      .catch(() => undefined)
      .then(() => db.saveSession(session));
  };

  const updateActiveSession = async (partial: Partial<ProcessingSession>) => {
    const current = activeSessionRef.current || await db.getSession();
    if (!current) return null;
    const next: ProcessingSession = {
      ...current,
      ...partial,
      id: 'current',
      updatedAt: partial.updatedAt ?? Date.now(),
    };
    activeSessionRef.current = next;
    setResumeSession(next);
    sessionPersistChainRef.current = sessionPersistChainRef.current
      .catch(() => undefined)
      .then(() => db.saveSession(next));
    await sessionPersistChainRef.current;
    return next;
  };

  const clearResumeSession = async () => {
    activeSessionRef.current = null;
    setResumeSession(null);
    sessionPersistChainRef.current = sessionPersistChainRef.current
      .catch(() => undefined)
      .then(() => db.clearSession());
    await sessionPersistChainRef.current;
  };

  const buildSessionBase = async (
    phase: ProcessingPhase,
    settingsSnapshot: AppSettings,
    extras: Partial<ProcessingSession> = {}
  ): Promise<ProcessingSession> => ({
    id: 'current',
    status: 'running',
    phase,
    createdAt: extras.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    filesFingerprint: await hashFiles(getPersistableFiles(filesRef.current || [])),
    forcedOcrMode: extras.forcedOcrMode,
    settingsSnapshot,
    analysisSnapshot: analysisRef.current,
    totalTopLevelBatches: extras.totalTopLevelBatches ?? 0,
    completedBatchIndices: extras.completedBatchIndices ?? [],
    failedBatchIndices: extras.failedBatchIndices ?? [],
    failedBatchDetails: extras.failedBatchDetails ?? [],
    duplicatesSnapshot: extras.duplicatesSnapshot ?? (duplicatesRef.current || []),
    autoSkippedCount: extras.autoSkippedCount ?? 0,
    currentCount: extras.currentCount ?? (mcqsRef.current || []).length,
    resumeRetryIndices: extras.resumeRetryIndices,
    mcqsSnapshot: extras.mcqsSnapshot ?? (mcqsRef.current || []),
    phaseQuestionsSnapshot: extras.phaseQuestionsSnapshot ?? [],
    phaseDuplicatesSnapshot: extras.phaseDuplicatesSnapshot ?? [],
    phaseAutoSkippedCount: extras.phaseAutoSkippedCount ?? 0,
    phaseCurrentCount: extras.phaseCurrentCount ?? 0,
    phaseComparisonBaselineCount: extras.phaseComparisonBaselineCount,
    phaseComparisonFailedBatchIndices: extras.phaseComparisonFailedBatchIndices ?? [],
    phaseComparisonFailedBatchDetails: extras.phaseComparisonFailedBatchDetails ?? [],
  });

  return {
    resumeSession,
    setResumeSession,
    activeSessionRef,
    persistSession,
    persistSessionSnapshot,
    updateActiveSession,
    clearResumeSession,
    buildSessionBase,
  };
};
