import React, { useState } from 'react';
import { UploadedFile, MCQ, GeneratedResponse, AnalysisResult, AuditResult, Explanation } from './types';
import FileUploader from './components/FileUploader';
import MCQDisplay from './components/MCQDisplay';
import { generateQuestions, analyzeDocument, auditMissingQuestions } from './services/geminiService';
import { BrainCircuit, Loader2, Download, CheckCircle2, AlertTriangle, Info, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { extractTextWithTesseract } from './services/ocrService';
import { ScanText, Languages } from 'lucide-react';

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
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="bg-white border-b sticky top-0 z-50 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <BrainCircuit className="text-indigo-600" size={28} />
          <h1 className="text-xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">ANKIGEN PRO</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">1. Nguồn dữ liệu</h2>
              <div className="flex bg-indigo-50 p-1 rounded-lg px-3 py-1 items-center gap-2">
                <BrainCircuit size={14} className="text-indigo-600" />
                <span className="text-xs font-bold text-indigo-700">SMART AUTO MODE</span>
              </div>
            </div>

            <FileUploader files={files} setFiles={setFiles} />

            {ocrMode === 'tesseract' && files.some(f => f.type.startsWith('image/')) && (
              <div className="text-[10px] bg-amber-50 text-amber-700 p-2 rounded border border-amber-100">
                ⚠️ Chế độ Local OCR (Tesseract): Sẽ tải model 5MB lần đầu. Tốc độ chậm hơn Cloud AI.
              </div>
            )}

            {!analysis ? (
              <button onClick={handleAnalyze} disabled={analyzing || files.length === 0} className="w-full py-3 bg-indigo-50 text-indigo-700 font-bold rounded-xl border border-indigo-200 hover:bg-indigo-100 transition-all active:scale-95">
                {analyzing ? <Loader2 className="animate-spin mx-auto" /> : "QUÉT TÀI LIỆU"}
              </button>
            ) : (
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-xs">
                <p className="font-bold text-emerald-800 flex items-center gap-2"><CheckCircle2 size={14} /> {analysis.topic}</p>
                <p className="mt-1 text-emerald-600">Ước tính: {analysis.estimatedCount} câu hỏi</p>
              </div>
            )}

            <button onClick={handleGenerate} disabled={loading || !analysis} className="w-full py-4 bg-indigo-600 text-white font-black rounded-xl shadow-lg hover:bg-indigo-700 disabled:bg-gray-200 transition-all active:scale-95">
              {loading ? <Loader2 className="animate-spin mx-auto" /> : "TRÍCH XUẤT ABCDE FORMAT"}
            </button>
          </div>

          {audit && (
            <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm transition-all ${audit.status === 'warning' ? 'border-amber-200' : 'border-blue-200'}`}>
              <button
                onClick={() => setShowAudit(!showAudit)}
                className={`w-full p-4 flex items-center justify-between text-left ${audit.status === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800'}`}
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert size={18} />
                  <span className="font-bold text-sm uppercase tracking-tight">Báo cáo chất lượng trích xuất</span>
                </div>
                {showAudit ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {showAudit && (
                <div className="p-4 space-y-4 text-sm">
                  <div>
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-gray-700">
                      <AlertTriangle size={14} className="text-amber-500" /> Lý do thiếu câu hỏi:
                    </h4>
                    <ul className="list-disc list-inside space-y-1 text-gray-600 pl-2">
                      {audit.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>

                  {audit.problematicSections.length > 0 && (
                    <div>
                      <h4 className="font-bold flex items-center gap-2 mb-2 text-gray-700">
                        <Info size={14} className="text-blue-500" /> Các phần gặp vấn đề:
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {audit.problematicSections.map((s, i) => (
                          <span key={i} className="bg-gray-100 text-gray-500 px-2 py-1 rounded text-[10px] font-bold border border-gray-200 uppercase">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 italic text-gray-500 text-xs">
                    <span className="font-bold not-italic text-gray-700 block mb-1">💡 Lời khuyên:</span>
                    {audit.advice}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          {loading && (
            <div className="bg-indigo-600 p-6 rounded-2xl text-white shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <BrainCircuit size={80} />
              </div>
              <div className="flex justify-between items-end mb-2 relative z-10">
                <span className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> {progressStatus}
                </span>
                <span className="text-2xl font-black">{currentCount} CÂU</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden relative z-10">
                <div
                  className="h-full bg-white transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, (currentCount / (analysis?.estimatedCount || 100)) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {auditing && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center gap-3 text-amber-700 text-sm font-medium animate-pulse">
              <Loader2 className="animate-spin" size={18} />
              Đang phân tích lý do trích xuất bị thiếu...
            </div>
          )}

          {mcqs.length > 0 && !loading && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div>
                <h2 className="font-bold text-gray-800 text-lg">DANH SÁCH TRÍCH XUẤT</h2>
                <p className="text-xs text-gray-400">Đã hoàn thành: {mcqs.length} câu hỏi / {analysis?.estimatedCount} dự kiến</p>
              </div>
              <button onClick={downloadCSV} className="w-full sm:w-auto px-6 py-2.5 bg-green-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg hover:bg-green-700 transition-all active:scale-95">
                <Download size={18} /> TẢI CSV CHUẨN ANKI
              </button>
            </div>
          )}

          <MCQDisplay mcqs={mcqs} />

          {!loading && mcqs.length === 0 && !analyzing && !files.length && (
            <div className="h-64 flex flex-col items-center justify-center text-gray-300 border-2 border-dashed rounded-3xl">
              <BrainCircuit size={48} className="mb-4 opacity-20" />
              <p className="font-medium">Chưa có dữ liệu. Hãy tải file lên để bắt đầu.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
