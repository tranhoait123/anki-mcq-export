export {
  applyTrustedSourceLabel,
  applyTrustedSourceMetadata,
  buildSourceSnippet,
  buildPartialSalvageRecoveryParts,
  estimateOutputTokensForQuestions,
  estimateTextTokens,
  getAdaptiveQuestionBatchSize,
  getStructuredQuestionBatchSize,
  getTrustedSourceLabel,
  hashFiles,
  inferCompletedBatchIndicesFromExistingQuestions,
  STRUCTURED_QUESTION_BATCH_CAP,
} from './batching';

export {
  buildGoogleBatchMessage,
  getPdfVisionCoverageSchema,
  getModelConfig,
} from './googleProvider';

export {
  buildOpenAICompatibleProviderRequest,
  callOpenAICompatibleProvider,
  extractProviderMessageContent,
  validateShopAIKeyConnection,
} from './openAiProvider';

export {
  parseQuestionsFromModelText,
  parseJsonFromModelText,
  salvageCompleteQuestionsFromJson,
} from './parsing';

export {
  applySharedCaseContextToQuestion,
  extractSharedCaseContexts,
  getSharedCaseContextForQuestion,
  hasSharedCaseStem,
} from '../../utils/sharedCaseContext';

export {
  getRetryDelayMsFromError,
  parseRetryAfterHeaderMs,
  translateErrorForUser,
} from './providerErrors';

export {
  analyzeDocument,
  auditMissingQuestions,
} from './analysis';

export { generateQuestions } from './generation';
