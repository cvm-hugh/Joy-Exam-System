import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { HEADERS } from '../lib/domain';
export function demoRows() {
  return [
    ['000001', '测试甲', '中心分校', '一班', '2026-09-12 上午场', '七年级', 5, 4, 4, 4, 4, 8, 4, 4, 4, 6, 7, 12, 66],
    ['000002', '测试乙', '中心分校', '一班', '2026-09-12 上午场', '七年级', 3, 3, 3, 3, 3, 6, 3, 3, 3, 4, 5, 9, 48],
    ['000003', '测试丙', '中心分校', '一班', '2026-09-12 上午场', '七年级', 5, 5, 5, 5, 5, 10, 5, 5, 5, 7, 8, 15, 80],
  ];
}
export async function makeFixtureFile(format: 'xlsx' | 'csv') {
  if (format === 'csv')
    return new TextEncoder().encode(
      '\uFEFF' + Papa.unparse([HEADERS, ...demoRows()]),
    );
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('成绩');
  sheet.addRows([HEADERS, ...demoRows()]);
  sheet.getColumn(1).numFmt = '@';
  return new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer);
}
