import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './helpers';
import { Store } from '../lib/store';
import { defaultConfig, HEADERS, resultFor } from '../lib/domain';
import { reportPdfFileName } from '../lib/report-pdf';
import { validateRows } from '../lib/importer';
import { demoRows } from './fixtures';
import ExcelJS from 'exceljs';
import { buildDimensionCoefficientWorkbook } from '../lib/dimension-coefficient-export';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportPages } from '../components/report-pages';

test('旧数据库增补字段可重复执行，原始分数与前导零不变，未知信息保持空白', async () => {
  const DB = new SqliteD1();
  try {
    DB.sqlite.exec("CREATE TABLE students (exam_no TEXT PRIMARY KEY, name TEXT NOT NULL, scores TEXT NOT NULL, total TEXT NOT NULL)");
    DB.sqlite.prepare('INSERT INTO students VALUES(?,?,?,?)').run('000004', '学生甲', '{"L1":"3.5"}', '3.5');
    const store = new Store(DB); await store.init(); await store.init();
    const student = await store.student('学生甲', '000004');
    assert.equal(student?.scores.L1, '3.5'); assert.equal(student?.total, '3.5');
    assert.equal(student?.className, ''); assert.equal(student?.examSession, ''); assert.equal(student?.yearLevel, '');
  } finally { DB.sqlite.close(); }
});
test('新模板只要求分校，其他信息可留空；PDF文件名保持中文与完整考号并处理路径字符', () => {
  const rows = [HEADERS, ...demoRows()];
  const student = validateRows(rows)[0];
  assert.equal(reportPdfFileName(resultFor(student, defaultConfig(), false), student.examNo), '中心分校-一班-测试甲-000001.pdf');
  const invalid = structuredClone(rows); invalid[1][2] = '';
  assert.throws(() => validateRows(invalid));
  for (let column = 3; column < 6; column++) {
    const optional = structuredClone(rows); optional[1][column] = '';
    assert.doesNotThrow(() => validateRows(optional));
  }
  student.className = 'A/B班';
  assert.match(reportPdfFileName(resultFor(student, defaultConfig(), false), student.examNo), /A_B班/);
});

test('六维系数工作簿导出Part、维度总分和向下截断的真实系数', async () => {
  const config = defaultConfig();
  const student = validateRows([HEADERS, demoRows()[0]])[0];
  student.sourceData = {
    '学号': '000001', '姓名': '测试甲Joy', '上课科目': '英语', '任课老师': '王老师', '联系电活': '13800000000',
  };
  const exportStudent = { ...student, qualifiedForInterview: true };
  const bytes = await buildDimensionCoefficientWorkbook({
    examName: config.examName,
    analysis: config.analysis,
    students: [exportStudent],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Sheet1', 'Sheet2']);
  const detail = workbook.getWorksheet('Sheet1')!;
  assert.equal(detail.getCell('A2').text, '000001');
  assert.equal(detail.getCell('B2').text, '测试甲Joy');
  assert.equal(detail.getCell('C2').text, '测试甲');
  assert.equal(detail.getCell('J2').text, '王老师');
  assert.equal(detail.getCell('K1').text, '笔试时间');
  assert.equal(detail.getCell('O2').text, '是');
  assert.equal(detail.getCell('Q1').text, '听力理解得分系数');
  assert.equal(detail.getCell('V1').text, '写作能力得分系数');
  assert.equal(detail.getCell('W2').text, '');
  const headers = detail.getRow(1).values as unknown[];
  const column = (header: string) => headers.findIndex((value) => value === header);
  assert.equal(detail.getRow(2).getCell(column('考试总分')).value, 66);
  assert.equal(detail.getRow(2).getCell(column('Listening Part1')).value, 5);
  assert.equal(detail.getRow(2).getCell(column('听力理解总得分')).value, 13);
  const coefficient = detail.getRow(2).getCell(column('听力理解得分系数'));
  assert.equal(coefficient.value, 0.86);
  assert.equal(coefficient.numFmt, '0.00');
  const rules = workbook.getWorksheet('Sheet2')!;
  assert.match(rules.getCell('B9').text, /不四舍五入/);
  assert.match(rules.getCell('B10').text, /不采用预览页面的0.3最低显示保护/);
  assert.match(rules.getCell('C14').text, /Listening Part1/);
});

test('取消分数明细后只导出到六维得分系数且不生成Sheet2', async () => {
  const config = defaultConfig();
  const student = validateRows([HEADERS, demoRows()[0]])[0];
  const bytes = await buildDimensionCoefficientWorkbook({
    examName: config.examName,
    analysis: config.analysis,
    students: [{ ...student, qualifiedForInterview: false }],
    includeScoreDetails: false,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Sheet1']);
  const sheet = workbook.getWorksheet('Sheet1')!;
  assert.equal(sheet.columnCount, 22);
  assert.equal(sheet.getCell('Q1').text, '听力理解得分系数');
  assert.equal(sheet.getCell('V1').text, '写作能力得分系数');
  assert.equal(sheet.getCell('W1').text, '');
  const headers = sheet.getRow(1).values as unknown[];
  assert.equal(headers.includes('Listening Part1'), false);
  assert.equal(headers.includes('考试总分'), false);
  assert.equal(headers.includes('听力理解总得分'), false);
});

test('统一报告组件固定输出九个390 × 844页面', () => {
  const config = defaultConfig();
  config.admission.enabled = true;
  const student = validateRows([HEADERS, demoRows()[0]])[0];
  const html = renderToStaticMarkup(createElement(ReportPages, {
    result: resultFor(student, config, false),
  }));
  assert.equal((html.match(/data-report-page=/g) ?? []).length, 9);
  assert.match(html, /data-report-title="学生信息"/);
  assert.match(html, /data-report-title="资格结果"/);
  assert.match(html, /data-report-title="六维能力图"/);
  assert.match(html, /data-report-title="写作能力"/);
  assert.equal((html.match(/is-reading-dimension/g) ?? []).length, 1);
  assert.match(html, /Congratulations！🎉/);
  assert.match(html, /恭喜你获得「进阶班」入学资格/);
  assert.match(html, /可继续学习佳音课程/);
  assert.match(html, /standard-admission-primary/);
});

test('取得精修班口试资格时使用分组通知文案与独立强调区域', () => {
  const config = defaultConfig();
  config.admission.enabled = true;
  config.admission.dimensionCutoffs = [0, 0, 0, 0, 0, 0];
  const student = validateRows([HEADERS, demoRows()[0]])[0];
  const result = resultFor(student, config, false);
  assert.equal(result.admission?.qualifiedForInterview, true);
  assert.equal(
    result.admission?.message,
    'Congratulations！🎉\n\n恭喜你获得「进阶班」入学资格\n可继续学习佳音课程\n\n并取得「精修班」\n🏆口试选拔考试资格🏆',
  );
  const html = renderToStaticMarkup(createElement(ReportPages, { result }));
  assert.match(html, /standard-admission-interview/);
  assert.match(html, /并取得「精修班」/);
  assert.match(html, /🏆口试选拔考试资格🏆/);
});
