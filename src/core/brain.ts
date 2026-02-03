
import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedResponse, UploadedFile, ProgressCallback, AnalysisResult, AuditResult } from "../types";

const SYSTEM_INSTRUCTION_EXTRACT = `
Bạn là một **GIÁO SƯ Y KHOA ĐẦU NGÀNH (Senior Medical Professor)** đang biên soạn thẻ học Anki cho sinh viên Y khoa.
Mục tiêu: Giúp sinh viên hiểu sâu sắc bản chất vấn đề, cơ chế bệnh sinh và tư duy lâm sàng.

QUY TẮC TUYỆT ĐỐI (STRICT RULES):
1. **CHỐNG NHIỄU (NOISE REDUCTION)**:
   - **BỎ QUA HOÀN TOÀN** các chi tiết viết tay, vết mực đỏ/xanh, vòng tròn khoanh đáp án, dấu tích, con dấu đè lên văn bản.
   - Chỉ trích xuất nội dung từ **CHỮ IN (Printed Text)** màu đen/xám của đề gốc.
   - Nếu văn bản bị cong ở lề (gáy sách), hãy dùng ngữ cảnh để "đoán" và khôi phục từ bị méo.
2. **KHÔNG BỊA ĐẶT (NO HALLUCINATIONS)**: Chỉ được trích xuất những câu hỏi CÓ THỰC. Tuyệt đối không tự sáng tác.
3. **LẤY HẾT (FULL COVERAGE)**: Quét kỹ từng dòng, không bỏ sót câu hỏi nào. Nếu câu hỏi ngắt trang, hãy nối lại.

NHIỆM VỤ CỤ THỂ (HỖ TRỢ ĐA ĐỊNH DẠNG):
1. **Trích xuất câu hỏi**:
   - **MCQ Đơn (Standard)**: Lấy đủ A, B, C, D, E.
   - **Đúng/Sai (True/False)**: Chuyển thành câu hỏi MCQ với các lựa chọn là các ý A, B, C, D (đánh dấu ý đúng trong phần giải thích).
   - **Ghép nối (Matching)**: Chuyển thành câu hỏi dạng: "Ghép các mục cột trái với cột phải: 1-?, 2-?,...". Các lựa chọn A, B, C, D sẽ là các phương án ghép.
   - **Chọn nhiều (Multi-select)**: Ghi rõ trong nội dung câu hỏi "(Chọn nhiều đáp án đúng)".
   - **Điền khuyết/Tự luận ngắn**: Chuyển thành câu hỏi: "Điền vào chỗ trống: [Nội dung]...", Đáp án là từ cần điền.

2. **Giải thích chuyên sâu (Deep Analysis)**:
   - **core (Cốt lõi)**: Giải thích trực diện. Dẫn chứng Sinh lý bệnh/Guideline.
   - **analysis (Tư duy biện luận)**: **CHẨN ĐOÁN PHÂN BIỆT**. Giải thích TẠI SAO các đáp án kia sai? (Quan trọng nhất).
   - **evidence (Lý thuyết trọng tâm - Key Theory)**:
     - Trích dẫn ngắn gọn lý thuyết/kiến thức nền tảng cần có để trả lời câu hỏi này.
     - Ưu tiên lấy từ tài liệu gốc.
     - **QUAN TRỌNG**: Nếu tài liệu gốc quá vắn tắt hoặc thiếu lý thuyết, hãy **BỔ SUNG** từ kiến thức Y khoa chuẩn mực của bạn (Harrison, Bộ Y tế, Dược thư...). Đảm bảo người học đọc xong là hiểu ngay nguyên lý mà không cần tra cứu thêm.
   - **warning**: Bẫy lâm sàng.

QUY TẮC ĐỊNH DẠNG:
- Xử lý Case Study: Nếu câu hỏi dựa trên tình huống lâm sàng dài, hãy lặp lại tóm tắt tình huống ở mỗi câu hỏi.
`;

const SYSTEM_INSTRUCTION_AUDIT = `
Bạn là Chuyên gia Kiểm toán Tài liệu AI. 
Nhiệm vụ: Phân tích lý do tại sao quá trình trích xuất câu hỏi trắc nghiệm từ tài liệu (có thể là file scan, mờ) không đạt được số lượng mong muốn.
Kiểm tra các yếu tố: 
- Lỗi OCR (chữ dính nhau, ký tự lạ).
- Bố cục phức tạp (chia 2 cột, bảng biểu).
- Ảnh mờ hoặc bị nghiêng.
- Các câu hỏi bị dính vào nhau.
- Tài liệu bị thiếu trang hoặc ngắt quãng.
`;

// --- Key Management ---
class KeyManager {
  private keys: string[] = [];
  private currentIndex: number = 0;
  private exhaustedKeys: Set<string> = new Set();

  constructor() {
    const keyString = import.meta.env.VITE_GEMINI_API_KEY || "";
    this.keys = keyString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (this.keys.length === 0) {
      console.error("No API keys found in VITE_GEMINI_API_KEY");
    }
  }

  getKey(): string {
    if (this.keys.length === 0) throw new Error("VITE_GEMINI_API_KEY is not configured or empty.");

    // Find a key that is not exhausted
    for (let i = 0; i < this.keys.length; i++) {
      const keyToCheck = this.keys[(this.currentIndex + i) % this.keys.length];
      if (!this.exhaustedKeys.has(keyToCheck)) {
        this.currentIndex = (this.currentIndex + i) % this.keys.length;
        return keyToCheck;
      }
    }

    // If all keys are exhausted, clear the list and just return the current one (loop back)
    console.warn("All keys temporarily exhausted. Resetting exhaustion status.");
    this.exhaustedKeys.clear();
    return this.keys[this.currentIndex];
  }

  markExhausted(key: string) {
    this.exhaustedKeys.add(key);
    console.warn(`API Key ending in ...${key.slice(-4)} marked as exhausted/rate-limited.`);
    // Move to next key immediately
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  rotate() {
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    console.log(`Rotating to next key: ...${this.keys[this.currentIndex].slice(-4)}`);
  }

  hasNextKey(): boolean {
    // If we have more than 1 key, we can rotate
    return this.keys.length > 1;
  }
}

const keyManager = new KeyManager();

// --- Helpers ---

const extractJson = (text: string): string => {
  if (!text) return "";
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || start >= end) return text;
  return text.substring(start, end + 1);
};

// --- Deduplication Helpers ---

/**
 * Normalize text for comparison: lowercase, remove extra whitespace & punctuation
 */
const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[\s\n\r]+/g, ' ')      // Collapse whitespace
    .replace(/[.,;:!?\"'()\\[\\]{}]/g, '') // Remove punctuation
    .trim();
};

/**
 * Extract question number from text (e.g., "Câu 15:", "Question 3.", "15.")
 */
const extractQuestionNumber = (text: string): number | null => {
  const patterns = [
    /câu\s*(?:số\s*)?(\d+)/i,        // Vietnamese: Câu 15, Câu số 15
    /question\s*(\d+)/i,             // English: Question 15
    /^(\d+)\s*[.:)\]]/,              // Just number: 15. or 15: or 15)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
};

/**
 * Calculate similarity ratio between two strings (0-1)
 */
const calculateSimilarity = (str1: string, str2: string): number => {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.95;

  // Simple word overlap ratio
  const words1 = new Set(s1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(s2.split(' ').filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  words1.forEach(w => { if (words2.has(w)) overlap++; });

  return overlap / Math.max(words1.size, words2.size);
};

/**
 * Check if a question is duplicate - returns detailed info for logging
 */
const checkDuplicate = (newQ: string, existingQuestions: any[]): { isDup: boolean; reason?: string; matchedWith?: string } => {
  const SIMILARITY_THRESHOLD = 0.70; // Reduced to 70% to avoid false positives

  const newNumber = extractQuestionNumber(newQ);

  for (const existing of existingQuestions) {
    // Check 1: Same question number = definite duplicate
    const existingNumber = extractQuestionNumber(existing.question);
    if (newNumber !== null && existingNumber !== null && newNumber === existingNumber) {
      return {
        isDup: true,
        reason: `Trùng số câu hỏi: Câu ${newNumber}`,
        matchedWith: existing.question.substring(0, 60)
      };
    }

    // Check 2: High text similarity
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

const getModelConfig = (apiKey: string, systemInstruction: string, schema?: any) => {
  return {
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };
};

// --- Execution with Retry & Rotation ---

async function executeWithRotation<T>(
  operation: (apiKey: string) => Promise<T>,
  retryCount = 0
): Promise<T> {
  const MAX_RETRIES = 10;

  try {
    const apiKey = keyManager.getKey();
    return await operation(apiKey);
  } catch (error: any) {
    if (retryCount >= MAX_RETRIES) throw error;

    const isRateLimit = error.message?.includes("429") || error.message?.includes("Quota exceeded");

    if (isRateLimit) {
      console.warn("Hit rate limit/quota. Rotating key...");
      keyManager.markExhausted(keyManager.getKey()); // Mark current key as bad

      // Wait a bit before retrying even with a new key, just to be safe
      await new Promise(resolve => setTimeout(resolve, 2000));

      return executeWithRotation(operation, retryCount + 1);
    }

    throw error;
  }
}


export const generateQuestions = async (
  files: UploadedFile[],
  limit: number = 0,
  onProgress?: ProgressCallback,
  expectedCount: number = 0
): Promise<GeneratedResponse> => {
  try {
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content } };
      }
      return { text: `FILE: ${file.name}\n${file.content}\n` };
    });

    const questionSchema = {
      type: Type.OBJECT,
      properties: {
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Danh sách các lựa chọn A, B, C, D và E (nếu có)."
              },
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
    let allDuplicates: { id: string; question: string; reason: string; matchedWith: string; fullData: any }[] = [];
    let duplicateCounter = 0;  // Counter for unique IDs
    let loopCount = 0;
    let keepFetching = true;
    let consecutiveEmptyBatches = 0;

    while (keepFetching && loopCount < 50) {
      loopCount++;
      const currentCount = allQuestions.length;
      if (limit > 0 && currentCount >= limit) break;

      // Better prompt to reduce duplicate extraction
      const lastQuestionSnippet = allQuestions.length > 0
        ? allQuestions[allQuestions.length - 1].question.substring(0, 80)
        : '';

      let promptText = allQuestions.length === 0
        ? "BẮT ĐẦU: Lấy 50 câu hỏi ĐẦU TIÊN trong tài liệu. Trích xuất đầy đủ A, B, C, D, E nếu có."
        : `TIẾP TỤC từ vị trí SAU câu hỏi này: "${lastQuestionSnippet}..."

⚠️ QUY TẮC BẮT BUỘC:
- KHÔNG được lặp lại câu hỏi trên hoặc bất kỳ câu nào đã có.
- Chỉ lấy 50 câu hỏi TIẾP THEO chưa được trích xuất.
- Nếu đã hết câu hỏi mới, trả về mảng rỗng [].`;

      if (onProgress) onProgress(`Đang quét đợt ${loopCount}... (Có ${currentCount} câu)...`, currentCount);

      // RATE LIMITING: Maintain the 4s delay as a baseline courtesy
      await new Promise(resolve => setTimeout(resolve, 4000));

      try {
        // WRAPPED API CALL
        const text = await executeWithRotation(async (apiKey) => {
          const ai = new GoogleGenAI({ apiKey });
          const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_EXTRACT, questionSchema));
          const response = await chat.sendMessage({
            // Always send parts + prompt. This treats each request as standalone but with full context.
            message: [...parts, { text: promptText }]
          });
          return response.text;
        });

        if (!text) {
          // Empty response? 
          if (expectedCount > 0 && currentCount < expectedCount * 0.9 && consecutiveEmptyBatches < 3 && keyManager.hasNextKey()) {
            console.warn("Empty response but target not reached. Rotating key and retrying...");
            keyManager.rotate();
            consecutiveEmptyBatches++;
            continue; // Retry loop with new key (same prompt)
          }
          keepFetching = false;
          continue;
        }

        const parsed = JSON.parse(extractJson(text)) as GeneratedResponse;
        const rawNewQs = parsed.questions || [];

        // === DEDUPLICATION: Filter out questions that already exist ===
        const newQs: typeof rawNewQs = [];
        const duplicatesInfo: { id: string; question: string; reason: string; matchedWith: string; fullData: typeof rawNewQs[0] }[] = [];

        for (const q of rawNewQs) {
          const result = checkDuplicate(q.question, allQuestions);
          if (result.isDup) {
            duplicateCounter++;
            duplicatesInfo.push({
              id: `dup-${Date.now()}-${duplicateCounter}`,
              question: q.question.substring(0, 50),
              reason: result.reason || '',
              matchedWith: result.matchedWith || '',
              fullData: q  // Store full question data for restore
            });
          } else {
            newQs.push(q);
          }
        }

        if (duplicatesInfo.length > 0) {
          console.log(`\n🔄 Batch ${loopCount}: Loại bỏ ${duplicatesInfo.length} câu trùng lặp:`);
          duplicatesInfo.forEach((d, i) => {
            console.log(`  ${i + 1}. "${d.question}..." → ${d.reason}`);
          });
          // Add to global duplicates array for UI display
          allDuplicates.push(...duplicatesInfo);
        }

        if (newQs.length === 0) {
          // If ALL questions in batch were duplicates, AI might be stuck
          if (rawNewQs.length > 0) {
            console.warn(`Batch ${loopCount} contained ONLY duplicates. AI may be looping.`);
            consecutiveEmptyBatches++;
          }

          if (expectedCount > 0 && currentCount < expectedCount * 0.9 && consecutiveEmptyBatches < 3 && keyManager.hasNextKey()) {
            console.warn(`Got 0 new questions but target not reached (${currentCount}/${expectedCount}). Rotating key and retrying...`);
            keyManager.rotate();
            continue; // Retry loop with new key
          }
          keepFetching = false;
        } else {
          allQuestions = [...allQuestions, ...newQs];
          consecutiveEmptyBatches = 0; // Reset counter on success
          console.log(`Added ${newQs.length} unique questions. Total: ${allQuestions.length}`);
        }
      } catch (e: any) {
        console.error("Extraction loop error:", e);
        // If we error out, also try rotating if we haven't reached target?
        if (expectedCount > 0 && currentCount < expectedCount * 0.9 && consecutiveEmptyBatches < 3 && keyManager.hasNextKey()) {
          console.warn("Error encountered. Rotating key and retrying...");
          keyManager.rotate();
          consecutiveEmptyBatches++;
          continue;
        }
        // If we are here, it means even rotation failed or other error. Stop.
        keepFetching = false;
      }
    }

    // === DOUBLE-CHECK MODE: Verify extraction completeness ===
    if (expectedCount > 0 && allQuestions.length < expectedCount * 0.9) {
      console.log(`\n🔍 DOUBLE-CHECK MODE: Thiếu ${expectedCount - allQuestions.length} câu (có ${allQuestions.length}/${expectedCount})`);

      if (onProgress) onProgress(`Đang kiểm tra lại... (có ${allQuestions.length}/${expectedCount} câu)`, allQuestions.length);

      // Extract question numbers we already have
      const extractedNumbers = new Set<number>();
      allQuestions.forEach(q => {
        const num = extractQuestionNumber(q.question);
        if (num !== null) extractedNumbers.add(num);
      });

      // Find gaps in the sequence
      const maxNumber = Math.max(...Array.from(extractedNumbers), expectedCount);
      const missingNumbers: number[] = [];
      for (let i = 1; i <= maxNumber; i++) {
        if (!extractedNumbers.has(i)) missingNumbers.push(i);
      }

      if (missingNumbers.length > 0) {
        console.log(`📋 Các câu có thể bị thiếu: ${missingNumbers.slice(0, 20).join(', ')}${missingNumbers.length > 20 ? '...' : ''}`);

        // Second pass: specifically request missing questions
        const missingRanges = missingNumbers.slice(0, 30).join(', ');
        const secondPassPrompt = `TÌM CÂU HỎI BỊ THIẾU:
Hãy tìm và trích xuất CÁC CÂU HỎI sau đây trong tài liệu: Câu ${missingRanges}

⚠️ CHỈ trích xuất những câu hỏi có SỐ THỨ TỰ trong danh sách trên.
Nếu không tìm thấy câu nào, trả về mảng rỗng [].`;

        await new Promise(resolve => setTimeout(resolve, 4000));

        try {
          const secondPassText = await executeWithRotation(async (apiKey) => {
            const ai = new GoogleGenAI({ apiKey });
            const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_EXTRACT, questionSchema));
            const response = await chat.sendMessage({
              message: [...parts, { text: secondPassPrompt }]
            });
            return response.text;
          });

          if (secondPassText) {
            const secondParsed = JSON.parse(extractJson(secondPassText)) as GeneratedResponse;
            const secondPassQs = secondParsed.questions || [];

            // Add only non-duplicates from second pass
            let addedFromSecondPass = 0;
            for (const q of secondPassQs) {
              const result = checkDuplicate(q.question, allQuestions);
              if (!result.isDup) {
                allQuestions.push(q);
                addedFromSecondPass++;
              }
            }

            if (addedFromSecondPass > 0) {
              console.log(`✅ Double-check: Tìm thêm được ${addedFromSecondPass} câu. Tổng: ${allQuestions.length}`);
            }
          }
        } catch (e) {
          console.warn("Double-check pass failed:", e);
        }
      }
    }

    // Final summary
    console.log(`\n📊 KẾT QUẢ CUỐI CÙNG: ${allQuestions.length} câu hỏi (mục tiêu: ${expectedCount || 'không xác định'})`);
    if (allDuplicates.length > 0) {
      console.log(`🔄 Tổng số câu bị loại do trùng lặp: ${allDuplicates.length}`);
    }

    return { questions: allQuestions, duplicates: allDuplicates };
  } catch (error: any) {
    throw new Error(error.message);
  }
};

export const analyzeDocument = async (files: UploadedFile[]): Promise<AnalysisResult> => {
  let attempts = 0;
  const MaxAttempts = 3;

  while (attempts < MaxAttempts) {
    try {
      // We don't use executeWithRotation wrapper here because we want manual control over rotation
      // based on LOGICAL failures (bad content), not just HTTP 429.
      // However, we still want to catch 429.
      // Let's use a try-catch block similar to generateQuestions loop logic.

      const apiKey = keyManager.getKey();
      const ai = new GoogleGenAI({ apiKey });

      const parts: any[] = files.map(file => {
        if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
          return { inlineData: { mimeType: file.type, data: file.content } };
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

      const chat = ai.chats.create(getModelConfig(apiKey, "Phân tích số câu hỏi trắc nghiệm trong tài liệu Y khoa.", schema));
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
        keyManager.rotate();
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Analysis failed after multiple attempts");
};

export const auditMissingQuestions = async (files: UploadedFile[], count: number): Promise<AuditResult> => {
  return await executeWithRotation(async (apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content } };
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

    const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_AUDIT, schema));
    const res = await chat.sendMessage({
      message: [
        ...parts,
        { text: `Quá trình trích xuất chỉ lấy được ${count} câu hỏi. Hãy so sánh với toàn bộ tài liệu và báo cáo tại sao có sự thiếu hụt này. Chỉ ra chính xác chương hoặc trang gặp khó khăn nếu có thể.` }
      ]
    });

    return JSON.parse(extractJson(res.text)) as AuditResult;
  });
};
