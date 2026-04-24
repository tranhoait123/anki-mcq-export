import React, { useState, useEffect } from 'react';
import { UploadedFile, MCQ, GeneratedResponse, AnalysisResult, AuditResult, DuplicateInfo, AppSettings, ProcessingCheckpoint, ProcessingController, ProcessingPhase } from './types';
import FileUploader from './ui/FileUploader';
import MCQDisplay from './ui/MCQDisplay';
import SettingsModal from './ui/SettingsModal';
import AuditPanel from './ui/AuditPanel';
import DuplicatesReviewModal from './ui/DuplicatesReviewModal';
import { generateQuestions, analyzeDocument, auditMissingQuestions, hashFiles, translateErrorForUser } from './core/brain';
// @ts-ignore
import { db } from './core/db';
import { BrainCircuit, Loader2, Download, CheckCircle2, AlertTriangle, ScanText, Moon, Sun, Settings as SettingsIcon, Columns, FileText, DownloadCloud, Sparkles, RotateCcw, Info, Pause, Play } from 'lucide-react';
import { extractTextWithTesseract } from './core/vision';
import { findDuplicate } from './utils/dedupe';
import { coerceModelForProviderInput } from './utils/models';
import { toast } from 'sonner';
import { convertPdfToImages } from './utils/pdfProcessor';
import { selectPreferredPhaseOutcome } from './utils/resumeSession';
import { formatSessionPhase, getPersistableFiles, isDocxFile, isResumableStatus, sortMcqsByQuestionNumber, summarizeBatchFailures } from './utils/appHelpers';
import { useExportActions } from './hooks/useExportActions';
import { useProcessingSession } from './hooks/useProcessingSession';
import { useProcessingControllerState } from './hooks/useProcessingControllerState';
import { usePersistedSettings } from './hooks/usePersistedSettings';

const App: React.FC = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [mcqs, setMcqs] = useState<MCQ[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [, setAuditing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [progressStatus, setProgressStatus] = useState("");
  const [currentCount, setCurrentCount] = useState(0);
  const [showAudit, setShowAudit] = useState(false);
  const [ocrMode] = useState<'gemini' | 'tesseract'>('gemini');
  const [duplicates, setDuplicates] = useState<DuplicateInfo[]>([]);
  const [failedBatchIndices, setFailedBatchIndices] = useState<number[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const resultsPanelRef = React.useRef<HTMLDivElement | null>(null);
  const filesRef = React.useRef<UploadedFile[]>([]);
  const mcqsRef = React.useRef<MCQ[]>([]);
  const duplicatesRef = React.useRef<DuplicateInfo[]>([]);
  const analysisRef = React.useRef<AnalysisResult | null>(null);
  const previousFilesSignatureRef = React.useRef<string | null>(null);
  const mcqPersistChainRef = React.useRef<Promise<void>>(Promise.resolve());
  const { exportAction, downloadCSV, downloadDOCX } = useExportActions(mcqs, files);
  const {
    resumeSession,
    setResumeSession,
    activeSessionRef,
    persistSession,
    persistSessionSnapshot,
    updateActiveSession,
    clearResumeSession,
    buildSessionBase,
  } = useProcessingSession({ filesRef, mcqsRef, duplicatesRef, analysisRef });
  const {
    processingState,
    startProcessingController,
    clearProcessingController,
    waitWithController,
    handleTogglePause,
  } = useProcessingControllerState(activeSessionRef, persistSessionSnapshot);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const { settings, setSettings, loadPersistedSettings } = usePersistedSettings(isLoaded);

  // Initialization & Migration: Load from DB or Migration from localStorage
  useEffect(() => {
    const initData = async () => {
      try {
        await db.init();

        // 1. Check Settings
        await loadPersistedSettings();

        // 1.5 Check Files
        const persistedFiles = getPersistableFiles(await db.getFiles());
        if (persistedFiles.length > 0) setFiles(persistedFiles);

        // 1.6 Check Processing Session
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

        // 2. Check MCQs
        let persistedMcqs = await db.getAllMCQs();
        if (persistedMcqs.length === 0) {
          // Try migration
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
        console.log("Pro Storage (IndexedDB) ready.");
      } catch (e) {
        console.error("Storage Initialization Error:", e);
        setIsLoaded(true);
      }
    };
    initData();
  }, [loadPersistedSettings, setResumeSession]);

  // Save MCQs on change
  useEffect(() => {
    if (!isLoaded) return;
    if (activeSessionRef.current) return;
    mcqPersistChainRef.current = mcqPersistChainRef.current
      .catch(() => undefined)
      .then(() => db.saveMCQs(mcqs));
  }, [activeSessionRef, mcqs, isLoaded]);

  // Save uploaded files on change so reload/reset doesn't force re-upload
  useEffect(() => {
    if (!isLoaded) return;
    db.saveFiles(getPersistableFiles(files));
  }, [files, isLoaded]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    mcqsRef.current = mcqs;
  }, [mcqs]);

  useEffect(() => {
    duplicatesRef.current = duplicates;
  }, [duplicates]);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  // Dark Mode State
  // Dark Mode State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('anki_dark_mode') === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem('anki_dark_mode', String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // PWA Install Logic
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      console.log('✅ PWA Install Prompt detected');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // DEBUG: Force show if already installed or criteria not met but user wants to see it
    if ((window as any).DEBUG_SHOW_INSTALL) {
      setDeferredPrompt({ prompt: () => alert("PWA Install prompt would show here!"), userChoice: Promise.resolve({ outcome: 'accepted' }) });
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Reset lỗi khi file thay đổi để tránh lệch Index
  useEffect(() => {
    if (!isLoaded) return;
    const signature = files.map((file) => file.id).join('|');
    if (previousFilesSignatureRef.current === null) {
      previousFilesSignatureRef.current = signature;
      return;
    }
    if (signature !== previousFilesSignatureRef.current && files.length > 0 && !activeSessionRef.current && !resumeSession) {
      setFailedBatchIndices([]);
    }
    previousFilesSignatureRef.current = signature;
  }, [activeSessionRef, files, isLoaded, resumeSession]);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setDeferredPrompt(null);
    }
  };

  const currentFilesRequireVision = () => files.some(file => file.type === 'application/pdf' || file.type.startsWith('image/'));
  const getVisionRecommendedDocx = () => files.find(file => file.docxMode === 'visionRecommended');
  const getDetectedDocxMcqCount = () => files.reduce((total, file) => total + (file.nativeMcqCount || file.structuredMcqCount || 0), 0);

  const warnVisionRecommendedDocx = () => {
    const file = getVisionRecommendedDocx();
    if (!file) return false;
    toast.error(`DOCX "${file.name}" gần như không có text thật. Hãy xuất Word sang PDF hoặc ảnh rõ rồi tải lại để quét Vision.`, {
      duration: 7000,
    });
    return true;
  };

  const getRequestSettings = (requiresVision: boolean = false) => {
    const coercedModel = coerceModelForProviderInput(settings.provider, settings.model, requiresVision);
    if (coercedModel !== settings.model) {
      const nextSettings = { ...settings, model: coercedModel };
      setSettings(nextSettings);
      toast.info(requiresVision
        ? "Đã tự đổi sang model hỗ trợ ảnh/PDF để tránh lỗi quét."
        : "Đã tự đổi model cho khớp provider hiện tại để tránh lỗi endpoint.");
      return nextSettings;
    }
    return settings;
  };

  // Memoized Preview URL for Split View to avoid base64 overhead
  const previewUrl = React.useMemo(() => {
    if (!isSplitView || files.length === 0) return null;
    const file = files[0];
    if (isDocxFile(file) || (!file.type.startsWith('image/') && file.type !== 'application/pdf')) return null;
    try {
      // Decode base64 to Blob URL
      const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: file.type });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("Failed to generate preview URL", e);
      return null;
    }
  }, [files, isSplitView]);

  // Cleanup Blob URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Helper to process files for analysis/generation
  const prepareFiles = async (
    forcedMode?: 'gemini' | 'tesseract',
    controller?: ProcessingController,
    runtimeSettings?: AppSettings
  ): Promise<UploadedFile[]> => {
    const activeSettings = runtimeSettings || settings;
    const mode = forcedMode || ocrMode;
    let processedFiles: UploadedFile[] = [];

    // Pre-processing: Chuyển PDF thành ảnh nếu Provider không phải Google (Vertex/OpenRouter/ShopAI không nhận PDF raw)
    const needsPdfRasterization = activeSettings.provider !== 'google' && mode !== 'gemini';
    for (const file of files) {
      await controller?.waitIfPaused();

      if (file.type === 'application/pdf' && needsPdfRasterization) {
         setProgressStatus(`Đang chuyển đổi PDF sang ảnh để tương thích với ${activeSettings.provider}...`);
         try {
           const pdfDataUrl = file.content.startsWith('data:') ? file.content : `data:application/pdf;base64,${file.content}`;
           const imageBase64s = await convertPdfToImages(pdfDataUrl);
           
           imageBase64s.forEach((b64, idx) => {
             // Extract raw base64 logic
             const rawBase64 = b64.includes(',') ? b64.split(',')[1] : b64;
             processedFiles.push({
               id: `${file.id}-page-${idx}`,
               name: `${file.name.replace('.pdf', '')} - Trang ${idx + 1}.jpg`,
               type: 'image/jpeg',
               size: Math.round(rawBase64.length * 0.75),
               content: rawBase64,
             });
           });
           continue; 
         } catch (e: any) {
           console.error('PDF Conversion failed:', e);
           toast.error(`Lỗi chuyển đổi PDF ${file.name}: ${e.message}`);
         }
      }
      processedFiles.push(file);
    }

    if (mode === 'gemini') return processedFiles;

    // Tesseract Mode: Convert images to text first
    setProgressStatus("Đang chạy Local OCR (Tesseract)...");

    const textProcessedFiles: UploadedFile[] = [];
    for (const file of processedFiles) {
      await controller?.waitIfPaused();

      if (file.type.startsWith('image/')) {
        try {
          const base64Content = `data:${file.type};base64,${file.content}`;
          const text = await extractTextWithTesseract(base64Content, (p) => {
            setProgressStatus(`OCR ${file.name}: ${p}%`);
          });
          textProcessedFiles.push({
            ...file,
            content: text,
            type: 'text/plain',
            name: `${file.name}.txt`
          });
          continue;
        } catch (e) {
          console.error(`OCR Failed for ${file.name}`, e);
          textProcessedFiles.push(file); // Keep original if failed
          continue;
        }
      }
      if (file.name.toLowerCase().endsWith('.csv')) {
        textProcessedFiles.push({
          ...file,
          content: `FILE: ${file.name} (FORMAT: CSV - Each row is a record)\n${file.content}\n`
        });
        continue;
      }
      textProcessedFiles.push(file);
    }

    return textProcessedFiles;
  };

  const uniqueAgainst = (newList: MCQ[], existingList: MCQ[]): MCQ[] => {
    const uniqueNew: MCQ[] = [];
    for (const q of newList) {
      const result = findDuplicate(q, [...existingList, ...uniqueNew]);
      if (!result.isDup) uniqueNew.push(q);
    }
    return uniqueNew;
  };

  const setVisibleMcqs = async (items: MCQ[]) => {
    const sorted = sortMcqsByQuestionNumber(items);
    mcqsRef.current = sorted;
    setMcqs(sorted);
    if (!activeSessionRef.current) {
      mcqPersistChainRef.current = mcqPersistChainRef.current
        .catch(() => undefined)
        .then(() => db.saveMCQs(sorted));
      await mcqPersistChainRef.current;
    }
    return sorted;
  };

  const appendVisibleMcqs = async (items: MCQ[]) => {
    const uniqueNew = uniqueAgainst(items, mcqsRef.current);
    if (uniqueNew.length === 0) return [];
    await setVisibleMcqs([...mcqsRef.current, ...uniqueNew]);
    return uniqueNew;
  };

  const runGenerationPhase = async ({
    phase,
    filesToUse,
    requestSettings,
    expectedQuestionCount,
    controller,
    progressPrefix,
    retryIndices,
    isAdvancedMode = false,
    retryProfile,
    autoRescue = false,
    seedQuestions = [],
    seedDuplicates = [],
    seedAutoSkippedCount = 0,
    liveAppendToVisible = false,
    comparisonBaselineCount,
    comparisonFailedBatchIndices = [],
    comparisonFailedBatchDetails = [],
    existingCompletedBatchIndices = [],
    forcedOcrMode,
  }: {
    phase: ProcessingPhase;
    filesToUse: UploadedFile[];
    requestSettings: AppSettings;
    expectedQuestionCount: number;
    controller: ProcessingController;
    progressPrefix?: string;
    retryIndices?: number[];
    isAdvancedMode?: boolean;
    retryProfile?: 'normal' | 'rescue';
    autoRescue?: boolean;
    seedQuestions?: MCQ[];
    seedDuplicates?: DuplicateInfo[];
    seedAutoSkippedCount?: number;
    liveAppendToVisible?: boolean;
    comparisonBaselineCount?: number;
    comparisonFailedBatchIndices?: number[];
    comparisonFailedBatchDetails?: GeneratedResponse['failedBatchDetails'];
    existingCompletedBatchIndices?: number[];
    forcedOcrMode?: 'gemini' | 'tesseract';
  }) => {
    let phaseQuestions = sortMcqsByQuestionNumber(seedQuestions);
    let phaseDuplicates = [...seedDuplicates];
    let phaseAutoSkippedCount = seedAutoSkippedCount;

    await persistSession(await buildSessionBase(phase, requestSettings, {
      totalTopLevelBatches: retryIndices?.length || 0,
      completedBatchIndices: existingCompletedBatchIndices,
      failedBatchIndices: [],
      failedBatchDetails: [],
      forcedOcrMode,
      autoSkippedCount: liveAppendToVisible ? 0 : phaseAutoSkippedCount,
      currentCount: liveAppendToVisible ? mcqsRef.current.length : phaseQuestions.length,
      resumeRetryIndices: retryIndices,
      mcqsSnapshot: mcqsRef.current,
      duplicatesSnapshot: duplicatesRef.current,
      phaseQuestionsSnapshot: phaseQuestions,
      phaseDuplicatesSnapshot: phaseDuplicates,
      phaseAutoSkippedCount: phaseAutoSkippedCount,
      phaseCurrentCount: phaseQuestions.length,
      phaseComparisonBaselineCount: comparisonBaselineCount,
      phaseComparisonFailedBatchIndices: comparisonFailedBatchIndices,
      phaseComparisonFailedBatchDetails: comparisonFailedBatchDetails,
    }));

    const res = await generateQuestions(
      filesToUse,
      requestSettings,
      0,
      (status, count) => {
        setProgressStatus(progressPrefix ? `${progressPrefix}${status}` : status);
        setCurrentCount(count);
      },
      expectedQuestionCount,
      (newBatch) => {
        const persistBatch = async () => {
          if (liveAppendToVisible) {
            await appendVisibleMcqs(newBatch);
          }
          phaseQuestions = sortMcqsByQuestionNumber([...phaseQuestions, ...newBatch]);
        };
        void persistBatch();
      },
      retryIndices,
      isAdvancedMode,
      {
        controller,
        retryProfile,
        autoRescue,
        resumeMode: existingCompletedBatchIndices.length > 0 || seedQuestions.length > 0,
        completedBatchIndices: existingCompletedBatchIndices,
        existingQuestions: phaseQuestions,
        existingDuplicates: phaseDuplicates,
        existingAutoSkippedCount: phaseAutoSkippedCount,
        sessionPhase: phase,
        onCheckpoint: (checkpoint: ProcessingCheckpoint) => {
          void updateActiveSession({
            totalTopLevelBatches: checkpoint.totalTopLevelBatches,
            completedBatchIndices: checkpoint.completedBatchIndices,
            failedBatchIndices: checkpoint.failedBatchIndices,
            failedBatchDetails: checkpoint.failedBatchDetails,
            currentCount: checkpoint.currentCount,
            mcqsSnapshot: checkpoint.questionsSnapshot,
            duplicatesSnapshot: checkpoint.duplicatesSnapshot,
            autoSkippedCount: checkpoint.autoSkippedCount,
            phaseQuestionsSnapshot: checkpoint.questionsSnapshot,
            phaseDuplicatesSnapshot: checkpoint.duplicatesSnapshot,
            phaseAutoSkippedCount: checkpoint.autoSkippedCount,
            phaseCurrentCount: checkpoint.questionsSnapshot.length,
          });
          mcqPersistChainRef.current = mcqPersistChainRef.current
            .catch(() => undefined)
            .then(() => db.saveMCQs(checkpoint.questionsSnapshot));
        },
      }
    );

    phaseQuestions = sortMcqsByQuestionNumber(res.questions);
    phaseDuplicates = [...(res.duplicates || [])];
    phaseAutoSkippedCount = res.autoSkippedCount || phaseAutoSkippedCount;

    await updateActiveSession({
      totalTopLevelBatches: retryIndices?.length || activeSessionRef.current?.totalTopLevelBatches || 0,
      failedBatchIndices: res.failedBatches || [],
      failedBatchDetails: res.failedBatchDetails || [],
      currentCount: liveAppendToVisible ? mcqsRef.current.length : phaseQuestions.length,
      mcqsSnapshot: mcqsRef.current,
      duplicatesSnapshot: phaseDuplicates,
      autoSkippedCount: liveAppendToVisible ? phaseAutoSkippedCount : (activeSessionRef.current?.autoSkippedCount || phaseAutoSkippedCount),
      phaseQuestionsSnapshot: phaseQuestions,
      phaseDuplicatesSnapshot: phaseDuplicates,
      phaseAutoSkippedCount: phaseAutoSkippedCount,
      phaseCurrentCount: phaseQuestions.length,
    });

    return {
      res,
      phaseQuestions,
      phaseDuplicates,
      phaseAutoSkippedCount,
    };
  };

  const handleAnalyze = async () => {
    if (files.length === 0) return;
    if (warnVisionRecommendedDocx()) return;
    const requestSettings = getRequestSettings(currentFilesRequireVision());

    // Validation for Provider Keys (Fix Pack 2026)
    if (requestSettings.provider === 'google' && !requestSettings.apiKey?.trim()) {
      toast.error("🔑 Vui lòng nhập Google API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return;
    }
    if (requestSettings.provider === 'shopaikey' && !requestSettings.shopAIKeyKey?.trim()) {
      toast.error("🔑 Vui lòng nhập ShopAIKey API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return;
    }
    if (requestSettings.provider === 'openrouter' && !requestSettings.openRouterKey?.trim()) {
      toast.error("🔑 Vui lòng nhập OpenRouter API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return;
    }
    if (requestSettings.provider === 'vertexai' && (!requestSettings.vertexProjectId?.trim() || !requestSettings.vertexLocation?.trim() || !requestSettings.vertexAccessToken?.trim())) {
      toast.error("🔗 Vui lòng nhập đủ Project ID, Location và Token của Vertex AI trong (⚙️).");
      return;
    }

    setAnalyzing(true);
    setAnalysis(null);
    setAudit(null);
    try {
      if (settings.skipAnalysis) {
        const detectedDocxCount = getDetectedDocxMcqCount();
        setAnalysis({
          topic: detectedDocxCount > 0 ? "DOCX structured" : "Bỏ qua thuộc tính quét",
          estimatedCount: detectedDocxCount,
          questionRange: detectedDocxCount > 0 ? "Theo số block MCQ đã tách từ Word" : "Toàn bộ tài liệu",
          confidence: detectedDocxCount > 0 ? "High" : "N/A"
        });
        toast.info(detectedDocxCount > 0
          ? `Đã dùng số câu DOCX đã nhận diện: ${detectedDocxCount} câu.`
          : "Đã bỏ qua bước quét tài liệu.");
        setAnalyzing(false);
        return;
      }

      const filesToUse = await prepareFiles(undefined, undefined, requestSettings);
      const res = await analyzeDocument(filesToUse, requestSettings);
      setAnalysis(res);
      toast.success(`Phân tích thành công! Dự kiến có khoảng ${res.estimatedCount} câu hỏi.`);
    } catch (e: any) { 
      toast.error(translateErrorForUser(e, 'Phân tích'));
    }
    finally { setAnalyzing(false); }
  };

  const handleGenerate = async () => {
    if (files.length === 0) return;
    if (warnVisionRecommendedDocx()) return;
    const requestSettings = getRequestSettings(currentFilesRequireVision());
    
    // Validation for Provider Keys
    if (requestSettings.provider === 'google' && !requestSettings.apiKey) {
      toast.error("🔑 Vui lòng nhập Google API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return;
    }
    if (requestSettings.provider === 'shopaikey' && !requestSettings.shopAIKeyKey) {
      toast.error("🔑 Vui lòng nhập ShopAIKey API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return;
    }
    if (requestSettings.provider === 'openrouter' && !requestSettings.openRouterKey?.trim()) {
      toast.error("🔑 Vui lòng nhập OpenRouter API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return;
    }
    if (requestSettings.provider === 'vertexai' && (!requestSettings.vertexProjectId?.trim() || !requestSettings.vertexLocation?.trim() || !requestSettings.vertexAccessToken?.trim())) {
      toast.error("🔗 Vui lòng nhập đủ Project ID, Location và Token của Vertex AI trong (⚙️).");
      return;
    }

    await clearResumeSession();
    setLoading(true);
    setCurrentCount(0);
    setProgressStatus("Đang chuẩn bị xử lý...");
    setMcqs([]);
    mcqsRef.current = [];
    await db.saveMCQs([]);
    setFailedBatchIndices([]);
    setAudit(null);
    setShowAudit(false);
    setDuplicates([]);
    duplicatesRef.current = [];
    setShowDuplicates(false);
    let completed = false;

    try {
      const controller = startProcessingController();
      const settingsSnapshot = { ...requestSettings };
      let activeOcrMode: 'gemini' | 'tesseract' = ocrMode;

      // 1. Initial Attempt (Default Mode)
      let filesToUse = await prepareFiles(activeOcrMode, controller, settingsSnapshot);
      const expectedQuestionCount = analysis?.estimatedCount || getDetectedDocxMcqCount();
      let { res } = await runGenerationPhase({
        phase: 'initial',
        filesToUse,
        requestSettings: settingsSnapshot,
        expectedQuestionCount,
        controller,
        liveAppendToVisible: true,
        forcedOcrMode: activeOcrMode,
      });

      // 2. Auto-Fallback Check
      // If we used Gemini (Cloud) AND got bad results (< 60% of estimate), try Tesseract
      if (ocrMode === 'gemini' && analysis && analysis.estimatedCount > 0) {
        const count = res.questions.length;
        if (count < analysis.estimatedCount * 0.9) {
          const hasImages = files.some(f => f.type.startsWith('image/'));
          if (hasImages) {
            // Trigger Fallback
            setProgressStatus(`Kết quả Cloud thấp(${count} / ${analysis.estimatedCount}).Đang tự động chuyển sang Local OCR(Smart Fallback)...`);
            await waitWithController(2000, controller);

            try {
              const tesseractFiles = await prepareFiles('tesseract', controller, settingsSnapshot);
              // If OCR produced text, let's retry generation
              if (tesseractFiles.some(f => f.type === 'text/plain' && f.content.length > 50)) {
                const fallbackPhase = await runGenerationPhase({
                  phase: 'fallback',
                  filesToUse: tesseractFiles,
                  requestSettings: settingsSnapshot,
                  expectedQuestionCount: analysis.estimatedCount,
                  controller,
                  progressPrefix: '',
                  liveAppendToVisible: false,
                  comparisonBaselineCount: count,
                  comparisonFailedBatchIndices: res.failedBatches || [],
                  comparisonFailedBatchDetails: res.failedBatchDetails || [],
                  forcedOcrMode: 'tesseract',
                });
                const fallbackRes = fallbackPhase.res;

                const preferredOutcome = selectPreferredPhaseOutcome({
                  baselineQuestions: res.questions as MCQ[],
                  baselineFailedBatchIndices: res.failedBatches || [],
                  baselineFailedBatchDetails: res.failedBatchDetails || [],
                  baselineMode: activeOcrMode,
                  candidateQuestions: fallbackRes.questions as MCQ[],
                  candidateFailedBatchIndices: fallbackRes.failedBatches || [],
                  candidateFailedBatchDetails: fallbackRes.failedBatchDetails || [],
                  candidateMode: 'tesseract',
                });

                if (preferredOutcome.useCandidate) {
                  res = {
                    ...fallbackRes,
                    failedBatches: preferredOutcome.failedBatchIndices,
                    failedBatchDetails: preferredOutcome.failedBatchDetails,
                  };
                  filesToUse = tesseractFiles;
                  activeOcrMode = 'tesseract';
                  await setVisibleMcqs(sortMcqsByQuestionNumber(fallbackRes.questions.map((q, i) => ({
                    ...q,
                    id: q.id || `q-${Date.now()}-${i}`,
                  }))));
                  console.log("Fallback successful, replaced results.");
                } else {
                  setFailedBatchIndices(preferredOutcome.failedBatchIndices);
                }
              }
            } catch (fallbackError) {
              console.error("Fallback failed:", fallbackError);
              // Swallow error and keep original results
            }
          }
        }
      }

      let autoRescuedCount = 0;
      if (res.failedBatches && res.failedBatches.length > 0) {
        const initialFailed = [...res.failedBatches];
        try {
          const rescuePhase = await runGenerationPhase({
            phase: 'rescue',
            filesToUse,
            requestSettings: settingsSnapshot,
            expectedQuestionCount,
            controller,
            retryIndices: initialFailed,
            isAdvancedMode: true,
            retryProfile: 'rescue',
            autoRescue: true,
            liveAppendToVisible: true,
            forcedOcrMode: activeOcrMode,
          });
          const rescueRes = rescuePhase.res;

          const uniqueRescued = deduplicateQuestions(rescueRes.questions as MCQ[], res.questions as MCQ[]);
          autoRescuedCount = Math.max(autoRescuedCount, uniqueRescued.length);
          res = {
            ...res,
            questions: [...res.questions, ...uniqueRescued],
            duplicates: [...(res.duplicates || []), ...(rescueRes.duplicates || [])],
            failedBatches: rescueRes.failedBatches || [],
            failedBatchDetails: rescueRes.failedBatchDetails || [],
            autoSkippedCount: (res.autoSkippedCount || 0) + (rescueRes.autoSkippedCount || 0),
          };
        } catch (rescueError) {
          console.warn("Auto-rescue failed:", rescueError);
        }
      }

      const formatted = res.questions.map((q, i) => ({
        ...q, id: q.id || `q - ${Date.now()} -${i} `
      }));
      await setVisibleMcqs(formatted);

      // 3. Thông báo lỗi cho các Batch thất bại (nếu có)
      if (res.failedBatches && res.failedBatches.length > 0) {
        setFailedBatchIndices(res.failedBatches);
        toast.warning(`⚠️ Còn ${res.failedBatches.length} phần lỗi sau khi quét${autoRescuedCount > 0 ? `, đã tự cứu thêm ${autoRescuedCount} câu` : ''}. ${summarizeBatchFailures(res.failedBatchDetails, res.failedBatches)}`, {
          duration: 15000,
        });
      } else {
        setFailedBatchIndices([]);
        const skipCount = res.autoSkippedCount || 0;
        if (formatted.length > 0) {
          toast.success(`Trích xuất hoàn tất! Tìm thấy tổng cộng ${formatted.length} câu hỏi.${autoRescuedCount > 0 ? ` Đã tự cứu thêm ${autoRescuedCount} câu từ batch lỗi.` : ''}${skipCount > 0 ? ` Đã bỏ qua ${skipCount} câu trùng.` : ''}`);
        } else if (skipCount > 0) {
          toast.info(`Toàn bộ tài liệu (${skipCount} câu) đã trùng lặp trong danh sách, không trích xuất thêm.`);
        } else {
          toast.error("Không tìm thấy câu hỏi nào hoặc lỗi trích xuất.");
        }
      }

      // Store duplicates for display
      if (res.duplicates && res.duplicates.length > 0) {
        setDuplicates(res.duplicates);
        duplicatesRef.current = res.duplicates;
      }

      // Tự động kiểm toán nếu số lượng quá thấp
      if (analysis && formatted.length < analysis.estimatedCount * 0.8) {
        runAudit(formatted.length, filesToUse);
      } else if (!analysis && expectedQuestionCount > 0 && formatted.length < expectedQuestionCount * 0.8) {
        runAudit(formatted.length, filesToUse);
      }
      completed = true;
    } catch (e: any) {
      toast.error(translateErrorForUser(e, 'Trích xuất'));
    }
    finally {
      if (completed) await clearResumeSession();
      clearProcessingController();
      setLoading(false);
    }
  };

  function deduplicateQuestions(newList: MCQ[], existingList: MCQ[]): MCQ[] {
    return uniqueAgainst(newList, existingList);
  }

  const handleDiscardResumeSession = async () => {
    await clearResumeSession();
    await db.saveMCQs(mcqsRef.current);
    setProgressStatus("");
    setCurrentCount(0);
    setFailedBatchIndices([]);
    toast.info("Đã bỏ phiên dang dở. File và dữ liệu đã khôi phục vẫn được giữ lại.");
  };

  const handleResumeSession = async () => {
    const session = resumeSession;
    if (!session || files.length === 0) return;
    if (warnVisionRecommendedDocx()) return;

    setLoading(true);
    setCurrentCount(session.currentCount ?? session.phaseCurrentCount ?? mcqsRef.current.length);
    setProgressStatus(`Đang tiếp tục ${formatSessionPhase(session.phase).toLowerCase()}...`);
    setFailedBatchIndices(session.failedBatchIndices || []);
    setDuplicates(session.duplicatesSnapshot || []);
    duplicatesRef.current = session.duplicatesSnapshot || [];
    let resumedSuccessfully = false;

    try {
      const controller = startProcessingController();
      let activeOcrMode: 'gemini' | 'tesseract' = session.forcedOcrMode || 'gemini';
      let filesToUse = await prepareFiles(activeOcrMode, controller, session.settingsSnapshot);
      const expectedQuestionCount = session.analysisSnapshot?.estimatedCount || getDetectedDocxMcqCount();

      if (session.phase === 'initial') {
        let { res } = await runGenerationPhase({
          phase: 'initial',
          filesToUse,
          requestSettings: session.settingsSnapshot,
          expectedQuestionCount,
          controller,
          seedQuestions: mcqsRef.current,
          seedDuplicates: [],
          existingCompletedBatchIndices: session.completedBatchIndices,
          liveAppendToVisible: true,
          forcedOcrMode: activeOcrMode,
        });

        if (activeOcrMode === 'gemini' && session.analysisSnapshot && session.analysisSnapshot.estimatedCount > 0) {
          const count = res.questions.length;
          if (count < session.analysisSnapshot.estimatedCount * 0.9) {
            const hasImages = files.some(f => f.type.startsWith('image/'));
            if (hasImages) {
              const tesseractFiles = await prepareFiles('tesseract', controller, session.settingsSnapshot);
              if (tesseractFiles.some(f => f.type === 'text/plain' && f.content.length > 50)) {
                const fallbackPhase = await runGenerationPhase({
                  phase: 'fallback',
                  filesToUse: tesseractFiles,
                  requestSettings: session.settingsSnapshot,
                  expectedQuestionCount: session.analysisSnapshot.estimatedCount,
                  controller,
                  seedQuestions: [],
                  seedDuplicates: [],
                  comparisonBaselineCount: count,
                  comparisonFailedBatchIndices: res.failedBatches || [],
                  comparisonFailedBatchDetails: res.failedBatchDetails || [],
                  forcedOcrMode: 'tesseract',
                });

                const preferredOutcome = selectPreferredPhaseOutcome({
                  baselineQuestions: res.questions as MCQ[],
                  baselineFailedBatchIndices: res.failedBatches || [],
                  baselineFailedBatchDetails: res.failedBatchDetails || [],
                  baselineMode: activeOcrMode,
                  candidateQuestions: fallbackPhase.res.questions as MCQ[],
                  candidateFailedBatchIndices: fallbackPhase.res.failedBatches || [],
                  candidateFailedBatchDetails: fallbackPhase.res.failedBatchDetails || [],
                  candidateMode: 'tesseract',
                });

                if (preferredOutcome.useCandidate) {
                  res = {
                    ...fallbackPhase.res,
                    failedBatches: preferredOutcome.failedBatchIndices,
                    failedBatchDetails: preferredOutcome.failedBatchDetails,
                  };
                  filesToUse = tesseractFiles;
                  activeOcrMode = 'tesseract';
                  await setVisibleMcqs(sortMcqsByQuestionNumber(fallbackPhase.res.questions));
                } else {
                  setFailedBatchIndices(preferredOutcome.failedBatchIndices);
                }
              }
            }
          }
        }

        if (res.failedBatches && res.failedBatches.length > 0) {
          const rescuePhase = await runGenerationPhase({
            phase: 'rescue',
            filesToUse,
            requestSettings: session.settingsSnapshot,
            expectedQuestionCount,
            controller,
            retryIndices: res.failedBatches,
            isAdvancedMode: true,
            retryProfile: 'rescue',
            autoRescue: true,
            liveAppendToVisible: true,
            forcedOcrMode: activeOcrMode,
          });
          const uniqueRescued = deduplicateQuestions(rescuePhase.res.questions as MCQ[], res.questions as MCQ[]);
          res = {
            ...res,
            questions: [...res.questions, ...uniqueRescued],
            duplicates: [...(res.duplicates || []), ...(rescuePhase.res.duplicates || [])],
            failedBatches: rescuePhase.res.failedBatches || [],
            failedBatchDetails: rescuePhase.res.failedBatchDetails || [],
            autoSkippedCount: (res.autoSkippedCount || 0) + (rescuePhase.res.autoSkippedCount || 0),
          };
        }

        await setVisibleMcqs(sortMcqsByQuestionNumber(res.questions));
        setFailedBatchIndices(res.failedBatches || []);
        setDuplicates(res.duplicates || []);
        duplicatesRef.current = res.duplicates || [];
      } else if (session.phase === 'fallback') {
        const fallbackPhase = await runGenerationPhase({
          phase: 'fallback',
          filesToUse,
          requestSettings: session.settingsSnapshot,
          expectedQuestionCount,
          controller,
          seedQuestions: session.phaseQuestionsSnapshot || [],
          seedDuplicates: session.phaseDuplicatesSnapshot || [],
          seedAutoSkippedCount: session.phaseAutoSkippedCount || 0,
          existingCompletedBatchIndices: session.completedBatchIndices || [],
          comparisonBaselineCount: session.phaseComparisonBaselineCount || mcqsRef.current.length,
          comparisonFailedBatchIndices: session.phaseComparisonFailedBatchIndices || [],
          comparisonFailedBatchDetails: session.phaseComparisonFailedBatchDetails || [],
          forcedOcrMode: 'tesseract',
        });

        const preferredOutcome = selectPreferredPhaseOutcome({
          baselineQuestions: mcqsRef.current,
          baselineFailedBatchIndices: session.phaseComparisonFailedBatchIndices || [],
          baselineFailedBatchDetails: session.phaseComparisonFailedBatchDetails || [],
          baselineMode: 'gemini',
          candidateQuestions: fallbackPhase.res.questions as MCQ[],
          candidateFailedBatchIndices: fallbackPhase.res.failedBatches || [],
          candidateFailedBatchDetails: fallbackPhase.res.failedBatchDetails || [],
          candidateMode: 'tesseract',
        });

        let selectedRes: GeneratedResponse = preferredOutcome.useCandidate
          ? {
              ...fallbackPhase.res,
              failedBatches: preferredOutcome.failedBatchIndices,
              failedBatchDetails: preferredOutcome.failedBatchDetails,
            }
          : {
              questions: preferredOutcome.questions,
              duplicates: session.duplicatesSnapshot || [],
              failedBatches: preferredOutcome.failedBatchIndices,
              failedBatchDetails: preferredOutcome.failedBatchDetails,
              autoSkippedCount: session.autoSkippedCount || 0,
            };

        if (preferredOutcome.useCandidate) {
          activeOcrMode = 'tesseract';
          filesToUse = await prepareFiles('tesseract', controller, session.settingsSnapshot);
          await setVisibleMcqs(sortMcqsByQuestionNumber(fallbackPhase.res.questions));
        } else {
          activeOcrMode = preferredOutcome.forcedOcrMode || 'gemini';
          filesToUse = await prepareFiles(activeOcrMode, controller, session.settingsSnapshot);
          await setVisibleMcqs(sortMcqsByQuestionNumber(preferredOutcome.questions));
        }

        if (selectedRes.failedBatches && selectedRes.failedBatches.length > 0) {
          const rescuePhase = await runGenerationPhase({
            phase: 'rescue',
            filesToUse,
            requestSettings: session.settingsSnapshot,
            expectedQuestionCount,
            controller,
            retryIndices: selectedRes.failedBatches,
            isAdvancedMode: true,
            retryProfile: 'rescue',
            autoRescue: true,
            liveAppendToVisible: true,
            forcedOcrMode: activeOcrMode,
          });
          const uniqueRescued = deduplicateQuestions(rescuePhase.res.questions as MCQ[], selectedRes.questions as MCQ[]);
          selectedRes = {
            ...selectedRes,
            questions: [...selectedRes.questions, ...uniqueRescued],
            duplicates: [...(selectedRes.duplicates || []), ...(rescuePhase.res.duplicates || [])],
            failedBatches: rescuePhase.res.failedBatches || [],
            failedBatchDetails: rescuePhase.res.failedBatchDetails || [],
            autoSkippedCount: (selectedRes.autoSkippedCount || 0) + (rescuePhase.res.autoSkippedCount || 0),
          };
        }

        await setVisibleMcqs(sortMcqsByQuestionNumber(selectedRes.questions as MCQ[]));
        setFailedBatchIndices(selectedRes.failedBatches || []);
        setDuplicates(selectedRes.duplicates || []);
        duplicatesRef.current = selectedRes.duplicates || [];
      } else {
        const retryIndices = session.resumeRetryIndices || session.failedBatchIndices || [];
        const resumedPhase = await runGenerationPhase({
          phase: session.phase,
          filesToUse,
          requestSettings: session.settingsSnapshot,
          expectedQuestionCount,
          controller,
          progressPrefix: session.phase === 'retryFailed' ? '[CƠ CHẾ CHUYÊN GIA] ' : '',
          retryIndices,
          isAdvancedMode: true,
          retryProfile: 'rescue',
          autoRescue: session.phase === 'rescue',
          liveAppendToVisible: true,
          existingCompletedBatchIndices: session.completedBatchIndices || [],
          seedQuestions: session.phaseQuestionsSnapshot || [],
          seedDuplicates: session.phaseDuplicatesSnapshot || [],
          seedAutoSkippedCount: session.phaseAutoSkippedCount || 0,
          forcedOcrMode: activeOcrMode,
        });
        setFailedBatchIndices(resumedPhase.res.failedBatches || []);
        setDuplicates(resumedPhase.res.duplicates || []);
        duplicatesRef.current = resumedPhase.res.duplicates || [];
      }

      toast.success("Đã tiếp tục xong phiên dang dở.");
      resumedSuccessfully = true;
    } catch (e: any) {
      toast.error(translateErrorForUser(e, 'Tiếp tục'));
    } finally {
      if (resumedSuccessfully) await clearResumeSession();
      clearProcessingController();
      setLoading(false);
    }
  };

  const handleRetryFailed = async () => {
    if (files.length === 0 || failedBatchIndices.length === 0) return;
    if (warnVisionRecommendedDocx()) return;
    const requestSettings = getRequestSettings(currentFilesRequireVision());
    
    await clearResumeSession();
    setLoading(true);
    setCurrentCount(0);
    setProgressStatus(`Đang quét lại ${failedBatchIndices.length} phần lỗi...`);
    let retryCompleted = false;
    
    try {
      const controller = startProcessingController();
      const filesToUse = await prepareFiles(ocrMode, controller, requestSettings);
      const retryPhase = await runGenerationPhase({
        phase: 'retryFailed',
        filesToUse,
        requestSettings: requestSettings,
        expectedQuestionCount: analysis?.estimatedCount || 0,
        controller,
        progressPrefix: '[CƠ CHẾ CHUYÊN GIA] ',
        retryIndices: failedBatchIndices,
        isAdvancedMode: true,
        retryProfile: 'rescue',
        liveAppendToVisible: true,
        forcedOcrMode: ocrMode,
      });
      const res = retryPhase.res;

      if (res.failedBatches && res.failedBatches.length > 0) {
        setFailedBatchIndices(res.failedBatches);
        toast.error(`⚠️ Quét lại vẫn còn ${res.failedBatches.length} phần lỗi. ${summarizeBatchFailures(res.failedBatchDetails, res.failedBatches)}`);
      } else {
        setFailedBatchIndices([]);
        toast.success("Đã quét lại thành công tất cả các phần lỗi!");
      }
      setDuplicates(res.duplicates || []);
      duplicatesRef.current = res.duplicates || [];
      retryCompleted = true;
    } catch (e: any) {
      toast.error(translateErrorForUser(e, 'Quét lại'));
    } finally {
      if (retryCompleted) await clearResumeSession();
      clearProcessingController();
      setLoading(false);
    }
  };

  const runAudit = async (count: number, processedFiles?: UploadedFile[]) => {
    setAuditing(true);
    try {
      const requestSettings = getRequestSettings((processedFiles || files).some(file => file.type === 'application/pdf' || file.type.startsWith('image/')));
      const filesToUse = processedFiles || await prepareFiles(undefined, undefined, requestSettings);
      const res = await auditMissingQuestions(filesToUse, count, requestSettings);
      setAudit(res);
      setShowAudit(true);
    } catch (e) {
      console.error("Audit failed", e);
    } finally {
      setAuditing(false);
    }
  };

  // Restore a duplicate question back to the main list
  const restoreDuplicate = (dupId: string) => {
    const dup = duplicates.find(d => d.id === dupId);
    if (!dup || !dup.fullData) return;

    // Add to mcqs with new unique ID
    const restoredMcq: MCQ = {
      ...dup.fullData,
      id: `restored - ${Date.now()} `
    };
    setMcqs(prev => {
      const result = findDuplicate(restoredMcq, prev);
      if (result.isDup) return prev;
      return [...prev, restoredMcq];
    });

    // Remove from duplicates list by ID
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
    toast.success("Đã khôi phục câu hỏi");
  };

  const handleSkipDuplicate = (dupId: string) => {
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
    toast.info("Đã loại bỏ câu trùng");
  };

  const handleReplaceDuplicate = (originalId: string, newMcq: MCQ, dupId: string) => {
    // Replace in main list
    setMcqs(prev => prev.map(m => m.id === originalId ? { ...newMcq, id: originalId } : m));
    // Remove from duplicates
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
    toast.success("Đã thay thế câu cũ bằng nội dung mới");
  };

  const handleKeepAllDuplicates = () => {
    const toRestore = duplicates.filter(d => d.fullData).map((d, i) => ({
      ...d.fullData,
      id: `restored-bulk-${Date.now()}-${i}`
    }));

    setMcqs(prev => {
      const accepted: MCQ[] = [];
      for (const item of toRestore) {
        const result = findDuplicate(item, [...prev, ...accepted]);
        if (!result.isDup) accepted.push(item);
      }
      return [...prev, ...accepted];
    });
    setDuplicates([]);
    setShowDuplicates(false);
    toast.success(`Đã khôi phục toàn bộ ${toRestore.length} câu hỏi bị loại`);
  };

  const handleUpdateMCQ = (updatedMCQ: MCQ) => {
    setMcqs(prev => prev.map(m => m.id === updatedMCQ.id ? updatedMCQ : m));
  };

  const handleDeleteMCQ = (id: string) => {
    if (confirm('Bạn có chắc muốn xóa câu hỏi này không?')) {
      setMcqs(prev => prev.filter(m => m.id !== id));
      toast.success("Đã xóa câu hỏi");
    }
  };

  const displayedProgressStatus = processingState === 'paused'
    ? 'Đã tạm dừng an toàn. Nhấn "Tiếp tục" để chạy tiếp.'
    : processingState === 'pausing'
      ? 'Đang chờ batch hiện tại hoàn tất để tạm dừng an toàn...'
      : progressStatus;

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#020617] font-sans text-slate-800 dark:text-slate-100 transition-colors duration-300">
      <header className="glass sticky top-0 z-50 px-6 py-4 flex justify-between items-center transition-all">
        <div className="flex items-center gap-4">
          <img
            src={darkMode ? "/ponz-dark.png" : "/ponz-header.png"}
            alt="PonZ Logo"
            className="h-10 w-auto object-contain hover:scale-105 transition-transform"
          />
          <div className="flex flex-col border-l-2 border-indigo-600/20 dark:border-indigo-400/20 pl-4 ml-1">
            <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white leading-none">
              MCQ AnkiGen <span className="text-indigo-600 dark:text-indigo-400">Pro</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex flex-col items-end px-4 border-r border-slate-200 dark:border-slate-800 mr-2">
            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-0.5">AI MCQ Extraction & Solver Engine</span>
            <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Made by PonZ</span>
          </div>
          <div className="flex bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl mr-2">
            <button
              onClick={() => setDarkMode(false)}
              className={`p-2 rounded-lg transition-all ${!darkMode ? 'bg-white dark:bg-slate-700 shadow-sm text-amber-500' : 'text-slate-400'}`}
            >
              <Sun size={16} />
            </button>
            <button
              onClick={() => setDarkMode(true)}
              className={`p-2 rounded-lg transition-all ${darkMode ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-400' : 'text-slate-400'}`}
            >
              <Moon size={16} />
            </button>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:shadow-sm transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
            title="Cài đặt"
          >
            <SettingsIcon size={20} />
          </button>

          {deferredPrompt && (
            <button
              onClick={handleInstallApp}
              className="flex items-center gap-2 px-4 py-2 pro-gradient text-white rounded-xl hover:scale-105 transition-all text-xs font-black shadow-lg shadow-indigo-100 dark:shadow-none"
              title="Cài đặt ứng dụng về máy"
            >
              <DownloadCloud size={16} />
              <span className="uppercase tracking-tighter">Tải App</span>
            </button>
          )}

          <button
            onClick={() => setIsSplitView(!isSplitView)}
            className={`p-2.5 rounded-xl transition-all border ${isSplitView ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200 dark:shadow-none' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 border-transparent hover:bg-white dark:hover:bg-slate-700'}`}
            title="Chế độ So sánh (Split View)"
            disabled={files.length === 0}
          >
            <Columns size={20} />
          </button>
        </div>
      </header>

      <main className={`mx-auto transition-all duration-300 ${isSplitView ? 'grid h-[calc(100dvh-72px)] min-h-0 max-w-full grid-cols-12 gap-5 overflow-hidden p-4' : 'grid max-w-6xl grid-cols-1 gap-8 p-6 lg:grid-cols-12'}`}>

        {/* Split View: Left Panel (Source) */}
        {isSplitView && files.length > 0 && (
          <div className="col-span-6 flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
            <div className="p-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shadow-sm">
              <span className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                <FileText size={16} className="text-indigo-600" /> Tài liệu gốc
              </span>
              <span className="text-xs text-slate-500 truncate max-w-[200px]">{files[0].name}</span>
            </div>
            <div className={`min-h-0 flex-1 overflow-auto bg-slate-500/10 p-3 ${isDocxFile(files[0]) ? '' : 'flex items-center justify-center'}`}>
              {previewUrl && files[0].type === 'application/pdf' ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-full rounded shadow-sm bg-white"
                  title="PDF Preview"
                />
              ) : previewUrl && files[0].type.startsWith('image/') ? (
                <img
                  src={previewUrl}
                  className="max-w-full max-h-full object-contain rounded shadow-sm"
                  alt="Preview"
                />
              ) : isDocxFile(files[0]) && files[0].content ? (
                <article
                  className="docx-preview mx-auto min-h-full w-full max-w-4xl rounded-xl bg-white px-10 py-8 text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
                  dangerouslySetInnerHTML={{ __html: files[0].content }}
                />
              ) : (
                <div className="text-center text-slate-500">
                  <p>Chưa có bản xem trước cho định dạng này.</p>
                  <p className="text-xs mt-2 opacity-70">Hỗ trợ xem trước PDF, hình ảnh và Word DOCX.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sidebar - Control Panel (In standard view or hidden/moved in Split View?? Let's keep sidebar on top if standard, or... wait. In split view, we probably want Control Panel to be minimal or accessible functionality.
           Actually, the plan was: Left Panel (Source) - Right Panel (MCQs).
           Where does the Control Panel go?
           Maybe we turn the Control Panel into a floating drawer or keep it as a smaller column?
           Let's try: In Split View, Layout is: [Source (6)] [Questions + Controls (6)]?
           Or maybe [Source (5)] [Controls (3)] [Questions (4)]? -> Too crowded.
           
           Let's do:
           Split View:
           Left (6): Source
           Right (6): Questions (Main) + Controls (Collapsible or Tabbed?)
           
           Actually, simpler: 
           Standard: [Controls (4)] [Questions (8)]
           Split View: [Source (6)] [Questions (6)] (Controls hidden? No, need to Generate.
           
           Re-visit Plan: "Left Panel: Document Viewer... Right Panel: MCQDisplay".
           User needs to UPLOAD and GENERATE first.
           So `isSplitView` should only be enabled AFTER files are uploaded/generated?
           Or, we show Controls in the Right Panel ABOVE the questions.
           
           Let's adjust the Right Panel to include Controls if Split View is active.
           But `FileUploader` is big.
           
           Idea: In Split View, hide `FileUploader` (assuming user is done uploading). Show only "Generate" button or mini controls.
           
           Let's stick to simple layout modification first.
           If Split View:
           col-span-6 for Source.
           col-span-6 for "Main Content" (which currently wraps Questions).
           The "Sidebar" (Control Panel) needs careful handling.
           
           If Split View used:
           Sidebar (Control Panel) -> Hidden or Grid broken?
           
           Let's try this Logic:
           Main Container:
           !SplitView -> grid-cols-12. Sidebar (4), Main (8).
           SplitView -> grid-cols-12. Source (6), Main (6). (Sidebar hidden/collapsed?).
           
           Let's hide Sidebar in Split View. The user usually switches to Split View *after* generation to review.
           So:
           Sidebar: className={`lg:col-span-4 ... ${isSplitView ? 'hidden' : ''}`}
           Main (Questions): className={`... ${isSplitView ? 'col-span-6 h-full overflow-y-auto' : 'lg:col-span-8'}`}
           
           Wait, if I hide Sidebar, how do they Re-Generate or Add Files?
           They toggle Split View OFF to do setup, then Toggle ON to review. This is acceptable UX.
        */}

        {/* Sidebar - Control Panel */}
        <div className={`space-y-6 ${isSplitView ? 'hidden' : 'lg:col-span-4'}`}>
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-5">
            <FileUploader files={files} setFiles={setFiles} />

            {ocrMode === 'tesseract' && files.some(f => f.type.startsWith('image/')) && (
              <div className="text-xs bg-amber-50 text-amber-700 p-2 rounded border border-amber-100 flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>Đang dùng Local OCR (Offline). Tốc độ có thể chậm hơn Cloud.</span>
              </div>
            )}

            {!analysis ? (
              <button
                onClick={handleAnalyze}
                data-testid="analyze-button"
                disabled={analyzing || files.length === 0}
                className="w-full py-4 pro-gradient text-white font-black rounded-2xl hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-100 dark:shadow-none flex items-center justify-center gap-3 text-sm uppercase tracking-widest"
              >
                {analyzing ? <Loader2 className="animate-spin" size={18} /> : <><ScanText size={18} strokeWidth={2.5} /> Quét tài liệu</>}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex justify-between items-center group">
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-500 p-1.5 rounded-lg text-white">
                      <CheckCircle2 size={16} />
                    </div>
                    <span className="font-bold text-emerald-900 dark:text-emerald-400 text-xs uppercase tracking-tighter">Hệ thống đã sẵn sàng</span>
                  </div>
                  <span className="text-lg font-black text-emerald-600">{analysis.estimatedCount}</span>
                </div>

                <button
                  onClick={handleGenerate}
                  data-testid="generate-button"
                  disabled={loading}
                  className="w-full py-4 bg-slate-900 dark:bg-indigo-600 text-white font-black rounded-2xl hover:scale-[1.02] active:scale-95 shadow-xl transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
                >
                  {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={18} /> Trích xuất câu hỏi</>}
                </button>

                {failedBatchIndices.length > 0 && !loading && (
                  <button
                    onClick={handleRetryFailed}
                    className="w-full py-3 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 font-extrabold rounded-2xl border-2 border-orange-200 dark:border-orange-800 hover:bg-orange-600 hover:text-white dark:hover:bg-orange-600 transition-all flex items-center justify-center gap-2 uppercase tracking-tighter text-xs"
                  >
                    <RotateCcw size={16} /> Quét lại {failedBatchIndices.length} phần bị lỗi
                  </button>
                )}
              </div>
            )}
          </div>

          {audit && (
            <AuditPanel audit={audit} showAudit={showAudit} setShowAudit={setShowAudit} />
          )}

          {/* Duplicates Review Trigger */}
          {duplicates.length > 0 && (
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-orange-200 dark:border-orange-900/30 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <RotateCcw size={48} className="text-orange-600 rotate-12" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-xl flex items-center justify-center shadow-inner">
                    <Info size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 dark:text-white text-sm leading-none uppercase tracking-tighter">Phát hiện trùng lặp</h3>
                    <span className="text-xs font-bold text-orange-600 dark:text-orange-400 mt-1 block">Có {duplicates.length} câu tương đồng cao</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowDuplicates(true)}
                  className="w-full py-3 bg-white dark:bg-slate-900 border-2 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-orange-600 dark:hover:bg-orange-600 hover:text-white transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  <ScanText size={14} /> Kiểm tra ngay
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Main Content - Results */}
        <div ref={resultsPanelRef} className={`${isSplitView ? 'col-span-6 h-full min-h-0 space-y-4 overflow-y-auto pr-1' : 'space-y-6 lg:col-span-8'}`}>
          {resumeSession && !loading && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h3 className="text-sm font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                    Phát hiện phiên dang dở
                  </h3>
                  <p className="text-sm text-amber-900 dark:text-amber-100">
                    {formatSessionPhase(resumeSession.phase)} • {resumeSession.completedBatchIndices.length}/{resumeSession.totalTopLevelBatches || '?'} batch • {resumeSession.settingsSnapshot.provider} / {resumeSession.settingsSnapshot.model}
                  </p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-200/80">
                    Cập nhật lần cuối: {new Date(resumeSession.updatedAt).toLocaleString('vi-VN')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleDiscardResumeSession}
                    className="rounded-xl border border-amber-300 px-4 py-2 text-xs font-black uppercase tracking-wider text-amber-800 transition hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/30"
                  >
                    Bỏ phiên cũ
                  </button>
                  <button
                    onClick={handleResumeSession}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-amber-600"
                  >
                    Tiếp tục phiên dang dở
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Warning for Split View if no files */}
          {isSplitView && files.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg flex items-center gap-3">
              <AlertTriangle size={20} />
              <div>
                <strong>Chưa có tài liệu!</strong> Vui lòng tắt chế độ So sánh, tải file lên và trích xuất câu hỏi trước.
              </div>
            </div>
          )}
          {loading && (
            <div className="bg-white p-5 rounded-xl border border-indigo-100 shadow-sm space-y-3">
              <div className="flex justify-between items-center text-sm font-medium text-indigo-900">
                <span className="flex items-center gap-2">
                  {processingState === 'running' ? (
                    <Loader2 className="animate-spin text-indigo-600" size={16} />
                  ) : processingState === 'pausing' ? (
                    <Loader2 className="animate-spin text-amber-600" size={16} />
                  ) : (
                    <Pause className="text-amber-600" size={16} />
                  )}
                  {displayedProgressStatus}
                </span>
                <span>
                  {analysis?.estimatedCount && analysis.estimatedCount > 0 
                    ? `${Math.round((currentCount / analysis.estimatedCount) * 100)}%`
                    : `Đã xong ${currentCount} câu`}
                </span>
              </div>
              <div className="h-2 bg-indigo-50 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-indigo-600 transition-all duration-300 ease-out ${(!analysis?.estimatedCount || analysis.estimatedCount === 0) ? 'animate-pulse' : ''}`}
                  style={{ width: `${analysis?.estimatedCount && analysis.estimatedCount > 0 ? Math.min(100, (currentCount / analysis.estimatedCount) * 100) : 100}%` }}
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleTogglePause(loading)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider transition-all ${
                    processingState === 'running'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {processingState === 'running' ? <Pause size={14} /> : <Play size={14} />}
                  {processingState === 'running' ? 'Tạm dừng' : 'Tiếp tục'}
                </button>
              </div>
            </div>
          )}

          {mcqs.length > 0 && !loading && (
            <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Kết quả</h2>
                      <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                        <span data-testid="result-count" className="sr-only">{mcqs.length}</span>
                        {mcqs.length} câu
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        if (confirm("Xóa toàn bộ dữ liệu hiện tại, file đã lưu, phiên dang dở và cache AI?")) {
                          setMcqs([]);
                          mcqsRef.current = [];
                          setFiles([]);
                          filesRef.current = [];
                          setDuplicates([]);
                          duplicatesRef.current = [];
                          setFailedBatchIndices([]);
                          setResumeSession(null);
                          activeSessionRef.current = null;
                          await db.clearAll();
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2 text-xs font-black text-rose-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/25 dark:text-rose-300 dark:hover:bg-rose-950/45"
                    >
                      <AlertTriangle size={14} /> Xóa toàn bộ dữ liệu
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      onClick={downloadCSV}
                      data-testid="export-csv-button"
                      disabled={exportAction !== null}
                      className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-[0_14px_32px_-18px_rgba(5,150,105,0.85)] transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    >
                      {exportAction === 'downloadCsv' ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} Xuất CSV Anki
                    </button>
                    <button
                      onClick={downloadDOCX}
                      disabled={exportAction !== null}
                      className="inline-flex items-center gap-2 rounded-2xl border border-sky-200/80 bg-sky-50 px-5 py-3 text-sm font-bold text-sky-700 shadow-[0_14px_32px_-22px_rgba(14,165,233,0.65)] transition-all hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300 dark:hover:bg-sky-950/35"
                      title="Xuất file Word để học trực tiếp"
                    >
                      {exportAction === 'downloadDocx' ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />} Xuất DOCX
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className={isSplitView ? 'min-h-0' : 'min-h-[400px]'}>
            {exportAction && (
              <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm font-medium text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-300">
                {exportAction === 'downloadCsv' && 'Đang chuẩn bị file CSV...'}
                {exportAction === 'downloadDocx' && 'Đang dựng file DOCX để tải về...'}
              </div>
            )}
            <MCQDisplay
              mcqs={mcqs}
              onUpdate={handleUpdateMCQ}
              onDelete={handleDeleteMCQ}
              scrollContainerRef={resultsPanelRef}
              useWindowScroll={!isSplitView}
            />

            {!loading && mcqs.length === 0 && !analyzing && !files.length && (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 py-20">
                <BrainCircuit size={64} className="mb-4 text-slate-200" strokeWidth={1} />
                <p className="font-medium text-slate-400">Chọn file để bắt đầu</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Settings Modal Component */}
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        setSettings={setSettings}
      />
      <DuplicatesReviewModal
        show={showDuplicates}
        onClose={() => setShowDuplicates(false)}
        duplicates={duplicates}
        onRestore={restoreDuplicate}
        onSkip={handleSkipDuplicate}
        onReplace={handleReplaceDuplicate}
        onKeepAll={handleKeepAllDuplicates}
      />
    </div>
  );
};

export default App;
