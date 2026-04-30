export const translateErrorForUser = (error: any, context?: string): string => {
  const msg = error?.message || String(error) || "";
  const msgLow = msg.toLowerCase();
  const statusCode = error?.status || error?.statusCode || 0;
  const prefix = context ? `[${context}] ` : "";
  const providerModel = msg.match(/model=([^|]+)/)?.[1]?.trim();
  const providerDetail = msg.includes('|') ? msg.split('|').slice(2).join('|').trim() : '';
  const providerSuffix = `${providerModel ? ` Model: ${providerModel}.` : ''}${providerDetail ? ` Chi tiết: ${providerDetail}` : ''}`;

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

  if (statusCode === 403 || msgLow.includes("403") || msgLow.includes("permission denied") || msgLow.includes("forbidden")) {
    return `${prefix}🔑 API Key không có quyền truy cập. Hãy kiểm tra: Key đã bật Gemini API chưa? Key có bị vô hiệu hóa không? (Mã lỗi: 403)`;
  }
  if ((msgLow.includes("api key") || msgLow.includes("api_key")) && (msgLow.includes("invalid") || msgLow.includes("not found") || msgLow.includes("expired"))) {
    return `${prefix}🔑 API Key không hợp lệ hoặc đã hết hạn. Vui lòng vào Cài đặt → kiểm tra lại API Key.`;
  }
  if (msgLow.includes("401") || msgLow.includes("unauthenticated") || statusCode === 401) {
    return `${prefix}🔑 Xác thực thất bại. Vui lòng kiểm tra API Key trong phần Cài đặt.`;
  }

  if (statusCode === 429 || msgLow.includes("429") || msgLow.includes("quota") || msgLow.includes("resource_exhausted") || msgLow.includes("exhausted")) {
    return `${prefix}⏳ Hệ thống đang nhận quá nhiều yêu cầu (hết hạn mức). Vui lòng chờ 1-2 phút rồi thử lại. Nếu lỗi tiếp tục, hãy thêm nhiều API Key trong Cài đặt.`;
  }

  if (statusCode === 503 || msgLow.includes("503") || msgLow.includes("unavailable") || msgLow.includes("overloaded")) {
    return `${prefix}🔄 Server AI đang quá tải tạm thời. Hệ thống sẽ tự động thử lại. Nếu lỗi kéo dài, vui lòng chờ 2-3 phút.`;
  }
  if (statusCode === 500 || msgLow.includes("500") || msgLow.includes("internal")) {
    return `${prefix}⚠️ Lỗi phía server AI (lỗi nội bộ). Vui lòng thử lại sau ít phút.`;
  }
  if (msgLow.includes("deadline") || msgLow.includes("504") || statusCode === 504) {
    return `${prefix}⏱️ Yêu cầu quá thời gian chờ. Tài liệu có thể quá dài — hãy thử chia nhỏ file hoặc giảm số trang.`;
  }

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

  if (msgLow.includes("pdf") && (msgLow.includes("lỗi") || msgLow.includes("error"))) {
    return `${prefix}📄 Lỗi đọc file PDF. File có thể bị hỏng hoặc được bảo vệ bằng mật khẩu. Hãy thử chuyển sang ảnh rồi tải lại.`;
  }
  if (msgLow.includes("ocr failed")) {
    return `${prefix}📷 Nhận dạng chữ từ ảnh thất bại. Ảnh có thể quá mờ hoặc không chứa văn bản. Thử với ảnh có độ phân giải cao hơn.`;
  }

  if (msgLow.includes("tất cả") && msgLow.includes("keys") && msgLow.includes("lỗi")) {
    return msg;
  }
  if (msgLow.includes("đã thử luân phiên") || msgLow.includes("quá tải")) {
    return msg;
  }

  if (msg.startsWith("🔑") || msg.startsWith("⏳") || msg.startsWith("🔄") || msg.startsWith("📄") || msg.startsWith("🌐")) {
    return msg;
  }

  const shortMsg = msg.length > 120 ? msg.substring(0, 120) + "..." : msg;
  return `${prefix}❌ Đã xảy ra lỗi không mong muốn: ${shortMsg}. Vui lòng thử lại hoặc liên hệ hỗ trợ.`;
};

export const parseRetryAfterHeaderMs = (headers?: Headers): number | undefined => {
  const rawValue = headers?.get('retry-after');
  if (!rawValue) return undefined;
  const asSeconds = Number(rawValue);
  if (Number.isFinite(asSeconds) && asSeconds > 0) return Math.round(asSeconds * 1000);

  const retryDate = Date.parse(rawValue);
  if (Number.isFinite(retryDate)) {
    const delayMs = retryDate - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  }

  return undefined;
};

const normalizeRetryDelayMs = (value: number, unit: string): number => {
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit.startsWith('ms')) return Math.round(value);
  if (normalizedUnit.startsWith('m')) return Math.round(value * 60 * 1000);
  return Math.round(value * 1000);
};

export const getRetryDelayMsFromError = (error: any): number | undefined => {
  const hintedDelay = Number(error?.retryAfterMs || error?.providerRetryDelayMs || 0);
  if (Number.isFinite(hintedDelay) && hintedDelay > 0) return hintedDelay;

  const text = String(error?.message || error || '');
  if (!text) return undefined;

  const retryWithUnitPatterns = [
    /retry(?:ing)?\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|minutes?)/i,
    /please retry in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|minutes?)/i,
    /retry(?:_delay|delay)?["'\s:=]+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|minutes?)/i,
  ];

  for (const pattern of retryWithUnitPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    return normalizeRetryDelayMs(value, match[2]);
  }

  const retrySecondsMatch = text.match(/retry(?:_delay|delay)?["'\s:=]+(\d+(?:\.\d+)?)s/i);
  if (retrySecondsMatch) {
    const value = Number(retrySecondsMatch[1]);
    if (Number.isFinite(value) && value > 0) return Math.round(value * 1000);
  }

  return undefined;
};

export const createProviderApiError = async (providerName: string, response: Response, modelName: string): Promise<Error> => {
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
  const error: Error & { status?: number; statusCode?: number; retryAfterMs?: number } = new Error(
    `${providerName} API Error: ${response.status} | model=${modelName}${cleanDetail ? ` | ${cleanDetail}` : ''}`
  );
  error.status = response.status;
  error.statusCode = response.status;
  const retryAfterMs = parseRetryAfterHeaderMs(response.headers) ?? getRetryDelayMsFromError({ message: detail });
  if (retryAfterMs) error.retryAfterMs = retryAfterMs;
  return error;
};
