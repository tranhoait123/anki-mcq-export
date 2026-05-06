import { expect, test, type Page } from '@playwright/test';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

const uploadAndGenerate = async (
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer }
) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByText(file.name)).toBeVisible();
  await expect(page.getByText('Đã sẵn sàng')).toBeVisible();
  await page.getByTestId('analyze-button').click();
  await expect(page.getByText('Hệ thống đã sẵn sàng')).toBeVisible();
  await page.getByTestId('generate-button').click();
  await expect(page.getByTestId('result-count')).toHaveText('1');
  await expect(page.getByText('Đâu là đáp án đúng trong smoke test?')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`Nguồn: ${file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') })).toBeVisible();
};

const makeDocxBuffer = async () => {
  const longText = Array.from({ length: 12 }, (_, index) =>
    `Đoạn ${index + 1}: Đây là nội dung DOCX dùng cho e2e smoke, đủ dài để đi qua fallback văn bản sạch.`
  ).join(' ');

  return Packer.toBuffer(new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun(longText)],
          }),
        ],
      },
    ],
  }));
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('anki_mcq_settings', JSON.stringify({
      apiKey: 'fake-e2e-key',
      shopAIKeyKey: '',
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
      customPrompt: '',
      skipAnalysis: true,
      concurrencyLimit: 1,
      adaptiveBatching: true,
      batchingMode: 'safe',
    }));
  });
});

test('uploads text, extracts with mocked AI, renders result, and exports CSV', async ({ page }) => {
  await uploadAndGenerate(page, {
    name: 'e2e-smoke.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Câu 1. Đâu là đáp án đúng?\nA. Sai\nB. Đúng\nC. Gần đúng\nD. Không đủ dữ kiện'),
  });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-csv-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^\[ANKI\]_e2e_smoke_\d{4}-\d{2}-\d{2}\.csv$/);

  await page.getByRole('button', { name: /Xóa toàn bộ dữ liệu/i }).click();
  await expect(page.getByText('Xóa dữ liệu hiện tại?')).toBeVisible();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByText('Đâu là đáp án đúng trong smoke test?')).toBeVisible();

  await page.getByTitle('Thư viện bộ đề').click();
  await expect(page.getByRole('heading', { name: 'Thư viện bộ đề' })).toBeVisible();
  await expect(page.getByRole('button', { name: /e2e-smoke -/i })).toBeVisible();
  await page.getByRole('button', { name: 'Đóng' }).click();

  await page.getByRole('button', { name: /Nguồn: e2e-smoke.txt/i }).click();
  await expect(page.getByText('Tài liệu gốc')).toBeVisible();

  await page.reload();
  await page.getByTitle('Thư viện bộ đề').click();
  await expect(page.getByRole('button', { name: /e2e-smoke -/i })).toBeVisible();
});

test('uploads PDF, extracts with mocked AI, and keeps PDF source label', async ({ page }) => {
  await uploadAndGenerate(page, {
    name: 'e2e-smoke.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% e2e smoke pdf\n%%EOF'),
  });

  await expect(page.getByText('PDF vision')).toBeVisible();
});

test('uploads DOCX, shows DOCX fallback badge, extracts with mocked AI, and exports DOCX', async ({ page }) => {
  await uploadAndGenerate(page, {
    name: 'e2e-smoke.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await makeDocxBuffer(),
  });

  await expect(page.getByText('DOCX text fallback')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-docx-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^\[DOCX\]_e2e_smoke_\d{4}-\d{2}-\d{2}\.docx$/);
});

test('uploads image/OCR candidate and extracts with mocked AI', async ({ page }) => {
  await uploadAndGenerate(page, {
    name: 'e2e-smoke.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
});

test('keeps shared clinical vignette on item-set questions', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'e2e-shared-case.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from([
      'Tình huống cho câu 11-12-13-14: Bệnh nhân nữ có siêu âm tử cung trống beta 1300.',
      'Siêu âm có 1 khối echo hỗn hợp cạnh buồng trứng.',
      'Câu 11: Chẩn đoán:',
      'A. Thai chưa xác định vị trí.',
      'B. Thai ngoài tử cung.',
      'C. Xảy thai trọn.',
      'D. Thai nghén thất bại sớm.',
    ].join('\n')),
  });

  await page.getByTestId('analyze-button').click();
  await expect(page.getByText('Hệ thống đã sẵn sàng')).toBeVisible();
  await page.getByTestId('generate-button').click();

  await expect(page.getByTestId('result-count')).toHaveText('1');
  await expect(page.getByText('[TÌNH HUỐNG]')).toBeVisible();
  await expect(page.getByText('Tình huống cho câu 11-12-13-14')).toBeVisible();
  await expect(page.getByText('Bệnh nhân nữ có siêu âm tử cung trống beta 1300')).toBeVisible();
  await expect(page.getByText('[CÂU HỎI]')).toBeVisible();
  await expect(page.getByText('Câu 11: Chẩn đoán:')).toBeVisible();
  await expect(page.getByText('Đã ghép tình huống chung')).toBeVisible();
});

test('retrying failed batches appends rescued questions to existing results', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'e2e-retry.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('E2E retry should preserve existing questions and append rescued batch.'),
  });

  await page.getByTestId('analyze-button').click();
  await expect(page.getByText('Hệ thống đã sẵn sàng')).toBeVisible();
  await page.getByTestId('generate-button').click();
  await expect(page.getByTestId('result-count')).toHaveText('2');
  await expect(page.getByRole('button', { name: /Quét lại 1 phần bị lỗi/i })).toBeVisible();

  await page.getByRole('button', { name: /Quét lại 1 phần bị lỗi/i }).click();
  await expect(page.getByTestId('result-count')).toHaveText('3');
  await expect(page.getByText('Câu 3: Đâu là đáp án đúng trong smoke test?')).toBeVisible();
});
