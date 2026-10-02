import assert from 'node:assert/strict';
import test from 'node:test';
import { localExportStamp, planReportExport } from '../lib/report-export-plan';

test('桌面报告导出按1、2至5、6至20、20以上分档', () => {
  assert.deepEqual(planReportExport(1, true), {
    kind: 'single-pdf', useFolderSession: false, createBatchFolder: false,
  });
  assert.deepEqual(planReportExport(5, true), {
    kind: 'individual-pdfs', useFolderSession: true, createBatchFolder: false,
  });
  assert.deepEqual(planReportExport(6, true), {
    kind: 'single-zip', useFolderSession: false, createBatchFolder: false,
  });
  assert.deepEqual(planReportExport(20, true), {
    kind: 'single-zip', useFolderSession: false, createBatchFolder: false,
  });
  assert.deepEqual(planReportExport(21, true), {
    kind: 'split-zips', useFolderSession: true, createBatchFolder: true,
  });
});

test('普通浏览器在少量多人时回退为单ZIP，避免连续下载确认', () => {
  assert.equal(planReportExport(2, false).kind, 'single-zip');
  assert.equal(planReportExport(5, false).kind, 'single-zip');
  assert.equal(planReportExport(21, false).kind, 'split-zips');
  assert.equal(planReportExport(21, false).useFolderSession, false);
});

test('批次导出时间戳使用本地时间且适合作为目录名', () => {
  assert.equal(localExportStamp(new Date(2026, 8, 15, 9, 7, 4)), '20260915-090704');
});
