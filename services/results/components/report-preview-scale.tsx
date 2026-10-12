'use client';

import { Button } from './ui/button';

export const REPORT_PREVIEW_SCALES = [30, 50, 70, 100] as const;
export type ReportPreviewScale = (typeof REPORT_PREVIEW_SCALES)[number];

export function ReportPreviewScaleControl({
  scale,
  onChange,
}: {
  scale: ReportPreviewScale;
  onChange: (scale: ReportPreviewScale) => void;
}) {
  return (
    <fieldset className="report-preview-scale-control">
      <legend className="sr-only">报告预览缩放</legend>
      <span className="mini-label" aria-hidden="true">预览比例</span>
      {REPORT_PREVIEW_SCALES.map((value) => (
        <Button
          key={value}
          type="button"
          variant={scale === value ? 'default' : 'outline'}
          aria-pressed={scale === value}
          onClick={() => onChange(value)}
        >
          {value}%
        </Button>
      ))}
    </fieldset>
  );
}
