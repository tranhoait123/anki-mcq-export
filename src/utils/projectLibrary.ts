import {
  AnalysisResult,
  AppSettings,
  DuplicateInfo,
  MCQ,
  ProjectComparison,
  StudyProject,
  StudyProjectSummary,
  UploadedFile,
} from '../types';
import { hashFiles } from '../core/brain';
import { createDuplicateLookup, findDuplicate } from './dedupe';
import { getPersistableFiles } from './appHelpers';
import { isOptionCorrect } from './text';

const normalizeQuestion = (value: string): string => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const LIKELY_DUPLICATE_SCAN_PAIR_LIMIT = 200_000;

const getCorrectLetter = (mcq: MCQ): string => {
  const index = (mcq.options || []).findIndex((option, optionIndex) =>
    isOptionCorrect(option, mcq.correctAnswer || '', optionIndex)
  );
  if (index >= 0) return String.fromCharCode(65 + index);
  return (mcq.correctAnswer || '').trim().toUpperCase();
};

const safeProjectName = (files: UploadedFile[]): string => {
  const firstName = files[0]?.name?.replace(/\.[^/.]+$/, '').trim();
  const suffix = new Date().toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return firstName ? `${firstName} - ${suffix}` : `Bộ đề - ${suffix}`;
};

export const buildProjectStats = (
  mcqs: MCQ[],
  duplicates: DuplicateInfo[],
  files: UploadedFile[],
  analysis: AnalysisResult | null
) => {
  const difficultyCounts = mcqs.reduce<Record<string, number>>((acc, mcq) => {
    const key = mcq.difficulty || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    questionCount: mcqs.length,
    duplicateCount: duplicates.length,
    fileCount: files.length,
    estimatedCount: analysis?.estimatedCount,
    difficultyCounts,
  };
};

export const buildSettingsSummary = (settings: AppSettings) => ({
  provider: settings.provider,
  model: settings.model,
  skipAnalysis: settings.skipAnalysis,
  concurrencyLimit: settings.concurrencyLimit,
  adaptiveBatching: settings.adaptiveBatching,
  projectLibraryEnabled: settings.projectLibraryEnabled,
  googleRpmLimiterEnabled: settings.googleRpmLimiterEnabled,
  googleRpmLimitPerMinute: settings.googleRpmLimitPerMinute,
  hasCustomPrompt: Boolean(settings.customPrompt?.trim()),
});

export const buildProjectSnapshot = async ({
  existing,
  files,
  mcqs,
  duplicates,
  analysis,
  settings,
}: {
  existing?: Pick<StudyProjectSummary, 'id' | 'name' | 'createdAt'> | null;
  files: UploadedFile[];
  mcqs: MCQ[];
  duplicates: DuplicateInfo[];
  analysis: AnalysisResult | null;
  settings: AppSettings;
}): Promise<StudyProject> => {
  const persistableFiles = getPersistableFiles(files);
  const now = Date.now();
  const filesFingerprint = await hashFiles(persistableFiles);

  return {
    id: existing?.id || `project-${now}-${Math.random().toString(36).slice(2, 10)}`,
    name: existing?.name || safeProjectName(persistableFiles),
    filesFingerprint,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    files: persistableFiles,
    mcqs,
    duplicates,
    analysis,
    settingsSummary: buildSettingsSummary(settings),
    stats: buildProjectStats(mcqs, duplicates, persistableFiles, analysis),
  };
};

export const compareProjectToCurrent = (
  project: StudyProject,
  currentMcqs: MCQ[]
): ProjectComparison => {
  const projectByQuestion = new Map(project.mcqs.map((mcq) => [normalizeQuestion(mcq.question), mcq]));
  const currentByQuestion = new Map(currentMcqs.map((mcq) => [normalizeQuestion(mcq.question), mcq]));

  const added = currentMcqs
    .filter((mcq) => !projectByQuestion.has(normalizeQuestion(mcq.question)))
    .map((mcq) => ({ id: mcq.id, question: mcq.question, source: mcq.source }));

  const removed = project.mcqs
    .filter((mcq) => !currentByQuestion.has(normalizeQuestion(mcq.question)))
    .map((mcq) => ({ id: mcq.id, question: mcq.question, source: mcq.source }));

  const changedAnswers = currentMcqs.reduce<ProjectComparison['changedAnswers']>((items, current) => {
    const previous = projectByQuestion.get(normalizeQuestion(current.question));
    if (!previous) return items;
    const previousAnswer = getCorrectLetter(previous);
    const currentAnswer = getCorrectLetter(current);
    if (previousAnswer && currentAnswer && previousAnswer !== currentAnswer) {
      items.push({
        id: current.id,
        question: current.question,
        previousAnswer,
        currentAnswer,
      });
    }
    return items;
  }, []);

  const skippedLikelyDuplicateScan = currentMcqs.length * project.mcqs.length > LIKELY_DUPLICATE_SCAN_PAIR_LIMIT;
  const projectDuplicateLookup = skippedLikelyDuplicateScan ? null : createDuplicateLookup(project.mcqs);
  const likelyDuplicates = skippedLikelyDuplicateScan
    ? []
    : currentMcqs.reduce<ProjectComparison['likelyDuplicates']>((items, current) => {
      if (projectByQuestion.has(normalizeQuestion(current.question))) return items;
      const match = projectDuplicateLookup?.find(current) || findDuplicate(current, project.mcqs);
      if (!match.isDup || !match.matchedData) return items;
      items.push({
        id: current.id,
        question: current.question,
        matchedWith: match.matchedWith || match.matchedData.question.substring(0, 60) || 'Câu hỏi đã có',
        score: match.score,
      });
      return items;
    }, []);

  return {
    added,
    removed,
    changedAnswers,
    likelyDuplicates,
    skippedLikelyDuplicateScan,
  };
};

export const sanitizeDownloadName = (name: string): string =>
  String(name || 'MCQ_Project').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'MCQ_Project';
