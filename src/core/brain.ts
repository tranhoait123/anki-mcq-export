import { PDFDocument } from 'pdf-lib';
import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedResponse, UploadedFile, ProgressCallback, AnalysisResult, AuditResult, BatchCallback, AppSettings, MCQ, DuplicateInfo, BatchFailureInfo } from "../types";
import { db } from './db';
import { findDuplicate } from '../utils/dedupe';
import { coerceModelForProvider, coerceModelForProviderInput, getModelTokenProfile, getProviderFallbackModel, getProviderModelMismatchMessage, ModelTokenProfile } from '../utils/models';
import { analyzePdfTextLayer, convertPdfToImages, PdfPageRange } from '../utils/pdfProcessor';
import { UserKeyRotator } from '../utils/keyRotator';
import {
  classifyBatchError,
  describeBatchError,
  getBackoffDelayMs,
  getRetryProfile,
  RetryProfile,
  RetryProfileName,
  shouldSplitForError,
  splitTextIntoNaturalParts,
} from '../utils/retryStrategy';
import { buildNativeMcqBatchText, getNativeMcqBlocks, splitNativeMcqTextIntoBatches } from './docxNative';

interface GenerateQuestionsOptions {
  retryProfile?: RetryProfileName;
  autoRescue?: boolean;
}

const getFileTextContent = (file: UploadedFile): string =>
  file.nativeText?.trim() || file.structuredText?.trim() || file.plainText?.trim() || file.content || '';

const getDetectedDocxMcqCount = (files: UploadedFile[]): number =>
  files.reduce((total, file) => total + (file.nativeMcqCount || file.structuredMcqCount || 0), 0);

const getNativeBatchExpectedCount = (text: string): number => {
  const match = String(text || '').match(/^\[(?:DOCX_NATIVE|PDF_TEXT)_(?:BATCH|MCQ)_COUNT:\s*(\d+)\]/i);
  return match ? Number(match[1]) || 0 : 0;
};

const getNativePartBatches = (text: string, targetParts: number): string[] => {
  const blocks = getNativeMcqBlocks(text);
  if (blocks.length <= 1) return [];
  const parts = Math.min(Math.max(2, targetParts), blocks.length);
  const batchSize = Math.ceil(blocks.length / parts);
  const batches: string[] = [];
  for (let i = 0; i < blocks.length; i += batchSize) {
    batches.push(buildNativeMcqBatchText(blocks.slice(i, i + batchSize)));
  }
  return batches;
};

const splitStructuredPartByBatchSize = (part: any, batchSize: number): any[] => {
  const blocks = getNativeMcqBlocks(part.text || '');
  if (blocks.length <= batchSize) return [part];
  const parts: any[] = [];
  for (let i = 0; i < blocks.length; i += batchSize) {
    const chunk = blocks.slice(i, i + batchSize);
    parts.push({
      ...part,
      text: buildNativeMcqBatchText(chunk),
      expectedQuestions: chunk.length,
    });
  }
  return parts;
};

export const estimateTextTokens = (text: string): number => Math.ceil(String(text || '').length / 3.6);

export const estimateOutputTokensForQuestions = (count: number): number =>
  Math.ceil(Math.max(1, count) * 1100 * 1.15);

export const getAdaptiveQuestionBatchSize = (
  profile: ModelTokenProfile,
  adaptiveBatching = true,
  runtimeCap?: number
): number => {
  if (!adaptiveBatching) return 10;
  const budgetLimitedCount = Math.max(1, Math.floor(profile.safeOutputBudget / estimateOutputTokensForQuestions(1)));
  return Math.max(1, Math.min(runtimeCap || profile.maxQuestionsPerBatch, profile.maxQuestionsPerBatch, budgetLimitedCount));
};

const getAdaptiveTextCharBudget = (profile: ModelTokenProfile, adaptiveBatching = true): number => {
  if (!adaptiveBatching) return 15000;
  const inputBudgetChars = Math.floor(profile.inputLimit * 0.08 * 3.6);
  return Math.max(15000, Math.min(60000, inputBudgetChars));
};

const getAdaptiveVisionPagesPerChunk = (profile: ModelTokenProfile, adaptiveBatching = true): number =>
  adaptiveBatching ? Math.max(3, Math.min(5, profile.visionPagesPerBatch)) : 3;

// Helper: Hashing for cache identification
const hashFiles = async (files: UploadedFile[]): Promise<string> => {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const combined = sortedFiles.map(f => `${f.name}:${getFileTextContent(f)}`).join('|');
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
  const providerModel = msg.match(/model=([^|]+)/)?.[1]?.trim();
  const providerDetail = msg.includes('|') ? msg.split('|').slice(2).join('|').trim() : '';
  const providerSuffix = `${providerModel ? ` Model: ${providerModel}.` : ''}${providerDetail ? ` Chi tiết: ${providerDetail}` : ''}`;

  // --- Provider-specific errors first, so users see the right key/token/project guidance ---
  if (msgLow.includes("vertex ai api error")) {
    const code = msg.match(/:\s*(\d+)/)?.[1] || "?";
    const vxMsgs: Record<string, string> = {
      "400": "Dữ liệu cấu hình Vertex không đúng (Project ID, Vùng, hoặc Token bị sai định dạng).",
      "401": "Access Token của Google Cloud đã HẾT HẠN hoặc sai. Vui lòng lấy Token mới.",
      "403": "Token không đủ quyền (Permission Denied) hoặc chưa bật Vertex AI API.",
      "404": "Không tìm thấy Vertex OpenAI endpoint. Kiểm tra Project ID, Location và model.",
      "429": "Vertex AI Quota Exceeded (Hết lượng truy cập cho phép).",
      "500": "Lỗi nội bộ từ máy chủ Google Cloud Vertex AI.",
    };
    return `${prefix}🔷 Lỗi Vertex AI: ${vxMsgs[code] || `Máy chủ phản hồi mã ${code}.`}${providerSuffix}`;
  }

  if (msgLow.includes("openrouter api error")) {
    const code = msg.match(/:\s*(\d+)/)?.[1] || "?";
    const orMsgs: Record<string, string> = {
      "400": "Dữ liệu gửi lên sai định dạng hoặc model không hỗ trợ ảnh/JSON mode (Mã 400).",
      "401": "API Key OpenRouter không hợp lệ. Kiểm tra lại Key (Mã 401).",
      "402": "Tài khoản OpenRouter hết số dư. Vui lòng nạp thêm (Mã 402).",
      "403": "API Key OpenRouter bị giới hạn hoặc chặn nội dung. Cảnh báo an toàn (Mã 403).",
      "429": "OpenRouter hoặc AI model này đang bị giới hạn tốc độ. Chờ 1-2 phút (Mã 429).",
      "500": "Đứt kết nối tạm thời tới nhà cung cấp (Mã 500).",
      "502": "Lỗi kết nối từ OpenRouter tới AI Model đang chọn (Mã 502).",
      "503": "Nhà cung cấp quá tải. Thử chọn model khác trên OpenRouter (Mã 503).",
    };
    return `${prefix}🤖 Lỗi OpenRouter: ${orMsgs[code] || `Máy chủ phản hồi mã ${code}. Vui lòng thử lại sau.`}${providerSuffix}`;
  }

  if (msgLow.includes("shopaikey api error")) {
    const code = msg.match(/:\s*(\d+)/)?.[1] || "?";
    const shopMsgs: Record<string, string> = {
      "400": "Dữ liệu gửi lên bị từ chối do sai định dạng hoặc model không hỗ trợ ảnh/JSON mode (Mã 400).",
      "401": "API Key ShopAIKey không hợp lệ. Kiểm tra lại Key (Mã 401).",
      "402": "Tài khoản ShopAIKey hết số dư. Vui lòng nạp thêm (Mã 402).",
      "403": "API Key ShopAIKey không có quyền truy cập. Kiểm tra Key (Mã 403).",
      "429": "ShopAIKey quá tải. Chờ 1-2 phút rồi thử lại (Mã 429).",
      "500": "Server ShopAIKey đang gặp sự cố nội bộ. Thử lại sau (Mã 500).",
      "503": "Server ShopAIKey quá tải tạm thời. Thử lại sau (Mã 503).",
    };
    return `${prefix}🤖 Lỗi ShopAIKey: ${shopMsgs[code] || `Server phản hồi mã ${code}. Vui lòng thử lại sau.`}${providerSuffix}`;
  }

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
  if (msgLow.includes("model_provider_mismatch")) {
    return `${prefix}⚙️ Model đang không khớp provider. Nếu dùng DeepSeek/OpenAI/Claude hãy chọn OpenRouter hoặc ShopAIKey; nếu dùng Google/Vertex hãy chọn model dạng gemini-*.`;
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
  if (!modelName.startsWith('gemini-')) {
    return null;
  }

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
      return { text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
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
const getPdfPageRanges = (totalPages: number, pagesPerChunk: number = 3, overlap: number = 1): PdfPageRange[] => {
  const ranges: PdfPageRange[] = [];
  const step = Math.max(1, pagesPerChunk - overlap);
  for (let start = 1; start <= totalPages; start += step) {
    const end = Math.min(totalPages, start + pagesPerChunk - 1);
    ranges.push({ start, end });
    if (end === totalPages) break;
  }
  return ranges;
};

const splitPdfByRanges = async (base64Data: string, ranges: PdfPageRange[]): Promise<string[]> => {
  const pdfDoc = await PDFDocument.load(base64Data);
  const chunks: string[] = [];
  const totalPages = pdfDoc.getPageCount();

  for (const range of ranges) {
    const subDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: Math.max(0, range.end - range.start + 1) }, (_, k) => range.start - 1 + k);
    const validIndices = pageIndices.filter(idx => idx < totalPages);
    if (validIndices.length === 0) break;

    const copyPages = await subDoc.copyPages(pdfDoc, validIndices);
    copyPages.forEach((page) => subDoc.addPage(page));
    const base64 = await subDoc.saveAsBase64();
    chunks.push(base64);

  }
  return chunks;
};

const splitPdf = async (base64Data: string, pagesPerChunk: number = 3, overlap: number = 1): Promise<string[]> => {
  const pdfDoc = await PDFDocument.load(base64Data);
  return splitPdfByRanges(base64Data, getPdfPageRanges(pdfDoc.getPageCount(), pagesPerChunk, overlap));
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
      return { text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
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

const findBalancedObjectEnd = (text: string, startIndex: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
};

const isCompleteQuestionObject = (value: any): boolean =>
  Boolean(
    value &&
    typeof value.question === 'string' &&
    Array.isArray(value.options) &&
    value.options.length >= 2 &&
    typeof value.correctAnswer === 'string' &&
    value.explanation &&
    typeof value.explanation.core === 'string' &&
    typeof value.explanation.evidence === 'string' &&
    typeof value.explanation.analysis === 'string' &&
    typeof value.explanation.warning === 'string' &&
    typeof value.source === 'string' &&
    typeof value.difficulty === 'string' &&
    typeof value.depthAnalysis === 'string'
  );

export const salvageCompleteQuestionsFromJson = (text: string): any[] => {
  let jsonText = text || '';
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonText = codeBlockMatch[1];
  if (!jsonText) return [];

  const questionsKeyIndex = jsonText.indexOf('"questions"');
  const arrayStart = questionsKeyIndex >= 0 ? jsonText.indexOf('[', questionsKeyIndex) : jsonText.indexOf('[');
  if (arrayStart < 0) return [];

  const questions: any[] = [];
  let cursor = arrayStart + 1;
  while (cursor < jsonText.length) {
    const objectStart = jsonText.indexOf('{', cursor);
    if (objectStart < 0) break;
    const objectEnd = findBalancedObjectEnd(jsonText, objectStart);
    if (objectEnd < 0) break;

    try {
      const parsed = JSON.parse(jsonText.substring(objectStart, objectEnd + 1));
      if (isCompleteQuestionObject(parsed)) questions.push(parsed);
    } catch {
      // Keep scanning; one malformed object should not discard previous complete MCQs.
    }
    cursor = objectEnd + 1;
  }

  return questions;
};

// --- Deduplication Helpers ---

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

export const getModelConfig = (apiKey: string, systemInstruction: string, schema?: any, modelName: string = 'gemini-2.0-flash', cachedContent?: string, maxOutputTokens?: number) => {
  return {
    model: modelName,
    config: {
      systemInstruction,
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: schema,
      cachedContent,
      maxOutputTokens
    }
  };
};

const createProviderApiError = async (providerName: string, response: Response, modelName: string): Promise<Error> => {
  let detail = '';
  try {
    const raw = await response.text();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message || parsed?.message || parsed?.detail || raw;
      } catch {
        detail = raw;
      }
    }
  } catch {
    detail = '';
  }

  const cleanDetail = detail.replace(/\s+/g, ' ').slice(0, 260);
  return new Error(`${providerName} API Error: ${response.status} | model=${modelName}${cleanDetail ? ` | ${cleanDetail}` : ''}`);
};

export const buildGoogleBatchMessage = (part: any, batchPrompt: string, cachedContent?: string) => {
  if (cachedContent) return [{ text: batchPrompt }];
  return [part, { text: batchPrompt }];
};

type OpenAICompatibleProvider = 'shopaikey' | 'openrouter' | 'vertexai';

interface ProviderRequestConfig {
  url: string;
  providerName: string;
  model: string;
  apiKey: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

const JSON_MODE_FALLBACK_INSTRUCTION = 'QUAN TRỌNG: Endpoint hiện tại không hỗ trợ response_format. Bạn vẫn PHẢI trả về JSON hợp lệ duy nhất, không markdown, không giải thích ngoài JSON.';

const isOpenAICompatibleProvider = (provider: AppSettings['provider']): provider is OpenAICompatibleProvider =>
  provider === 'shopaikey' || provider === 'openrouter' || provider === 'vertexai';

const getProviderName = (provider: OpenAICompatibleProvider): string => {
  if (provider === 'vertexai') return 'Vertex AI';
  if (provider === 'shopaikey') return 'ShopAIKey';
  return 'OpenRouter';
};

const normalizeVertexLocation = (location?: string): string => (location || 'global').trim() || 'global';

export const normalizeVertexOpenAIModel = (model: string): string => {
  if (!model) return 'google/gemini-2.5-flash';
  if (model.startsWith('google/')) return model;
  return `google/${model}`;
};

const normalizeProviderModel = (provider: OpenAICompatibleProvider, model: string): string => {
  if (provider === 'vertexai') return normalizeVertexOpenAIModel(model);
  return model;
};

const buildProviderUrl = (settings: AppSettings): string => {
  if (settings.provider === 'vertexai') {
    const location = normalizeVertexLocation(settings.vertexLocation);
    const projectId = settings.vertexProjectId?.trim();
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/endpoints/openapi/chat/completions`;
  }
  if (settings.provider === 'shopaikey') return 'https://api.shopaikey.com/v1/chat/completions';
  return 'https://openrouter.ai/api/v1/chat/completions';
};

const getProviderApiKey = (settings: AppSettings): string | undefined => {
  if (settings.provider === 'vertexai') return settings.vertexAccessToken;
  if (settings.provider === 'shopaikey') return settings.shopAIKeyKey;
  return settings.openRouterKey;
};

const buildProviderHeaders = (settings: AppSettings, apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (settings.provider !== 'vertexai' && typeof window !== 'undefined') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'MCQ AnkiGen Pro';
    if (settings.provider === 'openrouter') headers['X-OpenRouter-Title'] = 'MCQ AnkiGen Pro';
  }

  return headers;
};

export const buildOpenAICompatibleProviderRequest = (
  settings: AppSettings,
  modelName: string,
  messages: any[],
  includeResponseFormat: boolean = true
): ProviderRequestConfig => {
  if (!isOpenAICompatibleProvider(settings.provider)) {
    throw new Error(`Unsupported OpenAI-compatible provider: ${settings.provider}`);
  }

  const apiKey = getProviderApiKey(settings) || '';
  const model = normalizeProviderModel(settings.provider, modelName);
  const body: Record<string, any> = {
    model,
    messages,
    temperature: 0.1,
  };
  body.max_tokens = getModelTokenProfile(settings.provider, modelName).safeOutputBudget;

  if (includeResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  return {
    url: buildProviderUrl(settings),
    providerName: getProviderName(settings.provider),
    model,
    apiKey,
    headers: buildProviderHeaders(settings, apiKey),
    body,
  };
};

const isResponseFormatUnsupportedError = (error: Error): boolean => {
  const msg = error.message.toLowerCase();
  return (
    (msg.includes('response_format') || msg.includes('json_object') || msg.includes('json mode')) &&
    (msg.includes('not support') || msg.includes('unsupported') || msg.includes('invalid') || msg.includes('unrecognized'))
  );
};

const withJsonModeFallbackPrompt = (messages: any[]): any[] => {
  const next = messages.map(message => ({ ...message }));
  const systemIndex = next.findIndex(message => message.role === 'system');
  if (systemIndex >= 0) {
    next[systemIndex] = {
      ...next[systemIndex],
      content: `${next[systemIndex].content}\n\n${JSON_MODE_FALLBACK_INSTRUCTION}`,
    };
  } else {
    next.unshift({ role: 'system', content: JSON_MODE_FALLBACK_INSTRUCTION });
  }
  return next;
};

export const extractProviderMessageContent = (data: any): string => {
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .join('');
  }
  if (typeof content === 'string' && content.trim()) return content;
  throw new Error('AI_FORMAT_ERROR_EMPTY_PROVIDER_RESPONSE: Provider không trả về choices[0].message.content.');
};

export const callOpenAICompatibleProvider = async (
  settings: AppSettings,
  modelName: string,
  messages: any[],
  includeResponseFormat: boolean = true
): Promise<string> => {
  const request = buildOpenAICompatibleProviderRequest(settings, modelName, messages, includeResponseFormat);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const error = await createProviderApiError(request.providerName, response, request.model);
    if (includeResponseFormat && isResponseFormatUnsupportedError(error)) {
      console.warn(`${request.providerName}: response_format unsupported for ${request.model}. Retrying with prompt-only JSON mode.`);
      return callOpenAICompatibleProvider(settings, modelName, withJsonModeFallbackPrompt(messages), false);
    }
    throw error;
  }

  const data = await response.json();
  return extractProviderMessageContent(data);
};

const toOpenAIContentFromPart = (part: any): any[] => {
  if (part.inlineData) {
    if (part.inlineData.mimeType === 'application/pdf') {
      throw new Error('PDF_PROVIDER_RASTERIZATION_REQUIRED: Provider OpenAI-compatible không nhận PDF thô. Hãy để hệ thống chuyển PDF sang ảnh trước khi quét.');
    }
    return [{ type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } }];
  }
  return [{ type: 'text', text: part.text || '' }];
};

const toOpenAIContentFromFile = (file: UploadedFile): any => {
  if (file.type.startsWith('image/')) {
    return {
      type: 'image_url',
      image_url: { url: `data:${file.type};base64,${file.content.includes(',') ? file.content.split(',')[1] : file.content}` },
    };
  }
  if (file.type === 'application/pdf') {
    return { type: 'text', text: `FILE: ${file.name}\n[PDF chưa được chuyển sang ảnh. Vui lòng quét lại để hệ thống rasterize PDF trước.]\n` };
  }
  return { type: 'text', text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
};

const filesRequireVision = (files: UploadedFile[]): boolean =>
  files.some(file => file.type === 'application/pdf' || file.type.startsWith('image/'));

const partsRequireVision = (parts: any[]): boolean => parts.some(part => Boolean(part.inlineData));

const normalizeAnalysisResult = (raw: any): AnalysisResult => {
  const confidence = raw?.confidence;
  const confidenceText = typeof confidence === 'number'
    ? `${Math.round((confidence <= 1 ? confidence * 100 : confidence))}%`
    : String(confidence || 'N/A');

  return {
    topic: raw?.topic || raw?.specialty || 'Tài liệu y khoa',
    estimatedCount: Number(raw?.estimatedCount ?? raw?.count ?? 0) || 0,
    questionRange: raw?.questionRange || raw?.structureNote || 'Toàn bộ tài liệu',
    confidence: confidenceText,
  };
};

// --- Execution with Retry & Rotation ---

async function executeWithUserRotation<T>(
  initialModel: string,
  operation: (apiKey: string, modelName: string) => Promise<T>,
  startingKey?: string, // Cho phép chỉ định key khởi đầu (per-batch distribution)
  fallbackModel: string = 'gemini-2.5-flash',
  retryProfile: RetryProfile = getRetryProfile('normal')
): Promise<T> {
  const ATTEMPTS_LIMIT = Math.max(retryProfile.minAttempts, userKeyRotator.keyCount + retryProfile.attemptBuffer);
  let attempts = 0;
  let distinctKeysTried = 0; // Đếm số key THỰC SỰ đã thử (thay vì so sánh index)
  let lastTriedKey = ''; // Track key trước đó để đếm chính xác
  let currentModel = initialModel;
  let currentKey = startingKey || userKeyRotator.getCurrentKey();

  while (attempts < ATTEMPTS_LIMIT) {
    if (!currentKey && userKeyRotator.keyCount > 0) {
      const cooldownDelay = userKeyRotator.getNextCooldownDelayMs();
      if (cooldownDelay > 0) {
        const waitMs = Math.min(cooldownDelay, retryProfile.singleKeyBackoffCapMs);
        console.log(`⏳ All API keys are cooling down. Waiting ${Math.round(waitMs / 1000)}s before retrying.`);
        await new Promise(r => setTimeout(r, waitMs));
        currentKey = userKeyRotator.getKeyForBatch() || userKeyRotator.getCurrentKey();
        continue;
      }
    }

    attempts++;

    // Nếu sau 6 lần thử (hết khoảng 1/2 số Key trung bình) mà vẫn lỗi 503, 
    // ta tự động chuyển sang Model dự phòng ổn định hơn.
    if (attempts > retryProfile.fallbackAfterAttempt && currentModel !== fallbackModel) {
      console.log(`🚀 Switching to STABLE FALLBACK MODEL: ${fallbackModel}`);
      currentModel = fallbackModel;
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
        if (isFormatError && attempts >= retryProfile.formatFastFailAttempt) {
          console.warn(`🚀 Detection: JSON Format Error confirmed after ${attempts} attempts. Failing fast to trigger Subdivision...`);
          throw new Error("AI_FORMAT_ERROR_TRUNCATED");
        }

        // === CHIẾN LƯỢC XỬ LÝ LỖI THÔNG MINH ===
        
        if (isPermissionDenied || isKeyError) {
          if (msg.includes("vertex ai api error") || msg.includes("openrouter api error") || msg.includes("shopaikey api error")) {
            throw error;
          }
          console.warn(`🚫 403/Invalid Key detected! Key #${userKeyRotator.getKeyNumber(currentKey)} is broken. Rotating IMMEDIATELY...`);
          userKeyRotator.markKeyFailed(currentKey);
          if (userKeyRotator.availableKeyCount > 0) {
            currentKey = userKeyRotator.rotate();
            continue; // Retry ngay lập tức với key mới, KHÔNG delay
          } else {
            throw new Error(`API Key hoặc Token bị từ chối truy cập (403/Invalid). Vui lòng vào Cài đặt kiểm tra lại (Có thể Key hết hạn hoặc sai).`);
          }
        }

        // [B] 429 Rate Limit / 503 Server Busy: Xoay key + Exponential Backoff + Jitter
        const reason = isFormatError ? "Lỗi định dạng AI" : (isRateLimit ? "Hết hạn mức/Timeout (429)" : "Server quá tải (503)");
        console.warn(`⚠️ ${reason} (Lần thử ${attempts}/${ATTEMPTS_LIMIT}). Đang xoay vòng/thử lại...`);

        let backoffMs = 0;
        if (isRateLimit || isServerBusy) {
          userKeyRotator.markKeyCooldown(currentKey, isRateLimit ? 'rateLimit' : 'serverBusy');
        }
        
        // Luôn xoay nếu còn bất kỳ key khả dụng nào sau khi key hiện tại bị cooldown.
        if (userKeyRotator.availableKeyCount > 0) {
          currentKey = userKeyRotator.rotate();
          let hasFreshKey = false;
          
          // Đếm số key thực sự đã thử (không dùng index comparison vì sẽ sai khi có key bị skip)
          if (currentKey !== lastTriedKey) {
            distinctKeysTried++;
            lastTriedKey = currentKey;
            hasFreshKey = true;
          }
          
          // Chỉ áp dụng Exponential Backoff khi đã thử hết tất cả key khả dụng ít nhất 1 vòng
          const availableCount = userKeyRotator.availableKeyCount;
          if (distinctKeysTried >= availableCount) {
            const cycles = Math.floor(distinctKeysTried / Math.max(1, availableCount));
            backoffMs = getBackoffDelayMs(retryProfile, attempts, cycles, isServerBusy, isRateLimit, isFormatError, false);
          } else {
            // Vừa xoay sang Key mới chưa thử: Chờ rất ngắn (0.5s - 1.5s) để tránh thundering herd,
            // nhưng không bị phạt thời gian như key cũ.
            backoffMs = getBackoffDelayMs(retryProfile, attempts, 0, isServerBusy, isRateLimit, isFormatError, hasFreshKey);
          }
        } else {
          const cooldownDelay = userKeyRotator.getNextCooldownDelayMs();
          if (cooldownDelay > 0) {
            backoffMs = Math.min(cooldownDelay, retryProfile.singleKeyBackoffCapMs);
            await new Promise(r => setTimeout(r, backoffMs));
            currentKey = userKeyRotator.getKeyForBatch() || userKeyRotator.getCurrentKey();
            continue;
          } else {
            // Chỉ có 1 key: Áp dụng Exponential Backoff bình thường
            backoffMs = Math.min(
              retryProfile.singleKeyBackoffCapMs,
              getBackoffDelayMs(retryProfile, attempts, attempts - 1, isServerBusy, isRateLimit, isFormatError, false)
            );
          }
        }
        
        console.log(`⏳ Backoff: ${Math.round(backoffMs / 1000)}s (Key #${userKeyRotator.getKeyNumber(currentKey)}/${userKeyRotator.keyCount}, Distinct tried: ${distinctKeysTried})`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Dịch vụ AI đang bận hoặc quá tải sau ${ATTEMPTS_LIMIT} lần thử. Vui lòng chờ 1-2 phút rồi thử lại.`);
}


export const generateQuestions = async (
  files: UploadedFile[],
  settings: AppSettings,
  limit: number = 0,
  onProgress?: ProgressCallback,
  expectedCount: number = 0,
  onBatchComplete?: BatchCallback,
  retryIndices?: number[],
  isAdvancedMode: boolean = false,
  options: GenerateQuestionsOptions = {}
): Promise<{ questions: MCQ[], duplicates: DuplicateInfo[], failedBatches: number[], failedBatchDetails: BatchFailureInfo[], autoSkippedCount: number }> => {
  try {
    const mismatchMessage = getProviderModelMismatchMessage(settings.provider, settings.model);
    let runtimeSettings = mismatchMessage ? { ...settings, model: coerceModelForProvider(settings.provider, settings.model) } : settings;
    const retryProfile = getRetryProfile(options.retryProfile || (isAdvancedMode ? 'rescue' : 'normal'));
    const isRescueMode = retryProfile.name === 'rescue';
    userKeyRotator.init(runtimeSettings.apiKey);
    const adaptiveBatching = runtimeSettings.adaptiveBatching !== false;
    const tokenProfile = getModelTokenProfile(runtimeSettings.provider, runtimeSettings.model);
    let adaptiveQuestionCap = getAdaptiveQuestionBatchSize(tokenProfile, adaptiveBatching);
    let adaptiveLargeBatchFailures = 0;
    const visionPagesPerChunk = getAdaptiveVisionPagesPerChunk(tokenProfile, adaptiveBatching);
    const textCharBudget = getAdaptiveTextCharBudget(tokenProfile, adaptiveBatching);
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
        const rawBase64 = file.content.includes(',') ? file.content.split(',')[1] : file.content;
        const pdfDataUrl = file.content.startsWith('data:') ? file.content : `data:application/pdf;base64,${file.content}`;
        try {
          if (onProgress) onProgress(`Đang kiểm tra text layer PDF "${file.name}"...`, 0);
          const pdfTextAnalysis = await analyzePdfTextLayer(pdfDataUrl, visionPagesPerChunk, 1, adaptiveQuestionCap);
          if (pdfTextAnalysis.textBatches.length > 0) {
            pdfTextAnalysis.textBatches.forEach((batch, batchIndex) => {
              allParts.push({
                text: `[TÀI LIỆU PDF TEXT STRUCTURED: "${file.name}" (Trang ${batch.pageRange.start}-${batch.pageRange.end}, Nhóm ${batchIndex + 1}/${pdfTextAnalysis.textBatches.length})]\n\n${batch.text}`,
                nativeMcqBatch: true,
                structuredMcqBatch: true,
                sourceMode: 'pdfText',
                expectedQuestions: batch.expectedQuestions,
              });
            });
          }

          const visionRanges = pdfTextAnalysis.visionPageRanges;
          if (visionRanges.length > 0) {
            if (onProgress) onProgress(`PDF hybrid: ${pdfTextAnalysis.textBatches.length} batch text, ${visionRanges.length} batch Vision.`, 0);
            if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
              for (const range of visionRanges) {
                const images = await convertPdfToImages(pdfDataUrl, range);
                images.forEach((imageBase64) => {
                  allParts.push({
                    inlineData: { mimeType: 'image/jpeg', data: imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64 },
                    sourceMode: 'pdfVision',
                  });
                });
              }
            } else {
              const pdfChunks = await splitPdfByRanges(rawBase64, visionRanges);
              pdfChunks.forEach((chunkBase64) => {
                allParts.push({ inlineData: { mimeType: 'application/pdf', data: chunkBase64 }, sourceMode: 'pdfVision' });
              });
            }
          }
        } catch (splitError) {
          console.warn('PDF safe hybrid fallback to legacy vision:', splitError);
          const pdfChunks = await splitPdf(rawBase64, visionPagesPerChunk, 1);
          if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
            const images = await convertPdfToImages(pdfDataUrl);
            images.forEach((imageBase64) => {
              allParts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64 }, sourceMode: 'pdfVision' });
            });
          } else {
            pdfChunks.forEach((chunkBase64) => {
              allParts.push({ inlineData: { mimeType: 'application/pdf', data: chunkBase64 }, sourceMode: 'pdfVision' });
            });
          }
        }
      } else if (file.type.startsWith('image/')) {
        allParts.push({ inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } });
      } else if (file.docxImageParts?.length) {
        const docxMcqText = file.nativeText?.trim() || file.structuredText?.trim() || '';
        const docxBatches = splitNativeMcqTextIntoBatches(docxMcqText, adaptiveQuestionCap);
        if (docxBatches.length > 0) {
          docxBatches.forEach((text, batchIndex) => {
            allParts.push({
              text: `[TÀI LIỆU DOCX ${file.nativeText?.trim() ? 'NATIVE' : 'STRUCTURED'}: "${file.name}" (Nhóm ${batchIndex + 1}/${docxBatches.length})]\n\n${text}`,
              nativeMcqBatch: true,
              expectedQuestions: getNativeBatchExpectedCount(text),
            });
          });
        }
        file.docxImageParts.forEach((image) => {
          allParts.push({
            inlineData: { mimeType: image.mimeType, data: image.content.includes(',') ? image.content.split(',')[1] : image.content },
            sourceMode: 'docxImage',
            docxImageLabel: `[DOCX IMAGE: "${file.name}" - Ảnh ${image.index} (${image.name})]`,
          });
        });
      } else if (file.nativeText?.trim() || file.structuredText?.trim()) {
        const docxMcqText = file.nativeText?.trim() || file.structuredText?.trim() || '';
        const docxBatches = splitNativeMcqTextIntoBatches(docxMcqText, adaptiveQuestionCap);
        if (docxBatches.length > 0) {
          docxBatches.forEach((text, batchIndex) => {
            allParts.push({
              text: `[TÀI LIỆU DOCX ${file.nativeText?.trim() ? 'NATIVE' : 'STRUCTURED'}: "${file.name}" (Nhóm ${batchIndex + 1}/${docxBatches.length})]\n\n${text}`,
              nativeMcqBatch: true,
              expectedQuestions: getNativeBatchExpectedCount(text),
            });
          });
        } else {
          allParts.push({ text: `[TÀI LIỆU: "${file.name}" (DOCX structured fallback)]\n\n${docxMcqText}` });
        }
      } else {
        const MAX_CHARS = textCharBudget;
        const OVERLAP = 1000;
        let offset = 0;
        let partIdx = 1;
        const textContent = getFileTextContent(file);
        while (offset < textContent.length) {
          allParts.push({ text: `[TÀI LIỆU: "${file.name}" (Phần ${partIdx++})]\n\n` + textContent.substring(offset, offset + MAX_CHARS) });
          offset += (MAX_CHARS - OVERLAP);
          if (offset >= textContent.length - OVERLAP) {
            if (offset < textContent.length) {
              allParts.push({ text: `[TÀI LIỆU: "${file.name}" (Phần cuối)]\n\n` + textContent.substring(offset, textContent.length) });
            }
            break;
          }
        }
      }
    }

    if (allParts.length === 0) {
      return { questions: [], duplicates: [], failedBatches: [], failedBatchDetails: [], autoSkippedCount: 0 };
    }

    if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
      const coercedModel = coerceModelForProviderInput(runtimeSettings.provider, runtimeSettings.model, partsRequireVision(allParts));
      if (coercedModel !== runtimeSettings.model) {
        console.warn(`🛡️ ${runtimeSettings.provider}: model ${runtimeSettings.model} không phù hợp với input ảnh/PDF. Đổi sang ${coercedModel}.`);
        runtimeSettings = { ...runtimeSettings, model: coercedModel };
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
    let failedBatches: number[] = [];
    let failedBatchDetails: BatchFailureInfo[] = [];
    let duplicateCounter = 0;
    let autoSkippedCount = 0;
    let rescueCompleted = 0;
    const rescueTotal = retryIndices?.length || 0;

    const recordBatchFailure = (index: number, label: string, error: any, stage: BatchFailureInfo['stage']) => {
      const batchNumber = index + 1;
      if (!failedBatches.includes(batchNumber)) failedBatches.push(batchNumber);
      if (failedBatchDetails.some(item => item.index === batchNumber && item.label === label && item.stage === stage)) return;
      const detail = describeBatchError(error, retryProfile.name);
      failedBatchDetails.push({
        index: batchNumber,
        label,
        kind: detail.kind,
        stage,
        message: detail.message,
        advice: detail.advice,
      });
    };

    // --- STEP 2: BATCH PROCESSING ---
    let completedBatches = 0;
    const CONCURRENCY_LIMIT = runtimeSettings.concurrencyLimit || 2;

    const extractAndParseQuestions = (text: string, batchIndex: number, expectedQuestions = 0) => {
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
        if (expectedQuestions > 0 && questions.length < expectedQuestions) {
          (questions as any).__salvagedPartial = true;
          (questions as any).__missingCount = expectedQuestions - questions.length;
        }
        return questions;
      } catch (e) {
        const salvaged = salvageCompleteQuestionsFromJson(text);
        if (salvaged.length > 0) {
          (salvaged as any).__salvagedPartial = true;
          (salvaged as any).__missingCount = expectedQuestions > 0 ? Math.max(0, expectedQuestions - salvaged.length) : 0;
          console.warn(`🧩 Salvaged ${salvaged.length}${expectedQuestions > 0 ? `/${expectedQuestions}` : ''} complete questions from malformed JSON in batch ${batchIndex + 1}.`);
          return salvaged;
        }
        console.error("JSON Parse Error info:", e, "Raw string:", jsonStr.substring(0, 100) + "...");
        throw new Error(`📄 Dữ liệu AI ở Phần ${batchIndex + 1} bị lỗi cấu trúc (JSON). Hệ thống đang tự động chia nhỏ và thử lại...`);
      }
    };

    const totalBatches = allParts.length;
    const stableFallbackModel = getProviderFallbackModel(runtimeSettings.provider);
    const extractionModel = isAdvancedMode || isRescueMode ? stableFallbackModel : runtimeSettings.model;

    // Hàm xử lý Batch chính có khả năng Đệ quy (Subdivision)
    const processBatch = async (part: any, index: number, depth: number = 0, forceJsonRepair: boolean = false) => {
      const batchLabel = depth === 0 ? `${index + 1}` : `${index + 1}${String.fromCharCode(96 + depth)}`;

      try {
        const expectedAtStart = part.expectedQuestions || getNativeBatchExpectedCount(part.text || '');
        if (adaptiveBatching && depth === 0 && part.nativeMcqBatch && expectedAtStart > adaptiveQuestionCap) {
          const cappedParts = splitStructuredPartByBatchSize(part, adaptiveQuestionCap);
          if (cappedParts.length > 1) {
            await Promise.all(cappedParts.map((p) => processBatch(p, index, depth + 1, forceJsonRepair)));
            return;
          }
        }

        if (onProgress) {
          if (isRescueMode) {
            onProgress(`Đang cứu ${Math.min(rescueCompleted + 1, Math.max(1, rescueTotal))}/${Math.max(1, rescueTotal)} phần lỗi • đã thêm ${allQuestions.length} câu${depth > 0 ? ' • đang chia nhỏ' : ''}`, allQuestions.length);
          } else {
            onProgress(`Quét Batch ${batchLabel}/${totalBatches}${depth > 0 ? ' (Đang chia nhỏ)' : ''}...`, allQuestions.length);
          }
        }
        await new Promise(r => setTimeout(r, Math.random() * (isRescueMode ? 250 : 800)));

        // Per-batch key assignment: Mỗi batch nhận key riêng theo round-robin
        const batchStartingKey = runtimeSettings.provider === 'google' ? userKeyRotator.getKeyForBatch() : '';
        const expectedQuestions = expectedAtStart;
        const structuredSourceLabel = part.sourceMode === 'pdfText' ? 'PDF TEXT STRUCTURED' : 'DOCX';
        const repairInstruction = forceJsonRepair
          ? 'LƯU Ý SỬA JSON: Lần trước batch này bị lỗi định dạng hoặc thiếu câu. Hãy trả về JSON hợp lệ tuyệt đối, đóng đủ mọi ngoặc, không markdown, không giải thích ngoài JSON.'
          : '';
        const nativePrompt = expectedQuestions > 0
          ? `NỘI DUNG ${structuredSourceLabel} ĐÃ ĐƯỢC TÁCH SẴN THÀNH ${expectedQuestions} BLOCK CÂU. Mỗi block <<<MCQ n>>> là đúng 1 câu hoặc 1 mục câu hỏi trong tài liệu. Option có ký hiệu ✅ là đáp án đúng lấy từ marker trong tài liệu; TUYỆT ĐỐI không đổi đáp án này. Nếu block có A/B/C/D thì trích đúng các lựa chọn đó. Nếu block chỉ có Question và Answer/Notes, hãy giữ nguyên câu hỏi, dùng Answer/Notes làm đáp án/giải thích, và chỉ tạo lựa chọn nhiễu khi tài liệu không cung cấp đủ options. Hãy trả về ĐÚNG ${expectedQuestions} câu theo cùng thứ tự, không bỏ câu nào.`
          : '';
        const imagePrompt = part.sourceMode === 'docxImage'
          ? `${part.docxImageLabel || '[DOCX IMAGE]'}\nẢnh này được nhúng trong file Word. Nếu ảnh chỉ là minh họa và KHÔNG chứa câu hỏi trắc nghiệm, hãy trả về chính xác {"questions":[]}. Nếu ảnh chứa MCQ, hãy trích xuất đầy đủ mọi câu hỏi, lựa chọn và đáp án nếu nhìn thấy.`
          : '';
        const scanPrompt = `${repairInstruction ? `${repairInstruction}\n\n` : ''}${nativePrompt ? `${nativePrompt}\n\n` : ''}${imagePrompt ? `${imagePrompt}\n\n` : ''}HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY. Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy (Phần ${batchLabel}).`;

        const rawNewQs = await (runtimeSettings.provider === 'shopaikey' || runtimeSettings.provider === 'openrouter' || runtimeSettings.provider === 'vertexai'
          ? executeWithUserRotation(
              extractionModel,
              async (dummyKey, activeModel) => {
                  const finalInstruction = runtimeSettings.customPrompt ? `${runtimeSettings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}` : SYSTEM_INSTRUCTION_EXTRACT;
                  
                  const messages = [
                    { role: "system", content: (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction },
                    { role: "user", content: [{ type: "text", text: scanPrompt }, ...toOpenAIContentFromPart(part)] }
                  ];

                  const text = await callOpenAICompatibleProvider(runtimeSettings, activeModel, messages);
                  return extractAndParseQuestions(text, index, expectedQuestions);
              }
              ,
              undefined,
              stableFallbackModel,
              retryProfile
            )
          : executeWithUserRotation(
              extractionModel,
              async (currentKey, activeModel) => {
                  if (!activeModel.startsWith('gemini-')) throw new Error(mismatchMessage || getProviderModelMismatchMessage('google', activeModel) || `MODEL_PROVIDER_MISMATCH: ${activeModel}`);
                  const aiInstance = new GoogleGenAI({ apiKey: currentKey });
                  const finalInstruction = runtimeSettings.customPrompt ? `${runtimeSettings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}` : SYSTEM_INSTRUCTION_EXTRACT;
                  // Cache key bao gồm cả modelName để tránh dùng cache của model cũ khi fallback
                  const cacheSessionKey = `${hashApiKey(currentKey)}_${activeModel}`;
                  if (!part.text && !sessionCache[cacheSessionKey]) {
                    sessionCache[cacheSessionKey] = (async () => {
                      try { return await getOrSetContextCache(aiInstance, files, activeModel, finalInstruction, currentKey); } catch (e) { return null; }
                    })();
                  }
                  const kCacheName = part.text ? null : await sessionCache[cacheSessionKey];
                  const activeProfile = getModelTokenProfile(runtimeSettings.provider, activeModel);
                  const config = getModelConfig(currentKey, (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction, questionSchema, activeModel, kCacheName || undefined, activeProfile.safeOutputBudget);
                  const chat = aiInstance.chats.create(config);
                  const batchPrompt = kCacheName ? `Dựa trên tài liệu đã cache, hãy trích xuất thêm trắc nghiệm cho Phần ${batchLabel}.` : scanPrompt;
                  const response = await chat.sendMessage({ message: buildGoogleBatchMessage(part, batchPrompt, kCacheName || undefined) });
                  return extractAndParseQuestions(response.text, index, expectedQuestions);
              },
              batchStartingKey, // Per-batch key assignment
              stableFallbackModel,
              retryProfile
            )
        );

        if (rawNewQs && rawNewQs.length > 0) {
          const salvagedPartial = Boolean((rawNewQs as any).__salvagedPartial);
          const missingCount = Number((rawNewQs as any).__missingCount || 0);
          const newQs = [];
          for (const q of rawNewQs) {
            const result = findDuplicate(q, [...allQuestions, ...newQs]);
            if (!result.isDup) {
              q.id = `mcq-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
              newQs.push(q);
            } else {
              duplicateCounter++;
              // Chỉ thêm vào danh sách Review nếu độ trùng lặp < 98% (không phải auto-skip)
              if (!result.isAutoSkip) {
                allDuplicates.push({
                  id: `dup-${Date.now()}-${duplicateCounter}`,
                  question: q.question.substring(0, 50),
                  reason: result.reason || 'Duplicate found',
                  matchedWith: result.matchedWith,
                  fullData: q,
                  matchedData: result.matchedData,
                  score: result.score,
                  fieldScores: result.fieldScores
                });
              } else {
                autoSkippedCount++;
                console.log(`⏩ Auto-skipped identical MCQ (~100%): ${q.question.substring(0, 50)}...`);
              }
            }
          }

          if (newQs.length > 0) {
            allQuestions.push(...newQs);
            if (onBatchComplete) onBatchComplete(newQs);
            console.log(`✅ Batch ${batchLabel}: Found ${newQs.length} questions.`);
          }

          if (salvagedPartial && missingCount > 0) {
            throw new Error(`AI_FORMAT_ERROR_PARTIAL_SALVAGE: Đã cứu ${rawNewQs.length} câu hợp lệ nhưng còn thiếu khoảng ${missingCount} câu.`);
          }
        }
      } catch (e: any) {
        const errorKind = classifyBatchError(e);
        const expectedQuestions = part.expectedQuestions || getNativeBatchExpectedCount(part.text || '');
        if (adaptiveBatching && !forceJsonRepair && depth === 0 && errorKind === 'format' && (expectedQuestions > 10 || estimateTextTokens(part.text || '') > 4000)) {
          console.warn(`🔧 Batch ${batchLabel} format failed. Retrying once with strict JSON repair before splitting...`);
          await processBatch(part, index, depth, true);
          return;
        }

        if (adaptiveBatching && forceJsonRepair && depth === 0 && errorKind === 'format' && expectedQuestions > 20) {
          adaptiveLargeBatchFailures++;
          if (adaptiveLargeBatchFailures >= 2 && adaptiveQuestionCap > 20) {
            adaptiveQuestionCap = 20;
            console.warn('🛡️ Adaptive batching cap lowered to 20 questions for remaining batches after repeated format failures.');
          }
        }

        const nativeParts = part.nativeMcqBatch && depth < retryProfile.maxDepth && shouldSplitForError(errorKind)
          ? getNativePartBatches(part.text || '', adaptiveBatching && forceJsonRepair ? 2 : retryProfile.targetSplitParts)
          : [];
        const canSplitText = depth < retryProfile.maxDepth && part.text && part.text.length > retryProfile.splitThresholdChars && shouldSplitForError(errorKind);
        if (nativeParts.length > 1 || canSplitText) {
          const splitPartsCount = adaptiveBatching && forceJsonRepair ? 2 : retryProfile.targetSplitParts;
          console.warn(`🚀 Batch ${batchLabel} fail (${errorKind}). Triggering NATURAL-SUBDIVISION (${splitPartsCount} parts, Depth ${depth + 1})...`);
          const progressBeforeSplit = allQuestions.length + allDuplicates.length + autoSkippedCount;
          const parts = (nativeParts.length > 1
            ? nativeParts.map(text => ({ ...part, text, expectedQuestions: getNativeBatchExpectedCount(text) }))
            : splitTextIntoNaturalParts(part.text, splitPartsCount, retryProfile.splitThresholdChars)
              .map(text => ({ ...part, text }))
          ).filter(p => p.text.trim().length > 0);

          // Chạy song song cả 4 phần để tối ưu thời gian
          await Promise.all(parts.map((p, i) => processBatch(p, index, depth + 1)));
          const progressAfterSplit = allQuestions.length + allDuplicates.length + autoSkippedCount;
          if (depth === 0 && progressAfterSplit === progressBeforeSplit && !failedBatches.includes(index + 1)) {
            recordBatchFailure(index, batchLabel, e, 'split');
          }
          return;
        }

        console.error(`❌ Batch ${batchLabel} FAILED after all retries & sub-batching (${errorKind}):`, e);
        if (depth === 0) recordBatchFailure(index, batchLabel, e, isRescueMode ? 'rescue' : 'normal');
        if (onProgress) {
          const detail = describeBatchError(e, retryProfile.name);
          onProgress(`⚠️ Phần ${batchLabel} lỗi: ${detail.message}. Đang tiếp tục...`, allQuestions.length);
        }
      } finally {
        if (isRescueMode && depth === 0) rescueCompleted++;
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

    failedBatches = Array.from(new Set(failedBatches)).sort((a, b) => a - b);
    failedBatchDetails = failedBatchDetails.sort((a, b) => a.index - b.index || a.label.localeCompare(b.label));

    console.log(`\n📊 FINAL: ${allQuestions.length} questions. Auto-skipped: ${autoSkippedCount}. Failed Batches: ${failedBatches.join(', ') || 'None'}`, failedBatchDetails);
    return { questions: allQuestions, duplicates: allDuplicates, failedBatches, failedBatchDetails, autoSkippedCount };

  } catch (error: any) {
    throw new Error(translateErrorForUser(error, 'Trích xuất'));
  }
};


export const analyzeDocument = async (files: UploadedFile[], settings: AppSettings): Promise<AnalysisResult> => {
  const detectedDocxCount = getDetectedDocxMcqCount(files);
  if (detectedDocxCount > 0) {
    return {
      topic: 'DOCX structured',
      estimatedCount: detectedDocxCount,
      questionRange: 'Theo số block MCQ đã tách từ Word',
      confidence: 'High',
    };
  }

  const mismatchMessage = getProviderModelMismatchMessage(settings.provider, settings.model);
  let runtimeSettings = mismatchMessage ? { ...settings, model: coerceModelForProvider(settings.provider, settings.model) } : settings;
  if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
    const coercedModel = coerceModelForProviderInput(runtimeSettings.provider, runtimeSettings.model, filesRequireVision(files));
    if (coercedModel !== runtimeSettings.model) runtimeSettings = { ...runtimeSettings, model: coercedModel };
  }
  const finalPrompt = `PHÂN TÍCH TÀI LIỆU Y KHOA:
  - Dự đoán TỔNG SỐ CÂU HỎI trắc nghiệm có trong toàn bộ tài liệu.
  - Phân loại chuyên khoa chính.
  - Mô tả cấu trúc (vd: có đáp án đi kèm không).
  ${SYSTEM_INSTRUCTION_ANALYZE}`;

  if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
    return await executeWithRetry(async () => {
      const parts = files.map(toOpenAIContentFromFile);
      const text = await callOpenAICompatibleProvider(runtimeSettings, runtimeSettings.model, [
        { role: "system", content: finalPrompt },
        { role: "user", content: parts }
      ]);
      return normalizeAnalysisResult(JSON.parse(extractJson(text)));
    });
  }

  userKeyRotator.init(runtimeSettings.apiKey);
  return await executeWithUserRotation(runtimeSettings.model, async (apiKey, activeModel) => {
    if (!activeModel.startsWith('gemini-')) throw new Error(mismatchMessage || getProviderModelMismatchMessage('google', activeModel) || `MODEL_PROVIDER_MISMATCH: ${activeModel}`);
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
      }
      return { text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
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
    return normalizeAnalysisResult(JSON.parse(extractJson(result.text)));
  }, undefined, getProviderFallbackModel(runtimeSettings.provider));
};

export const auditMissingQuestions = async (files: UploadedFile[], count: number, settings: AppSettings): Promise<AuditResult> => {
  const mismatchMessage = getProviderModelMismatchMessage(settings.provider, settings.model);
  let runtimeSettings = mismatchMessage ? { ...settings, model: coerceModelForProvider(settings.provider, settings.model) } : settings;
  if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
    const coercedModel = coerceModelForProviderInput(runtimeSettings.provider, runtimeSettings.model, filesRequireVision(files));
    if (coercedModel !== runtimeSettings.model) runtimeSettings = { ...runtimeSettings, model: coercedModel };
  }
  if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
    return await executeWithRetry(async () => {
      const parts = files.map(toOpenAIContentFromFile);
      const text = await callOpenAICompatibleProvider(runtimeSettings, runtimeSettings.model, [
        { role: "system", content: SYSTEM_INSTRUCTION_AUDIT },
        {
          role: "user",
          content: [
            ...parts,
            { type: "text", text: `Quá trình trích xuất chỉ lấy được ${count} câu hỏi. Hãy phân tích lý do.` }
          ]
        }
      ]);
      return JSON.parse(extractJson(text)) as AuditResult;
    });
  }

  userKeyRotator.init(runtimeSettings.apiKey);
  return await executeWithUserRotation(runtimeSettings.model, async (apiKey, activeModel) => {
    if (!activeModel.startsWith('gemini-')) throw new Error(mismatchMessage || getProviderModelMismatchMessage('google', activeModel) || `MODEL_PROVIDER_MISMATCH: ${activeModel}`);
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
      }
      return { text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
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
  }, undefined, getProviderFallbackModel(runtimeSettings.provider));
};
