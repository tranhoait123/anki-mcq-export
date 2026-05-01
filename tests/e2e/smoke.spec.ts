import { expect, test } from '@playwright/test';

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
  await page.goto('/');

  await page.getByTestId('file-input').setInputFiles({
    name: 'e2e-smoke.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Câu 1. Đâu là đáp án đúng?\nA. Sai\nB. Đúng\nC. Gần đúng\nD. Không đủ dữ kiện'),
  });

  await expect(page.getByText('e2e-smoke.txt')).toBeVisible();
  await page.getByTestId('analyze-button').click();
  await expect(page.getByText('Hệ thống đã sẵn sàng')).toBeVisible();

  await page.getByTestId('generate-button').click();
  await expect(page.getByTestId('result-count')).toHaveText('1');
  await expect(page.getByText('Đâu là đáp án đúng trong smoke test?')).toBeVisible();
  await expect(page.getByRole('button', { name: /Nguồn: e2e-smoke.txt/i })).toBeVisible();

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
