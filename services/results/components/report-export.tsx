'use client';
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '@/lib/client';
import type { Analysis, Result, Student } from '@/lib/domain';
import { localExportStamp, planReportExport } from '@/lib/report-export-plan';

type DesktopExportHandler = { postMessage: (message: Record<string, unknown>) => void };

function desktopExportHandler(): DesktopExportHandler | undefined {
  return (window as typeof window & {
    webkit?: { messageHandlers?: { exportSession?: DesktopExportHandler } };
  }).webkit?.messageHandlers?.exportSession;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function ReportExport({ count, revision, disabled, onBusyChange, selectedExamNos }: {
  count: number; revision: number; disabled: boolean; onBusyChange: (value: boolean) => void;
  selectedExamNos?: string[];
}) {
  const [running, setRunning] = useState(false);
  const [coefficientRunning, setCoefficientRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const stopped = useRef(false);
  useEffect(() => {
    const cancelDesktopExport = () => {
      stopped.current = true;
      setStatus('已取消保存位置，正在停止本轮导出。');
    };
    window.addEventListener('desktop-export-cancelled', cancelDesktopExport);
    return () => {
      stopped.current = true;
      window.removeEventListener('desktop-export-cancelled', cancelDesktopExport);
    };
  }, []);
  async function start() {
    const selected = selectedExamNos ?? [];
    const targetCount = selected.length || count;
    if (running || disabled || !targetCount) return;
    stopped.current = false; setRunning(true); onBusyChange(true); setError(''); setFailures([]);
    setStatus('正在检查名单信息…');
    const problems: string[] = [];
    let completed = 0, downloads = 0;
    const desktopHandler = desktopExportHandler();
    const plan = planReportExport(targetCount, Boolean(desktopHandler));
    const stamp = localExportStamp();
    const folderName = `学生成绩报告-${stamp}-共${targetCount}人`;
    try {
      const { default: JSZip } = await import('jszip');
      const { renderReportPdf, reportPdfFileName } = await import('@/lib/report-pdf');
      let zip = new JSZip(), files = 0, bytes = 0;
      let packageStart = 0, successfulSequence = 0;
      if (plan.useFolderSession)
        desktopHandler?.postMessage({
          action: 'begin',
          folderName,
          createBatchFolder: plan.createBatchFolder,
        });
      async function flush() {
        if (!files) return;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        const packageNumber = downloads + 1;
        const fileName = plan.kind === 'single-zip'
          ? `学生成绩报告-${stamp}-共${files}人.zip`
          : `第${String(packageNumber).padStart(2, '0')}包-${String(packageStart).padStart(3, '0')}至${String(successfulSequence).padStart(3, '0')}-共${files}人.zip`;
        triggerDownload(blob, fileName);
        downloads++;
        zip = new JSZip(); files = 0; bytes = 0;
      }
      try {
        for (let offset = 0; offset < targetCount && !stopped.current; offset += 10) {
          const page = await api<{ count: number; records: { examNo: string; result: Result }[] }>('report-batch', 'POST', { revision, offset, examNos: selected });
          if (page.count !== targetCount || !page.records.length) throw new Error('名单已更新，请重新开始导出');
          for (const record of page.records) {
            if (stopped.current) break;
            setStatus(`正在生成 ${completed + problems.length + 1} / ${targetCount}：${record.result.name}`);
            try {
              const pdf = await renderReportPdf(record.result);
              const pdfName = reportPdfFileName(record.result, record.examNo);
              successfulSequence++;
              if (plan.kind === 'single-pdf' || plan.kind === 'individual-pdfs') {
                triggerDownload(pdf, pdfName);
                downloads++;
              } else {
                if (!files) packageStart = successfulSequence;
                zip.file(pdfName, await pdf.arrayBuffer());
                files++; bytes += pdf.size;
              }
              completed++;
            } catch (e) {
              problems.push(`${record.result.name}（${record.examNo}）：${e instanceof Error ? e.message : '生成失败'}`);
            }
            if (plan.kind === 'split-zips' && (files >= 20 || bytes >= 25_000_000))
              await flush();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      } finally {
        await flush();
        if (plan.useFolderSession)
          setTimeout(() => desktopHandler?.postMessage({ action: 'end' }), 1000);
      }
      const outputLabel = plan.kind === 'single-pdf' || plan.kind === 'individual-pdfs' ? 'PDF文件' : '压缩包';
      setStatus(`${stopped.current ? '已停止' : '生成完成'}：${completed}名学生，已发起${downloads}个${outputLabel}下载${problems.length ? `，${problems.length}名失败` : ''}。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
      desktopHandler?.postMessage({ action: 'end' });
      setStatus(completed ? `已生成${completed}名学生，已发起${downloads}个文件下载。` : '');
    } finally {
      setFailures(problems); setRunning(false); onBusyChange(false);
    }
  }
  async function exportCoefficients() {
    const selected = selectedExamNos ?? [];
    const targetCount = selected.length || count;
    if (running || coefficientRunning || disabled || !targetCount) return;
    setCoefficientRunning(true); onBusyChange(true); setError(''); setFailures([]);
    setStatus('正在整理六维得分系数…');
    try {
      let records: Array<Student & { qualifiedForInterview?: boolean | null }> = [];
      let analysis: Analysis | null = null;
      let examName = '';
      for (let offset = 0; offset < targetCount; offset += 100) {
        const page = await api<{
          count: number;
          examName: string;
          analysis: Analysis;
          records: Array<Student & { qualifiedForInterview?: boolean | null }>;
        }>('dimension-coefficient-batch', 'POST', { revision, offset, examNos: selected });
        if (page.count !== targetCount || !page.records.length)
          throw new Error('名单已更新，请重新开始导出');
        analysis = page.analysis;
        examName = page.examName;
        records = records.concat(page.records);
        setStatus(`正在整理六维得分系数：${records.length} / ${targetCount}`);
      }
      if (!analysis || records.length !== targetCount)
        throw new Error('学生数据不完整，请刷新后重试');
      const { buildDimensionCoefficientWorkbook, dimensionCoefficientFileName } =
        await import('@/lib/dimension-coefficient-export');
      const bytes = await buildDimensionCoefficientWorkbook({
        examName,
        analysis,
        students: records,
        includeScoreDetails: true,
      });
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = dimensionCoefficientFileName();
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(`六维得分系数导出完成：${records.length}名学生。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
      setStatus('');
    } finally {
      setCoefficientRunning(false); onBusyChange(false);
    }
  }
  return <div className="report-export">
    <div className="actions">
      <Button disabled={disabled || running || coefficientRunning || !count} onClick={() => void start()}><Download />{selectedExamNos?.length ? `导出已选 ${selectedExamNos.length} 名学生PDF` : '导出全部学生PDF'}</Button>
      <Button variant="outline" disabled={disabled || running || coefficientRunning || !count} onClick={() => void exportCoefficients()}><Download />导出6维得分系数</Button>
      {running && <Button variant="outline" onClick={() => { stopped.current = true; }}>停止导出</Button>}
    </div>
    <p className="mini-label">导出6维得分系数时，默认导出分数明细。上传前在线成绩表时，要手动删除分数明细。 表内得分系数不含低分保护，但预览含低分保护。</p>
    <p className="mini-label">1人直接导出PDF；桌面端2–5人选择一次文件夹后保存独立PDF；6–20人导出单个ZIP；超过20人选择一次位置，自动新建批次文件夹并按每20人或约25MB分包。</p>
    {status && <output>{status}</output>}
    {error && <p className="error" role="alert">{error}</p>}
    {!!failures.length && <details><summary>查看未成功导出的学生（{failures.length}名）</summary>{failures.map((value) => <p key={value}>{value}</p>)}</details>}
  </div>;
}
