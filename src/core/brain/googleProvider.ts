import { Type, GoogleGenAI } from "@google/genai";

export interface GoogleRequestRuntimeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const getModelConfig = (
  apiKey: string,
  systemInstruction: string,
  schema?: any,
  modelName: string = 'gemini-2.0-flash',
  cachedContent?: string,
  maxOutputTokens?: number,
  runtimeOptions: GoogleRequestRuntimeOptions = {}
) => {
  return {
    model: modelName,
    config: {
      systemInstruction,
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: schema,
      cachedContent,
      maxOutputTokens,
      abortSignal: runtimeOptions.signal,
      httpOptions: {
        ...(runtimeOptions.timeoutMs ? { timeout: runtimeOptions.timeoutMs } : {}),
        retryOptions: { attempts: 1 },
      },
    }
  };
};

export const getQuestionSchema = () => ({
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
});

const toGoogleContentPart = (part: any): any => {
  if (part.inlineData) return { inlineData: part.inlineData };
  return { text: part.text || '' };
};

export const buildGoogleBatchMessage = (part: any, batchPrompt: string, cachedContent?: string) => {
  const inlineDataParts = Array.isArray(part.inlineDataParts) ? part.inlineDataParts : [];
  if (inlineDataParts.length > 0) {
    return [
      ...(part.text ? [{ text: part.text }] : []),
      ...inlineDataParts.map((inlineData: any) => ({ inlineData })),
      { text: batchPrompt },
    ];
  }
  if (cachedContent && !part.inlineData) return [{ text: batchPrompt }];
  return [toGoogleContentPart(part), { text: batchPrompt }];
};

export interface GeminiKeyValidationResult {
  keyIndex: number;
  keyTruncated: string;
  keyRaw: string;
  ok: boolean;
  status: 'healthy' | 'authBlocked' | 'quotaBlocked' | 'serverBusy' | 'unknown';
  latencyMs?: number;
  message: string;
}

export interface GeminiBulkValidationResult {
  ok: boolean;
  totalChecked: number;
  healthyCount: number;
  results: GeminiKeyValidationResult[];
  message: string;
}

export const validateGeminiKeys = async (
  apiKeyString: string,
  modelName: string = 'gemini-2.5-flash'
): Promise<GeminiBulkValidationResult> => {
  const parts = apiKeyString.split(/[,;\n\r]+/);
  const seenKeys = new Set<string>();
  const keys = parts
    .map(k => k.trim())
    .filter(k => {
      if (k.length <= 5 || seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    });

  if (keys.length === 0) {
    return {
      ok: false,
      totalChecked: 0,
      healthyCount: 0,
      results: [],
      message: 'Vui lòng nhập danh sách API Key trước khi kiểm tra.',
    };
  }

  // Chạy song song kiểm tra từng key với timeout 8s
  const checkPromises = keys.map(async (key, index) => {
    const keyTruncated = key.length > 8 ? `${key.slice(0, 6)}...${key.slice(-4)}` : 'Key quá ngắn';
    const start = Date.now();
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      // Thử gọi một request siêu đơn giản để ping
      await ai.models.generateContent({
        model: modelName,
        contents: 'Hi',
        config: {
          maxOutputTokens: 2,
          httpOptions: {
            retryOptions: { attempts: 1 },
            timeout: 8000,
          }
        }
      });
      const latencyMs = Date.now() - start;
      return {
        keyIndex: index + 1,
        keyTruncated,
        keyRaw: key,
        ok: true,
        status: 'healthy' as const,
        latencyMs,
        message: `Hoạt động tốt (${latencyMs}ms)`,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - start;
      const errorText = String(error?.message || error || '').toLowerCase();
      let status: 'authBlocked' | 'quotaBlocked' | 'serverBusy' | 'unknown' = 'unknown';
      let message = 'Lỗi không xác định';

      if (
        errorText.includes('api_key_invalid') ||
        errorText.includes('api key not valid') ||
        errorText.includes('key not valid') ||
        errorText.includes('invalid api key') ||
        errorText.includes('invalid_key') ||
        errorText.includes('api-key invalid') ||
        errorText.includes('api key invalid')
      ) {
        status = 'authBlocked';
        message = 'Key không hợp lệ hoặc đã bị khóa';
      } else if (
        errorText.includes('quota') ||
        errorText.includes('exhausted') ||
        errorText.includes('limit') ||
        errorText.includes('429')
      ) {
        status = 'quotaBlocked';
        message = 'Hết hạn mức (Quota / Rate Limit)';
      } else if (
        errorText.includes('503') ||
        errorText.includes('overloaded') ||
        errorText.includes('timeout') ||
        errorText.includes('busy')
      ) {
        status = 'serverBusy';
        message = 'Server Google quá tải hoặc Timeout';
      } else {
        message = error?.message || 'Lỗi kết nối';
      }

      return {
        keyIndex: index + 1,
        keyTruncated,
        keyRaw: key,
        ok: false,
        status,
        latencyMs,
        message: `${message} (${latencyMs}ms)`,
      };
    }
  });

  const results = await Promise.all(checkPromises);
  const healthyCount = results.filter(r => r.ok).length;

  return {
    ok: healthyCount > 0,
    totalChecked: keys.length,
    healthyCount,
    results,
    message: healthyCount === keys.length
      ? `Tất cả ${keys.length} API Key đều hoạt động hoàn hảo!`
      : `Đã kiểm tra xong: ${healthyCount}/${keys.length} API Key hoạt động tốt. Vui lòng loại bỏ các key lỗi để tối ưu hóa hiệu năng.`,
  };
};
