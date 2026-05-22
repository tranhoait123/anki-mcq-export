import { describe, expect, it } from 'vitest';
import {
  classifyBatchError,
  describeBatchError,
  getBackoffDelayMs,
  getRetryDecision,
  getRetryProfile,
  shouldSplitForError,
  splitTextIntoNaturalParts,
} from './retryStrategy';
import { estimateMarkdownQuestions } from '../ui/FileUploader';

describe('batch retry strategy', () => {
  it('classifies JSON and empty responses as split-worthy errors', () => {
    expect(classifyBatchError(new Error('AI_FORMAT_ERROR_TRUNCATED'))).toBe('format');
    expect(classifyBatchError(new Error('Không tìm thấy câu hỏi trắc nghiệm'))).toBe('empty');
    expect(shouldSplitForError('format')).toBe(true);
    expect(shouldSplitForError('empty')).toBe(true);
  });

  it('classifies rate/server errors for short rescue retry', () => {
    expect(classifyBatchError(new Error('OpenRouter API Error: 429'))).toBe('rateLimit');
    expect(classifyBatchError(new Error('Gemini API Error: too many requests; rate limit exceeded'))).toBe('rateLimit');
    expect(classifyBatchError({ statusCode: 429, message: 'RetryInfo quota exhausted' })).toBe('rateLimit');
    expect(classifyBatchError(new Error('Gemini overloaded 503'))).toBe('serverBusy');
    expect(classifyBatchError(new Error('ShopAIKey NETWORK_ERROR: Failed to fetch | model=gpt-5.4-mini'))).toBe('serverBusy');
    expect(getRetryProfile('rescue').minAttempts).toBeLessThan(getRetryProfile('normal').minAttempts);
    expect(getRetryProfile('rescue').backoffCapMs).toBeLessThan(getRetryProfile('normal').backoffCapMs);
    expect(getRetryProfile('rescue').maxElapsedMs).toBeGreaterThan(45_000);
  });

  it('preserves provider-pressure metadata when a retry executor wraps the error', () => {
    const wrappedServerBusy = Object.assign(new Error('AI_FORMAT_ERROR_TRUNCATED'), {
      retryKind: 'serverBusy',
      retryCause: 'serverBusy',
    });
    const wrappedRateLimit = Object.assign(new Error('RETRY_BUDGET_EXHAUSTED'), {
      retryKind: 'rateLimit',
      retryCause: 'softRateLimit',
      retryAfterMs: 45000,
    });

    expect(classifyBatchError(wrappedServerBusy)).toBe('serverBusy');
    expect(describeBatchError(wrappedServerBusy).kind).toBe('serverBusy');
    expect(getRetryDecision(wrappedServerBusy, getRetryProfile('normal'), 1)).toMatchObject({
      kind: 'serverBusy',
      cause: 'serverBusy',
      action: 'retry',
    });
    expect(classifyBatchError(wrappedRateLimit)).toBe('rateLimit');
    expect(getRetryDecision(wrappedRateLimit, getRetryProfile('normal'), 1)).toMatchObject({
      kind: 'rateLimit',
      cause: 'softRateLimit',
      action: 'retry',
      retryDelayMs: 45000,
    });
  });

  it('separates hard quota from soft throttling decisions', () => {
    const hardQuota = getRetryDecision(new Error('429 RESOURCE_EXHAUSTED: exceeded your current quota, check billing'), getRetryProfile('normal'), 1);
    const softThrottle = getRetryDecision({ statusCode: 429, message: 'too many requests', retryAfterMs: 12000 }, getRetryProfile('normal'), 1);
    const quota403 = getRetryDecision({ statusCode: 403, message: 'PERMISSION_DENIED: userRateLimitExceeded rate limit exceeded', retryAfterMs: 12000 }, getRetryProfile('normal'), 1);
    const perMinuteQuota = getRetryDecision({ statusCode: 429, message: 'Quota exceeded for quota metric GenerateRequestsPerMinute per minute' }, getRetryProfile('normal'), 1);

    expect(hardQuota.kind).toBe('rateLimit');
    expect(hardQuota.cause).toBe('hardQuota');
    expect(hardQuota.action).toBe('fail');
    expect(softThrottle.cause).toBe('softRateLimit');
    expect(softThrottle.action).toBe('retry');
    expect(softThrottle.retryDelayMs).toBe(12000);
    expect(classifyBatchError({ statusCode: 403, message: 'quota exceeded for quota metric userRateLimitExceeded' })).toBe('rateLimit');
    expect(quota403.kind).toBe('rateLimit');
    expect(quota403.cause).toBe('softRateLimit');
    expect(quota403.action).toBe('retry');
    expect(perMinuteQuota.kind).toBe('rateLimit');
    expect(perMinuteQuota.cause).toBe('softRateLimit');
    expect(perMinuteQuota.action).toBe('retry');
  });

  it('splits oversized requests immediately instead of retrying the same payload', () => {
    const decision = getRetryDecision({ statusCode: 413, message: 'context length exceeded; request too large' }, getRetryProfile('normal'), 1);

    expect(classifyBatchError({ statusCode: 413, message: 'request too large' })).toBe('format');
    expect(decision.cause).toBe('requestTooLarge');
    expect(decision.action).toBe('split');
  });

  it('retries transient server errors and only recommends fallback after repeated attempts', () => {
    const first = getRetryDecision(new Error('503 UNAVAILABLE model overloaded'), getRetryProfile('normal'), 1);
    const second = getRetryDecision(new Error('503 UNAVAILABLE model overloaded'), getRetryProfile('normal'), 2);
    const rescueSecond = getRetryDecision(new Error('503 UNAVAILABLE model overloaded'), getRetryProfile('rescue'), 2);
    const later = getRetryDecision(new Error('503 UNAVAILABLE model overloaded'), getRetryProfile('normal'), 7);

    expect(first.kind).toBe('serverBusy');
    expect(first.action).toBe('retry');
    expect(second.action).toBe('split');
    expect(rescueSecond.action).toBe('split');
    expect(first.cooldownKind).toBeUndefined();
    expect(first.shouldTryFallbackModel).toBe(false);
    expect(later.shouldTryFallbackModel).toBe(true);
  });

  it('fails auth errors without retry or split', () => {
    const decision = getRetryDecision(new Error('403 permission denied API key not valid'), getRetryProfile('normal'), 1);

    expect(decision.kind).toBe('auth');
    expect(decision.action).toBe('fail');
    expect(shouldSplitForError(decision.kind)).toBe(false);
  });

  it('does not split auth failures', () => {
    expect(classifyBatchError(new Error('403 permission denied'))).toBe('auth');
    expect(classifyBatchError(new Error('API_KEY_INVALID: API key not valid'))).toBe('auth');
    expect(classifyBatchError(new Error('Gemini API Error: API key invalid'))).toBe('auth');
    expect(classifyBatchError(new Error('invalid_grant token expired'))).toBe('auth');
    expect(shouldSplitForError('auth')).toBe(false);
    expect(describeBatchError(new Error('403 permission denied')).advice).toContain('API key');
  });

  it('does not treat generic 400 request/model errors as invalid keys', () => {
    expect(classifyBatchError({ statusCode: 400, message: '400 INVALID_ARGUMENT: response_schema is invalid for this model' })).toBe('fatal');
    expect(classifyBatchError(new Error('400 INVALID_ARGUMENT: model does not support response_format'))).toBe('fatal');
    expect(classifyBatchError(new Error('400 INVALID_ARGUMENT: API_KEY_INVALID: API key not valid'))).toBe('auth');
    expect(classifyBatchError(new Error('SHOPAIKEY_DEEPSEEK_VISION_GROUP_UNSUPPORTED: scan-only input'))).toBe('fatal');
    expect(classifyBatchError(new Error('ShopAIKey API Error: 500 | model=deepseek-v4-flash | no available channel for group cheap,gemini model deepseek-v4-flash'))).toBe('fatal');
  });

  it('splits text on natural boundaries without empty parts', () => {
    const text = [
      'Đoạn 1. Câu hỏi A có nhiều dữ kiện lâm sàng.',
      'Đoạn 2. Câu hỏi B có nhiều dữ kiện lâm sàng.',
      'Đoạn 3. Câu hỏi C có nhiều dữ kiện lâm sàng.',
      'Đoạn 4. Câu hỏi D có nhiều dữ kiện lâm sàng.',
      'Đoạn 5. Câu hỏi E có nhiều dữ kiện lâm sàng.',
    ].join('\n\n').repeat(12);

    const parts = splitTextIntoNaturalParts(text, 4, 250);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(4);
    expect(parts.every(part => part.trim().length > 0)).toBe(true);
    expect(parts.join('').length).toBeGreaterThan(text.length * 0.95);
  });

  it('keeps clinical case stems and their corresponding questions in the same part during split', () => {
    const text = [
      'Câu 1. Câu hỏi thường không thuộc tình huống lâm sàng.',
      'Tình huống lâm sàng (Câu 2 đến Câu 3): Bệnh nhân nam 60 tuổi vào viện vì đau ngực cấp tính dữ dội sau xương ức kéo dài 2 giờ.',
      'Câu 2: Chẩn đoán sơ bộ nào sau đây là phù hợp nhất cho bệnh nhân này?',
      'A. Nhồi máu cơ tim cấp.',
      'B. Phình tách động mạch chủ ngực.',
      'C. Viêm màng ngoài tim cấp.',
      'D. Thuyên tắc phổi cấp.',
      'Câu 3: Xét nghiệm cận lâm sàng nào cần được ưu tiên thực hiện ngay?',
      'A. Điện tâm đồ 12 chuyển đạo.',
      'B. Siêu âm tim tại giường.',
      'C. Chụp CT động mạch chủ ngực.',
      'D. Định lượng Troponin I huyết thanh.',
      'Câu 4. Câu hỏi thường tiếp theo không liên quan đến tình huống trên.',
    ].join('\n\n');

    // Chạy chia nhỏ thành 2 phần
    const parts = splitTextIntoNaturalParts(text, 2, 100);
    expect(parts.length).toBe(2);

    // Kiểm tra xem phần chứa Tình huống lâm sàng có bị cắt đôi hay không.
    // Toàn bộ cụm từ Tình huống lâm sàng, Câu 2 và Câu 3 PHẢI nằm trọn vẹn trong cùng 1 phần!
    const part1HasStem = parts[0].includes('Tình huống lâm sàng');
    const part1HasQ2 = parts[0].includes('Câu 2');
    const part1HasQ3 = parts[0].includes('Câu 3');

    const part2HasStem = parts[1].includes('Tình huống lâm sàng');
    const part2HasQ2 = parts[1].includes('Câu 2');
    const part2HasQ3 = parts[1].includes('Câu 3');

    if (part1HasStem) {
      expect(part1HasQ2).toBe(true);
      expect(part1HasQ3).toBe(true);
      expect(part2HasStem).toBe(false);
      expect(part2HasQ2).toBe(false);
      expect(part2HasQ3).toBe(false);
    } else {
      expect(part2HasStem).toBe(true);
      expect(part2HasQ2).toBe(true);
      expect(part2HasQ3).toBe(true);
      expect(part1HasStem).toBe(false);
      expect(part1HasQ2).toBe(false);
      expect(part1HasQ3).toBe(false);
    }
  });

  it('caps rescue backoff lower than normal backoff', () => {
    const normal = getBackoffDelayMs(getRetryProfile('normal'), 8, 8, true, false, false, false, () => 1);
    const rescue = getBackoffDelayMs(getRetryProfile('rescue'), 8, 8, true, false, false, false, () => 1);
    expect(rescue).toBeLessThan(normal);
    expect(rescue).toBeLessThanOrEqual(getRetryProfile('rescue').backoffCapMs);
  });
  it('prioritizes Markdown headers and horizontal rules as split boundaries', () => {
    const text = [
      'Câu 1: Câu hỏi khởi đầu.',
      'A. Lựa chọn A.',
      'B. Lựa chọn B.',
      '---',
      '# Tiêu đề Markdown lớn',
      'Nội dung phần 2 rất dài cần được thảo luận chi tiết để đảm bảo hệ thống chia đúng.',
      'Một đoạn văn khác bổ sung thêm thông tin cho phần 2 để tăng độ dài ký tự.',
    ].join('\n\n');

    const parts = splitTextIntoNaturalParts(text, 2, 50);
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain('---');
    expect(parts[1]).toContain('# Tiêu đề Markdown lớn');
  });

  it('protects Markdown blockquotes as clinical protected ranges', () => {
    const text = [
      'Câu 1: Câu hỏi thứ nhất.',
      'A. Lựa chọn A.',
      `> Tình huống lâm sàng đặc biệt trong blockquote:
> Bệnh nhân nam 45 tuổi nhập viện vì cơn hen phế quản cấp tính.
> Tiền sử có dị ứng với aspirin và hen phế quản từ nhỏ.`,
      'Câu 2: Câu hỏi dựa trên blockquote trên.',
      'A. Lựa chọn A.',
      'B. Lựa chọn B.',
    ].join('\n\n');

    const parts = splitTextIntoNaturalParts(text, 2, 25);
    expect(parts.length).toBe(2);

    const part1HasBQStart = parts[0].includes('> Tình huống lâm sàng');
    const part1HasBQEnd = parts[0].includes('> Tiền sử có dị ứng');
    const part2HasBQStart = parts[1].includes('> Tình huống lâm sàng');
    const part2HasBQEnd = parts[1].includes('> Tiền sử có dị ứng');

    if (part1HasBQStart) {
      expect(part1HasBQEnd).toBe(true);
    } else if (part2HasBQStart) {
      expect(part2HasBQEnd).toBe(true);
    }
  });

  it('estimates Markdown MCQ count accurately using estimateMarkdownQuestions', () => {
    const textWithLabels = `
# Chương 1
Câu 1: Triệu chứng chính của viêm ruột thừa cấp là gì?
A. Đau hố chậu phải
B. Sốt cao kèm rét run
C. Nôn mửa liên tục
D. Tiêu chảy cấp

Cau 2. Dấu hiệu thực thể quan trọng nhất là?
A. Điểm Mac-Burney ấn đau
B. Phản ứng thành bụng hố chậu phải
C. Dấu hiệu Blumberg dương tính
D. Tất cả đều đúng
    `;
    expect(estimateMarkdownQuestions(textWithLabels)).toBe(2);

    const textWithOptionsOnly = `
- Triệu chứng của bệnh mạch vành:
A. Đau thắt ngực khi gắng sức
B. Đau đầu âm ỉ
C. Tê bì tay chân
D. Khó thở khi nằm

- Xử trí ban đầu nhồi máu cơ tim:
A. Cho ngậm Nitroglycerin dưới lưỡi
B. Cho uống paracetamol
C. Cho tập thể dục nhẹ
D. Cho uống nhiều nước ấm
    `;
    expect(estimateMarkdownQuestions(textWithOptionsOnly)).toBe(2);

    const textWithChecklists = `
Câu hỏi 1
- [ ] Lựa chọn A
- [ ] Lựa chọn B
- [ ] Lựa chọn C
- [ ] Lựa chọn D

Câu hỏi 2
- [ ] Lựa chọn A
- [ ] Lựa chọn B
- [ ] Lựa chọn C
- [ ] Lựa chọn D
    `;
    expect(estimateMarkdownQuestions(textWithChecklists)).toBe(2);
  });
});

