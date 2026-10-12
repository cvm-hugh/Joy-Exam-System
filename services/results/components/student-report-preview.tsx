'use client';

import { useId, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, Columns3, Rows3 } from 'lucide-react';
import type { Result } from '@/lib/domain';
import { Button } from './ui/button';
import { ReportPages } from './report-pages';
import { ReportPreviewScaleControl, type ReportPreviewScale } from './report-preview-scale';

export type StudentPreviewLayout = 'horizontal' | 'vertical';

export function StudentReportPreview({
  result,
  layout,
  onLayoutChange,
  scale,
  onScaleChange,
}: {
  result: Result;
  layout: StudentPreviewLayout;
  onLayoutChange: (layout: StudentPreviewLayout) => void;
  scale: ReportPreviewScale;
  onScaleChange: (scale: ReportPreviewScale) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const pagesId = useId();
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const topToggle = useRef<HTMLButtonElement>(null);
  const ToggleIcon = expanded ? ChevronUp : ChevronDown;

  function togglePreview(fromFooter = false) {
    setExpanded((value) => !value);
    if (fromFooter) {
      topToggle.current?.focus({ preventScroll: true });
      section.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }

  return (
    <section
      ref={section}
      className="panel student-report-preview"
      data-layout={layout}
      aria-labelledby={titleId}
    >
      <div className="student-preview-toolbar">
        <h2 id={titleId}>{result.name} · 报告预览</h2>
        <div className="student-preview-controls">
          <fieldset className="student-preview-layout">
            <legend className="sr-only">预览显示模式</legend>
            <span className="mini-label" aria-hidden="true">显示模式</span>
            <Button
              type="button"
              variant={layout === 'horizontal' ? 'default' : 'outline'}
              aria-pressed={layout === 'horizontal'}
              onClick={() => onLayoutChange('horizontal')}
            >
              <Columns3 aria-hidden="true" />
              横向排列
            </Button>
            <Button
              type="button"
              variant={layout === 'vertical' ? 'default' : 'outline'}
              aria-pressed={layout === 'vertical'}
              onClick={() => onLayoutChange('vertical')}
            >
              <Rows3 aria-hidden="true" />
              竖向排列
            </Button>
          </fieldset>
          <ReportPreviewScaleControl scale={scale} onChange={onScaleChange} />
          <Button
            ref={topToggle}
            type="button"
            variant="outline"
            aria-controls={pagesId}
            aria-expanded={expanded}
            onClick={() => togglePreview()}
          >
            <ToggleIcon aria-hidden="true" />
            {expanded ? '折叠' : '展开'}
          </Button>
        </div>
      </div>
      {expanded ? (
        <p className="mini-label student-preview-hint">
          {layout === 'horizontal' ? '左右滚动查看完整报告。' : '上下滚动查看完整报告。'}缩放仅影响预览，导出的报告 PDF 仍按 100% 尺寸导出。
        </p>
      ) : (
        <output className="mini-label student-preview-hint">
          {result.name}的报告预览已折叠。
        </output>
      )}
      {/* The scroll region needs focus so keyboard users can scroll the report pages. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <section id={pagesId} className="student-preview-viewport" hidden={!expanded} aria-label={`${result.name}的报告页面`} tabIndex={expanded ? 0 : -1}>
        {expanded && (
          <div className="parent-preview report-preview-shell" style={{ '--report-preview-scale': scale / 100 } as CSSProperties}>
            <ReportPages result={result} previewScale={scale} />
          </div>
        )}
      </section>
      <div className="student-preview-footer">
        <span className="mini-label">{expanded ? '预览结束' : '预览已折叠'}</span>
        <Button
          type="button"
          variant="outline"
          aria-controls={pagesId}
          aria-expanded={expanded}
          onClick={() => togglePreview(true)}
        >
          <ToggleIcon aria-hidden="true" />
          {expanded ? '折叠' : '展开'}
        </Button>
      </div>
    </section>
  );
}
