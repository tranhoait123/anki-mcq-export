import { PDFDocument } from 'pdf-lib';
import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedResponse, UploadedFile, ProgressCallback, AnalysisResult, AuditResult, BatchCallback, AppSettings } from "../types";
import { db } from './db';

// Helper: Hashing for cache identification
const hashFiles = async (files: UploadedFile[]): Promise<string> => {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const combined = sortedFiles.map(f => `${f.name}:${f.content}`).join('|');
  const msgUint8 = new TextEncoder().encode(combined);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Helper: Hash for API Key identification (to scope caches per project/key)
const hashApiKey = (key: string): string => {
  if (!key) return "no-key";
  return key.substring(0, 8) + key.substring(key.length - 8); // Simple suffix/prefix hash
};

// Helper: Cache Management
const getOrSetContextCache = async (ai: any, files: UploadedFile[], modelName: string, systemInstruction: string, apiKey: string): Promise<string | null> => {
  try {
    const fileHash = await hashFiles(files);
    const keyHash = hashApiKey(apiKey);
    const instrHash = systemInstruction.length.toString(); // Simple length-based check to trigger refresh
    const cacheId = `${fileHash}_${modelName}_${keyHash}_${instrHash}`;
    const existing = await db.getCache(cacheId);

    // If existing and not expired, return it
    if (existing && existing.expiresAt > Date.now()) {
      console.log(`🎯 Cache Hit (Key: ${keyHash}): ${existing.cacheName}`);
      return existing.cacheName;
    }

    // Prepare contents for caching
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
      }
      return { text: `FILE: ${file.name}\n${file.content}\n` };
    });

    // Estimate tokens (rough estimate: 4 chars per token)
    const estimatedTokens = parts.reduce((acc, p) => acc + (p.text?.length || p.inlineData?.data?.length || 0), 0) / 4;
    
    // Google requires minimum ~2048 tokens for explicit caching in many models
    if (estimatedTokens < 2000) {
      console.log("⚡ Document too small for explicit caching (< 2000 estimated tokens). Using standard request.");
      return null;
    }

    console.log(`💎 Creating new Context Cache for ${modelName}...`);
    const ttlSeconds = 7200; // 2 hours
    const cache = await ai.caches.create({
      model: modelName,
      config: {
        contents: [{ role: 'user', parts }],
        systemInstruction,
        ttl: `${ttlSeconds}s`,
      },
    });

    const expiresAt = Date.now() + (ttlSeconds * 1000);
    await db.saveCache({
      id: cacheId,
      cacheName: cache.name,
      expiresAt,
      modelName
    });

    console.log(`✅ Cache Created: ${cache.name}`);
    return cache.name;
  } catch (err) {
    console.warn("⚠️ Context Caching failed (possibly not supported by key/model):", err);
    return null;
  }
};

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
4. **ƯU TIÊN BẢNG BIỂU & CSV (TABLE/CSV INTELLIGENCE)**:
   - Nếu dữ liệu có dạng lưới (Grid) hoặc bảng: Phân tích kỹ lưỡng nội dung theo từng hàng.
      + Thường thì Cột 1 là Câu hỏi, các cột tiếp theo là Phương án (A, B, C, D) và Đáp án đúng.
      + Nếu văn bản có các ký tự \`|\` hoặc dấu phẩy \`,\` ngăn cách: Hãy coi đó là ranh giới giữa các trường dữ liệu và không được gộp chúng lại.
      + Luôn đảm bảo nội dung của một ô trong bảng được giữ nguyên vẹn, không bị dính vào ô bên cạnh.

📋 **QUY TẮC TRÍCH XUẤT (HANDLING FORMATS)**:
1. **FULL CONTENT**: Luôn trích xuất đầy đủ Câu hỏi + 5 Lựa chọn (A, B, C, D, E) nếu có.
2. **XỬ LÝ DẠNG ĐẶC BIỆT**:
   - **MCQ Đơn (Standard)**: A, B, C, D...
   - **Đúng/Sai (True/False)**: Chuyển thành MCQ với câu hỏi "Phát biểu nào sau đây là ĐÚNG/SAI?".
   - **Ghép nối (Matching)**: Chuyển thành dạng "Ghép cột 1-?, 2-?..." (A,B,C,D là các phương án ghép).
   - **Điền khuyết (Fill-in)**: Chuyển thành "Chọn từ phù hợp điền vào chỗ trống...".
   - **Tình huống lâm sàng (Case Study / Clinical Vignette)**:
     + Khi gặp 1 tình huống lâm sàng kèm NHIỀU câu hỏi (VD: "Tình huống lâm sàng 1" → Câu 1, Câu 2, Câu 3...):
     + **BẮT BUỘC** lặp lại NGUYÊN VĂN toàn bộ đoạn tình huống lâm sàng vào đầu trường "question" của MỖI câu hỏi.
     + Format mỗi câu: "[TÌNH HUỐNG LÂM SÀNG]\n{toàn bộ nội dung case nguyên văn}\n\n[CÂU HỎI]\n{nội dung câu hỏi riêng lẻ}"
     + Lý do: Mỗi câu hỏi sẽ thành 1 thẻ Anki riêng biệt, sinh viên cần đọc case đầy đủ trên mỗi thẻ.
     + KHÔNG được tóm tắt, rút gọn hay paraphrase case — phải giữ nguyên văn như trong tài liệu gốc.
     + Ví dụ: Nếu tài liệu có "Bệnh nhân nam 68 tuổi..." rồi Câu 1, Câu 2, Câu 3 → cả 3 câu đều phải bắt đầu bằng đoạn "Bệnh nhân nam 68 tuổi...".

🩺 **BIỆN LUẬN LÂM SÀNG (BẮT BUỘC FORMAT CHI TIẾT SAU ĐÂY)**:
1. **core** (🎯 ĐÁP ÁN CỐT LÕI): Đáp án đúng + lý do chọn ngắn gọn.
2. **evidence** (📚 BẰNG CHỨNG): Bảng phân loại, tiêu chuẩn chẩn đoán, guideline liên quan. (Bắt buộc dùng bảng Markdown khi có nhiều tính chất/bệnh lý).
3. **analysis** (💡 PHÂN TÍCH SÂU): Bảng loại trừ từng đáp án sai + bảng xét nghiệm/đặc điểm phân biệt. Trả lời chi tiết, có hệ thống, dùng Markdown table để so sánh. 
4. **warning** (⚠️ CẢNH BÁO LÂM SÀNG): Lưu ý xử trí, theo dõi, tác dụng phụ, hoặc sai lầm thường gặp trên lâm sàng/thi cử.
5. **difficulty** (📊 ĐỘ KHÓ): Chỉ trả về một từ: Easy / Medium / Hard.
6. **depthAnalysis** (🧠 TƯ DUY): Key points dạng blockquote (🔑), bẫy thường gặp trong thi cử. Nhấn mạnh tư duy loại trừ.
7. **source** (📁 NGUỒN): Tên tài liệu hoặc ngữ cảnh trang hiện tại.

⛔ **HÀNG RÀO AN TOÀN (SAFETY PROTOCOL)**:
- Tuyệt đối không sử dụng văn bản giả hoặc ghi chú chung chung (Placeholder).
- Không được bịa đặt (hallucinate) các tình huống lâm sàng không có trong văn bản.
- Nếu một câu hỏi bị che khuất hoàn toàn (>70%) và không có cách nào suy luận logic, hãy bỏ qua câu đó.

1. **questions**: Mảng chứa danh sách các câu hỏi. Mỗi câu hỏi trong mảng PHẢI có đầy đủ các trường sau:
   - **question**: Nội dung câu hỏi (kèm Case lâm sàng nếu có).
   - **options**: Mảng 4-5 lựa chọn (VD: ["A. ...", "B. ..."]).
   - **correctAnswer**: Đáp án đúng (VD: "A").
   - **explanation**: Đối tượng chi tiết gồm:
     - **core**: Giải thích cốt lõi.
     - **evidence**: Bằng chứng y khoa (Markdown Table).
     - **analysis**: Phân tích loại trừ (Markdown Table).
     - **warning**: Cảnh báo lâm sàng.
   - **source**: Nguồn trích dẫn (Tên tài liệu/Trang).
   - **difficulty**: Độ khó (Easy/Medium/Hard).
   - **depthAnalysis**: Tư duy lâm sàng chuyên sâu.

🎯 **CHỈ THỊ CUỐI CÙNG (FINAL COMMAND)**:
- Chỉ trả về duy nhất một đối tượng JSON có khóa "questions". KHÔNG giải thích thêm.
- TUYỆT ĐỐI không để trống các trường bắt buộc. Nếu không có dữ liệu, hãy điền "Thông tin đang cập nhật" thay vì để trống.

OUTPUT FORMAT: JSON Object with "questions" array.
`;

const SYSTEM_INSTRUCTION_NORMALIZE = `
Bạn là Chuyên gia Số hóa Tài liệu Y khoa. 
Nhiệm vụ: Chuyển đổi toàn bộ nội dung trong ảnh/PDF thành văn bản Markdown MIÊU TẢ CHI TIẾT VÀ CHÍNH XÁC.
- **BẮT BUỘC DỰNG LẠI BẢNG**: Nếu tài liệu có bảng biểu (tables), hãy sử dụng định dạng Markdown Table (\`| Question | Option A | Option B | ... |\`) để giữ nguyên cấu trúc hàng/cột.
- **NGĂN CÁCH TUYỆT ĐỐI**: Đảm bảo nội dung trong các ô khác nhau không bị dính vào nhau. Sử dụng các ký tự phân cách rõ ràng.
- Giữ nguyên cấu trúc: Tiêu đề, đoạn văn, danh sách.
- Đặc biệt lưu ý: Các câu hỏi trắc nghiệm phải được trích xuất ĐẦY ĐỦ (Câu hỏi, các lựa chọn A/B/C/D).
- Nếu có Case lâm sàng (Tình huống dài), hãy trích xuất toàn bộ văn bản để tránh mất ngữ cảnh.
- Không được tóm tắt. Cần trích xuất "Word-by-word" (từng chữ một) ở mức độ cao nhất.
- Bỏ qua: Số trang, Header, Footer lặp lại.
- Output: Văn bản Markdown sạch, cấu trúc bảng biểu hoàn hảo.
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

// --- Normalization Helper ---
const normalizeToMarkdown = async (ai: any, files: UploadedFile[], onProgress?: ProgressCallback): Promise<string | null> => {
  try {
    const hash = await hashFiles(files);
    const cached = await db.getMarkdown(hash);
    if (cached) {
      console.log("🎯 Markdown Cache Hit!");
      return cached.content;
    }

    if (onProgress) onProgress("Đang số hóa tài liệu (Bước 1: OCR & Normalizing)...", 0);

    const contents: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
      }
      return { text: `FILE: ${file.name}\n${file.content}\n` };
    });

    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: 'user', parts: [...contents, { text: "Hãy chuyển đổi tài liệu này thành Markdown sạch, trích xuất chính xác 100% nội dung chữ." }] }],
      config: { systemInstruction: SYSTEM_INSTRUCTION_NORMALIZE }
    });

    const text = result.text;

    if (text) {
      await db.saveMarkdown({
        id: hash,
        content: text,
        createdAt: Date.now()
      });
      return text;
    }
    return null;
  } catch (e) {
    console.warn("⚠️ Normalization failed:", e);
    return null;
  }
};

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
  
  // Xử lý khối mã Markdown: ```json ... ``` hoặc ``` ... ```
  let cleanText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanText = codeBlockMatch[1];
  }

  const start = cleanText.indexOf('{');
  const end = cleanText.lastIndexOf('}');
  
  if (start === -1 || end === -1 || start >= end) {
    // Nếu không tìm thấy { }, kiểm tra xem có phải mảng [ ] không
    const aStart = cleanText.indexOf('[');
    const aEnd = cleanText.lastIndexOf(']');
    if (aStart !== -1 && aEnd !== -1 && aStart < aEnd) {
      return cleanText.substring(aStart, aEnd + 1);
    }
    return cleanText.trim();
  }
  return cleanText.substring(start, end + 1);
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
  if (!text || typeof text !== 'string') return null;
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
  
  // Logic Flip Detection (Bẫy phủ định)
  // Nếu một câu có chữ "không" mà câu kia không có -> Giảm mạnh tương đồng
  const negativeKeywords = ['không', 'ngoại trừ', 'ngoài trừ', 'not', 'except', 'un-'];
  for (const kw of negativeKeywords) {
    const has1 = s1.includes(` ${kw} `) || s1.startsWith(`${kw} `);
    const has2 = s2.includes(` ${kw} `) || s2.startsWith(`${kw} `);
    if (has1 !== has2) return 0.2; // Rất thấp vì logic ngược nhau
  }

  const words1 = s1.split(' ').filter(w => w.length > 2);
  const words2 = s2.split(' ').filter(w => w.length > 2);

  if (words1.length === 0 || words2.length === 0) return 0;

  // Detect shared case stem (common prefix by words)
  let commonPrefixLen = 0;
  const minLen = Math.min(words1.length, words2.length);
  for (let i = 0; i < minLen; i++) {
    if (words1[i] === words2[i]) {
      commonPrefixLen++;
    } else {
      break;
    }
  }

  const maxLen = Math.max(words1.length, words2.length);

  // If >40% of words are a shared prefix (case stem), compare suffixes
  if (commonPrefixLen > 5 && commonPrefixLen / maxLen > 0.4) {
    const suffix1 = words1.slice(commonPrefixLen);
    const suffix2 = words2.slice(commonPrefixLen);

    if (suffix1.length === 0 && suffix2.length === 0) return 1;
    if (suffix1.length === 0 || suffix2.length === 0) return 0.5;

    const suffixSet1 = new Set(suffix1);
    const suffixSet2 = new Set(suffix2);
    let suffixOverlap = 0;
    suffixSet1.forEach(w => { if (suffixSet2.has(w)) suffixOverlap++; });
    return suffixOverlap / Math.max(suffixSet1.size, suffixSet2.size);
  }

  const set1 = new Set(words1);
  const set2 = new Set(words2);
  let overlap = 0;
  set1.forEach(w => { if (set2.has(w)) overlap++; });

  return overlap / Math.max(set1.size, set2.size);
};

const checkDuplicate = (newQ: any, existingQuestions: any[]): { isDup: boolean; reason?: string; matchedWith?: string; matchedData?: any } => {
  const CONTENT_THRESHOLD = 0.95; // Nâng lên 95% để cực kỳ khắt khe
  const NUMBER_MATCH_THRESHOLD = 0.90; // Nâng lên 90% thay vì 80%

  const newNumber = extractQuestionNumber(newQ.question);
  const newText = newQ.question;
  const newOpts = (newQ.options || []).join(' ');

  for (const existing of existingQuestions) {
    const existingNumber = extractQuestionNumber(existing.question);
    const qSim = calculateSimilarity(newText, existing.question);
    const optSim = calculateSimilarity(newOpts, (existing.options || []).join(' '));
    
    // Tổng hợp độ tương đồng (70% câu hỏi, 30% đáp án)
    const totalSim = (qSim * 0.7) + (optSim * 0.3);

    // Trường hợp 1: Trùng số câu hỏi (Câu 1, Câu 1...)
    // Chỉ coi là trùng nếu nội dung cũng cực kỳ giống nhau (> 90%)
    if (newNumber !== null && existingNumber !== null && newNumber === existingNumber) {
      if (totalSim >= NUMBER_MATCH_THRESHOLD) {
        return {
          isDup: true,
          reason: `Trùng số (${newNumber}) & Nội dung (~${Math.round(totalSim * 100)}%)`,
          matchedWith: existing.question.substring(0, 60),
          matchedData: existing
        };
      }
    }

    // Trường hợp 2: Không trùng số hoặc số khác nhau nhưng nội dung giống hệt (> 95%)
    if (totalSim >= CONTENT_THRESHOLD) {
      return {
        isDup: true,
        reason: `Nội dung tương đồng rất cao (${Math.round(totalSim * 100)}%)`,
        matchedWith: existing.question.substring(0, 60),
        matchedData: existing
      };
    }
  }

  return { isDup: false };
};

const getModelConfig = (apiKey: string, systemInstruction: string, schema?: any, modelName: string = 'gemini-2.0-flash', cachedContent?: string) => {
  return {
    model: modelName,
    config: {
      systemInstruction,
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: schema,
      cachedContent
    }
  };
};

// --- Execution with Retry & Rotation ---

async function executeWithUserRotation<T>(
  operation: (apiKey: string) => Promise<T>
): Promise<T> {
  const ATTEMPTS_LIMIT = 15;
  let attempts = 0;

  while (attempts < ATTEMPTS_LIMIT) {
    attempts++;
    const currentKey = userKeyRotator.getCurrentKey();

    try {
      return await operation(currentKey);
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const isRateLimit = msg.includes("429") || msg.includes("quota exceeded") || msg.includes("resource exhausted") || msg.includes("timeout") || msg.includes("econnreset");
      const isServerBusy = msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded");
      const isKeyError = msg.includes("api key") && (msg.includes("invalid") || msg.includes("not found") || msg.includes("expired"));

      if (isRateLimit || isServerBusy || isKeyError) {
        const reason = isRateLimit ? "Hết hạn mức/Timeout" : (isServerBusy ? "Server quá tải (503)" : "Lỗi Key");
        console.warn(`⚠️ ${reason} on Key #${userKeyRotator.getKeyIndex() + 1}. Rotating... (Attempt ${attempts})`);
        
        // Exponential backoff & jitter logic for rate limits
        const backoffMs = isRateLimit 
             ? Math.min(15000, 1000 * Math.pow(1.5, attempts) + Math.random() * 1000) 
             : 500;

        userKeyRotator.rotate();
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Đã thử luân phiên tất cả ${userKeyRotator.keyCount} Keys nhưng đều quá tải (đã thử ${ATTEMPTS_LIMIT} lần). Vui lòng chờ 1-2 phút rồi thử lại.`);
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
    const apiKey = userKeyRotator.getCurrentKey();
    const ai = new GoogleGenAI({ apiKey });

    // --- STEP 1: PRE-PROCESS & NORMALIZE ---
    let allParts: any[] = [];
    const sessionCache: Record<string, Promise<string | null>> = {};

    if (onProgress) onProgress("Đang tính toán số lượng Batch và chuẩn bị quét dữ liệu...", 0);

    // [Step 1: Splitting Logic]
    for (const file of files) {
        if (file.type === 'application/pdf') {
          try {
            const rawBase64 = file.content.includes(',') ? file.content.split(',')[1] : file.content;
            const pdfChunks = await splitPdf(rawBase64, 3, 1); 
            pdfChunks.forEach((chunkBase64) => {
              allParts.push({ inlineData: { mimeType: 'application/pdf', data: chunkBase64 } });
            });
          } catch (splitError) {
            allParts.push({ inlineData: { mimeType: 'application/pdf', data: file.content.includes(',') ? file.content.split(',')[1] : file.content } });
          }
        } else if (file.type.startsWith('image/')) {
          allParts.push({ inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } });
        } else {
          const MAX_CHARS = 15000;
          const OVERLAP = 1000;
          let offset = 0;
          let partIdx = 1;
          while (offset < file.content.length) {
             allParts.push({ text: `[TÀI LIỆU: "${file.name}" (Phần ${partIdx++})]\n\n` + file.content.substring(offset, offset + MAX_CHARS) });
             offset += (MAX_CHARS - OVERLAP);
             if (offset >= file.content.length - OVERLAP) {
                if (offset < file.content.length) {
                   allParts.push({ text: `[TÀI LIỆU: "${file.name}" (Phần cuối)]\n\n` + file.content.substring(offset, file.content.length) });
                }
                break;
             }
          }
      }
    }

    if (allParts.length === 0) {
      return { questions: [], duplicates: [] };
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

    const CONCURRENCY_LIMIT = 1;
    const totalBatches = allParts.length;
    let completedBatches = 0;

    const processBatch = async (part: any, index: number) => {
      try {
        if (onProgress) onProgress(`Đang quét song song: Batch ${index + 1}/${totalBatches}...`, allQuestions.length);
        await new Promise(r => setTimeout(r, Math.random() * 1000));

        const promptText = `
  HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY.
  Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy.
  Đừng lo về trùng lặp (hệ thống sẽ tự lọc).
            `;

        const text = await executeWithUserRotation(async (currentKey) => {
          const ai = new GoogleGenAI({ apiKey: currentKey });
          
          const finalInstruction = settings.customPrompt 
            ? `${settings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}`
            : SYSTEM_INSTRUCTION_EXTRACT;

          // Resolve cache for THIS specific key (thread-safe within session)
          const keyHash = hashApiKey(currentKey);
          if (!sessionCache[keyHash]) {
            sessionCache[keyHash] = getOrSetContextCache(ai, files, settings.model, finalInstruction, currentKey);
          }
          const kCacheName = await sessionCache[keyHash];

          // If we have a cache for this key, use it
          const config = getModelConfig(currentKey, finalInstruction, questionSchema, settings.model, kCacheName || undefined);
          const chat = ai.chats.create(config);

          const batchPrompt = kCacheName 
            ? `Dựa trên tài liệu bạn đã cache, hãy trích xuất thêm trắc nghiệm cho Phần ${index + 1}/${totalBatches}. Tập trung vào nội dung mới được gửi đính kèm.`
            : `HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY. Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy (Phần ${index + 1}/${totalBatches}).`;

          const response = await chat.sendMessage({
            message: [part, { text: batchPrompt }]
          });
          return response.text;
        });

        if (text) {
          console.log(`📡 Batch ${index + 1} Raw (Length: ${text.length}):`, text.substring(0, 500) + (text.length > 500 ? "..." : ""));
          const jsonStr = extractJson(text);
          let parsed: any;
          try {
            parsed = JSON.parse(jsonStr);
          } catch (pe) {
            console.error(`❌ Batch ${index + 1} JSON Parse Error:`, pe.message);
            console.log("Faulty JSON:", jsonStr);
            return;
          }

          // Fallback: Nếu AI trả về mảng trực tiếp, bọc lại vào đối tượng
          let rawNewQs = [];
          if (Array.isArray(parsed)) {
            console.log(`⚠️ Batch ${index + 1}: AI returned an ARRAY instead of object. Using fallback.`);
            rawNewQs = parsed;
          } else if (parsed && parsed.questions) {
            rawNewQs = parsed.questions;
          }

          const newQs = [];

          for (const q of rawNewQs) {
            const result = checkDuplicate(q, allQuestions);
            if (result.isDup) {
              duplicateCounter++;
              allDuplicates.push({
                id: `dup-${Date.now()}-${duplicateCounter}`,
                question: q.question.substring(0, 50),
                reason: result.reason || 'Duplicate found',
                matchedWith: result.matchedWith,
                fullData: q,
                matchedData: result.matchedData
              });
            } else {
              // Gán ID duy nhất để có thể lưu vào IndexedDB (Sửa lỗi DataError)
              q.id = `mcq-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
        console.error(`❌ Batch ${index + 1} FAILED after all retries:`, e);
        // Throwing here will stop the entire generation to prevent silent data loss
        throw new Error(`Batch ${index + 1} thất bại do Server bận (503/429). Vui lòng thử lại sau ít phút.`);
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

    if (!text) throw new Error("Empty response from AI");

    const result = JSON.parse(extractJson(text)) as AnalysisResult;
    return result;
  });
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
