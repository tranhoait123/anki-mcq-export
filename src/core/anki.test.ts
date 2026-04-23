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
    expect(html).toContain('<blockquote>Quote</blockquote>');
  });

  it('escapes table cells while keeping generated table tags', () => {
    const html = formatRichText('| A | B |\n| --- | --- |\n| <b>x</b> | y |');

    expect(html).toContain('<table>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<td><b>x</b></td>');
  });

  it('normalizes simple raw HTML tables to compact safe table markup', () => {
    const html = formatRichText('<table style="x"><tbody><tr><th>Hệ</th><th>Triệu chứng</th></tr><tr><td>Muscarinic</td><td><img src=x onerror=alert(1)>SLUDGE</td></tr></tbody></table>');

    expect(html).toContain('<table><tr><th>Hệ</th><th>Triệu chứng</th></tr><tr><td>Muscarinic</td><td>SLUDGE</td></tr></table>');
    expect(html).not.toContain('<tbody>');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=');
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

  it('does not embed repeated style tags in exported explanation HTML', () => {
    const html = buildAnkiHtml(
      { core: 'ok', evidence: '| A | B |\n| --- | --- |\n| x | y |', analysis: '', warning: '' },
      'Medium',
      'Recall'
    );

    expect(html).not.toContain('<style>');
    expect(html).toContain('<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></table>');
  });
});
