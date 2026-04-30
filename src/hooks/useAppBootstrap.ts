import React from 'react';
import { AnalysisResult, DuplicateInfo, MCQ, ProcessingSession, UploadedFile } from '../types';
import { db } from '../core/db';
import { hashFiles } from '../core/brain';
import { getPersistableFiles, isResumableStatus, sortMcqsByQuestionNumber } from '../utils/appHelpers';

interface UseAppBootstrapOptions {
  loadPersistedSettings: () => Promise<unknown>;
  setAnalysis: React.Dispatch<React.SetStateAction<AnalysisResult | null>>;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateInfo[]>>;
  setFailedBatchIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  setIsLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setMcqs: React.Dispatch<React.SetStateAction<MCQ[]>>;
  setResumeSession: (session: ProcessingSession | null) => void;
}

export const useAppBootstrap = ({
  loadPersistedSettings,
  setAnalysis,
  setCurrentCount,
  setDuplicates,
  setFailedBatchIndices,
  setFiles,
  setIsLoaded,
  setMcqs,
  setResumeSession,
}: UseAppBootstrapOptions) => {
  React.useEffect(() => {
    const initData = async () => {
      try {
        await db.init();
        await loadPersistedSettings();

        const persistedFiles = getPersistableFiles(await db.getFiles());
        if (persistedFiles.length > 0) setFiles(persistedFiles);

        let persistedSession = await db.getSession();
        if (persistedSession) {
          if (persistedFiles.length === 0) {
            await db.clearSession();
            persistedSession = null;
          } else {
            const fingerprint = await hashFiles(persistedFiles);
            if (persistedSession.filesFingerprint !== fingerprint) {
              await db.clearSession();
              persistedSession = null;
            }
          }
        }

        if (persistedSession && isResumableStatus(persistedSession.status)) {
          if (persistedSession.status !== 'interrupted') {
            persistedSession = {
              ...persistedSession,
              status: 'interrupted',
              updatedAt: Date.now(),
            };
            await db.saveSession(persistedSession);
          }
          if (persistedSession.analysisSnapshot) setAnalysis(persistedSession.analysisSnapshot);
          if ((persistedSession.mcqsSnapshot || []).length > 0) setMcqs(sortMcqsByQuestionNumber(persistedSession.mcqsSnapshot || []));
          if (persistedSession.duplicatesSnapshot.length > 0) setDuplicates(persistedSession.duplicatesSnapshot);
          if ((persistedSession.failedBatchIndices || []).length > 0) setFailedBatchIndices(persistedSession.failedBatchIndices);
          setCurrentCount(persistedSession.currentCount || 0);
          setResumeSession(persistedSession);
        }

        let persistedMcqs = await db.getAllMCQs();
        if (persistedMcqs.length === 0) {
          const legacy = localStorage.getItem('anki_mcqs');
          if (legacy) {
            persistedMcqs = JSON.parse(legacy);
            if (Array.isArray(persistedMcqs) && persistedMcqs.length > 0) {
              await db.saveMCQs(persistedMcqs);
            }
          }
        }
        if (persistedMcqs.length > 0 && !persistedSession) setMcqs(persistedMcqs);

        setIsLoaded(true);
        console.log('Pro Storage (IndexedDB) ready.');
      } catch (error) {
        console.error('Storage Initialization Error:', error);
        setIsLoaded(true);
      }
    };

    void initData();
  }, [
    loadPersistedSettings,
    setAnalysis,
    setCurrentCount,
    setDuplicates,
    setFailedBatchIndices,
    setFiles,
    setIsLoaded,
    setMcqs,
    setResumeSession,
  ]);
};
