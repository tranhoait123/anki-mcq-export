
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
  name: string;
  type: string;
  content: string;
  isProcessing?: boolean;
  progress?: number;
}

export type ProgressCallback = (message: string, count: number) => void;
export type BatchCallback = (newQuestions: any[]) => void;

export interface AppSettings {
  apiKey: string;
  model: string;
  customPrompt: string;
}
