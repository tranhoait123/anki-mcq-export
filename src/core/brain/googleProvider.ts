import { GoogleGenAI, Type } from "@google/genai";
import { AppSettings } from '../../types';
import { isShopAIKeyGeminiModel } from '../../utils/models';

export const SHOPAIKEY_GOOGLE_GENAI_DIRECT_BASE_URL = 'https://direct.shopaikey.com';
export const SHOPAIKEY_GOOGLE_GENAI_API_BASE_URL = 'https://api.shopaikey.com';
export const SHOPAIKEY_GOOGLE_GENAI_BASE_URL = SHOPAIKEY_GOOGLE_GENAI_DIRECT_BASE_URL;

export interface GoogleRequestRuntimeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}

export const isShopAIKeyGeminiRuntime = (settings: Pick<AppSettings, 'provider' | 'model'>): boolean =>
  settings.provider === 'shopaikey' && isShopAIKeyGeminiModel(settings.model);

export const getGoogleRuntimeApiKeys = (settings: Pick<AppSettings, 'provider' | 'apiKey' | 'shopAIKeyKey' | 'model'>): string =>
  isShopAIKeyGeminiRuntime(settings) ? settings.shopAIKeyKey : settings.apiKey;

export const getShopAIKeyGoogleBaseUrl = (settings: Pick<AppSettings, 'shopAIKeyEndpoint'>): string =>
  settings.shopAIKeyEndpoint === 'api' ? SHOPAIKEY_GOOGLE_GENAI_API_BASE_URL : SHOPAIKEY_GOOGLE_GENAI_DIRECT_BASE_URL;

export const getGoogleRuntimeBaseUrl = (settings: Pick<AppSettings, 'provider' | 'model' | 'shopAIKeyEndpoint'>): string | undefined =>
  isShopAIKeyGeminiRuntime(settings) ? getShopAIKeyGoogleBaseUrl(settings) : undefined;

export const createGoogleGenAIClient = (
  settings: Pick<AppSettings, 'provider' | 'model' | 'shopAIKeyEndpoint'>,
  apiKey: string
): GoogleGenAI => new GoogleGenAI({
  apiKey,
  ...(getGoogleRuntimeBaseUrl(settings) ? { httpOptions: { baseUrl: getGoogleRuntimeBaseUrl(settings) } } : {}),
});

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
        ...(runtimeOptions.baseUrl ? { baseUrl: runtimeOptions.baseUrl } : {}),
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

export const getPdfVisionCoverageSchema = () => ({
  type: Type.OBJECT,
  properties: {
    expectedCount: { type: Type.NUMBER },
    questionNumbers: {
      type: Type.ARRAY,
      items: { type: Type.NUMBER },
    },
    tailComplete: { type: Type.BOOLEAN },
    confidence: { type: Type.STRING },
    missingLikely: { type: Type.BOOLEAN },
    reason: { type: Type.STRING },
  },
  required: ['expectedCount', 'questionNumbers', 'tailComplete', 'confidence', 'missingLikely', 'reason'],
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
