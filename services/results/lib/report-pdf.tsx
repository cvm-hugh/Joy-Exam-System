'use client';

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { getFontEmbedCSS, toPng } from 'html-to-image';
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

// Preserve the accepted Windows PDF fix: mount first, load the actual text's
// fonts, then embed and decode them before html-to-image draws each report page.
const ASSET_TIMEOUT_MS = 15000;
let embeddedFontSerial = 0;

function withAbort<T>(operation: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error(message));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    if (signal.aborted) onAbort();
  });
}

async function loadReportImage(image: HTMLImageElement, signal: AbortSignal) {
  const failure = '报告图片加载失败，请检查试卷模板中的图片后重试';
  const timeout = '报告图片加载超时，请检查试卷模板中的图片后重试';
  if (!image.complete) await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onLoad = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(failure)); };
    const onAbort = () => { cleanup(); reject(new Error(timeout)); };
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else if (image.complete) onLoad();
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error(failure);
  if (image.decode) {
    try { await withAbort(image.decode(), signal, timeout); }
    catch (error) {
      throw signal.aborted ? error : new Error('报告图片解码失败，请检查试卷模板中的图片后重试');
    }
  }
}

async function loadReportFonts(container: HTMLElement, signal: AbortSignal) {
  const fonts = new Map<string, Set<string>>();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement || !node.textContent?.trim()) continue;
    const style = getComputedStyle(node.parentElement);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = fonts.get(font) ?? new Set<string>();
    for (const character of node.textContent) text.add(character);
    fonts.set(font, text);
  }
  const timeout = '报告字体加载超时，请重新打开结果管理后重试';
  try {
    await withAbort(Promise.all(Array.from(fonts, ([font, text]) =>
      document.fonts.load(font, Array.from(text).join('')))), signal, timeout);
    await withAbort(document.fonts.ready, signal, timeout);
  } catch (error) {
    throw signal.aborted ? error : new Error('报告字体加载失败，请检查报告字体文件或重新打开结果管理后重试');
  }
}

function embeddedFontUrls(css: string) {
  const urls = new Set<string>();
  const matches = css.matchAll(/url\(\s*(?:(["'])([\s\S]*?)\1|([^)]*?))\s*\)/gi);
  for (const match of matches) {
    const url = (match[2] ?? match[3]).trim();
    if (!/^data:[^,]*,\s*\S/i.test(url))
      throw new Error('报告字体嵌入失败，请检查报告字体文件后重试');
    urls.add(url);
  }
  return Array.from(urls);
}

async function waitForPageAssets(container: HTMLElement, embeddedFonts: FontFace[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
  let frame = 0;
  try {
    container.getBoundingClientRect();
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all([loadReportFonts(container, controller.signal),
      ...images.map((image) => loadReportImage(image, controller.signal))]);
    await withAbort(new Promise<void>((resolve) => {
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => resolve()); });
    }), controller.signal, '报告页面渲染超时，请保持结果管理窗口打开后重试');
    try {
      const css = await withAbort(getFontEmbedCSS(container, {
        cacheBust: false, fetchRequestInit: { signal: controller.signal },
      }), controller.signal, '报告字体嵌入超时，请检查报告字体文件后重试');
      const fonts = embeddedFontUrls(css).map((url) => {
        const font = new FontFace(`Joy PDF Embedded ${++embeddedFontSerial}`, `url(${JSON.stringify(url)})`);
        embeddedFonts.push(font);
        document.fonts.add(font);
        return font;
      });
      await withAbort(Promise.all(fonts.map((font) => font.load())), controller.signal,
        '报告字体嵌入超时，请检查报告字体文件后重试');
      return css;
    } catch (error) {
      throw controller.signal.aborted ? error : new Error('报告字体嵌入失败，请检查报告字体文件后重试');
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (frame) cancelAnimationFrame(frame);
  }
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
  const embeddedFonts: FontFace[] = [];
  try {
    flushSync(() => root.render(createElement(ReportPages, { result })));
    const fontEmbedCSS = await waitForPageAssets(host, embeddedFonts);
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
        fontEmbedCSS,
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
    for (const font of embeddedFonts) document.fonts.delete(font);
    root.unmount();
    host.remove();
  }
}
