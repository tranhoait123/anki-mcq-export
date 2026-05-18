import { Type } from "@google/genai";

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
