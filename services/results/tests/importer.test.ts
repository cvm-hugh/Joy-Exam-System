import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { demoRows, makeFixtureFile } from './fixtures';
import { HEADERS } from '../lib/domain';
import {
  makeTemplate,
  normalizeScoreExportRows,
  parseFile,
  validateRows,
  ImportError,
} from '../lib/importer';

test('阅卷系统成绩汇总可直接重排导入并忽略文件名、六维和复核列', () => {
  const headers = [
    'File Name', '考号', '中文名', '年级', '分校', '班级', '考试批次',
    'Listening_Part1', 'Listening_Part2', 'Listening_Part3',
    'Written_Part1', 'Written_Part2', 'Written_Part3', 'Written_Part4',
    'Written_Part5', 'Written_Part6', 'Written_Part7', 'Written_Part8',
    'Writing', 'Total', '听力理解', '是否需核对原卷', 'Status',
  ];
  const exported = [
    headers,
    [
      '000001.jpg', '000001', '测试甲', '七年级', '中心分校', '一班',
      '2026-09-12 上午场', 5, 5, 5, 5, 5, 10, 5, 5, 5, 7, 8, 15,
      80, 1, '否', 'OK',
    ],
  ];
  const normalized = normalizeScoreExportRows(exported);
  assert.deepEqual(normalized[0], HEADERS);
  const students = validateRows(normalized);
  assert.equal(students[0].examNo, '000001');
  assert.equal(students[0].name, '测试甲');
  assert.equal(students[0].branch, '中心分校');
  assert.equal(students[0].yearLevel, '七年级');
  assert.equal(students[0].scores.W3, '10');
  assert.equal(students[0].total, '80');
});

test('阅卷系统多工作表xlsx直接读取首个成绩汇总页', async () => {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('成绩汇总');
  summary.addRow([
    'File Name', '考号', '中文名', '年级', '分校', '班级', '考试批次',
    'Listening_Part1', 'Listening_Part2', 'Listening_Part3',
    'Written_Part1', 'Written_Part2', 'Written_Part3', 'Written_Part4',
    'Written_Part5', 'Written_Part6', 'Written_Part7', 'Written_Part8',
    'Writing', 'Total', '空白Part', '空白题号', 'Status',
  ]);
  summary.addRow([
    '000008.jpg', '000008', '张三', '七年级', '中心分校', '一班',
    '2026-09-12 上午场', 5, 5, 5, 5, 5, 10, 5, 5, 5, 7, 8, 15,
    80, '', '', 'OK',
  ]);
  workbook.addWorksheet('逐题明细').addRow(['无关列']);
  workbook.addWorksheet('需复核名单').addRow(['无关列']);
  const students = await parseFile(
    '阅卷结果.xlsx',
    new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer),
  );
  assert.equal(students.length, 1);
  assert.equal(students[0].examNo, '000008');
  assert.equal(students[0].total, '80');
});

test('原始名单业务列随阅卷成绩进入结果系统，中英混排姓名只用中文查询', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('成绩汇总');
  sheet.addRow([
    '学号', '姓名', '年级', '上课科目', '课程', '班级', '毕业时间', '上课校区',
    '任课老师', '考试批次', '备注', '是否报名TM', '联系电活', '', '精修口试通过', '',
    'Listening_Part1', 'Listening_Part2', 'Listening_Part3',
    'Written_Part1', 'Written_Part2', 'Written_Part3', 'Written_Part4',
    'Written_Part5', 'Written_Part6', 'Written_Part7', 'Written_Part8',
    'Writing', 'Total', '需要人工核对学生试卷', '身份异常',
  ]);
  sheet.addRow([
    '000009', '张佳音Joy', '七年级', '英语', '精修班', '一班', '2027', '中心分校',
    '王老师', '2026-09-12 上午场', '正常', '是', '13800000000', '', '', '',
    5, 5, 5, 5, 5, 10, 5, 5, 5, 7, 8, 15, 80, '否', '',
  ]);
  const students = await parseFile(
    '阅卷结果.xlsx',
    new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer),
  );
  assert.equal(students[0].name, '张佳音');
  assert.equal(students[0].sourceData?.['任课老师'], '王老师');
  assert.equal(students[0].sourceData?.['联系电活'], '13800000000');
});

test('合并交接接受含重复姓名列的原始名单表头', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('成绩汇总');
  sheet.addRow([
    '学号', '姓名', '姓名', '年级', '上课科目', '课程', '班级', '毕业时间', '上课校区',
    '任课老师', '笔试时间', '备注', '是否报名TM', '联系电话', '精修笔试通过', '',
    'File Name', 'Listening_Part1', 'Listening_Part2', 'Listening_Part3',
    'Written_Part1', 'Written_Part2', 'Written_Part3', 'Written_Part4',
    'Written_Part5', 'Written_Part6', 'Written_Part7', 'Written_Part8',
    'Writing', 'Total', '需要人工核对学生试卷', '异常原因', '身份异常',
  ]);
  sheet.addRow([
    'S10010', '张佳音Joy', '', '六年级', '英语', 'IS12', 'RIA', '2027', '新街分校',
    '李老师', '8.22（周六）', '', '否', '13800000001', '', '',
    '000010.jpg', 5, 5, 5, 5, 5, 10, 5, 5, 5, 7, 8, 15, 80, '否', '', '',
  ]);
  const students = await parseFile(
    '阅卷结果.xlsx',
    new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer),
  );
  assert.equal(students.length, 1);
  assert.equal(students[0].examNo, '010010');
  assert.equal(students[0].name, '张佳音');
  assert.equal(students[0].branch, '新街分校');
  assert.equal(students[0].className, 'RIA');
  assert.equal(students[0].examSession, '8.22（周六）');
  assert.equal(students[0].scores.W3, '10');
  assert.equal(students[0].total, '80');
  assert.equal(students[0].sourceData?.['学号'], 'S10010');
  assert.equal(students[0].sourceData?.['任课老师'], '李老师');
});

test('阅卷文件存在未处理考号时拒绝进入正式结果', () => {
  const rows = [
    [
      'File Name', '考号', '中文名', '年级', '分校', '班级', '考试批次',
      'Listening_Part1', 'Listening_Part2', 'Listening_Part3',
      'Written_Part1', 'Written_Part2', 'Written_Part3', 'Written_Part4',
      'Written_Part5', 'Written_Part6', 'Written_Part7', 'Written_Part8',
      'Writing', 'Total', '需要人工核对学生试卷', '异常原因', '身份异常',
    ],
    [
      '999999.jpg', '999999', '', '', '', '', '',
      5, 5, 5, 5, 5, 10, 5, 5, 5, 7, 8, 15, 80,
      '是', '考号不在名单中', '考号不在名单中',
    ],
  ];
  assert.throws(
    () => normalizeScoreExportRows(rows),
    (error) =>
      error instanceof ImportError &&
      error.issues.some((issue) => issue.includes('待处理记录')),
  );
});
test('CSV与Excel样例都能导入并保留前导零', async () => {
  for (const ext of ['csv', 'xlsx'] as const) {
    const bytes = await makeFixtureFile(ext);
    const rows = await parseFile(`scores.${ext}`, bytes);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].examNo, '000001');
    assert.equal(rows[0].total, '66');
  }
});
test('空模板不会清空旧成绩', async () => {
  await assert.rejects(() => parseFile('empty.xlsx', awaitable()), ImportError);
  function awaitable() {
    return new Uint8Array();
  }
});
test('空成绩、重复考号、非文本考号、超满分、负分、公式、总分不一致、缺列、错误表头均拒绝', () => {
  const mutations = [
    (r: unknown[][]) => r.push([...r[1]]),
    (r: unknown[][]) => (r[1][0] = 1),
    (r: unknown[][]) => (r[1][6] = 6),
    (r: unknown[][]) => (r[1][6] = -1),
    (r: unknown[][]) => (r[1][6] = ''),
    (r: unknown[][]) => (r[1][6] = { formula: '1+1', result: 2 }),
    (r: unknown[][]) => (r[1][r[1].length - 1] = 79),
    (r: unknown[][]) => r[1].pop(),
    (r: unknown[][]) => (r[0][0] = '学号'),
  ];
  for (const mutate of mutations) {
    const rows: unknown[][] = [HEADERS.slice(), [...demoRows()[0]]];
    mutate(rows);
    assert.throws(() => validateRows(rows), ImportError);
  }
});
test('错误包含实际行号，CSV引号内中文支持', async () => {
  const rows: unknown[][] = [
    HEADERS.slice(),
    Array(HEADERS.length).fill(''),
    [...demoRows()[0]],
  ];
  rows[2][6] = 'wrong';
  assert.throws(
    () => validateRows(rows),
    (e) =>
      e instanceof ImportError && e.issues.some((i) => i.includes('第3行')),
  );
  const bytes = await makeFixtureFile('csv');
  const imported = await parseFile('a.csv', bytes);
  assert.equal(imported[2].name, '测试丙');
});
test('错误扩展名、非法UTF8与超过上限拒绝', async () => {
  await assert.rejects(() => parseFile('a.xls', new Uint8Array()), ImportError);
  await assert.rejects(
    () => parseFile('a.csv', new Uint8Array([255, 254])),
    ImportError,
  );
  await assert.rejects(
    () => parseFile('a.csv', new Uint8Array(3_000_001)),
    ImportError,
  );
});
test('Excel空模板有正确表头但无学生', async () => {
  const bytes = await makeTemplate('xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  assert.equal(
    book.getWorksheet('填写说明')!.getCell('A2').value,
    '学生姓名仅使用中文名。',
  );
  const scoreSheet = book.getWorksheet('成绩')!;
  assert.equal(scoreSheet.getCell('C2').dataValidation.type, 'list');
  assert.match(String(scoreSheet.getCell('C2').dataValidation.formulae?.[0]), /牡丹广场分校/);
  assert.equal(scoreSheet.getCell('F2').dataValidation.type, 'list');
  assert.match(String(scoreSheet.getCell('F2').dataValidation.formulae?.[0]), /七年级/);
  await assert.rejects(
    () => parseFile('template.xlsx', bytes),
    (e) =>
      e instanceof ImportError && e.issues.some((x) => x.includes('没有学生')),
  );
});

test('班级批次年级可留空，批次数字转文字，旧初中年级写法自动统一', () => {
  const blankInfo = [HEADERS.slice(), [...demoRows()[0]]];
  blankInfo[1][3] = '';
  blankInfo[1][4] = '';
  blankInfo[1][5] = '';
  const blankStudent = validateRows(blankInfo)[0];
  assert.equal(blankStudent.className, '');
  assert.equal(blankStudent.examSession, '');
  assert.equal(blankStudent.yearLevel, '');

  const source = [
    ['File Name', '考号', '中文名', '年级', '分校', '班级', '考试批次',
      ...HEADERS.slice(6, -1), 'Total'],
    ['a.jpg', '000001', '测试甲', '初一', '中心分校', '', 9.19,
      ...demoRows()[0].slice(6)],
  ];
  const student = validateRows(normalizeScoreExportRows(source))[0];
  assert.equal(student.yearLevel, '七年级');
  assert.equal(student.examSession, '9.19');
});
