import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedResponse, UploadedFile, ProgressCallback, AnalysisResult, AuditResult, BatchCallback, AppSettings } from "../types";

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
// --- User Key Management ---

class UserKeyRotator {
  private keys: string[] = [];
  private currentIndex: number = 0;

  constructor() { }

  init(apiKeyString: string) {
    if (!apiKeyString) {
      this.keys = [];
      return;
    }
    // Robust splitting: commas, semicolons, newlines, or even spaces if user forgot commas
    // Try standard delimiters first
    let parts = apiKeyString.split(/[,;\n]+/);

    this.keys = parts.map(k => k.trim()).filter(k => k.length > 10); // keys are usually long
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

// Wrapper for API calls with Rotation support
async function executeWithUserRotation<T>(
  operation: (apiKey: string) => Promise<T>
): Promise<T> {
  const MAX_RETRIES_PER_KEY = 2;
  const ATTEMPTS_LIMIT = 10; // Global safety limit
  let attempts = 0;

  while (attempts < ATTEMPTS_LIMIT) {
    attempts++;
    const currentKey = userKeyRotator.getCurrentKey();

    try {
      // console.log(`Attempting with Key #${userKeyRotator.getKeyIndex() + 1}...`);
      return await operation(currentKey);
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const isRateLimit = msg.includes("429") || msg.includes("quota exceeded") || msg.includes("resource exhausted");
      const isKeyError = msg.includes("api key") && (msg.includes("invalid") || msg.includes("not found") || msg.includes("expired"));

      if (isRateLimit || isKeyError) {
        const reason = isRateLimit ? "Rate Limit (429)" : "Invalid/Expired Key";
        console.warn(`⚠️ ${reason} on Key #${userKeyRotator.getKeyIndex() + 1}. Rotating...`);

        userKeyRotator.rotate();

        // Simple backoff
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // If it's another error (e.g. 500 or unknown), we might want to retry ONCE on the same key 
      // or rotate if we have many keys? 
      // For now, let's treat unknown errors as fatal unless we want to be very aggressive.
      // But users often get "Overloaded" (503) which might be temporary.
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
    // 1. Initialize Client with Dynamic Key
    // 1. Initialize Rotator
    userKeyRotator.init(settings.apiKey);

    // Validate immediatley
    // This will throw if empty
    userKeyRotator.getCurrentKey();

    // Initialize parts from files
    const parts: any[] = files.map(file => {
      // Handle images/PDFs (base64)
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        // If content is already base64 (data:image/...), split it.
        // If it's raw text, this might be wrong for PDF. Assuming file.content is base64 for binary types.
        const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
        return {
          inlineData: {
            mimeType: file.type,
            data: base64Data
          }
        };
      }
      // Handle Text Files
      else {
        return { text: `FILE: ${file.name}\n${file.content}\n` };
      }
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

      // Better prompt with Smart Anchoring
      const lastQ = allQuestions.length > 0 ? allQuestions[allQuestions.length - 1] : null;
      const lastQuestionSnippet = lastQ?.question.substring(0, 80) || '';
      const lastNum = lastQ ? extractQuestionNumber(lastQ.question) : null;

      const anchor = lastNum
        ? `Câu số ${lastNum} (hoặc Question ${lastNum})`
        : `câu hỏi có nội dung "${lastQuestionSnippet}..."`;

      let promptText = allQuestions.length === 0
        ? "BẮT ĐẦU: Lấy 50 câu hỏi ĐẦU TIÊN trong tài liệu. Trích xuất đầy đủ A, B, C, D, E nếu có."
        : `TIẾP TỤC từ vị trí SAU ${anchor}.
  ⚠️ Nhiệm vụ:
  - Tìm và trích xuất các câu hỏi TIẾP THEO ngay sau vị trí trên.
  - Nếu câu hỏi tiếp theo bị ngắt quãng, hãy tự động ghép nối.`;

      const instructionNote = `
  ⚠️ QUY TẮC BẮT BUỘC:
  - KHÔNG được lặp lại câu hỏi cũ.
  - Chỉ lấy 50 câu hỏi TIẾP THEO.
  - Nếu đã hết câu hỏi mới, trả về mảng rỗng [].`;

      promptText += "\n" + instructionNote;

      if (onProgress) onProgress(`Đang quét đợt ${loopCount}... (Có ${currentCount} câu)...`, currentCount);

      // RATE LIMITING: Maintain the 4s delay as a baseline courtesy
      await new Promise(resolve => setTimeout(resolve, 4000));

      try {
        // WRAPPED API CALL
        const text = await executeWithUserRotation(async (apiKey) => {
          const ai = new GoogleGenAI({ apiKey });
          const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_EXTRACT, questionSchema, settings.model));
          const response = await chat.sendMessage({
            // Always send parts + prompt. This treats each request as standalone but with full context.
            message: [...parts, { text: promptText }]
          });
          return response.text;
        });

        if (!text) {
          // Empty response handling
          if (expectedCount > 0 && currentCount < expectedCount * 0.9 && consecutiveEmptyBatches < 3) {
            console.warn("Empty response. Retrying...");
            consecutiveEmptyBatches++;
            continue;
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

          if (expectedCount > 0 && currentCount < expectedCount * 0.9 && consecutiveEmptyBatches < 3) {
            console.warn(`Got 0 new questions but target not reached (${currentCount}/${expectedCount}). Retrying...`);
            continue; // Retry loop
          }
          keepFetching = false;
        } else {
          allQuestions = [...allQuestions, ...newQs];

          // STREAMING: Notify new questions immediately
          if (onBatchComplete && newQs.length > 0) {
            onBatchComplete(newQs);
          }

          consecutiveEmptyBatches = 0; // Reset counter on success
          console.log(`Added ${newQs.length} unique questions. Total: ${allQuestions.length}`);
        }
      } catch (e: any) {
        console.error("Extraction loop error:", e);
        // If we error out, also try rotating if we haven't reached target?
        if (expectedCount > 0 && currentCount < expectedCount * 0.9 && consecutiveEmptyBatches < 3) {
          console.warn("Error encountered. Retrying...");
          consecutiveEmptyBatches++;
          continue;
        }
        // If we are here, it means even rotation failed or other error. Stop.
        keepFetching = false;
      }
    }

    // === AGGRESSIVE GAP FILLING LOOP ===
    // Loop up to 3 times to find missing questions
    let gapFillAttempts = 0;
    while (gapFillAttempts < 3) {
      gapFillAttempts++;
      console.log(`\n🔍 GAP FILLING ATTEMPT ${gapFillAttempts}/3...`);

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

      if (missingNumbers.length === 0) break; // No gaps found

      console.log(`📋 Các câu bị thiếu (Attempt ${gapFillAttempts}): ${missingNumbers.slice(0, 20).join(', ')}${missingNumbers.length > 20 ? '...' : ''}`);
      if (onProgress) onProgress(`Đang soát lại lần ${gapFillAttempts}: Tìm câu ${missingNumbers.slice(0, 5).join(', ')}...`, allQuestions.length);

      // Request missing questions
      const missingRanges = missingNumbers.slice(0, 30).join(', ');
      const gapPrompt = `TÌM KIẾM MỤC TIÊU (LẦN ${gapFillAttempts}):
  Hãy tìm và trích xuất chính xác các câu hỏi có số thứ tự sau: ${missingRanges}
  
  ⚠️ QUY TẮC:
  - Chỉ trích xuất đúng các câu hỏi thiếu này.
  - Nếu văn bản chỗ đó bị bẩn/mờ, hãy dùng chế độ KHÔI PHỤC để đọc.
  - Nếu không tìm thấy, tuyệt đối KHÔNG BỊA ĐẶT.`;

      await new Promise(resolve => setTimeout(resolve, 4000));

      try {
        const gapText = await executeWithUserRotation(async (apiKey) => {
          const ai = new GoogleGenAI({ apiKey });
          const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_EXTRACT, questionSchema, settings.model));
          const response = await chat.sendMessage({
            message: [...parts, { text: gapPrompt }]
          });
          return response.text;
        });

        if (gapText) {
          const gapParsed = JSON.parse(extractJson(gapText)) as GeneratedResponse;
          const gapQs = gapParsed.questions || [];
          let addedCount = 0;

          for (const q of gapQs) {
            const result = checkDuplicate(q.question, allQuestions);
            if (!result.isDup) {
              allQuestions.push(q);
              addedCount++;
              if (onBatchComplete) onBatchComplete([q]);
            }
          }

          if (addedCount > 0) {
            console.log(`✅ Gap Fill: Tìm thêm được ${addedCount} câu.`);
          } else {
            console.log("⚠️ Gap Fill: Không tìm thấy thêm câu nào mới.");
          }
        }
      } catch (e) {
        console.warn("Gap fill attempt failed:", e);
      }
    }

    // Final Sort: Ensure questions are in numerical order (since Gap Filling might add them out of order)
    allQuestions.sort((a, b) => {
      const numA = extractQuestionNumber(a.question) || 999999;
      const numB = extractQuestionNumber(b.question) || 999999;
      return numA - numB;
    });

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

export const analyzeDocument = async (files: UploadedFile[], settings: AppSettings): Promise<AnalysisResult> => {
  let attempts = 0;
  const MaxAttempts = 3;

  // Manual Rotation Logic for Analysis
  userKeyRotator.init(settings.apiKey);

  while (attempts < MaxAttempts) {
    try {
      const apiKey = userKeyRotator.getCurrentKey();

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
