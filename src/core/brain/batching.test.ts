import { describe, expect, it } from 'vitest';
import { UploadedFile } from '../../types';
import { hashFiles } from './batching';

const file = (overrides: Partial<UploadedFile>): UploadedFile => ({
  id: overrides.id || 'file-1',
  name: overrides.name || 'demo.txt',
  type: overrides.type || 'text/plain',
  content: overrides.content || 'content',
  contentHash: overrides.contentHash,
});

describe('brain batching helpers', () => {
  it('hashFiles uses precomputed contentHash when available', async () => {
    const withLargeContent = await hashFiles([file({ content: 'first-content', contentHash: 'same-hash' })]);
    const withDifferentContent = await hashFiles([file({ content: 'second-content', contentHash: 'same-hash' })]);

    expect(withLargeContent).toBe(withDifferentContent);
  });

  it('hashFiles falls back to file content for legacy persisted files', async () => {
    const first = await hashFiles([file({ content: 'first-content' })]);
    const second = await hashFiles([file({ content: 'second-content' })]);

    expect(first).not.toBe(second);
  });
});
