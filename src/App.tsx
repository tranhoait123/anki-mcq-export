import React, { useState, useEffect } from 'react';
import { UploadedFile, MCQ, GeneratedResponse, AnalysisResult, AuditResult, DuplicateInfo, AppSettings } from './types';
import FileUploader from './ui/FileUploader';
import MCQDisplay from './ui/MCQDisplay';
import SettingsModal from './ui/SettingsModal';
import AuditPanel from './ui/AuditPanel';
import DuplicatesPanel from './ui/DuplicatesPanel';
import { generateQuestions, analyzeDocument, auditMissingQuestions } from './core/brain';
// @ts-ignore
import { db } from './core/db';
import { BrainCircuit, Loader2, Download, CheckCircle2, AlertTriangle, ScanText, Moon, Sun, Settings as SettingsIcon, Columns, FileText, DownloadCloud, Sparkles, Filter, Trash2, Copy } from 'lucide-react';
import { extractTextWithTesseract } from './core/vision';
import { buildAnkiHtml, formatRichText } from './core/anki';

const App: React.FC = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [mcqs, setMcqs] = useState<MCQ[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [progressStatus, setProgressStatus] = useState("");
  const [currentCount, setCurrentCount] = useState(0);
  const [showAudit, setShowAudit] = useState(false);
  const [ocrMode, setOcrMode] = useState<'gemini' | 'tesseract'>('gemini');
  const [duplicates, setDuplicates] = useState<DuplicateInfo[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    model: 'gemini-1.5-flash',
    customPrompt: ''
  });

  // Initialization & Migration: Load from DB or Migration from localStorage
  useEffect(() => {
    const initData = async () => {
      try {
        await db.init();

        // 1. Check Settings
        let persistedSettings = await db.getSettings();
        if (!persistedSettings) {
          // Try migration
          const legacy = localStorage.getItem('anki_mcq_settings');
          if (legacy) {
            persistedSettings = JSON.parse(legacy);
            if (persistedSettings) await db.saveSettings(persistedSettings);
          }
        }
        if (persistedSettings) setSettings(persistedSettings);

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
        if (persistedMcqs.length > 0) setMcqs(persistedMcqs);

        setIsLoaded(true);
        console.log("Pro Storage (IndexedDB) ready.");
      } catch (e) {
        console.error("Storage Initialization Error:", e);
        setIsLoaded(true);
      }
    };
    initData();
  }, []);

  // Save Settings on Change
  useEffect(() => {
    if (isLoaded) db.saveSettings(settings);
  }, [settings, isLoaded]);

  // Save MCQs on change
  useEffect(() => {
    if (isLoaded) db.saveMCQs(mcqs);
  }, [mcqs, isLoaded]);

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

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setDeferredPrompt(null);
    }
  };

  // Memoized Preview URL for Split View to avoid base64 overhead
  const previewUrl = React.useMemo(() => {
    if (!isSplitView || files.length === 0) return null;
    const file = files[0];
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

  // Helper: Auto-Clean text for MCQ question/options
  const cleanText = (text: string, type: 'question' | 'option') => {
    if (!text) return "";
    let cleaned = text.trim();
    if (type === 'question') {
      cleaned = cleaned.replace(/^(?:Câu|Question|Bài)\s*\d+[:.]\s*/i, "");
      cleaned = cleaned.replace(/^\d+[:.]\s*/, "");
    } else {
      cleaned = cleaned.replace(/^[A-Ea-e][:.)]\s*/, "");
    }
    return cleaned;
  };

  // Helper to process files for analysis/generation
  const prepareFiles = async (forcedMode?: 'gemini' | 'tesseract'): Promise<UploadedFile[]> => {
    const mode = forcedMode || ocrMode;
    if (mode === 'gemini') return files;

    // Tesseract Mode: Convert images to text first
    setProgressStatus("Đang chạy Local OCR (Tesseract)...");

    // Process in parallel using Promise.all
    const processedFiles = await Promise.all(files.map(async (file) => {
      if (file.type.startsWith('image/')) {
        try {
          const base64Content = `data:${file.type}; base64, ${file.content} `;
          const text = await extractTextWithTesseract(base64Content, (p) => {
            setProgressStatus(`OCR ${file.name}: ${p}% `);
          });
          return {
            ...file,
            content: text,
            type: 'text/plain',
            name: `${file.name}.txt`
          };
        } catch (e) {
          console.error(`OCR Failed for ${file.name}`, e);
          return file; // Keep original if failed
        }
      }
      return file;
    }));

    return processedFiles;
  };

  const handleAnalyze = async () => {
    if (files.length === 0) return;
    setAnalyzing(true);
    setAnalysis(null);
    setAudit(null);
    try {
      const filesToUse = await prepareFiles();
      const res = await analyzeDocument(filesToUse, settings);
      setAnalysis(res);
    } catch (e: any) { alert(e.message); }
    finally { setAnalyzing(false); }
  };

  const handleGenerate = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setMcqs([]);
    setAudit(null);
    setShowAudit(false);
    setDuplicates([]);
    setShowDuplicates(false);

    try {
      // 1. Initial Attempt (Default Mode)
      let filesToUse = await prepareFiles();
      let res = await generateQuestions(filesToUse, settings, 0, (status, count) => {
        setProgressStatus(status);
        setCurrentCount(count);
      }, analysis?.estimatedCount || 0, (newBatch) => {
        // REAL-TIME UPDATE: Append new questions immediately
        setMcqs(prev => {
          const updated = [...prev, ...newBatch];
          // Sort valid numbers
          return updated.sort((a, b) => {
            const getNum = (str: string) => {
              const m = str.match(/(\d+)/);
              return m ? parseInt(m[1]) : 999999;
            };
            return getNum(a.question) - getNum(b.question);
          });
        });
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
            await new Promise(r => setTimeout(r, 2000));

            try {
              const tesseractFiles = await prepareFiles('tesseract');
              // If OCR produced text, let's retry generation
              if (tesseractFiles.some(f => f.type === 'text/plain' && f.content.length > 50)) {
                setProgressStatus("Đang trích xuất lại với dữ liệu từ Local OCR...");
                const fallbackRes = await generateQuestions(tesseractFiles, settings, 0, (status, count) => {
                  setProgressStatus(`${status} (Fallback Loop)`);
                  setCurrentCount(count);
                }, analysis.estimatedCount);

                // Use fallback results if they are better or non-empty
                if (fallbackRes.questions.length > count) {
                  res = fallbackRes;
                  filesToUse = tesseractFiles; // Update filesToUse to reflect what was actually used
                  console.log("Fallback successful, replaced results.");
                }
              }
            } catch (fallbackError) {
              console.error("Fallback failed:", fallbackError);
              // Swallow error and keep original results
            }
          }
        }
      }

      const formatted = res.questions.map((q, i) => ({
        ...q, id: `q - ${Date.now()} -${i} `
      }));
      setMcqs(formatted);

      // Store duplicates for display
      if (res.duplicates && res.duplicates.length > 0) {
        setDuplicates(res.duplicates);
      }

      // Nếu số lượng trích xuất ít hơn 80% số lượng ước tính, tự động chạy kiểm toán
      if (analysis && formatted.length < analysis.estimatedCount * 0.8) {
        runAudit(formatted.length, filesToUse); // Pass the files we actually used? Ideally the original ones for context.
      }
    } catch (e: any) {
      alert("Lỗi trích xuất: " + e.message);
    }
    finally { setLoading(false); }
  };

  const runAudit = async (count: number, processedFiles?: UploadedFile[]) => {
    setAuditing(true);
    try {
      const filesToUse = processedFiles || await prepareFiles();
      const res = await auditMissingQuestions(filesToUse, count, settings);
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
    setMcqs(prev => [...prev, restoredMcq]);

    // Remove from duplicates list by ID
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
  };

  const handleUpdateMCQ = (updatedMCQ: MCQ) => {
    setMcqs(prev => prev.map(m => m.id === updatedMCQ.id ? updatedMCQ : m));
  };

  const handleDeleteMCQ = (id: string) => {
    if (confirm('Bạn có chắc muốn xóa câu hỏi này không?')) {
      setMcqs(prev => prev.filter(m => m.id !== id));
    }
  };

  // buildAnkiHtml moved to core/anki.ts

  const handleCopyCSV = () => {
    if (mcqs.length === 0) return;

    const headers = ["Question", "A", "B", "C", "D", "E", "CorrectAnswer", "ExplanationHTML", "Source", "Difficulty"];
    const rows = mcqs.map(m => {
      const esc = (t: string) => `"${(t || "").replace(new RegExp('"', 'g'), '""')}"`;

      const cleanQ = cleanText(m.question, 'question');
      const formattedQ = formatRichText(cleanQ);

      const ops = [...m.options];
      while (ops.length < 5) ops.push("");
      const cleanOps = ops.map(o => formatRichText(cleanText(o, 'option')));

      return [
        esc(formattedQ),
        esc(cleanOps[0]), esc(cleanOps[1]), esc(cleanOps[2]), esc(cleanOps[3]), esc(cleanOps[4]),
        esc(m.correctAnswer),
        esc(buildAnkiHtml(m.explanation, m.difficulty, m.depthAnalysis)),
        esc(m.source),
        esc(m.difficulty)
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    navigator.clipboard.writeText(csvContent);
    // Simple alert for feedback
    alert("Đã copy toàn bộ nội dung CSV vào bộ nhớ đệm! (Bạn có thể paste vào Excel/Sheets)");
  };

  const downloadCSV = () => {
    if (mcqs.length === 0) return;

    const headers = ["Question", "A", "B", "C", "D", "E", "CorrectAnswer", "ExplanationHTML", "Source", "Difficulty"];
    const rows = mcqs.map(m => {
      const esc = (t: string) => `"${(t || "").replace(new RegExp('"', 'g'), '""')}"`;

      // Clean Question & Options
      const cleanQ = cleanText(m.question, 'question');
      const formattedQ = formatRichText(cleanQ);

      const ops = [...m.options];
      while (ops.length < 5) ops.push("");
      const cleanOps = ops.map(o => formatRichText(cleanText(o, 'option')));

      return [
        esc(formattedQ),
        esc(cleanOps[0]), esc(cleanOps[1]), esc(cleanOps[2]), esc(cleanOps[3]), esc(cleanOps[4]),
        esc(m.correctAnswer), // Keep CorrectAnswer as is (usually full text, cleaning it might mismatch key)
        esc(buildAnkiHtml(m.explanation, m.difficulty, m.depthAnalysis)),
        esc(m.source),
        esc(m.difficulty)
      ].join(",");
    });
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    // Smart Filename
    let filename = "Anki_Export";
    if (files.length > 0) {
      // Use the first filename, strip extension, replace spaces with underscores
      const baseName = files[0].name.replace(/\.[^/.]+$/, "").replace(/\s+/g, "_");
      filename = `[ANKI]_${baseName}`;
    }

    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#020617] font-sans text-slate-800 dark:text-slate-100 transition-colors duration-300">
      <header className="glass sticky top-0 z-50 px-6 py-4 flex justify-between items-center transition-all">
        <div className="flex items-center gap-4">
          <img
            src={darkMode ? "/ponz-dark.png" : "/ponz-header.png"}
            alt="PonZ Logo"
            className="h-10 w-auto object-contain hover:scale-105 transition-transform"
          />
          <div className="flex flex-col border-l border-slate-200 dark:border-slate-700 pl-4 ml-1">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-none">
              MCQ AnkiGen <span className="text-indigo-600 dark:text-indigo-400">Pro</span>
            </h1>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">Medical Engine by PonZ</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex flex-col items-end px-4 border-r border-slate-200 dark:border-slate-800 mr-2">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Medical Expert Tool</span>
            <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Mastered by PonZ</span>
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

      <main className={`mx-auto p-6 transition-all duration-300 ${isSplitView ? 'max-w-full grid grid-cols-12 gap-6 h-[calc(100vh-80px)] overflow-hidden' : 'max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8'}`}>

        {/* Split View: Left Panel (Source) */}
        {isSplitView && files.length > 0 && (
          <div className="col-span-6 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col h-full overflow-hidden">
            <div className="p-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shadow-sm">
              <span className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                <FileText size={16} className="text-indigo-600" /> Tài liệu gốc
              </span>
              <span className="text-xs text-slate-500 truncate max-w-[200px]">{files[0].name}</span>
            </div>
            <div className="flex-1 overflow-auto bg-slate-500/10 p-4 flex items-center justify-center">
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
              ) : (
                <div className="text-center text-slate-500">
                  <p>Chỉ hỗ trợ xem trước PDF và Hình ảnh.</p>
                  <p className="text-xs mt-2 opacity-70">File Text/Word không hỗ trợ xem trực tiếp.</p>
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
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-5">
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
                  disabled={loading}
                  className="w-full py-4 bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-black rounded-2xl hover:scale-[1.02] active:scale-95 shadow-xl transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
                >
                  {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={18} /> Trích xuất câu hỏi</>}
                </button>
              </div>
            )}
          </div>

          {audit && (
            <AuditPanel audit={audit} showAudit={showAudit} setShowAudit={setShowAudit} />
          )}

          {/* Duplicates Display Section */}
          {/* Duplicates Display Section */}
          {duplicates.length > 0 && (
            <DuplicatesPanel
              duplicates={duplicates}
              showDuplicates={showDuplicates}
              setShowDuplicates={setShowDuplicates}
              onRestore={restoreDuplicate}
            />
          )}
        </div>

        {/* Main Content - Results */}
        <div className={`space-y-6 ${isSplitView ? 'col-span-6 h-full overflow-y-auto pr-2' : 'lg:col-span-8'}`}>
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
                <span className="flex items-center gap-2"><Loader2 className="animate-spin text-indigo-600" size={16} /> {progressStatus}</span>
                <span>{Math.round((currentCount / (analysis?.estimatedCount || 100)) * 100)}%</span>
              </div>
              <div className="h-2 bg-indigo-50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, (currentCount / (analysis?.estimatedCount || 100)) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {mcqs.length > 0 && !loading && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                  Kết quả
                  <span className="bg-slate-100 text-slate-500 text-xs py-0.5 px-2 rounded-full font-normal">
                    {mcqs.length} câu
                  </span>
                </h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (confirm("Xóa toàn bộ dữ liệu hiện tại?")) {
                      setMcqs([]);
                      db.clearAll();
                      setDuplicates([]);
                    }
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 font-medium text-sm rounded-lg hover:bg-gray-200 shadow-sm flex items-center gap-2 transition-all"
                >
                  <AlertTriangle size={16} /> Xóa hết
                </button>
                <button
                  onClick={handleCopyCSV}
                  className="px-4 py-2 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 shadow-sm flex items-center gap-2 transition-all"
                  title="Copy nội dung CSV vào bộ nhớ đệm"
                >
                  <ScanText size={16} /> Copy CSV
                </button>
                <button
                  onClick={downloadCSV}
                  className="px-4 py-2 bg-emerald-600 text-white font-medium text-sm rounded-lg hover:bg-emerald-700 shadow-sm flex items-center gap-2 transition-all"
                >
                  <Download size={16} /> Xuất CSV Anki
                </button>
              </div>
            </div>
          )}

          <div className="min-h-[400px]">
            <MCQDisplay mcqs={mcqs} onUpdate={handleUpdateMCQ} onDelete={handleDeleteMCQ} />

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
    </div>
  );
};

export default App;
