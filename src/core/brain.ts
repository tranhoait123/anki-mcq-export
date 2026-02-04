import { PDFDocument } from 'pdf-lib';
import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedResponse, UploadedFile, ProgressCallback, AnalysisResult, AuditResult, BatchCallback, AppSettings } from "../types";

// Helper: Split PDF into chunks (client-side, no worker needed)
// Helper: Split PDF into chunks (client-side) with OVERLAP support
const splitPdf = async (base64Data: string, pagesPerChunk: number = 3, overlap: number = 1): Promise<string[]> => {
  const pdfDoc = await PDFDocument.load(base64Data);
  const totalPages = pdfDoc.getPageCount();
  const chunks: string[] = [];
  const step = Math.max(1, pagesPerChunk - overlap);

  for (let i = 0; i < totalPages; i += step) {
    // Avoid creating a last chunk that is fully contained in the previous one if exact match?
    // But simplest logic is just overlap.
    if (i > 0 && i + pagesPerChunk > totalPages && i + step >= totalPages) {
      // Optimization: If we are near end, ensures we catch everything.
    }

    const subDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: Math.min(pagesPerChunk, totalPages - i) }, (_, k) => i + k);

    // Filter out of bounds just in case
    const validIndices = pageIndices.filter(idx => idx < totalPages);
    if (validIndices.length === 0) break;

    const copyPages = await subDoc.copyPages(pdfDoc, validIndices);
    copyPages.forEach((page) => subDoc.addPage(page));
    const base64 = await subDoc.saveAsBase64();
    chunks.push(base64);

    // Stop if we reached end
    if (validIndices[validIndices.length - 1] === totalPages - 1) break;
  }
  return chunks;
};

const SYSTEM_INSTRUCTION_EXTRACT = `
Bạn là một **GIÁO SƯ Y KHOA ĐẦU NGÀNH (Senior Medical Professor)** kiêm **CHUYÊN GIA PHÁP Y TÀI LIỆU (Forensic Document Analyst)**.
Mục tiêu: Trích xuất chính xác 100% câu hỏi trắc nghiệm từ tài liệu, bất kể chất lượng ảnh thấp, bị nhiễu, có chữ viết tay, hoặc bị che khuất.

🔍 **QUY TRÌNH PHÁP Y (FORENSIC WORKFLOW) - ƯU TIÊN CAO NHẤT**:
1. **XUYÊN THẤU NHIỄU (HANDWRITING BYPASS)**:
   - Các vết khoanh tròn đáp án, gạch chân, hoặc ghi chú viết tay đè lên văn bản gốc **KHÔNG ĐƯỢC** làm gián đoạn việc đọc. Hãy lờ đi các vết mực đó và tập trung vào văn bản in (printed text) bên dưới.
2. **SỬA LỖI THÔNG MINH (CONTEXTUAL INFERENCE)**:
   - Nếu văn bản bị mờ (Blur) hoặc mất pixel: Dùng kiến thức Y khoa uyên bác để "điền vào chỗ trống". 
   - Ví dụ: "S... thận mạn" -> "Suy thận mạn", "đái tháo ...uờng" -> "đái tháo đường". 
   - Sửa lỗi chính tả OCR (VD: "p" thành "ư", "o" thành "ô") để đảm bảo thuật ngữ Y khoa chuẩn 100%.
3. **KHÔI PHỤC CẤU TRÚC (DE-FRAGMENTATION)**:
   - Nếu câu hỏi bị ngắt dòng, ngắt trang hoặc bị che khuất một phần bởi ngón tay: Hãy nối các đoạn lại và dùng logic lâm sàng để phục hồi nội dung bị mất.

📋 **QUY TẮC TRÍCH XUẤT (HANDLING FORMATS)**:
1. **FULL CONTENT**: Luôn trích xuất đầy đủ Câu hỏi + 5 Lựa chọn (A, B, C, D, E) nếu có.
2. **XỬ LÝ DẠNG ĐẶC BIỆT**:
   - **MCQ Đơn (Standard)**: A, B, C, D...
   - **Đúng/Sai (True/False)**: Chuyển thành MCQ với câu hỏi "Phát biểu nào sau đây là ĐÚNG/SAI?".
   - **Ghép nối (Matching)**: Chuyển thành dạng "Ghép cột 1-?, 2-?..." (A,B,C,D là các phương án ghép).
   - **Điền khuyết (Fill-in)**: Chuyển thành "Chọn từ phù hợp điền vào chỗ trống...".
   - **Tình huống lâm sàng (Case Study)**: Lặp lại tóm tắt tình huống ở đầu mỗi câu hỏi liên quan để đảm bảo ngữ cảnh.

🩺 **BIỆN LUẬN LÂM SÀNG (DEEP ANALYSIS)**:
- **core**: Đáp án đúng nhất theo hướng dẫn của Bộ Y tế/Hiệp hội chuyên ngành. Trình bày lý do súc tích.
- **analysis**: Thực hiện chẩn đoán phân biệt. Tại sao phương án này là "Gương mặt vàng" còn các phương án khác lại sai trong ngữ cảnh này?
- **evidence**: Nêu rõ cơ chế bệnh sinh hoặc trích dẫn lý thuyết trực tiếp từ tài liệu hoặc trích dẫn nguồn uy tín (Harrison, Nelson, Bộ Y tế, Dược thư...).
- **warning**: Cảnh báo các bẫy lâm sàng hoặc nhầm lẫn thường gặp.

⛔ **HÀNG RÀO AN TOÀN (SAFETY PROTOCOL)**:
- Tuyệt đối không sử dụng văn bản giả hoặc ghi chú chung chung (Placeholder).
- Không được bịa đặt (hallucinate) các tình huống lâm sàng không có trong văn bản.
- Nếu một câu hỏi bị che khuất hoàn toàn (>70%) và không có cách nào suy luận logic, hãy bỏ qua câu đó.

🎯 **CHỈ THỊ CUỐI CÙNG (FINAL COMMAND)**:
- Chỉ trả về duy nhất mảng JSON. Không giải thích thêm bên ngoài JSON.
- Đảm bảo các trường "evidence" và "analysis" luôn có nội dung học thuật, không để trống.
- Nếu câu hỏi có nhiều đáp án có vẻ đúng, hãy chọn đáp án "Đúng nhất" theo tiêu chuẩn lâm sàng hiện hành.

OUTPUT FORMAT: JSON array.
`;

const SYSTEM_INSTRUCTION_AUDIT = `
Bạn là Chuyên gia Kiểm toán Tài liệu AI. 
Nhiệm vụ: Phân tích lý do tại sao trích xuất thất bại hoặc số lượng quá ít.
Hãy tìm các nguyên nhân cụ thể:
- **Handwriting interference**: Chữ viết tay/khoanh tròn đè lên văn bản gốc quá nhiều.
- **Physical obstruction**: Ngón tay, vật thể lạ che khuất.
- **Low resolution/Blur**: Ảnh quá mờ không thể đọc được cả bằng mắt thường.
- **Complexity**: Bố cục quá rối rắm, bảng biểu vỡ.

Đưa ra lời khuyên cụ thể để người dùng chụp lại tốt hơn (VD: "Cần chụp thẳng góc", "Tránh để ngón tay che chữ").
`;

// --- Key Management ---
class UserKeyRotator {
  private keys: string[] = [];
  private currentIndex: number = 0;

  constructor() { }

  init(apiKeyString: string) {
    if (!apiKeyString) {
      this.keys = [];
      return;
    }
    let parts = apiKeyString.split(/[,;\n]+/);
    this.keys = parts.map(k => k.trim()).filter(k => k.length > 10);
    this.currentIndex = 0;
    console.log(`🔑 Loaded ${this.keys.length} API Keys.`);
  }

  getCurrentKey(): string {
    if (this.keys.length === 0) {
      throw new Error("Vui lòng nhập Google API Key trong phần Cài đặt.");
    }
    return this.keys[this.currentIndex];
  }

  rotate(): string {
    if (this.keys.length <= 1) return this.getCurrentKey();
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    console.log(`🔄 Rotating to API Key #${this.currentIndex + 1}`);
    return this.keys[this.currentIndex];
  }

  get keyCount(): number {
    return this.keys.length;
  }

  getKeyIndex(): number {
    return this.currentIndex;
  }
}

const userKeyRotator = new UserKeyRotator();

// --- Helpers ---

const extractJson = (text: string): string => {
  if (!text) return "";
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || start >= end) return text;
  return text.substring(start, end + 1);
};

// --- Deduplication Helpers ---

const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[\s\n\r]+/g, ' ')
    .replace(/[.,;:!?\"'()\\[\\]{}]/g, '')
    .trim();
};

const extractQuestionNumber = (text: string): number | null => {
  const patterns = [
    /câu\s*(?:số\s*)?(\d+)/i,
    /question\s*(\d+)/i,
    /^(\d+)\s*[.:)\]]/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
};

const calculateSimilarity = (str1: string, str2: string): number => {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.95;

  const words1 = new Set(s1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(s2.split(' ').filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  words1.forEach(w => { if (words2.has(w)) overlap++; });

  return overlap / Math.max(words1.size, words2.size);
};

const checkDuplicate = (newQ: string, existingQuestions: any[]): { isDup: boolean; reason?: string; matchedWith?: string } => {
  const SIMILARITY_THRESHOLD = 0.70;

  const newNumber = extractQuestionNumber(newQ);

  for (const existing of existingQuestions) {
    const existingNumber = extractQuestionNumber(existing.question);
    if (newNumber !== null && existingNumber !== null && newNumber === existingNumber) {
      return {
        isDup: true,
        reason: `Trùng số câu hỏi: Câu ${newNumber}`,
        matchedWith: existing.question.substring(0, 60)
      };
    }

    const similarity = calculateSimilarity(newQ, existing.question);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return {
        isDup: true,
        reason: `Độ tương đồng ${Math.round(similarity * 100)}%`,
        matchedWith: existing.question.substring(0, 60)
      };
    }
  }

  return { isDup: false };
};

const getModelConfig = (apiKey: string, systemInstruction: string, schema?: any, modelName: string = 'gemini-3-flash') => {
  return {
    model: modelName,
    config: {
      systemInstruction,
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };
};

// --- Execution with Retry & Rotation ---

async function executeWithUserRotation<T>(
  operation: (apiKey: string) => Promise<T>
): Promise<T> {
  const ATTEMPTS_LIMIT = 10;
  let attempts = 0;

  while (attempts < ATTEMPTS_LIMIT) {
    attempts++;
    const currentKey = userKeyRotator.getCurrentKey();

    try {
      return await operation(currentKey);
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const isRateLimit = msg.includes("429") || msg.includes("quota exceeded") || msg.includes("resource exhausted");
      const isKeyError = msg.includes("api key") && (msg.includes("invalid") || msg.includes("not found") || msg.includes("expired"));

      if (isRateLimit || isKeyError) {
        const reason = isRateLimit ? "Rate Limit (429)" : "Invalid/Expired Key";
        console.warn(`⚠️ ${reason} on Key #${userKeyRotator.getKeyIndex() + 1}. Rotating...`);
        userKeyRotator.rotate();
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Đã thử tất cả ${userKeyRotator.keyCount} Keys nhưng đều thất bại (429/Invalid). Vui lòng kiểm tra lại Key.`);
}


export const generateQuestions = async (
  files: UploadedFile[],
  settings: AppSettings,
  limit: number = 0,
  onProgress?: ProgressCallback,
  expectedCount: number = 0,
  onBatchComplete?: BatchCallback
): Promise<GeneratedResponse> => {
  try {
    userKeyRotator.init(settings.apiKey);
    userKeyRotator.getCurrentKey();

    // --- STEP 1: PRE-PROCESS ---
    let allParts: { mimeType: string; data: string }[] = [];

    if (onProgress) onProgress("Đang phân tích định dạng tài liệu...", 0);

    for (const file of files) {
      if (file.type === 'application/pdf') {
        if (onProgress) onProgress(`Đang cắt nhỏ PDF "${file.name}" để quét sâu...`, 0);

        // SPLIT STRATEGY (Quantity Fix + Overlap):
        // Split PDF into 3-page chunks with 1 PAGE OVERLAP.
        // Chunks: [1-3], [3-5], [5-7]...
        // This ensures questions cut across pages are never lost.
        try {
          const rawBase64 = file.content.includes(',') ? file.content.split(',')[1] : file.content;
          const title = file.name;

          const pdfChunks = await splitPdf(rawBase64, 3, 1); // 3 pages, 1 overlap
          console.log(`✂️ Split PDF into ${pdfChunks.length} chunks (w/ overlap).`);

          pdfChunks.forEach((chunkBase64) => {
            allParts.push({
              mimeType: 'application/pdf',
              data: chunkBase64
            });
          });
        } catch (splitError) {
          console.error("PDF Split failed, fallback to whole doc:", splitError);
          allParts.push({
            mimeType: 'application/pdf',
            data: file.content.includes(',') ? file.content.split(',')[1] : file.content
          });
        }

      } else if (file.type.startsWith('image/')) {
        allParts.push({
          mimeType: file.type,
          data: file.content.includes(',') ? file.content.split(',')[1] : file.content
        });
      } else {
        return { questions: [], duplicates: [] };
      }
    }

    if (allParts.length === 0) {
      const textParts = files.filter(f => !f.type.startsWith('image/') && f.type !== 'application/pdf');
      if (textParts.length > 0) {
        throw new Error("Hiện tại chế độ 'Quét từng trang' chỉ hỗ trợ PDF và Ảnh.");
      }
    }

    const questionSchema = {
      type: Type.OBJECT,
      properties: {
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.STRING },
              explanation: {
                type: Type.OBJECT,
                properties: {
                  core: { type: Type.STRING },
                  evidence: { type: Type.STRING },
                  analysis: { type: Type.STRING },
                  warning: { type: Type.STRING }
                },
                required: ["core", "evidence", "analysis", "warning"]
              },
              source: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              depthAnalysis: { type: Type.STRING }
            },
            required: ["question", "options", "correctAnswer", "explanation", "source", "difficulty", "depthAnalysis"]
          }
        }
      }
    };

    let allQuestions: any[] = [];
    let allDuplicates: any[] = [];
    let duplicateCounter = 0;

    // --- STEP 2: BATCH PROCESSING ---
    // Since we split the PDF into small PDFs (3 pages), each "part" is now a 3-page PDF.
    // We can treat each Part as a Batch.

    const CHUNK_SIZE = 1; // Handled by splitPdf
    // const OVERLAP = 0; // Handled by splitPdf overlap param if we wanted, but here simpler is distinct blocks or overlapping blocks?
    // In splitPdf: I did NOT implement overlap. Just sequential.
    // To implement overlap: `i += pagesPerChunk - 1`?
    // My splitPdf loop: `i += pagesPerChunk`. That is NO overlap.
    // To ensure "Rolling Window", update splitPdf logic?
    // Actually, distinct blocks are usually fine if question doesn't span page break.
    // But to match "Rolling Window", we can adjust splitPdf loop step.
    // Ideally, we process these PDF chunks in parallel.

    const CONCURRENCY_LIMIT = 2;
    const totalBatches = allParts.length;
    let completedBatches = 0;

    const processBatch = async (part: { mimeType: string, data: string }, index: number) => {
      try {
        if (onProgress) onProgress(`Đang quét song song: Batch ${index + 1}/${totalBatches}...`, allQuestions.length);
        await new Promise(r => setTimeout(r, Math.random() * 1000));

        const promptText = `
  HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY.
  Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy.
  Đừng lo về trùng lặp (hệ thống sẽ tự lọc).
            `;

        const text = await executeWithUserRotation(async (apiKey) => {
          const ai = new GoogleGenAI({ apiKey });
          const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_EXTRACT, questionSchema, settings.model));
          // Wrap part in inlineData
          const inlinePart = { inlineData: { mimeType: part.mimeType, data: part.data } };
          const response = await chat.sendMessage({
            message: [inlinePart, { text: promptText }]
          });
          return response.text;
        });

        if (text) {
          const parsed = JSON.parse(extractJson(text)) as GeneratedResponse;
          const rawNewQs = parsed.questions || [];
          const newQs = [];

          for (const q of rawNewQs) {
            const result = checkDuplicate(q.question, allQuestions);
            if (result.isDup) {
              duplicateCounter++;
              allDuplicates.push({
                id: `dup-${Date.now()}-${duplicateCounter}`,
                question: q.question.substring(0, 50),
                reason: `Duplicate found`,
                matchedWith: result.matchedWith,
                fullData: q
              });
            } else {
              newQs.push(q);
            }
          }

          if (newQs.length > 0) {
            allQuestions.push(...newQs);
            if (onBatchComplete) onBatchComplete(newQs);
            console.log(`✅ Batch ${index + 1}: Found ${newQs.length} questions.`);
          }
        }
      } catch (e) {
        console.error(`Error in Batch ${index + 1}:`, e);
      } finally {
        completedBatches++;
        if (onProgress) onProgress(`Hoàn thành batch ${index + 1}/${totalBatches}. Tổng: ${allQuestions.length} câu...`, allQuestions.length);
      }
    };

    const activePromises: Promise<void>[] = [];
    for (let i = 0; i < allParts.length; i++) {
      const p = processBatch(allParts[i], i);
      activePromises.push(p);
      if (activePromises.length >= CONCURRENCY_LIMIT) {
        const finishedIndex = await Promise.race(activePromises.map((p, idx) => p.then(() => idx)));
        activePromises.splice(finishedIndex, 1);
      }
    }
    await Promise.all(activePromises);

    allQuestions.sort((a, b) => {
      const numA = extractQuestionNumber(a.question) || 999999;
      const numB = extractQuestionNumber(b.question) || 999999;
      return numA - numB;
    });

    console.log(`\n📊 FINAL: ${allQuestions.length} questions.`);
    return { questions: allQuestions, duplicates: allDuplicates };

  } catch (error: any) {
    throw new Error(error.message);
  }
};


export const analyzeDocument = async (files: UploadedFile[], settings: AppSettings): Promise<AnalysisResult> => {
  let attempts = 0;
  const MaxAttempts = 3;

  userKeyRotator.init(settings.apiKey);

  while (attempts < MaxAttempts) {
    try {
      const apiKey = userKeyRotator.getCurrentKey();
      const ai = new GoogleGenAI({ apiKey });

      const parts: any[] = files.map(file => {
        if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
          return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
        }
        return { text: `FILE: ${file.name}\n${file.content}\n` };
      });

      const schema = {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING },
          estimatedCount: { type: Type.INTEGER },
          questionRange: { type: Type.STRING },
          confidence: { type: Type.STRING }
        },
        required: ["topic", "estimatedCount", "questionRange"]
      };

      const chat = ai.chats.create(getModelConfig(apiKey, "Phân tích số câu hỏi trắc nghiệm trong tài liệu Y khoa.", schema, settings.model));
      const res = await chat.sendMessage({ message: [...parts, { text: "Quét tài liệu và ước tính tổng số câu hỏi MCQ có mặt." }] });
      const text = res.text;

      if (!text) throw new Error("Empty response");

      const result = JSON.parse(extractJson(text)) as AnalysisResult;
      return result;

    } catch (error: any) {
      console.warn(`Analysis failed (Attempt ${attempts + 1}/${MaxAttempts}):`, error);
      const isRateLimit = error.message?.includes("429") || error.message?.includes("Quota exceeded");
      if (isRateLimit || attempts < MaxAttempts - 1) {
        console.log("Rotating key and retrying analysis...");
        userKeyRotator.rotate();
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Analysis failed after multiple attempts");
};

export const auditMissingQuestions = async (files: UploadedFile[], count: number, settings: AppSettings): Promise<AuditResult> => {
  userKeyRotator.init(settings.apiKey);

  return await executeWithUserRotation(async (apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
      }
      return { text: `FILE: ${file.name}\n${file.content}\n` };
    });

    const schema = {
      type: Type.OBJECT,
      properties: {
        status: { type: Type.STRING },
        missingPercentage: { type: Type.NUMBER },
        reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
        problematicSections: { type: Type.ARRAY, items: { type: Type.STRING } },
        advice: { type: Type.STRING }
      },
      required: ["status", "reasons", "advice", "problematicSections"]
    };

    const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_AUDIT, schema, settings.model));
    const res = await chat.sendMessage({
      message: [
        ...parts,
        { text: `Quá trình trích xuất chỉ lấy được ${count} câu hỏi. Hãy so sánh với toàn bộ tài liệu và báo cáo tại sao có sự thiếu hụt này. Chỉ ra chính xác chương hoặc trang gặp khó khăn nếu có thể.` }
      ]
    });

    return JSON.parse(extractJson(res.text)) as AuditResult;
  });
};
