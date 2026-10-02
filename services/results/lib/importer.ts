import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { normalizeYearLevel } from './student-information';
import {
  defaultAnalysis,
  BRANCH_OPTIONS,
  YEAR_LEVEL_OPTIONS,
  scoreHeaders,
  fullMark,
  identitySchema,
  studentInfoSchema,
  type Analysis,
  type Student,
} from './domain';

export class ImportError extends Error {
  constructor(public issues: string[]) {
    super('导入文件校验失败');
  }
}
export const MAX_ROWS = 2000;
function effectivelyBlank(value: unknown) {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  // Excel may retain an empty formula cell in a formatted template row. It is
  // not a student record and should not make an otherwise empty row fail.
  if (typeof value === 'object' && 'result' in value)
    return effectivelyBlank((value as { result?: unknown }).result);
  return false;
}
function validateZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0,
    entries = 0;
  for (let i = 0; i + 46 <= bytes.length; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      const size = view.getUint32(i + 24, true);
      total += size;
      entries++;
      if (size > 20_000_000 || total > 40_000_000 || entries > 300)
        throw new ImportError(['Excel解压后过大，请使用不含图片的纯成绩模板']);
      i +=
        45 +
        view.getUint16(i + 28, true) +
        view.getUint16(i + 30, true) +
        view.getUint16(i + 32, true);
    }
  if (!entries) throw new ImportError(['不是有效的xlsx文件']);
}
export async function parseFile(
  name: string,
  bytes: Uint8Array,
  analysis: Analysis = defaultAnalysis(),
): Promise<Student[]> {
  const rows = await readRows(
      name,
      bytes,
      '成绩',
      scoreHeaders(analysis).length,
      MAX_ROWS,
    );
  const students = attachSourceData(
    validateRows(normalizeScoreExportRows(rows, analysis), analysis),
    rows,
  );
  if (new TextEncoder().encode(JSON.stringify(students)).length > 1_800_000)
    throw new ImportError(['成绩与原始名单数据过大，请联系开发调整批次容量']);
  return students;
}

function compactHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-（）()]/g, '');
}

function chineseDisplayName(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  const chinese = text.match(/[\u3400-\u9fff]+/g)?.join('') ?? '';
  return chinese || text;
}

function normalizedExamNo(value: unknown) {
  const text = metadataText(value);
  const studentNumber = text.match(/^[Ss](\d{5})$/);
  if (studentNumber) return `0${studentNumber[1]}`;
  return /^\d{1,6}$/.test(text) ? text.padStart(6, '0') : text;
}

function metadataText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value).trim();
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'object') {
    if ('result' in value)
      return metadataText((value as { result?: unknown }).result);
    if ('text' in value)
      return metadataText((value as { text?: unknown }).text);
    if ('richText' in value) {
      const richText = (value as { richText?: { text?: string }[] }).richText;
      return richText?.map((part) => part.text ?? '').join('').trim() ?? '';
    }
  }
  return '';
}

function normalizedYearLevel(value: unknown) {
  return normalizeYearLevel(metadataText(value));
}

function sourceHeaderPosition(headers: string[], aliases: string[]) {
  const accepted = new Set(aliases.map(compactHeader));
  return headers.findIndex((header) => accepted.has(compactHeader(header)));
}

function attachSourceData(students: Student[], rows: unknown[][]) {
  if (!rows.length) return students;
  const headers = rows[0].map((value) =>
    typeof value === 'string' ? value.trim() : '',
  );
  // Every import path retains its original columns, including unknown grades.
  const examPosition = sourceHeaderPosition(headers, [
    '考号', '学号', 'Exam ID', '考生号', '准考证号', '考试号',
  ]);
  if (examPosition < 0) return students;
  const usedHeaders = new Set<string>();
  const sourceKeys = headers.map((header, index) => {
    const base = header || `未命名列${index + 1}`;
    let key = base;
    let suffix = 1;
    while (usedHeaders.has(key)) key = `${base}（原始列${index + 1}·${suffix++}）`;
    usedHeaders.add(key);
    return key;
  });
  const byExamNo = new Map<string, Record<string, string>>();
  for (const row of rows.slice(1)) {
    const examNo = normalizedExamNo(row[examPosition]);
    if (!examNo) continue;
    const sourceData: Record<string, string> = {};
    sourceKeys.forEach((header, index) => {
      const value = row[index];
      sourceData[header] = metadataText(value);
    });
    byExamNo.set(examNo, sourceData);
  }
  return students.map((student) => ({
    ...student,
    sourceData: byExamNo.get(student.examNo) ?? student.sourceData ?? {},
  }));
}

/**
 * 阅卷系统的“成绩汇总”包含文件名、复核列和不同命名/顺序的身份列。
 * 这里只抽取当前试卷真正需要的字段，后续仍交给统一的严格校验流程。
 */
export function normalizeScoreExportRows(
  rows: unknown[][],
  analysis: Analysis = defaultAnalysis(),
) {
  if (!rows.length) return rows;
  const required = scoreHeaders(analysis);
  const sourceHeaders = rows[0].map((value) =>
    typeof value === 'string' ? value.trim() : '',
  );
  if (
    sourceHeaders.length === required.length &&
    sourceHeaders.every((value, index) => value === required[index])
  )
    return rows;

  const aliases = new Map<string, Set<string>>([
    ['考号', new Set(['考号', '学号', 'Exam ID', '考生号', '准考证号', '考试号'].map(compactHeader))],
    ['学生姓名', new Set(['学生姓名', '中文名', '姓名', '中英文名', 'Chinese Name'].map(compactHeader))],
    ['分校名称', new Set(['分校名称', '分校', '上课校区', 'Branch'].map(compactHeader))],
    ['班级名称', new Set(['班级名称', '班级', 'Class'].map(compactHeader))],
    ['笔试时间', new Set(['笔试时间', '考试时间（批次）', '考试时间', '考试批次', '参考时间', '参考场次', 'Exam Session'].map(compactHeader))],
    ['年级', new Set(['年级', 'Year Level', 'Grade'].map(compactHeader))],
    ['总分', new Set(['总分', 'Total'].map(compactHeader))],
  ]);

  // 结果管理只接收已完成阅卷的成绩。阅卷系统会保留名单外考号
  // 和其他待复核记录，但这些记录不能悄悄进入正式结果。
  const reviewHeaderAliases = new Set(
    ['需要人工核对学生试卷', '是否需核对原卷', 'Needs Review'].map(compactHeader),
  );
  const identityIssueAliases = new Set(
    ['身份异常', 'Identity Issue'].map(compactHeader),
  );
  const reviewPosition = sourceHeaders.findIndex((header) =>
    reviewHeaderAliases.has(compactHeader(header)),
  );
  const identityIssuePosition = sourceHeaders.findIndex((header) =>
    identityIssueAliases.has(compactHeader(header)),
  );
  const unresolvedLines = rows.slice(1).flatMap((row, index) => {
    const needsReview = reviewPosition >= 0
      ? metadataText(row[reviewPosition])
      : '';
    const identityIssue = identityIssuePosition >= 0
      ? metadataText(row[identityIssuePosition])
      : '';
    return needsReview === '是' || identityIssue
      ? [index + 2]
      : [];
  });
  if (unresolvedLines.length)
    throw new ImportError([
      `阅卷文件仍有${unresolvedLines.length}条待处理记录（第${unresolvedLines.slice(0, 10).join('、')}行）。请先在阅卷系统完成考号补全或原卷复核后再导入。`,
    ]);
  for (const part of analysis.parts) {
    const normalized = compactHeader(part.label);
    aliases.set(
      part.label,
      new Set([normalized, normalized.replace('test', '')]),
    );
  }

  const candidatePositions = required.map((header) => {
    const accepted = aliases.get(header) ?? new Set([compactHeader(header)]);
    return sourceHeaders
      .map((source, index) => (accepted.has(compactHeader(source)) ? index : -1))
      .filter((index) => index >= 0);
  });
  const positions = candidatePositions.map((matches) => {
    // 原始教务名单可能合法地含有同名列（目前模板中就有两个
    // “姓名”）；阅卷系统则始终把最终成绩追加在原名单右侧。
    // 因此同名时取最右一列，与阅卷系统导入名单时的规则一致，
    // 也能确保成绩取到新追加的最终值，而不是原模板中的空列。
    return matches.at(-1) ?? -1;
  });
  const missingHeaders = required.filter((_, index) => positions[index] < 0);
  if (missingHeaders.length)
    throw new ImportError([
      `阅卷交接文件缺少可识别字段：${missingHeaders.join('、')}。`,
      `实际读取的表头：${sourceHeaders.filter(Boolean).join('、') || '（空表）'}。`,
    ]);
  return [
    required,
    ...rows.slice(1).map((row) => positions.map((position, index) => {
      const header = required[index];
      if (header === '考号') return normalizedExamNo(row[position]);
      if (header === '学生姓名') {
        const name = candidatePositions[index]
          .toReversed()
          .map((candidate) => metadataText(row[candidate]))
          .find(Boolean) ?? '';
        return chineseDisplayName(name);
      }
      if (header === '年级') return metadataText(row[position]);
      if (['分校名称', '班级名称', '笔试时间'].includes(header))
        return metadataText(row[position]);
      return row[position] ?? '';
    })),
  ];
}
export async function readRows(
  name: string,
  bytes: Uint8Array,
  sheetName: string,
  columns: number,
  maxRows: number,
): Promise<unknown[][]> {
  if (bytes.length > 3_000_000)
    throw new ImportError(['文件超过3MB，请分离图片和无关工作表']);
  let rows: unknown[][];
  if (name.toLowerCase().endsWith('.csv')) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ImportError([
        'CSV必须采用UTF-8编码，请在Excel中另存为CSV UTF-8',
      ]);
    }
    const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
      skipEmptyLines: 'greedy',
    });
    if (parsed.errors.length)
      throw new ImportError(
        parsed.errors
          .slice(0, 20)
          .map((e) => `CSV第${(e.row ?? 0) + 1}行：${e.message}`),
      );
    rows = parsed.data;
  } else if (name.toLowerCase().endsWith('.xlsx')) {
    validateZip(bytes);
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(bytes as never);
    } catch {
      throw new ImportError(['无法读取Excel，请使用未加密的.xlsx模板']);
    }
    const sheet = book.getWorksheet(sheetName) ?? book.worksheets[0];
    if (!sheet) throw new ImportError(['Excel没有工作表']);
    if (sheet.rowCount > maxRows + 1)
      throw new ImportError([`工作表最多${maxRows}行内容，请检查多余行`]);
    rows = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = Array.from(
        { length: Math.max(columns, row.cellCount) },
        (_, i) => row.getCell(i + 1).value ?? '',
      );
      rows.push(values);
    });
  } else throw new ImportError(['仅支持.xlsx或UTF-8 .csv文件']);
  if (rows.length > maxRows + 1)
    throw new ImportError([`工作表最多${maxRows}行内容`]);
  return rows;
}
export function validateRows(
  rows: unknown[][],
  analysis: Analysis = defaultAnalysis(),
): Student[] {
  const HEADERS = scoreHeaders(analysis);
  const PARTS = analysis.parts;
  const issues: string[] = [];
  if (rows.length < 2)
    throw new ImportError(['文件没有学生成绩，请勿上传空模板']);
  if (rows.length > MAX_ROWS + 1)
    throw new ImportError([`基础版每批最多${MAX_ROWS}名学生`]);
  const header = rows[0].map((x) => (typeof x === 'string' ? x.trim() : ''));
  if (
    header.length !== HEADERS.length ||
    header.some((x, i) => x !== HEADERS[i])
  )
    throw new ImportError([
      `表头或顺序不匹配，请重新下载固定模板。正确表头：${HEADERS.join('、')}`,
    ]);
  const seen = new Set<string>();
  const students: Student[] = [];
  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    if (row.every(effectivelyBlank)) return;
    const start = issues.length;
    if (row.length !== HEADERS.length) {
      issues.push(`第${line}行：列数应为${HEADERS.length}`);
      return;
    }
    if (typeof row[0] !== 'string')
      issues.push(
        `第${line}行：考号必须为文本，避免丢失前导零，请按模板设置文本格式`,
      );
    const identity = identitySchema.safeParse({
      examNo: typeof row[0] === 'string' ? row[0].trim() : '',
      name: typeof row[1] === 'string' ? row[1].trim() : '',
    });
    if (!identity.success) {
      issues.push(`第${line}行：姓名或考号格式不正确`);
      return;
    }
    if (seen.has(identity.data.examNo)) issues.push(`第${line}行：考号重复`);
    seen.add(identity.data.examNo);
    const scores: Record<string, string> = {};
    let sum = new Decimal(0);
    const parseScore = (value: unknown, label: string, max: number) => {
      if (
        (typeof value !== 'string' && typeof value !== 'number') ||
        !/^\d+(\.\d{1,4})?$/.test(String(value).trim())
      ) {
        issues.push(
          `第${line}行 ${label}：需填写非负数字，最多4位小数；不接受公式或空值`,
        );
        return null;
      }
      const d = new Decimal(String(value).trim());
      if (d.gt(max)) {
        issues.push(`第${line}行 ${label}：超过满分${max}`);
        return null;
      }
      return d;
    };
    const info = studentInfoSchema.safeParse({
      branch: metadataText(row[2]),
      className: metadataText(row[3]),
      examSession: metadataText(row[4]),
      yearLevel: normalizedYearLevel(row[5]),
    });
    if (!info.success)
      info.error.issues.forEach((issue) =>
        issues.push(`第${line}行：${issue.message}`),
      );
    PARTS.forEach((p, i) => {
      const score = parseScore(row[i + 6], p.label, p.max);
      if (score) {
        scores[p.id] = score.toString();
        sum = sum.plus(score);
      }
    });
    const total = parseScore(row.at(-1), '总分', fullMark(analysis));
    if (total && !total.eq(sum) && Object.keys(scores).length === PARTS.length)
      issues.push(
        `第${line}行：总分${total.toString()}与各Part之和${sum.toString()}不一致（共享Part只计一次）`,
      );
    if (issues.length === start)
      students.push({ ...identity.data, ...info.data!, sourceData: Object.fromEntries(HEADERS.map((header, position) => [header, metadataText(row[position])])), scores, total: total!.toString() });
  });
  if (issues.length) throw new ImportError(issues.slice(0, 100));
  if (!students.length) throw new ImportError(['文件没有有效学生成绩']);
  if (new TextEncoder().encode(JSON.stringify(students)).length > 1_800_000)
    throw new ImportError(['成绩数据过大，请联系开发调整批次容量']);
  return students;
}
export async function makeTemplate(
  format: 'xlsx' | 'csv',
  analysis: Analysis = defaultAnalysis(),
) {
  const HEADERS = scoreHeaders(analysis);
  if (format === 'csv')
    return new TextEncoder().encode('\uFEFF' + Papa.unparse([HEADERS]));
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('成绩');
  sheet.addRow(HEADERS);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF23664F' },
  };
  sheet.columns = HEADERS.map((h, i) => ({
    width: i < 6 ? 22 : 25,
    numFmt: i < 6 ? '@' : '0.####',
  }));
  const branchValidation: ExcelJS.DataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: [`"${BRANCH_OPTIONS.join(',')}"`],
    showInputMessage: true,
    promptTitle: '选择分校',
    prompt: '请选择完整分校名称。',
    showErrorMessage: true,
    errorTitle: '分校名称不在名单中',
    error: '请选择下拉列表中的完整分校名称。',
  };
  const yearLevelValidation: ExcelJS.DataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: [`"${YEAR_LEVEL_OPTIONS.join(',')}"`],
    showInputMessage: true,
    promptTitle: '选择年级',
    prompt: '年级选填，未知可留空；初一至初三会自动统一为七至九年级。',
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: '请核对年级',
    error: '建议选择“一年级”至“九年级”；其他写法可以保留，未知可留空。',
  };
  const validationRanges = sheet as ExcelJS.Worksheet & {
    dataValidations: {
      add(range: string, validation: ExcelJS.DataValidation): void;
    };
  };
  validationRanges.dataValidations.add('C2:C2001', branchValidation);
  validationRanges.dataValidations.add('F2:F2001', yearLevelValidation);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const guide = book.addWorksheet('填写说明');
  [
    '请勿更改成绩工作表的表头或顺序。',
    '学生姓名仅使用中文名。',
    `分校名称须从下拉列表选择：${BRANCH_OPTIONS.join('、')}。`,
    '班级名称、笔试时间、年级只作信息保留，不参与报告版式或成绩计算；可以留空。',
    '笔试时间不限定格式，系统按单元格内容原样保留；Excel日期会转成“年-月-日”。',
    '年级选填；初一、初二、初三自动统一为七年级、八年级、九年级；空白、斜杠及未知视为待补充。其他写法保留并提醒核对，不阻断导入。',
    '导出前会列出分校、班级、笔试时间和年级的待补充信息；参考信息未补齐时可以继续导出，Excel附有“信息待补充”清单。',
    '长图文件名：分校-班级-学生中文名-考号.png。',
    '考号按文本填写，保留前导零。',
    '每个Part必填；缺考、缺分不可直接留空或按零分处理。',
    `只填数字，不接受公式；总分须等于${analysis.parts.length}项原始得分之和（满分${fullMark(analysis)}分）。`,
    '一个Part可关联多个维度，但在总分中只计一次。',
    ...analysis.parts.map((p) => `${p.label}：满分${p.max}分`),
    `基础版每批最多${MAX_ROWS}行，文件最多3MB；任一错误将取消整批替换。`,
  ].forEach((x) => guide.addRow([x]));
  guide.getColumn(1).width = 100;
  return new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer);
}
