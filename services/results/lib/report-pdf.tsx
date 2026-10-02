'use client';

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import { PDFDocument } from 'pdf-lib';
import { ReportPages } from '@/components/report-pages';
import type { Result } from './domain';

const PAGE_WIDTH = 390;
const PAGE_HEIGHT = 844;

function cleanFilePart(value: string) {
  return value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
}

export function reportPdfFileName(result: Result, examNo: string) {
  return [result.branch, result.className, result.name, examNo]
    .map(cleanFilePart)
    .join('-') + '.pdf';
}

async function waitForPageAssets(container: HTMLElement) {
  await document.fonts.ready;
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete)
        await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => reject(new Error('报告图片加载失败')), { once: true });
        });
      if (image.decode) await image.decode().catch(() => undefined);
    }),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function assertPageFits(page: HTMLElement) {
  const title = page.dataset.reportTitle ?? '报告';
  const containers = [
    page,
    ...Array.from(page.querySelectorAll<HTMLElement>('.standard-evaluation-card')),
  ];
  if (containers.some((node) => node.scrollHeight > node.clientHeight + 1))
    throw new Error(`${title}页内容超过390 × 844标准页，请精简本页文字或调小已配置的标题字号`);
}

export async function renderReportPdf(result: Result): Promise<Blob> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-pdf-rendering', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${PAGE_WIDTH}px`,
    pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(createElement(ReportPages, { result }));
    await waitForPageAssets(host);
    const pages = Array.from(host.querySelectorAll<HTMLElement>('[data-report-page]'));
    if (pages.length !== 9) throw new Error('报告页数量异常，必须为9页');
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${result.name}考试结果`);
    pdf.setSubject(result.examName.replace(/\n/g, ' '));
    pdf.setCreator('考试结果管理');
    for (const page of pages) {
      assertPageFits(page);
      const dataUrl = await toPng(page, {
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        skipAutoScale: true,
      });
      const image = await pdf.embedPng(dataUrl);
      const pdfPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
    }
    const bytes = await pdf.save({ useObjectStreams: true });
    const output = new Uint8Array(bytes.byteLength);
    output.set(bytes);
    return new Blob([output.buffer], { type: 'application/pdf' });
  } finally {
    root.unmount();
    host.remove();
  }
}
