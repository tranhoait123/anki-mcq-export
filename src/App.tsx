import React, { useState } from 'react';
import { UploadedFile, MCQ, GeneratedResponse, AnalysisResult, AuditResult, Explanation, DuplicateInfo } from './types';
import FileUploader from './ui/FileUploader';
import MCQDisplay from './ui/MCQDisplay';
import { generateQuestions, analyzeDocument, auditMissingQuestions } from './core/brain';
import { BrainCircuit, Loader2, Download, CheckCircle2, AlertTriangle, Info, ShieldAlert, ChevronDown, ChevronUp, ScanText } from 'lucide-react';
import { extractTextWithTesseract } from './core/vision';

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
          const base64Content = `data:${file.type};base64,${file.content}`;
          const text = await extractTextWithTesseract(base64Content, (p) => {
            setProgressStatus(`OCR ${file.name}: ${p}%`);
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
      const res = await analyzeDocument(filesToUse);
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
      let res = await generateQuestions(filesToUse, 0, (status, count) => {
        setProgressStatus(status);
        setCurrentCount(count);
      }, analysis?.estimatedCount || 0);

      // 2. Auto-Fallback Check
      // If we used Gemini (Cloud) AND got bad results (< 60% of estimate), try Tesseract
      if (ocrMode === 'gemini' && analysis && analysis.estimatedCount > 0) {
        const count = res.questions.length;
        if (count < analysis.estimatedCount * 0.9) {
          const hasImages = files.some(f => f.type.startsWith('image/'));
          if (hasImages) {
            // Trigger Fallback
            setProgressStatus(`Kết quả Cloud thấp (${count}/${analysis.estimatedCount}). Đang tự động chuyển sang Local OCR (Smart Fallback)...`);
            await new Promise(r => setTimeout(r, 2000));

            try {
              const tesseractFiles = await prepareFiles('tesseract');
              // If OCR produced text, let's retry generation
              if (tesseractFiles.some(f => f.type === 'text/plain' && f.content.length > 50)) {
                setProgressStatus("Đang trích xuất lại với dữ liệu từ Local OCR...");
                const fallbackRes = await generateQuestions(tesseractFiles, 0, (status, count) => {
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
        ...q, id: `q-${Date.now()}-${i}`
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
      const res = await auditMissingQuestions(filesToUse, count);
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
      id: `restored-${Date.now()}`
    };
    setMcqs(prev => [...prev, restoredMcq]);

    // Remove from duplicates list by ID
    setDuplicates(prev => prev.filter(d => d.id !== dupId));
  };

  const buildAnkiHtml = (exp: Explanation, difficulty: string, depth: string) => {
    // Style constants matching the screenshot vibe (clean, medical)
    const containerStyle = "font-family: -apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 14px;";
    const boxStyle = "margin-bottom: 12px; padding: 12px; border-left: 4px solid; border-radius: 4px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.05);";

    return `
      <div style="${containerStyle}">
        <div style="${boxStyle} border-color: #e11d48; background-color: #fff1f2; color: #9f1239;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px;">
            🎯 ĐÁP ÁN CỐT LÕI
          </div>
          ${exp.core}
        </div>

        <div style="${boxStyle} border-color: #6b7280; background-color: #f9fafb; color: #374151;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px;">
            📖 LÝ THUYẾT & BẰNG CHỨNG
          </div>
          <div style="font-style: italic;">
            ${exp.evidence}
          </div>
        </div>

        <div style="${boxStyle} border-color: #4f46e5; background-color: #eef2ff; color: #3730a3;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px;">
            💡 PHÂN TÍCH SÂU (CHẨN ĐOÁN PHÂN BIỆT)
          </div>
          ${exp.analysis}
        </div>

        ${exp.warning ? `
        <div style="${boxStyle} border-color: #d97706; background-color: #fffbeb; color: #92400e;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase; display: flex; items-center; gap: 4px;">
             ⚠️ CẢNH BÁO LÂM SÀNG
          </div>
          ${exp.warning}
        </div>` : ''}

        <div style="margin-top: 16px; border-top: 1px dashed #e5e7eb; padding-top: 12px; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between;">
           <span>📊 ĐỘ KHÓ: <b>${difficulty}</b></span>
           <span>🧠 TƯ DUY: <b>${depth}</b></span>
        </div>
      </div>
    `.replace(/\s+/g, ' ').trim();
  };

  const downloadCSV = () => {
    if (mcqs.length === 0) return;
    const headers = ["Question", "A", "B", "C", "D", "E", "CorrectAnswer", "ExplanationHTML", "Source", "Difficulty"];
    const rows = mcqs.map(m => {
      const esc = (t: string) => `"${(t || "").replace(/"/g, '""')}"`;
      const ops = [...m.options];
      while (ops.length < 5) ops.push("");
      return [
        esc(m.question),
        esc(ops[0]), esc(ops[1]), esc(ops[2]), esc(ops[3]), esc(ops[4]),
        esc(m.correctAnswer),
        esc(buildAnkiHtml(m.explanation, m.difficulty, m.depthAnalysis)),
        esc(m.source),
        esc(m.difficulty)
      ].join(",");
    });
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Anki_Export_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-800">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-3 flex justify-between items-center backdrop-blur-sm bg-white/90">
        <div className="flex items-center gap-3">
          <img src="/ponz-header.png" alt="PonZ Logo" className="h-8 w-auto object-contain" />
          <h1 className="text-lg font-bold tracking-tight text-slate-900 border-l border-slate-200 pl-3 ml-1">AnkiGen <span className="text-indigo-600">Pro</span></h1>
        </div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Made by PonZ
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar - Control Panel */}
        <div className="lg:col-span-4 space-y-6">
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
                className="w-full py-3 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2 text-sm"
              >
                {analyzing ? <Loader2 className="animate-spin" size={16} /> : <><ScanText size={16} /> Quét tài liệu</>}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-sm flex justify-between items-center">
                  <span className="font-medium text-emerald-800 flex items-center gap-2"><CheckCircle2 size={16} /> Đã quét xong</span>
                  <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-xs font-bold">{analysis.estimatedCount} câu</span>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  {loading ? <Loader2 className="animate-spin" /> : "Trích xuất câu hỏi"}
                </button>
              </div>
            )}
          </div>

          {audit && (
            <div className={`bg-white border rounded-xl overflow-hidden shadow-sm ${audit.status === 'warning' ? 'border-amber-200' : 'border-blue-100'}`}>
              <button
                onClick={() => setShowAudit(!showAudit)}
                className={`w-full p-3 flex items-center justify-between text-left text-sm font-medium ${audit.status === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800'}`}
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert size={16} />
                  <span>Báo cáo chất lượng</span>
                </div>
                {showAudit ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {showAudit && (
                <div className="p-4 space-y-4 text-xs">
                  <div>
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-slate-700">
                      <AlertTriangle size={12} className="text-amber-500" /> Vấn đề phát hiện:
                    </h4>
                    <ul className="list-disc list-inside space-y-1 text-slate-500 pl-1">
                      {audit.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded text-slate-500 border border-slate-100 italic">
                    {audit.advice}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Duplicates Display Section */}
          {duplicates.length > 0 && (
            <div className="bg-white border border-orange-200 rounded-xl overflow-hidden shadow-sm">
              <button
                onClick={() => setShowDuplicates(!showDuplicates)}
                className="w-full p-3 flex items-center justify-between text-left text-sm font-medium bg-orange-50 text-orange-800"
              >
                <div className="flex items-center gap-2">
                  <Info size={16} />
                  <span>Câu hỏi bị loại ({duplicates.length})</span>
                </div>
                {showDuplicates ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {showDuplicates && (
                <div className="p-4 max-h-64 overflow-y-auto">
                  <div className="space-y-2">
                    {duplicates.map((d, i) => (
                      <div key={i} className="text-xs p-2 bg-orange-50 border border-orange-100 rounded">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-slate-700 truncate" title={d.question}>
                              {i + 1}. {d.question}...
                            </div>
                            <div className="text-orange-600 mt-1">
                              ➜ {d.reason}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreDuplicate(d.id)}
                            className="shrink-0 px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 transition-colors"
                            title="Khôi phục câu hỏi này"
                          >
                            🔄 Khôi phục
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Content - Results */}
        <div className="lg:col-span-8 space-y-6">
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
              <button
                onClick={downloadCSV}
                className="px-4 py-2 bg-emerald-600 text-white font-medium text-sm rounded-lg hover:bg-emerald-700 shadow-sm flex items-center gap-2 transition-all"
              >
                <Download size={16} /> Xuất CSV Anki
              </button>
            </div>
          )}

          <div className="min-h-[400px]">
            <MCQDisplay mcqs={mcqs} />

            {!loading && mcqs.length === 0 && !analyzing && !files.length && (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 py-20">
                <BrainCircuit size={64} className="mb-4 text-slate-200" strokeWidth={1} />
                <p className="font-medium text-slate-400">Chọn file để bắt đầu</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
