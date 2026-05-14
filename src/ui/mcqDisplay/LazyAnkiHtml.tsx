import React from 'react';
import { Explanation } from '../../types';
import { buildAnkiHtml } from '../../core/anki';

interface LazyAnkiHtmlProps {
  buildHtml?: typeof buildAnkiHtml;
  compact?: boolean;
  depthAnalysis: string;
  difficulty: string;
  explanation: Explanation;
}

const shouldRenderImmediately = () => (
  typeof window === 'undefined' ||
  typeof IntersectionObserver === 'undefined'
);

const LazyAnkiHtml: React.FC<LazyAnkiHtmlProps> = React.memo(({
  buildHtml = buildAnkiHtml,
  compact = false,
  depthAnalysis,
  difficulty,
  explanation,
}) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = React.useState(shouldRenderImmediately);
  const htmlContent = React.useMemo(
    () => shouldRender ? buildHtml(explanation, difficulty, depthAnalysis) : '',
    [buildHtml, depthAnalysis, difficulty, explanation, shouldRender]
  );

  React.useEffect(() => {
    if (shouldRender || shouldRenderImmediately()) return;
    const target = rootRef.current;
    if (!target) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setShouldRender(true);
        observer.disconnect();
      }
    }, { rootMargin: '900px 0px' });

    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div ref={rootRef} className={`${compact ? 'pt-4' : 'pt-6'} border-t border-slate-100 dark:border-slate-800`}>
      <span className={`text-[10px] font-black text-slate-400 tracking-widest uppercase ${compact ? 'mb-3' : 'mb-4'} block`}>Giao diện Anki</span>
      {shouldRender ? (
        <div
          dangerouslySetInnerHTML={{ __html: htmlContent }}
          className={`anki-html ${compact ? 'min-h-[180px] p-4' : 'min-h-[220px] p-6'} bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-inner`}
        />
      ) : (
        <div
          aria-hidden="true"
          className={`${compact ? 'min-h-[180px] p-4' : 'min-h-[220px] p-6'} animate-pulse rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50`}
        >
          <div className="mb-3 h-3 w-36 rounded-full bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-2">
            <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="h-2.5 w-5/6 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="h-2.5 w-2/3 rounded-full bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>
      )}
    </div>
  );
});

export default LazyAnkiHtml;
