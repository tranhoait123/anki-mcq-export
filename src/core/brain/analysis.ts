import { GoogleGenAI, Type } from '@google/genai';
import { AnalysisResult, AppSettings, AuditResult, UploadedFile } from '../../types';
import { coerceModelForProvider, coerceModelForProviderInput, getProviderFallbackModel, getProviderModelMismatchMessage } from '../../utils/models';
import { getDetectedDocxMcqCount, getFileTextContent } from './batching';
import { executeWithRetry, executeWithUserRotation, userKeyRotator } from './retryExecutor';
import { getModelConfig } from './googleProvider';
import { isOpenAICompatibleProvider, callOpenAICompatibleProvider, toOpenAIContentFromFile } from './openAiProvider';
import { parseJsonFromModelText } from './parsing';
import { buildAnalyzePrompt, SYSTEM_INSTRUCTION_AUDIT } from './prompts';
import { getGoogleRequestRateLimitOptions } from './requestRateLimiter';

const filesRequireVision = (files: UploadedFile[]): boolean =>
  files.some(file => file.type === 'application/pdf' || file.type.startsWith('image/'));

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

const requireModelText = (text: string | undefined, context: string): string => {
  if (typeof text === 'string' && text.trim()) return text;
  throw new Error(`AI_FORMAT_ERROR_EMPTY_RESPONSE: ${context} không trả về nội dung.`);
};

const toGoogleContentFromFile = (file: UploadedFile): any => {
  if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
    return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
  }
  return { text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
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
  const finalPrompt = buildAnalyzePrompt();

  if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
    return await executeWithRetry(async () => {
      const parts = files.map(toOpenAIContentFromFile);
      const text = await callOpenAICompatibleProvider(runtimeSettings, runtimeSettings.model, [
        { role: 'system', content: finalPrompt },
        { role: 'user', content: parts }
      ]);
      return normalizeAnalysisResult(parseJsonFromModelText(text));
    });
  }

  userKeyRotator.init(runtimeSettings.apiKey, 1);
  return await executeWithUserRotation(runtimeSettings.model, async (apiKey, activeModel, attemptContext) => {
    if (!activeModel.startsWith('gemini-')) throw new Error(mismatchMessage || getProviderModelMismatchMessage('google', activeModel) || `MODEL_PROVIDER_MISMATCH: ${activeModel}`);
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = files.map(toGoogleContentFromFile);

    const schema = {
      type: Type.OBJECT,
      properties: {
        estimatedCount: { type: Type.NUMBER },
        specialty: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        hasAnswers: { type: Type.BOOLEAN },
        structureNote: { type: Type.STRING }
      },
      required: ['estimatedCount', 'specialty', 'confidence', 'hasAnswers', 'structureNote']
    };

    const chat = ai.chats.create(getModelConfig(apiKey, finalPrompt, schema, activeModel, undefined, undefined, {
      timeoutMs: attemptContext.timeoutMs,
      signal: attemptContext.signal,
    }));
    const result = await chat.sendMessage({ message: parts });
    return normalizeAnalysisResult(parseJsonFromModelText(requireModelText(result.text, 'Phân tích tài liệu')));
  }, undefined, getProviderFallbackModel(runtimeSettings.provider, runtimeSettings.model), undefined, undefined, getGoogleRequestRateLimitOptions(runtimeSettings));
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
        { role: 'system', content: SYSTEM_INSTRUCTION_AUDIT },
        {
          role: 'user',
          content: [
            ...parts,
            { type: 'text', text: `Quá trình trích xuất chỉ lấy được ${count} câu hỏi. Hãy phân tích lý do.` }
          ]
        }
      ]);
      return parseJsonFromModelText<AuditResult>(text);
    });
  }

  userKeyRotator.init(runtimeSettings.apiKey, 1);
  return await executeWithUserRotation(runtimeSettings.model, async (apiKey, activeModel, attemptContext) => {
    if (!activeModel.startsWith('gemini-')) throw new Error(mismatchMessage || getProviderModelMismatchMessage('google', activeModel) || `MODEL_PROVIDER_MISMATCH: ${activeModel}`);
    const parts: any[] = files.map(toGoogleContentFromFile);

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
      required: ['status', 'reasons', 'advice', 'problematicSections']
    };

    const chat = ai.chats.create(getModelConfig(apiKey, SYSTEM_INSTRUCTION_AUDIT, schema, activeModel, undefined, undefined, {
      timeoutMs: attemptContext.timeoutMs,
      signal: attemptContext.signal,
    }));
    const res = await chat.sendMessage({
      message: [
        ...parts,
        { text: `Quá trình trích xuất chỉ lấy được ${count} câu hỏi. Hãy phân tích lý do.` }
      ]
    });
    return parseJsonFromModelText<AuditResult>(requireModelText(res.text, 'Audit câu hỏi thiếu'));
  }, undefined, getProviderFallbackModel(runtimeSettings.provider, runtimeSettings.model), undefined, undefined, getGoogleRequestRateLimitOptions(runtimeSettings));
};
