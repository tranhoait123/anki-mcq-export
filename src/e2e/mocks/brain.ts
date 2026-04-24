import { AnalysisResult, AppSettings, AuditResult, GeneratedResponse, MCQ, UploadedFile } from '../../types';

const mockQuestion: MCQ = {
  id: 'e2e-q1',
  question: 'Câu 1: Đâu là đáp án đúng trong smoke test?',
  options: ['A. Sai', 'B. Đúng', 'C. Gần đúng', 'D. Không đủ dữ kiện'],
  correctAnswer: 'B',
  explanation: {
    core: 'Đáp án đúng là B.',
    evidence: 'Mock e2e không gọi API thật.',
    analysis: 'Câu hỏi này xác nhận luồng upload, extract và export hoạt động.',
    warning: '',
  },
  source: 'e2e-smoke.txt',
  difficulty: 'Easy',
  depthAnalysis: 'Nhận biết',
};

export const hashFiles = async (files: UploadedFile[]) =>
  files.map(file => `${file.id}:${file.name}:${file.size || file.content.length}`).join('|');

export const translateErrorForUser = (error: any, context = 'Xử lý') =>
  `${context}: ${error?.message || 'Lỗi mock e2e'}`;

export const analyzeDocument = async (_files: UploadedFile[], _settings: AppSettings): Promise<AnalysisResult> => ({
  topic: 'E2E smoke',
  estimatedCount: 1,
  questionRange: '1',
  confidence: 'High',
});

export const auditMissingQuestions = async (_files: UploadedFile[], _count: number, _settings: AppSettings): Promise<AuditResult> => ({
  status: 'success',
  missingPercentage: 0,
  reasons: [],
  problematicSections: [],
  advice: 'Mock audit passed.',
});

export const generateQuestions = async (
  _files: UploadedFile[],
  _settings: AppSettings,
  _startIndex: number,
  onProgress?: (status: string, count: number) => void,
  _expectedQuestionCount?: number,
  onBatch?: (newQuestions: MCQ[]) => void
): Promise<GeneratedResponse> => {
  onProgress?.('Mock e2e đang trích xuất...', 1);
  onBatch?.([mockQuestion]);
  await new Promise(resolve => setTimeout(resolve, 10));
  return {
    questions: [mockQuestion],
    duplicates: [],
    failedBatches: [],
    failedBatchDetails: [],
    autoSkippedCount: 0,
  };
};
