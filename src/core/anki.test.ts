import { describe, expect, it } from 'vitest';
import { buildAnkiHtml, formatRichText } from './anki';

describe('Anki rich text formatting', () => {
  it('escapes dangerous HTML before rendering preview/export HTML', () => {
    const html = formatRichText('<img src=x onerror=alert(1)><script>alert(2)</script>[x](javascript:alert(3))');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps the safe formatting subset for markdown-like content', () => {
    const html = formatRichText('**Bold**\n*Italic*\n> Quote');

    expect(html).toContain('<b>Bold</b>');
    expect(html).toContain('<i>Italic</i>');
    expect(html).toContain('<blockquote class="m-q">Quote</blockquote>');
  });

  it('escapes table cells while keeping generated table tags', () => {
    const html = formatRichText('| A | B |\n| --- | --- |\n| <b>x</b> | y |');

    expect(html).toContain('<table class="m-t">');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<td><b>x</b></td>');
  });

  it('escapes difficulty and depth metadata in Anki HTML', () => {
    const html = buildAnkiHtml(
      { core: 'ok', evidence: '', analysis: '', warning: '' },
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>'
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
