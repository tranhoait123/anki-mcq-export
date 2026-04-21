
export interface Explanation {
  core: string;      // Đáp án cốt lõi
  evidence: string;  // Bằng chứng tài liệu
  analysis: string;  // Phân tích sâu
  warning: string;   // Lưu ý
}

export interface MCQ {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: Explanation; // Chuyển từ string sang object cấu trúc
  source: string;
  difficulty: string;
  depthAnalysis: string;
}

export interface GeneratedResponse {
  questions: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: Explanation;
    source: string;
    difficulty: string;
    depthAnalysis: string;
  }[];
  duplicates?: DuplicateInfo[];
  failedBatches?: number[];
  autoSkippedCount: number;
}

export interface DuplicateInfo {
  id: string;  // Unique ID for stable restore
  question: string;
  reason: string;
  matchedWith: string;
  // Full question data for restore functionality
  fullData: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: Explanation;
    source: string;
    difficulty: string;
    depthAnalysis: string;
  };
  matchedData?: MCQ; // The existing MCQ that it matched with
}

export interface AnalysisResult {
  topic: string;
  estimatedCount: number;
  questionRange: string;
  confidence: string;
}

export interface AuditResult {
  status: 'warning' | 'success';
  missingPercentage: number;
  reasons: string[];
  problematicSections: string[];
  advice: string;
}

export interface UploadedFile {
  id: string; // Unique ID for tracking
  name: string;
  type: string;
  content: string;
  size?: number; // Added to fix lint error
  isProcessing?: boolean;
  progress?: number;
}

export type ProgressCallback = (message: string, count: number) => void;
export type BatchCallback = (newQuestions: MCQ[]) => void;

export interface AppSettings {
  apiKey: string;
  shopAIKeyKey: string;
  openRouterKey?: string;
  vertexProjectId?: string;
  vertexLocation?: string;
  vertexAccessToken?: string;
  provider: 'google' | 'shopaikey' | 'openrouter' | 'vertexai';
  model: string;
  customPrompt: string;
  skipAnalysis?: boolean;
  concurrencyLimit?: number;
}
