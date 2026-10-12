'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '@/lib/client';
import type { Analysis, Result, Student } from '@/lib/domain';
import { localExportStamp, planReportExport } from '@/lib/report-export-plan';
import { useConfirm } from './confirm-action';
import type { StudentInformationSummary } from '@/lib/student-information';

type DesktopExportHandler = { postMessage: (message: Record<string, unknown>) => void | boolean | Promise<boolean> };

function desktopExportHandler(): DesktopExportHandler | undefined {
  const desktop = window as typeof window & {
    joyDesktop?: { exportSession?: DesktopExportHandler };
    webkit?: { messageHandlers?: { exportSession?: DesktopExportHandler } };
  };
  return desktop.joyDesktop?.exportSession ?? desktop.webkit?.messageHandlers?.exportSession;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function subscribeSourceNames(notify: () => void) {
  window.addEventListener('storage', notify);
  return () => window.removeEventListener('storage', notify);
}

function storedSourceName(key: string | null) {
  try { return key ? localStorage.getItem(key) ?? '' : ''; }
  catch { return ''; }
}

export function ReportExport({ count, revision, batchId, examName, sourceFileName, disabled, onBusyChange, selectedExamNos, onFillInformation }: {
  count: number; revision: number; disabled: boolean; onBusyChange: (value: boolean) => void;
  batchId: string | null; examName: string; sourceFileName?: string | null;
  selectedExamNos?: string[];
  onFillInformation: (examNo: string) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [running, setRunning] = useState(false);
  const [coefficientRunning, setCoefficientRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const [informationIncludesSheets, setInformationIncludesSheets] = useState(false);
  const legacyNameKey = batchId ? `joy-export-source-name:${batchId}` : null;
  const storedName = useSyncExternalStore(subscribeSourceNames, () => storedSourceName(legacyNameKey), () => '');
  const [enteredName, setEnteredName] = useState<{ key: string | null; value: string } | null>(null);
  const legacySourceFileName = enteredName?.key === legacyNameKey ? enteredName.value : storedName;
  function changeLegacySourceFileName(value: string) {
    setEnteredName({ key: legacyNameKey, value });
    try { if (legacyNameKey) localStorage.setItem(legacyNameKey, value); }
    catch { /* The export still uses the current input if local storage is unavailable. */ }
  }
  const [informationCheck, setInformationCheck] = useState<{ revision: number; selectionKey: string; summary: StudentInformationSummary } | null>(null);
  const selectionKey = JSON.stringify(selectedExamNos ?? []);
  const information = informationCheck?.revision === revision && informationCheck.selectionKey === selectionKey
    ? informationCheck.summary : null;
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
  async function checkInformation(includeInformationSheets = false) {
    setInformationIncludesSheets(includeInformationSheets);
    const checked = await api<StudentInformationSummary & { count: number }>('export-information', 'POST', {
      revision, examNos: selectedExamNos ?? [],
    });
    if (checked.count !== ((selectedExamNos?.length ?? 0) || count))
      throw new Error('名单已更新，请重新开始导出');
    setInformationCheck({ revision, selectionKey, summary: checked });
    if (!checked.issueCount) return true;
    const preview = checked.items.slice(0, 8).map((item) =>
      `${item.name}（${item.examNo}）· ${item.label}：${item.message}`,
    ).join('\n');
    const proceed = await confirm(
      `本次导出的 ${checked.studentCount} 名学生有 ${checked.issueCount} 项信息待补充或核对。\n\n${preview}${checked.issueCount > 8 ? '\n更多项目可在下方查看。' : ''}${includeInformationSheets ? '\n教学备份 Excel 会附上完整“信息待补充”清单。' : '\n待补充信息在本页提示，可返回学生名单完善。'}\n\n您可以返回补充，也可以保留现有信息继续导出。`,
      { title: '导出前的信息提醒', confirmLabel: '继续导出', cancelLabel: '返回补充' },
    );
    if (!proceed && checked.items[0]) await onFillInformation(checked.items[0].examNo);
    return proceed;
  }
  async function start() {
    const selected = selectedExamNos ?? [];
    const targetCount = selected.length || count;
    if (running || coefficientRunning || disabled || !targetCount) return;
    stopped.current = false; setRunning(true); onBusyChange(true); setError(''); setFailures([]);
    setStatus('正在检查名单信息…');
    const problems: string[] = [];
    let completed = 0, downloads = 0;
    const desktopHandler = desktopExportHandler();
    const plan = planReportExport(targetCount, Boolean(desktopHandler));
    const stamp = localExportStamp();
    const folderName = `学生成绩报告-${stamp}-共${targetCount}人`;
    try {
      if (!(await checkInformation())) { setStatus(''); return; }
      const { default: JSZip } = await import('jszip');
      const { renderReportPdf, reportPdfFileName } = await import('@/lib/report-pdf');
      let zip = new JSZip(), files = 0, bytes = 0;
      let packageStart = 0, successfulSequence = 0;
      if (plan.useFolderSession) {
        const accepted = await desktopHandler?.postMessage({
          action: 'begin',
          folderName,
          createBatchFolder: plan.createBatchFolder,
        });
        if (accepted === false) {
          stopped.current = true;
          setStatus('已取消保存位置，本轮导出已停止。');
          return;
        }
      }
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
          setTimeout(() => { void desktopHandler?.postMessage({ action: 'end' }); }, 1000);
      }
      const outputLabel = plan.kind === 'single-pdf' || plan.kind === 'individual-pdfs' ? 'PDF文件' : '压缩包';
      setStatus(`${stopped.current ? '已停止' : '生成完成'}：${completed}名学生，已发起${downloads}个${outputLabel}下载${problems.length ? `，${problems.length}名失败` : ''}。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
      void desktopHandler?.postMessage({ action: 'end' });
      setStatus(completed ? `已生成${completed}名学生，已发起${downloads}个文件下载。` : '');
    } finally {
      setFailures(problems); setRunning(false); onBusyChange(false);
    }
  }
  async function exportCoefficients(includeScoreDetails: boolean) {
    const selected = selectedExamNos ?? [];
    const targetCount = selected.length || count;
    if (running || coefficientRunning || disabled || !targetCount) return;
    setCoefficientRunning(true); onBusyChange(true); setError(''); setFailures([]);
    const exportLabel = includeScoreDetails ? '详细得分名单' : '六维系数名单';
    setStatus(`正在整理${exportLabel}…`);
    try {
      if (!(await checkInformation(includeScoreDetails))) { setStatus(''); return; }
      let records: Array<Student & { qualifiedForInterview?: boolean | null }> = [];
      let analysis: Analysis | null = null;
      let examName = '';
      let importedFileName = '';
      for (let offset = 0; offset < targetCount; offset += 100) {
        const page = await api<{
          count: number;
          examName: string;
          sourceFileName?: string | null;
          analysis: Analysis;
          records: Array<Student & { qualifiedForInterview?: boolean | null }>;
        }>('dimension-coefficient-batch', 'POST', { revision, offset, examNos: selected });
        if (page.count !== targetCount || !page.records.length)
          throw new Error('名单已更新，请重新开始导出');
        analysis = page.analysis;
        examName = page.examName;
        importedFileName = page.sourceFileName ?? '';
        records = records.concat(page.records);
        setStatus(`正在整理${exportLabel}：${records.length} / ${targetCount}`);
      }
      if (!analysis || records.length !== targetCount)
        throw new Error('学生数据不完整，请刷新后重试');
      const { buildDimensionCoefficientWorkbook, dimensionCoefficientFileName } =
        await import('@/lib/dimension-coefficient-export');
      const bytes = await buildDimensionCoefficientWorkbook({
        examName,
        analysis,
        students: records,
        includeScoreDetails,
      });
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      triggerDownload(blob, dimensionCoefficientFileName(importedFileName || legacySourceFileName.trim() || sourceFileName || examName, includeScoreDetails));
      setStatus(`${exportLabel}导出完成：${records.length}名学生。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
      setStatus('');
    } finally {
      setCoefficientRunning(false); onBusyChange(false);
    }
  }
  return <div className="report-export">
    {!!count && !sourceFileName && <label className="field" htmlFor="excel-export-source-name">
      原文件名（用于 Excel 默认命名）
      <Input id="excel-export-source-name" value={legacySourceFileName} placeholder={examName} maxLength={512} disabled={disabled || running || coefficientRunning}
        onChange={(event) => changeLegacySourceFileName(event.target.value)} />
      <small className="muted">可补填本批次的原名单文件名；未填时使用考试名称。填写后会在本机记住，导出时自动去掉扩展名并添加“详细得分”或“六维系数”。</small>
    </label>}
    <div className="actions">
      <Button disabled={disabled || running || coefficientRunning || !count} onClick={() => void start()}><Download />{selectedExamNos?.length ? `导出已选 ${selectedExamNos.length} 名学生PDF` : '导出全部学生PDF'}</Button>
      <Button variant="outline" disabled={disabled || running || coefficientRunning || !count} onClick={() => void exportCoefficients(false)}><Download />导出六维系数名单（运营存档）</Button>
      <Button variant="outline" disabled={disabled || running || coefficientRunning || !count} onClick={() => void exportCoefficients(true)}><Download />导出详细得分名单（教学备份）</Button>
      {running && <Button variant="outline" onClick={() => { stopped.current = true; }}>停止导出</Button>}
    </div>
    <p className="mini-label">运营存档只含一张名单表，保留名单信息、六维得分系数和精修笔试通过情况；教学备份保留分数明细与附表。两种 Excel 均导出真实系数，不含页面预览的低分保护。</p>
    <p className="mini-label">1人直接导出PDF；桌面端2–5人选择一次文件夹后保存独立PDF；6–20人导出单个ZIP；超过20人选择一次位置，自动新建批次文件夹并按每20人或约25MB分包。</p>
    {status && <output>{status}</output>}
    {error && <p className="error" role="alert">{error}</p>}
    {!!information?.issueCount && <details className="notice" open>
      <summary>{information.studentCount} 名学生有 {information.issueCount} 项信息待补充或核对</summary>
      <p>可稍后完善，仍可继续导出；{informationIncludesSheets ? '教学备份 Excel 会附上完整“信息待补充”清单。' : '待补充信息在本页提示，可在学生名单中完善。'}</p>
      <div className="table-wrap"><table><thead><tr><th>考号</th><th>学生姓名</th><th>信息字段</th><th>当前内容</th><th>提示</th><th>操作</th></tr></thead><tbody>
        {information.items.slice(0, 100).map((item) => <tr key={`${item.examNo}-${item.field}`}>
          <td>{item.examNo}</td><td>{item.name}</td><td>{item.label}</td><td>{item.value || '未填写'}</td><td>{item.message}</td>
          <td><Button size="sm" variant="ghost" disabled={disabled || running || coefficientRunning} onClick={() => void onFillInformation(item.examNo).catch((e) => setError(e instanceof Error ? e.message : '无法打开学生信息'))}>补充信息</Button></td>
        </tr>)}
      </tbody></table></div>
      {information.issueCount > 100 && <p>界面展示前 100 项；{informationIncludesSheets ? '全部项目会写入教学备份 Excel 清单；' : ''}可在学生名单中逐人补充。</p>}
    </details>}
    {!!failures.length && <details><summary>查看未成功导出的学生（{failures.length}名）</summary>{failures.map((value) => <p key={value}>{value}</p>)}</details>}
  </div>;
}
