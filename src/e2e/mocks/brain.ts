import { AnalysisResult, AppSettings, AuditResult, GeneratedResponse, MCQ, SourceTrace, UploadedFile } from '../../types';

const getTraceMode = (file: UploadedFile): SourceTrace['mode'] => {
  if (file.type === 'application/pdf') return 'pdfVision';
  if (file.type.startsWith('image/')) return 'image';
  if (file.name.toLowerCase().endsWith('.docx')) return 'docxText';
  return 'text';
};

const makeMockQuestion = (files: UploadedFile[], id = 1): MCQ => {
  const file = files[0] || {
    id: 'e2e-file',
    name: 'e2e-smoke.txt',
    type: 'text/plain',
    content: '',
  };

  return {
    id: `e2e-q${id}`,
    question: `Câu ${id}: Đâu là đáp án đúng trong smoke test?`,
    options: ['A. Sai', 'B. Đúng', 'C. Gần đúng', 'D. Không đủ dữ kiện'],
    correctAnswer: 'B',
    explanation: {
      core: 'Đáp án đúng là B.',
      evidence: 'Mock e2e không gọi API thật.',
      analysis: 'Câu hỏi này xác nhận luồng upload, extract và export hoạt động.',
      warning: '',
    },
    source: file.name,
    trace: {
      fileId: file.id,
      fileName: file.name,
      sourceLabel: file.name,
      mode: getTraceMode(file),
      snippet: `Câu ${id}. Đâu là đáp án đúng?`,
    },
    difficulty: 'Easy',
    depthAnalysis: 'Nhận biết',
  };
};

const makeLargeMockQuestions = (files: UploadedFile[], count = 350): MCQ[] =>
  Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const question = makeMockQuestion(files, id);
    return {
      ...question,
      question: `Câu ${id}: Large list smoke item ${id} cần review mượt?`,
      difficulty: id % 3 === 0 ? 'Hard' : id % 2 === 0 ? 'Medium' : 'Easy',
      explanation: {
        ...question.explanation,
        analysis: `Large list mock explanation ${id}.`,
      },
    };
  });

const makeSharedCaseQuestion = (files: UploadedFile[]): MCQ => {
  const file = files[0] || {
    id: 'e2e-shared-case',
    name: 'e2e-shared-case.txt',
    type: 'text/plain',
    content: '',
  };
  const stem = 'Tình huống cho câu 11-12-13-14: Bệnh nhân nữ có siêu âm tử cung trống beta 1300. Siêu âm có 1 khối echo hỗn hợp cạnh buồng trứng.';

  return {
    id: 'e2e-shared-case-q11',
    question: `[TÌNH HUỐNG]\n${stem}\n\n[CÂU HỎI]\nCâu 11: Chẩn đoán:`,
    options: [
      'A. Thai chưa xác định vị trí.',
      'B. Thai ngoài tử cung.',
      'C. Xảy thai trọn.',
      'D. Thai nghén thất bại sớm.',
    ],
    correctAnswer: 'A',
    explanation: {
      core: 'Thai chưa xác định vị trí là đáp án phù hợp nhất trong mock e2e.',
      evidence: 'Mock e2e kiểm tra tình huống chung được giữ trong từng thẻ.',
      analysis: 'Câu hỏi riêng lẻ sẽ mất nghĩa nếu thiếu beta-hCG và siêu âm.',
      warning: '',
    },
    source: file.name,
    trace: {
      fileId: file.id,
      fileName: file.name,
      sourceLabel: file.name,
      mode: getTraceMode(file),
      snippet: stem,
    },
    sharedCase: {
      applied: true,
      confidence: 'explicit',
      stem,
      startQuestion: 11,
      endQuestion: 14,
      sourceLabel: file.name,
    },
    difficulty: 'Medium',
    depthAnalysis: 'Giữ clinical vignette trong từng thẻ Anki.',
  };
};

export const hashFiles = async (files: UploadedFile[]) =>
  files.map(file => `${file.id}:${file.name}:${file.size || file.content.length}`).join('|');

export const translateErrorForUser = (error: any, context = 'Xử lý') =>
  `${context}: ${error?.message || 'Lỗi mock e2e'}`;

export const analyzeDocument = async (files: UploadedFile[], _settings: AppSettings): Promise<AnalysisResult> => {
  const fileName = files[0]?.name || '';
  const estimatedCount = fileName === 'e2e-heavy-postprocess.txt'
    ? 420
    : fileName === 'e2e-stream-large.txt'
    ? 320
    : fileName === 'e2e-large.txt'
    ? 350
    : 1;
  return {
    topic: 'E2E smoke',
    estimatedCount,
    questionRange: estimatedCount === 1 ? '1' : `1-${estimatedCount}`,
    confidence: 'High',
  };
};

export const auditMissingQuestions = async (_files: UploadedFile[], _count: number, _settings: AppSettings): Promise<AuditResult> => ({
  status: 'success',
  missingPercentage: 0,
  reasons: [],
  problematicSections: [],
  advice: 'Mock audit passed.',
});

export const validateShopAIKeyConnection = async () => ({
  ok: true,
  message: 'Mock ShopAIKey connection passed.',
  models: ['gemini-3.1-flash-lite-preview'],
  selectedModel: 'gemini-3.1-flash-lite-preview',
  selectedModelAvailable: true,
});

export const generateQuestions = async (
  files: UploadedFile[],
  _settings: AppSettings,
  _startIndex: number,
  onProgress?: (status: string, count: number) => void,
  _expectedQuestionCount?: number,
  onBatch?: (newQuestions: MCQ[]) => void,
  retryIndices?: number[],
  _isAdvancedMode?: boolean,
  options: { autoRescue?: boolean; existingQuestions?: MCQ[] } = {}
): Promise<GeneratedResponse> => {
  if (files[0]?.name === 'e2e-retry.txt') {
    if (retryIndices?.length) {
      if (options.autoRescue) {
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          questions: options.existingQuestions || [],
          duplicates: [],
          failedBatches: [1],
          failedBatchDetails: [{
            index: 1,
            label: '1',
            kind: 'format',
            stage: 'rescue',
            message: 'Mock auto-rescue still failed',
            advice: 'Quét lại thủ công.',
          }],
          autoSkippedCount: 0,
        };
      }

      const retryQuestion = makeMockQuestion(files, 3);
      onProgress?.('Mock e2e đang quét lại batch lỗi...', (options.existingQuestions || []).length + 1);
      onBatch?.([retryQuestion]);
      await new Promise(resolve => setTimeout(resolve, 10));
      return {
        questions: [...(options.existingQuestions || []), retryQuestion],
        duplicates: [],
        failedBatches: [],
        failedBatchDetails: [],
        autoSkippedCount: 0,
      };
    }

    const firstPass = [makeMockQuestion(files, 1), makeMockQuestion(files, 2)];
    onProgress?.('Mock e2e đang trích xuất một phần...', firstPass.length);
    onBatch?.(firstPass);
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      questions: firstPass,
      duplicates: [],
      failedBatches: [1],
      failedBatchDetails: [{
        index: 1,
        label: '1',
        kind: 'format',
        stage: 'normal',
        message: 'Mock malformed JSON',
        advice: 'Quét lại batch lỗi.',
      }],
      autoSkippedCount: 0,
    };
  }

  if (files[0]?.name === 'e2e-shared-case.txt') {
    const mockQuestion = makeSharedCaseQuestion(files);
    onProgress?.('Mock e2e đang ghép tình huống chung...', 1);
    onBatch?.([mockQuestion]);
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      questions: [mockQuestion],
      duplicates: [],
      failedBatches: [],
      failedBatchDetails: [],
      autoSkippedCount: 0,
    };
  }

  if (files[0]?.name === 'e2e-large.txt') {
    const questions = makeLargeMockQuestions(files);
    for (let index = 0; index < questions.length; index += 50) {
      const batch = questions.slice(index, index + 50);
      onProgress?.('Mock e2e đang trích xuất danh sách lớn...', index + batch.length);
      onBatch?.(batch);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {
      questions,
      duplicates: [],
      failedBatches: [],
      failedBatchDetails: [],
      autoSkippedCount: 0,
    };
  }

  if (files[0]?.name === 'e2e-stream-large.txt') {
    const questions = makeLargeMockQuestions(files, 320).map((question, index) => ({
      ...question,
      question: `Câu ${index + 1}: Large stream item ${index + 1} vẫn nhập tìm kiếm mượt?`,
    }));
    for (let index = 0; index < questions.length; index += 20) {
      const batch = questions.slice(index, index + 20);
      onProgress?.('Mock e2e đang nhận danh sách lớn...', index + batch.length);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    for (let index = 0; index < questions.length; index += 80) {
      onBatch?.(questions.slice(index, index + 80));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {
      questions,
      duplicates: [],
      failedBatches: [],
      failedBatchDetails: [],
      autoSkippedCount: 0,
    };
  }

  if (files[0]?.name === 'e2e-heavy-postprocess.txt') {
    const questions = makeLargeMockQuestions(files, 420).map((question, index) => ({
      ...question,
      question: `Câu ${index + 1}: Heavy postprocess item ${index + 1} vẫn không đứng UI?`,
    }));
    for (let index = 0; index < questions.length; index += 30) {
      const batch = questions.slice(index, index + 30);
      onProgress?.(`Mock e2e đang nhận dữ liệu lớn... ${index + batch.length}/${questions.length}`, 0);
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    for (let index = 0; index < questions.length; index += 70) {
      onProgress?.(`Mock e2e đang hậu xử lý dữ liệu lớn... ${Math.min(index + 70, questions.length)}/${questions.length}`, index);
      onBatch?.(questions.slice(index, index + 70));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return {
      questions,
      duplicates: [],
      failedBatches: [],
      failedBatchDetails: [],
      autoSkippedCount: 0,
    };
  }

  const mockQuestion = makeMockQuestion(files);
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
