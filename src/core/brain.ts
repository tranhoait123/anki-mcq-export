import { PDFDocument } from 'pdf-lib';
import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedResponse, UploadedFile, ProgressCallback, AnalysisResult, AuditResult, BatchCallback, AppSettings, MCQ, DuplicateInfo } from "../types";
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

// --- User-Friendly Error Translator ---
// Nguyên tắc: "Chuyện gì xảy ra? Tại sao? Người dùng cần làm gì?"
export const translateErrorForUser = (error: any, context?: string): string => {
  const msg = error?.message || String(error) || "";
  const msgLow = msg.toLowerCase();
  const statusCode = error?.status || error?.statusCode || 0;
  const prefix = context ? `[${context}] ` : "";

  // --- API Key & Authentication ---
  if (statusCode === 403 || msgLow.includes("403") || msgLow.includes("permission denied") || msgLow.includes("forbidden")) {
    return `${prefix}🔑 API Key không có quyền truy cập. Hãy kiểm tra: Key đã bật Gemini API chưa? Key có bị vô hiệu hóa không? (Mã lỗi: 403)`;
  }
  if ((msgLow.includes("api key") || msgLow.includes("api_key")) && (msgLow.includes("invalid") || msgLow.includes("not found") || msgLow.includes("expired"))) {
    return `${prefix}🔑 API Key không hợp lệ hoặc đã hết hạn. Vui lòng vào Cài đặt → kiểm tra lại API Key.`;
  }
  if (msgLow.includes("401") || msgLow.includes("unauthenticated") || statusCode === 401) {
    return `${prefix}🔑 Xác thực thất bại. Vui lòng kiểm tra API Key trong phần Cài đặt.`;
  }

  // --- Rate Limiting ---
  if (statusCode === 429 || msgLow.includes("429") || msgLow.includes("quota") || msgLow.includes("resource_exhausted") || msgLow.includes("exhausted")) {
    return `${prefix}⏳ Hệ thống đang nhận quá nhiều yêu cầu (hết hạn mức). Vui lòng chờ 1-2 phút rồi thử lại. Nếu lỗi tiếp tục, hãy thêm nhiều API Key trong Cài đặt.`;
  }

  // --- Server Overload ---
  if (statusCode === 503 || msgLow.includes("503") || msgLow.includes("unavailable") || msgLow.includes("overloaded")) {
    return `${prefix}🔄 Server AI đang quá tải tạm thời. Hệ thống sẽ tự động thử lại. Nếu lỗi kéo dài, vui lòng chờ 2-3 phút.`;
  }
  if (statusCode === 500 || msgLow.includes("500") || msgLow.includes("internal")) {
    return `${prefix}⚠️ Lỗi phía server AI (lỗi nội bộ). Vui lòng thử lại sau ít phút.`;
  }
  if (msgLow.includes("deadline") || msgLow.includes("504") || statusCode === 504) {
    return `${prefix}⏱️ Yêu cầu quá thời gian chờ. Tài liệu có thể quá dài — hãy thử chia nhỏ file hoặc giảm số trang.`;
  }

  // --- Network ---
  if (msgLow.includes("failed to fetch") || msgLow.includes("networkerror") || msgLow.includes("net::")) {
    return `${prefix}🌐 Mất kết nối mạng. Hãy kiểm tra WiFi/Internet rồi thử lại.`;
  }
  if (msgLow.includes("timeout") || msgLow.includes("econnreset") || msgLow.includes("econnrefused")) {
    return `${prefix}🌐 Kết nối bị gián đoạn (timeout). Hãy kiểm tra mạng và thử lại.`;
  }
  if (msgLow.includes("cors")) {
    return `${prefix}🌐 Lỗi kết nối CORS. Vui lòng thử tải lại trang (F5).`;
  }

  // --- AI Format / Content ---
  if (msgLow.includes("ai_format_error") || msgLow.includes("json") && msgLow.includes("định dạng")) {
    return `${prefix}📄 AI trả về dữ liệu không đúng định dạng (tài liệu quá dài). Hệ thống sẽ tự chia nhỏ và thử lại.`;
  }
  if (msgLow.includes("safety") || msgLow.includes("blocked") || msgLow.includes("content filter")) {
    return `${prefix}🛡️ Nội dung bị chặn bởi bộ lọc an toàn AI. Hãy thử với tài liệu khác hoặc kiểm tra nội dung.`;
  }
  if (msgLow.includes("too large") || msgLow.includes("payload") || msgLow.includes("413") || statusCode === 413) {
    return `${prefix}📦 File quá lớn để xử lý. Vui lòng nén file hoặc chia nhỏ (dưới 20MB/file).`;
  }
  if (msgLow.includes("không tìm thấy câu hỏi") || msgLow.includes("không tìm thấy văn bản")) {
    return `${prefix}📄 Không tìm thấy câu hỏi trắc nghiệm trong tài liệu. Hãy kiểm tra file đúng chưa (cần file có nội dung MCQ).`;
  }

  // --- OpenRouter Specific ---
  if (msgLow.includes("openrouter api error")) {
    const code = msg.match(/:\s*(\d+)/)?.[1] || "?";
    const orMsgs: Record<string, string> = {
      "400": "Dữ liệu gửi lên sai định dạng (Mã 400).",
      "401": "API Key OpenRouter không hợp lệ. Kiểm tra lại Key (Mã 401).",
      "402": "Tài khoản OpenRouter hết số dư. Vui lòng nạp thêm (Mã 402).",
      "403": "API Key OpenRouter bị giới hạn hoặc chặn nội dung. Cảnh báo an toàn (Mã 403).",
      "429": "OpenRouter hoặc AI model này đang bị giới hạn tốc độ. Chờ 1-2 phút (Mã 429).",
      "500": "Đứt kết nối tạm thời tới nhà cung cấp (Mã 500).",
      "502": "Lỗi kết nối từ OpenRouter tới AI Model đang chọn (Mã 502).",
      "503": "Nhà cung cấp quá tải. Thử chọn model khác trên OpenRouter (Mã 503).",
    };
    return `${prefix}🤖 Lỗi OpenRouter: ${orMsgs[code] || `Máy chủ phản hồi mã ${code}. Vui lòng thử lại sau.`}`;
  }

  // --- ShopAIKey Specific ---
  if (msgLow.includes("shopaikey api error")) {
    const code = msg.match(/:\s*(\d+)/)?.[1] || "?";
    const shopMsgs: Record<string, string> = {
      "400": "Dữ liệu gửi lên bị từ chối do sai định dạng (Mã 400).",
      "401": "API Key ShopAIKey không hợp lệ. Kiểm tra lại Key (Mã 401).",
      "402": "Tài khoản ShopAIKey hết số dư. Vui lòng nạp thêm (Mã 402).",
      "403": "API Key ShopAIKey không có quyền truy cập. Kiểm tra Key (Mã 403).",
      "429": "ShopAIKey quá tải. Chờ 1-2 phút rồi thử lại (Mã 429).",
      "500": "Server ShopAIKey đang gặp sự cố nội bộ. Thử lại sau (Mã 500).",
      "503": "Server ShopAIKey quá tải tạm thời. Thử lại sau (Mã 503).",
    };
    return `${prefix}🤖 Lỗi ShopAIKey: ${shopMsgs[code] || `Server phản hồi mã ${code}. Vui lòng thử lại sau.`}`;
  }

  // --- PDF / File Processing ---
  if (msgLow.includes("pdf") && (msgLow.includes("lỗi") || msgLow.includes("error"))) {
    return `${prefix}📄 Lỗi đọc file PDF. File có thể bị hỏng hoặc được bảo vệ bằng mật khẩu. Hãy thử chuyển sang ảnh rồi tải lại.`;
  }
  if (msgLow.includes("ocr failed")) {
    return `${prefix}📷 Nhận dạng chữ từ ảnh thất bại. Ảnh có thể quá mờ hoặc không chứa văn bản. Thử với ảnh có độ phân giải cao hơn.`;
  }

  // --- All API Keys Failed ---
  if (msgLow.includes("tất cả") && msgLow.includes("keys") && msgLow.includes("lỗi")) {
    return msg; // Đã là message rõ ràng rồi
  }
  if (msgLow.includes("đã thử luân phiên") || msgLow.includes("quá tải")) {
    return msg; // Đã là message rõ ràng rồi  
  }

  // --- Fallback: Return original message if already Vietnamese/clear ---
  if (msg.startsWith("🔑") || msg.startsWith("⏳") || msg.startsWith("🔄") || msg.startsWith("📄") || msg.startsWith("🌐")) {
    return msg; // Đã có emoji prefix → message rõ ràng
  }

  // --- Last resort: wrap unknown error ---
  const shortMsg = msg.length > 120 ? msg.substring(0, 120) + "..." : msg;
  return `${prefix}❌ Đã xảy ra lỗi không mong muốn: ${shortMsg}. Vui lòng thử lại hoặc liên hệ hỗ trợ.`;
};

// --- High-Level Execution Wrappers ---

async function executeWithRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const isFormatError = msg.includes("format") || msg.includes("json");
      const isServerBusy = msg.includes("503") || msg.includes("overloaded") || msg.includes("429");

      if (isFormatError || isServerBusy) {
        const attempt = i + 1;
        // Fast-fail cho lỗi định dạng ngay trong lượt quét đầu tiên
        if (isFormatError && attempt >= 2) {
          console.warn(`🚀 Standard Mode: Format error detected. Failing early to allow Advanced Retry...`);
          throw new Error("Lỗi định dạng AI (Lượt đầu). Vui lòng dùng tính năng Quét lại để chia nhỏ tài liệu.");
        }

        console.warn(`⚠️ ${isFormatError ? 'Lỗi định dạng' : 'API Busy'} (Lượt đầu - Lần thử ${attempt}/${retries}). Retrying...`);
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
  throw new Error("🔄 Dịch vụ AI đang bận hoặc phản hồi sai định dạng sau nhiều lần thử. Vui lòng chờ 1-2 phút rồi thử lại, hoặc dùng nút 'Quét lại' để chia nhỏ tài liệu.");
}

// Helper: Cache Management
// Session-level flag: Khi 1 key fail caching (Free Tier / 429 / 403), tất cả key khác
// trong cùng session rất có thể cũng là Free Tier → skip luôn để tiết kiệm thời gian.
let cachingDisabledForSession = false;
let cachingFailureCount = 0;
const CACHING_FAIL_THRESHOLD = 2; // Sau 2 lần fail liên tiếp → disable cho cả session

const getOrSetContextCache = async (ai: any, files: UploadedFile[], modelName: string, systemInstruction: string, apiKey: string): Promise<string | null> => {
  // Fast-skip: Nếu session đã xác nhận Free Tier, không thử caching nữa
  if (cachingDisabledForSession) {
    return null;
  }

  try {
    const fileHash = await hashFiles(files);
    const keyHash = hashApiKey(apiKey);
    const instrHash = systemInstruction.length.toString(); // Simple length-based check to trigger refresh
    const cacheId = `${fileHash}_${modelName}_${keyHash}_${instrHash}`;
    const existing = await db.getCache(cacheId);

    // If existing and not expired, return it
    if (existing && existing.expiresAt > Date.now()) {
      console.log(`🎯 Cache Hit (Key: ${keyHash}): ${existing.cacheName}`);
      cachingFailureCount = 0; // Reset failure count on success
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
    cachingFailureCount = 0; // Reset on success
    return cache.name;
  } catch (err: any) {
    const msg = err.message?.toLowerCase() || "";
    cachingFailureCount++;

    const isFreeTierError = msg.includes("limit exceeded") || msg.includes("429") || msg.includes("resource exhausted");
    const isPermissionError = msg.includes("403") || msg.includes("permission denied") || msg.includes("suspended");

    if (isFreeTierError || isPermissionError) {
      console.log(`ℹ️ Context Caching failed (${isPermissionError ? '403/Suspended' : 'Free Tier/429'}). Failure count: ${cachingFailureCount}/${CACHING_FAIL_THRESHOLD}`);
      if (cachingFailureCount >= CACHING_FAIL_THRESHOLD) {
        cachingDisabledForSession = true;
        console.log(`🚫 Context Caching DISABLED for this session (${cachingFailureCount} consecutive failures). All keys appear to be Free Tier. Skipping caching for remaining batches.`);
      }
    } else {
      console.warn("⚠️ Context Caching failed:", err);
    }
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
      + Đây là quy tắc **QUAN TRỌNG NHẤT**: Khi một tình huống lâm sàng dùng chung cho nhiều câu hỏi (VD: "Dữ kiện sau cho câu 10, 11, 12"):
      + **BẮT BUỘC (MANDATORY)**: Chép lại NGUYÊN VĂN (Word-by-word) đoạn dẫn tình huống vào trường "question" của **TỪNG** câu hỏi thành phần.
      + **TUYỆT ĐỐI CẤM**: Không được dùng tham chiếu ngắn gọn như "Như trên...", "Câu hỏi tiếp theo...". Mỗi thẻ Anki phải đứng độc lập.
      + **CẤU TRÚC BẮT BUỘC**: 
        [TÌNH HUỐNG LÂM SÀNG]
        {Nội dung tình huống nguyên văn}
        
        [CÂU HỎI THEO TÌNH HUỐNG]
        {Câu hỏi riêng lẻ}

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

🎯 **CHỈ THỊ CUỐI CÙNG (FINAL COMMAND - QUAN TRỌNG)**:
- **TRƯỜNG HỢP KHÔNG CÓ CÂU HỎI**: Nếu đoạn văn được cung cấp hoàn toàn KHÔNG chứa câu hỏi trắc nghiệm nào, hãy trả về chính xác: {"questions": []}. Tuyệt đối không được giải thích, xin lỗi hay phản hồi bằng văn bản thường.
- CHỈ trả về duy nhất một đối tượng JSON có khóa "questions". KHÔNG được có bất kỳ văn bản giải thích nào trước hoặc sau khối JSON.
- ĐÂY LÀ GIỚI HẠN TÀI NGUYÊN: Nếu bạn sắp hết không gian trả về (Tokens), hãy kết thúc khối JSON hiện tại một cách sạch sẽ (đóng đầy đủ ngoặc } và ]) thay vì để nó bị cắt cụt giữa chừng.
- Đảm bảo tính nhất quán của cấu trúc: Mọi câu hỏi phải có đầy đủ các trường (question, options, correctAnswer, explanation, source, difficulty, depthAnalysis).
- KHÔNG sử dụng các phương thức định dạng lạ khác ngoài chuẩn JSON.

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

const SYSTEM_INSTRUCTION_ANALYZE = `
Bạn là Chuyên gia Phân tích Tài liệu Y khoa.
Nhiệm vụ: Ước tính tổng số câu hỏi trắc nghiệm có trong tài liệu này.
- Chỉ đếm các câu hỏi có đầy đủ nội dung hoặc có thể suy luận được.
- Phân tích sơ bộ chuyên khoa.
- Trả về JSON theo đúng schema yêu cầu.
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
  private failedKeys: Set<string> = new Set(); // Track permanently failed keys (403/invalid)
  private batchKeyCounter: number = 0; // For round-robin per-batch key distribution

  constructor() { }

  init(apiKeyString: string) {
    if (!apiKeyString || typeof apiKeyString !== 'string') {
      this.keys = [];
      return;
    }
    // Hỗ trợ dấu phẩy, dấu chấm phẩy, hoặc xuống dòng
    let parts = apiKeyString.split(/[,;\n\r]+/);
    this.keys = parts.map(k => k.trim()).filter(k => k.length > 5);
    this.currentIndex = 0;
    this.failedKeys.clear(); // Reset failed keys khi init lại session
    this.batchKeyCounter = 0;
    console.log(`🔑 Loaded ${this.keys.length} API Keys.`);
  }

  getCurrentKey(): string {
    if (this.keys.length === 0) {
      return ""; // Trả về chuỗi rỗng, để logic operation xử lý hoặc validation UI đã kiểm tra
    }
    return this.keys[this.currentIndex];
  }

  rotate(): string {
    if (this.keys.length <= 1) return this.getCurrentKey();
    
    // Tìm key tiếp theo chưa bị đánh dấu failed
    let attempts = 0;
    do {
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      attempts++;
      // Nếu đã duyệt hết vòng mà tất cả đều failed, reset và chọn random
      if (attempts >= this.keys.length) {
        console.warn(`⚠️ All ${this.keys.length} keys have been marked as failed. Resetting failed list...`);
        this.failedKeys.clear();
        // Chọn random key thay vì key kế tiếp (tránh chọn key vừa mới failed)
        this.currentIndex = Math.floor(Math.random() * this.keys.length);
        break;
      }
    } while (this.failedKeys.has(this.keys[this.currentIndex]));
    
    console.log(`🔄 Rotating to API Key #${this.currentIndex + 1}/${this.keys.length}`);
    return this.keys[this.currentIndex];
  }

  // Đánh dấu key bị lỗi vĩnh viễn (403 Permission Denied, Invalid Key)
  markKeyFailed(key: string): void {
    this.failedKeys.add(key);
    console.warn(`🚫 API Key #${this.keys.indexOf(key) + 1} marked as FAILED (403/Invalid). ${this.availableKeyCount} keys remaining.`);
  }

  // Lấy key theo round-robin cho mỗi batch (tránh thundering herd)
  getKeyForBatch(): string {
    if (this.keys.length === 0) return "";
    const availableKeys = this.keys.filter(k => !this.failedKeys.has(k));
    if (availableKeys.length === 0) {
      // Nếu tất cả đều failed, reset và dùng lại
      this.failedKeys.clear();
      this.batchKeyCounter = this.batchKeyCounter % this.keys.length; // Prevent overflow
      return this.keys[this.batchKeyCounter++ % this.keys.length];
    }
    this.batchKeyCounter = this.batchKeyCounter % availableKeys.length; // Prevent overflow
    return availableKeys[this.batchKeyCounter++ % availableKeys.length];
  }

  get keyCount(): number {
    return this.keys.length;
  }

  get availableKeyCount(): number {
    return this.keys.filter(k => !this.failedKeys.has(k)).length;
  }

  getKeyIndex(): number {
    return this.currentIndex;
  }
}

const userKeyRotator = new UserKeyRotator();

// --- Helpers ---

const extractJson = (text: string): string => {
  if (!text) return "";

  // 1. Xử lý khối mã Markdown: ```json ... ``` hoặc ``` ... ```
  let cleanText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanText = codeBlockMatch[1];
  }

  // 2. Tìm điểm bắt đầu thực sự của JSON
  const start = cleanText.indexOf('{');
  const aStart = cleanText.indexOf('[');

  // Ưu tiên cái nào xuất hiện trước
  let actualStart = -1;
  if (start !== -1 && aStart !== -1) actualStart = Math.min(start, aStart);
  else actualStart = start !== -1 ? start : aStart;

  if (actualStart === -1) return cleanText.trim();

  // 3. Tìm điểm kết thúc và cố gắng "vá" nếu AI cắt cụt (Unbalanced Braces)
  let subText = cleanText.substring(actualStart);
  let braceCount = 0;
  let bracketCount = 0;
  let lastValidEnd = -1;

  for (let i = 0; i < subText.length; i++) {
    const char = subText[i];
    if (char === '{') braceCount++;
    else if (char === '}') braceCount--;
    else if (char === '[') bracketCount++;
    else if (char === ']') bracketCount--;

    if (braceCount === 0 && bracketCount === 0) {
      lastValidEnd = i;
    }
  }

  if (lastValidEnd !== -1) {
    return subText.substring(0, lastValidEnd + 1);
  }

  // --- Cải tiến 2026: Auto-repair cho JSON bị cắt cụt ---
  const lastBrace = subText.lastIndexOf('}');
  const lastBracket = subText.lastIndexOf(']');
  const actualEnd = Math.max(lastBrace, lastBracket);

  if (actualEnd !== -1) {
    let result = subText.substring(0, actualEnd + 1);

    // Nếu AI cắt cụt giữa chừng một mảng câu hỏi
    // Chúng ta đóng các ngoặc còn thiếu để JSON.parse không bị lỗi hoàn toàn
    let tempBrace = braceCount;
    let tempBracket = bracketCount;

    // Cố gắng đóng mảng/object lớn nhất có thể
    while (tempBrace > 0) { result += '}'; tempBrace--; }
    while (tempBracket > 0) { result += ']'; tempBracket--; }

    try {
      JSON.parse(result);
      return result;
    } catch (e) {
      // Nếu vẫn lỗi, thử lùi lại đến dấu ngăn cách gần nhất
      const lastComma = result.lastIndexOf(',');
      if (lastComma !== -1) {
        let fixed = result.substring(0, lastComma);
        // Re-closing logic
        let rb = 0, rbr = 0;
        for (const c of fixed) {
          if (c === '{') rb++; else if (c === '}') rb--;
          if (c === '[') rbr++; else if (c === ']') rbr--;
        }
        while (rb > 0) { fixed += '}'; rb--; }
        while (rbr > 0) { fixed += ']'; rbr--; }
        return fixed + ']'; // Giả định là mảng
      }
    }
    return result;
  }

  return subText.trim();
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
  const Q_THRESHOLD = 0.90; // Ngưỡng câu hỏi (linh hoạt hơn)
  const OPT_THRESHOLD = 0.90; // Phải trùng cả đáp án để đảm bảo an toàn

  const newNumber = extractQuestionNumber(newQ.question);
  const newText = newQ.question;
  const newOpts = (newQ.options || []).join(' ');

  for (const existing of existingQuestions) {
    const existingNumber = extractQuestionNumber(existing.question);
    const qSim = calculateSimilarity(newText, existing.question);
    const optSim = calculateSimilarity(newOpts, (existing.options || []).join(' '));

    // Trường hợp 1: Trùng số câu hỏi (Câu 1, Câu 1...)
    if (newNumber !== null && existingNumber !== null && newNumber === existingNumber) {
      if (qSim >= 0.85 && optSim >= 0.85) {
        return {
          isDup: true,
          reason: `Trùng số (${newNumber}) & Nội dung tương đồng`,
          matchedWith: existing.question.substring(0, 60),
          matchedData: existing
        };
      }
    }

    // Trường hợp 2: Kiểm tra kết hợp Câu hỏi + Đáp án
    // Chỉ coi là trùng nếu CẢ câu hỏi và bộ đáp án đều giống nhau trên 90%
    if (qSim >= Q_THRESHOLD && optSim >= OPT_THRESHOLD) {
      return {
        isDup: true,
        reason: `Nội dung & Đáp án tương đồng cao (~${Math.round(qSim * 100)}%)`,
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
  initialModel: string,
  operation: (apiKey: string, modelName: string) => Promise<T>,
  startingKey?: string // Cho phép chỉ định key khởi đầu (per-batch distribution)
): Promise<T> {
  const ATTEMPTS_LIMIT = Math.max(8, userKeyRotator.keyCount + 3); // Đảm bảo thử hết tất cả key + buffer
  let attempts = 0;
  let distinctKeysTried = 0; // Đếm số key THỰC SỰ đã thử (thay vì so sánh index)
  let lastTriedKey = ''; // Track key trước đó để đếm chính xác
  let currentModel = initialModel;
  const FALLBACK_MODEL = 'gemini-2.5-flash';
  let currentKey = startingKey || userKeyRotator.getCurrentKey();

  while (attempts < ATTEMPTS_LIMIT) {
    attempts++;

    // Nếu sau 6 lần thử (hết khoảng 1/2 số Key trung bình) mà vẫn lỗi 503, 
    // ta tự động chuyển sang Model dự phòng ổn định hơn.
    if (attempts > 6 && currentModel !== FALLBACK_MODEL) {
      console.log(`🚀 Switching to STABLE FALLBACK MODEL: ${FALLBACK_MODEL}`);
      currentModel = FALLBACK_MODEL;
    }

    try {
      return await operation(currentKey, currentModel);
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const statusCode = error.status || error.statusCode || 0;
      
      // Mở rộng bộ lọc lỗi để nhận diện thêm các trường hợp đặc biệt của Google AI
      const isPermissionDenied = msg.includes("403") || msg.includes("permission denied") || msg.includes("forbidden") || statusCode === 403;
      const isRateLimit = msg.includes("429") || msg.includes("quota") || msg.includes("exhausted") || msg.includes("resource_exhausted") || msg.includes("timeout") || msg.includes("econnreset") || statusCode === 429;
      const isServerBusy = msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded") || msg.includes("deadline") || msg.includes("servicedown") || statusCode === 503;
      const isKeyError = (msg.includes("api key") || msg.includes("api_key")) && (msg.includes("invalid") || msg.includes("not found") || msg.includes("expired"));
      const isFormatError = msg.includes("json") || msg.includes("định dạng") || msg.includes("format") || msg.includes("unexpected token");

      if (isPermissionDenied || isRateLimit || isServerBusy || isKeyError || isFormatError) {
        // Fast-Failure logic: Nếu là lỗi định dạng (do AI bị đứt đoạn), chỉ thử lại tối đa 2 lần rồi cho chia nhỏ ngay.
        if (isFormatError && attempts >= 2) {
          console.warn(`🚀 Detection: JSON Format Error confirmed after ${attempts} attempts. Failing fast to trigger Subdivision...`);
          throw new Error("AI_FORMAT_ERROR_TRUNCATED");
        }

        // === CHIẾN LƯỢC XỬ LÝ LỖI THÔNG MINH ===
        
        // [A] 403 Permission Denied / Invalid Key: Đánh dấu key hỏng, xoay NGAY, KHÔNG delay
        if (isPermissionDenied || isKeyError) {
          console.warn(`🚫 403/Invalid Key detected! Key #${userKeyRotator.getKeyIndex() + 1} is broken. Rotating IMMEDIATELY...`);
          userKeyRotator.markKeyFailed(currentKey);
          if (userKeyRotator.availableKeyCount > 0) {
            currentKey = userKeyRotator.rotate();
            continue; // Retry ngay lập tức với key mới, KHÔNG delay
          } else {
            throw new Error(`Tất cả ${userKeyRotator.keyCount} API Keys đều bị lỗi 403 (Permission Denied). Vui lòng kiểm tra lại API Keys.`);
          }
        }

        // [B] 429 Rate Limit / 503 Server Busy: Xoay key + Exponential Backoff + Jitter
        const reason = isFormatError ? "Lỗi định dạng AI" : (isRateLimit ? "Hết hạn mức/Timeout (429)" : "Server quá tải (503)");
        console.warn(`⚠️ ${reason} (Lần thử ${attempts}/${ATTEMPTS_LIMIT}). Đang xoay vòng/thử lại...`);

        let backoffMs = 0;
        
        // Luôn xoay key nếu có nhiều hơn 1 key khả dụng
        if (userKeyRotator.availableKeyCount > 1) {
          currentKey = userKeyRotator.rotate();
          
          // Đếm số key thực sự đã thử (không dùng index comparison vì sẽ sai khi có key bị skip)
          if (currentKey !== lastTriedKey) {
            distinctKeysTried++;
            lastTriedKey = currentKey;
          }
          
          // Chỉ áp dụng Exponential Backoff khi đã thử hết tất cả key khả dụng ít nhất 1 vòng
          const availableCount = userKeyRotator.availableKeyCount;
          if (distinctKeysTried >= availableCount) {
            const cycles = Math.floor(distinctKeysTried / Math.max(1, availableCount));
            const baseDelay = isServerBusy ? 3500 : (isRateLimit ? 2500 : 2000);
            const multiplier = (isServerBusy || isFormatError) ? 1.8 : 1.5;
            const jitter = Math.random() * 2000 + 1000;
            backoffMs = Math.min(45000, baseDelay * Math.pow(multiplier, cycles) + jitter);
          } else {
            // Vừa xoay sang Key mới chưa thử: Chờ rất ngắn (0.5s - 1.5s) để tránh thundering herd,
            // nhưng không bị phạt thời gian như key cũ.
            backoffMs = Math.random() * 1000 + 500; 
          }
        } else {
          // Chỉ có 1 key: Áp dụng Exponential Backoff bình thường
          const baseDelay = isServerBusy ? 3500 : (isRateLimit ? 2500 : 2000);
          const multiplier = (isServerBusy || isFormatError) ? 1.8 : 1.5;
          const jitter = Math.random() * 3000 + 1000;
          backoffMs = Math.min(60000, baseDelay * Math.pow(multiplier, attempts - 1) + jitter);
        }
        
        console.log(`⏳ Backoff: ${Math.round(backoffMs / 1000)}s (Key #${userKeyRotator.getKeyIndex() + 1}/${userKeyRotator.keyCount}, Distinct tried: ${distinctKeysTried})`);
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
  onBatchComplete?: BatchCallback,
  retryIndices?: number[],
  isAdvancedMode: boolean = false
): Promise<{ questions: MCQ[], duplicates: DuplicateInfo[], failedBatches: number[] }> => {
  try {
    userKeyRotator.init(settings.apiKey);
    // Reset session-level caching flag cho mỗi phiên mới
    cachingDisabledForSession = false;
    cachingFailureCount = 0;
    // Note: Mỗi batch tự tạo GoogleGenAI instance riêng trong processBatch/executeWithUserRotation
    // Không cần tạo `ai` ở đây cho Google provider (dead code đã bị xóa)

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
      return { questions: [], duplicates: [], failedBatches: [] };
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
    let failedBatches: number[] = [];
    let duplicateCounter = 0;

    // --- STEP 2: BATCH PROCESSING ---
    let completedBatches = 0;
    const CONCURRENCY_LIMIT = settings.concurrencyLimit || 2;

    const extractAndParseQuestions = (text: string, batchIndex: number) => {
      let jsonStr = extractJson(text);
      if (!jsonStr) throw new Error("📄 AI không trả về dữ liệu đúng định dạng. Batch này sẽ được tự động chia nhỏ và thử lại.");

      try {
        // Cố gắng tự vá một số lỗi JSON phổ biến của AI trước khi parse
        // Vá lỗi thiếu dấu ngoặc đóng mảng/đối tượng
        if (jsonStr.trim().endsWith('}') && !jsonStr.includes(']')) {
          // Maybe it was supposed to be an array but it's an object?
        }

        // Loại bỏ dấu phẩy thừa ở cuối mảng trước dấu đóng ] hoặc }
        jsonStr = jsonStr.replace(/,\s*([\]\}])/g, '$1');

        const parsed = JSON.parse(jsonStr);
        const questions = Array.isArray(parsed) ? parsed : (parsed?.questions || []);
        if (questions.length === 0) throw new Error("📄 AI đã xử lý nhưng không tìm thấy câu hỏi trắc nghiệm nào trong phần này. Batch sẽ được chia nhỏ để quét kỹ hơn.");
        return questions;
      } catch (e) {
        console.error("JSON Parse Error info:", e, "Raw string:", jsonStr.substring(0, 100) + "...");
        throw new Error(`📄 Dữ liệu AI ở Phần ${batchIndex + 1} bị lỗi cấu trúc (JSON). Hệ thống đang tự động chia nhỏ và thử lại...`);
      }
    };

    const totalBatches = allParts.length;

    // Hàm xử lý Batch chính có khả năng Đệ quy (Subdivision)
    const processBatch = async (part: any, index: number, depth: number = 0) => {
      const batchLabel = depth === 0 ? `${index + 1}` : `${index + 1}${String.fromCharCode(96 + depth)}`;

      try {
        if (onProgress) onProgress(`Quét Batch ${batchLabel}/${totalBatches}${depth > 0 ? ' (Đang chia nhỏ)' : ''}...`, allQuestions.length);
        await new Promise(r => setTimeout(r, Math.random() * 800));

        // Per-batch key assignment: Mỗi batch nhận key riêng theo round-robin
        const batchStartingKey = settings.provider === 'google' ? userKeyRotator.getKeyForBatch() : '';

        const rawNewQs = await (settings.provider === 'shopaikey' || settings.provider === 'openrouter'
          ? executeWithUserRotation(
              isAdvancedMode ? 'gemini-2.5-flash' : settings.model,
              async (dummyKey, activeModel) => {
                  const finalInstruction = settings.customPrompt ? `${settings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}` : SYSTEM_INSTRUCTION_EXTRACT;
                  const messages = [
                    { role: "system", content: isAdvancedMode ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction },
                    { role: "user", content: [{ type: "text", text: `HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY. Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy (Phần ${batchLabel}).` }, ...(part.inlineData ? [{ type: "image_url", image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } }] : [{ type: "text", text: part.text }])] }
                  ];

                  const apiUrl = settings.provider === 'shopaikey' ? "https://api.shopaikey.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
                  const apiKey = settings.provider === 'shopaikey' ? settings.shopAIKeyKey : settings.openRouterKey;
                  const providerName = settings.provider === 'shopaikey' ? "ShopAIKey" : "OpenRouter";

                  const response = await fetch(apiUrl, {
                    method: "POST",
                    headers: { 
                      "Authorization": `Bearer ${apiKey}`, 
                      "HTTP-Referer": window.location.origin,
                      "X-Title": "MCQ AnkiGen Pro",
                      "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({ model: activeModel, messages, temperature: 0.1, response_format: { type: "json_object" } })
                  });
                  if (!response.ok) throw new Error(`${providerName} API Error: ${response.status}`); // translateErrorForUser sẽ dịch mã lỗi này
                  const data = await response.json();
                  return extractAndParseQuestions(data.choices[0].message.content, index);
              }
            )
          : executeWithUserRotation(
              isAdvancedMode ? 'gemini-2.5-flash' : settings.model,
              async (currentKey, activeModel) => {
                  const aiInstance = new GoogleGenAI({ apiKey: currentKey });
                  const finalInstruction = settings.customPrompt ? `${settings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}` : SYSTEM_INSTRUCTION_EXTRACT;
                  // Cache key bao gồm cả modelName để tránh dùng cache của model cũ khi fallback
                  const cacheSessionKey = `${hashApiKey(currentKey)}_${activeModel}`;
                  if (!sessionCache[cacheSessionKey]) {
                    sessionCache[cacheSessionKey] = (async () => {
                      try { return await getOrSetContextCache(aiInstance, files, activeModel, finalInstruction, currentKey); } catch (e) { return null; }
                    })();
                  }
                  const kCacheName = await sessionCache[cacheSessionKey];
                  const config = getModelConfig(currentKey, isAdvancedMode ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction, questionSchema, activeModel, kCacheName || undefined);
                  const chat = aiInstance.chats.create(config);
                  const batchPrompt = kCacheName ? `Dựa trên tài liệu đã cache, hãy trích xuất thêm trắc nghiệm cho Phần ${batchLabel}.` : `HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY. Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy (Phần ${batchLabel}).`;
                  const response = await chat.sendMessage({ message: [part, { text: batchPrompt }] });
                  return extractAndParseQuestions(response.text, index);
              },
              batchStartingKey // Per-batch key assignment
            )
        );

        if (rawNewQs && rawNewQs.length > 0) {
          const newQs = [];
          for (const q of rawNewQs) {
            const result = checkDuplicate(q, allQuestions);
            if (!result.isDup) {
              q.id = `mcq-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
              newQs.push(q);
            } else {
              duplicateCounter++;
              allDuplicates.push({
                id: `dup-${Date.now()}-${duplicateCounter}`,
                question: q.question.substring(0, 50),
                reason: result.reason || 'Duplicate found',
                matchedWith: result.matchedWith,
                fullData: q,
                matchedData: result.matchedData
              });
            }
          }

          if (newQs.length > 0) {
            allQuestions.push(...newQs);
            if (onBatchComplete) onBatchComplete(newQs);
            console.log(`✅ Batch ${batchLabel}: Found ${newQs.length} questions.`);
          }
        }
      } catch (e: any) {
        // CHIẾN LƯỢC CỨU VÃN: Nếu thất bại sau 2-15 lần thử (depth < 2) và là văn bản, ta chia nhỏ.
        // Nâng cấp: Chia làm 4 phần thay vì 2 để đảm bảo AI xử lý mượt mà nhất.
        if (depth < 2 && part.text && part.text.length > 500) {
          console.warn(`🚀 Batch ${batchLabel} fail. Triggering QUARTER-SUBDIVISION (4 parts, Depth ${depth + 1})...`);
          
          const textLength = part.text.length;
          const segmentSize = Math.floor(textLength / 4);
          
          const getSplitPos = (start: number, end: number) => {
            let pos = part.text.lastIndexOf('\n', end);
            if (pos < start || pos > end) pos = end;
            return pos;
          };

          const s1 = getSplitPos(0, segmentSize);
          const s2 = getSplitPos(s1, s1 + segmentSize);
          const s3 = getSplitPos(s2, s2 + segmentSize);

          const parts = [
            { ...part, text: part.text.substring(0, s1) },
            { ...part, text: part.text.substring(s1, s2) },
            { ...part, text: part.text.substring(s2, s3) },
            { ...part, text: part.text.substring(s3) }
          ].filter(p => p.text.trim().length > 0);

          // Chạy song song cả 4 phần để tối ưu thời gian
          await Promise.all(parts.map((p, i) => processBatch(p, index, depth + 1)));
          return;
        }

        console.error(`❌ Batch ${batchLabel} FAILED after all retries & sub-batching:`, e);
        if (depth === 0) failedBatches.push(index + 1);
        if (onProgress) onProgress(`⚠️ Phần ${batchLabel} thất bại hoàn toàn. Đang tiếp tục...`, allQuestions.length);
      }
    };

    const activePromises: Promise<void>[] = [];
    for (let i = 0; i < allParts.length; i++) {
      // Nếu đang chạy chế độ Retry, chỉ xử lý những index có trong danh sách
      if (retryIndices && retryIndices.length > 0 && !retryIndices.includes(i + 1)) {
        completedBatches++;
        continue;
      }

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

    console.log(`\n📊 FINAL: ${allQuestions.length} questions. Failed Batches: ${failedBatches.join(', ') || 'None'}`);
    return { questions: allQuestions, duplicates: allDuplicates, failedBatches };

  } catch (error: any) {
    throw new Error(translateErrorForUser(error, 'Trích xuất'));
  }
};


export const analyzeDocument = async (files: UploadedFile[], settings: AppSettings): Promise<AnalysisResult> => {
  const finalPrompt = `PHÂN TÍCH TÀI LIỆU Y KHOA:
  - Dự đoán TỔNG SỐ CÂU HỎI trắc nghiệm có trong toàn bộ tài liệu.
  - Phân loại chuyên khoa chính.
  - Mô tả cấu trúc (vd: có đáp án đi kèm không).
  ${SYSTEM_INSTRUCTION_ANALYZE}`;

  if (settings.provider === 'shopaikey' || settings.provider === 'openrouter') {
    return await executeWithRetry(async () => {
      const parts: any[] = files.map(file => {
        if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
          return {
            type: "image_url",
            image_url: { url: `data:${file.type};base64,${file.content.includes(',') ? file.content.split(',')[1] : file.content}` }
          };
        }
        return { type: "text", text: `FILE: ${file.name}\n${file.content}\n` };
      });

      const apiUrl = settings.provider === 'shopaikey' ? "https://api.shopaikey.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
      const apiKey = settings.provider === 'shopaikey' ? settings.shopAIKeyKey : settings.openRouterKey;
      const providerName = settings.provider === 'shopaikey' ? "ShopAIKey" : "OpenRouter";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": window.location.origin,
          "X-Title": "MCQ AnkiGen Pro",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "system", content: finalPrompt },
            { role: "user", content: parts }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) throw new Error(`${providerName} API Error: ${response.status}`); // translateErrorForUser sẽ dịch mã lỗi này
      const data = await response.json();
      return JSON.parse(extractJson(data.choices[0].message.content));
    });
  }

  userKeyRotator.init(settings.apiKey);
  return await executeWithUserRotation(settings.model, async (apiKey, activeModel) => {
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
        estimatedCount: { type: Type.NUMBER },
        specialty: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        hasAnswers: { type: Type.BOOLEAN },
        structureNote: { type: Type.STRING }
      },
      required: ["estimatedCount", "specialty", "confidence", "hasAnswers", "structureNote"]
    };

    const chat = ai.chats.create(getModelConfig(apiKey, finalPrompt, schema, activeModel));
    const result = await chat.sendMessage({ message: parts });
    return JSON.parse(extractJson(result.text));
  });
};

export const auditMissingQuestions = async (files: UploadedFile[], count: number, settings: AppSettings): Promise<AuditResult> => {
  if (settings.provider === 'shopaikey' || settings.provider === 'openrouter') {
    return await executeWithRetry(async () => {
      const parts: any[] = files.map(file => {
        if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
          return { type: "image_url", image_url: { url: `data:${file.type};base64,${file.content.includes(',') ? file.content.split(',')[1] : file.content}` } };
        }
        return { type: "text", text: `FILE: ${file.name}\n${file.content}\n` };
      });

      const apiUrl = settings.provider === 'shopaikey' ? "https://api.shopaikey.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
      const apiKey = settings.provider === 'shopaikey' ? settings.shopAIKeyKey : settings.openRouterKey;
      const providerName = settings.provider === 'shopaikey' ? "ShopAIKey" : "OpenRouter";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": window.location.origin,
          "X-Title": "MCQ AnkiGen Pro",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "system", content: SYSTEM_INSTRUCTION_AUDIT },
            {
              role: "user",
              content: [
                ...parts,
                { type: "text", text: `Quá trình trích xuất chỉ lấy được ${count} câu hỏi. Hãy phân tích lý do.` }
              ]
            }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) throw new Error(`${providerName} API Error: ${response.status}`); // translateErrorForUser sẽ dịch mã lỗi này
      const data = await response.json();
      return JSON.parse(extractJson(data.choices[0].message.content)) as AuditResult;
    });
  }

  userKeyRotator.init(settings.apiKey);
  return await executeWithUserRotation(settings.model, async (apiKey, activeModel) => {
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
      }
      return { text: `FILE: ${file.name}\n${file.content}\n` };
    });

    const ai = new GoogleGenAI({ apiKey });
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

    const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_AUDIT, schema, activeModel));
    const res = await chat.sendMessage({
      message: [
        ...parts,
        { text: `Quá trình trích xuất chỉ lấy được ${count} câu hỏi. Hãy phân tích lý do.` }
      ]
    });
    return JSON.parse(extractJson(res.text)) as AuditResult;
  });
};
