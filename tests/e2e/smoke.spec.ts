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

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-csv-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^\[ANKI\]_e2e_smoke_\d{4}-\d{2}-\d{2}\.csv$/);
});
