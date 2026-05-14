import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LazyAnkiHtml from './LazyAnkiHtml';

const explanation = {
  core: 'Core',
  evidence: 'Evidence',
  analysis: 'Analysis',
  warning: '',
};

describe('LazyAnkiHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not build Anki HTML before visibility when IntersectionObserver is available', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    const buildHtml = vi.fn(() => '<b>rendered</b>');

    const html = renderToString(
      <LazyAnkiHtml
        buildHtml={buildHtml}
        depthAnalysis="Nhận biết"
        difficulty="Easy"
        explanation={explanation}
      />
    );

    expect(buildHtml).not.toHaveBeenCalled();
    expect(html).not.toContain('rendered');
    expect(html).toContain('animate-pulse');
  });

  it('renders immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('IntersectionObserver', undefined);
    const buildHtml = vi.fn(() => '<b>rendered</b>');

    const html = renderToString(
      <LazyAnkiHtml
        buildHtml={buildHtml}
        depthAnalysis="Nhận biết"
        difficulty="Easy"
        explanation={explanation}
      />
    );

    expect(buildHtml).toHaveBeenCalledTimes(1);
    expect(html).toContain('rendered');
  });
});
