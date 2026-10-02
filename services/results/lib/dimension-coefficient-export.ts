import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import type { Analysis, Student } from './domain';

export type DimensionCoefficientExportData = {
  examName: string;
  analysis: Analysis;
  students: Array<Student & { qualifiedForInterview?: boolean | null }>;
  includeScoreDetails?: boolean;
};

const ORIGINAL_ROSTER_HEADERS = [
  '学号', '中英文名', '姓名', '年级', '上课科目', '课程', '班级', '毕业时间', '上课校区',
  '任课老师', '笔试时间', '备注', '是否报名TM', '联系电话', '精修笔试通过', '',
  '听力理解得分系数', '词汇运用得分系数', '语法运用得分系数', '交际能力得分系数',
  '阅读理解得分系数', '写作能力得分系数', '', '', '', '',
];

function originalRosterValues(
  student: Student & { qualifiedForInterview?: boolean | null },
  coefficients: Map<string, number>,
) {
  const source = student.sourceData ?? {};
  const fallback: Record<string, string> = {
    '学号': student.examNo,
    '中英文名': source['中英文名'] ?? source['姓名'] ?? student.name,
    '姓名': student.name,
    '年级': student.yearLevel ?? '',
    '班级': student.className ?? '',
    '上课校区': student.branch ?? '',
    '笔试时间': source['笔试时间'] ?? source['考试时间'] ?? source['考试批次'] ?? student.examSession ?? '',
    '联系电话': source['联系电话'] ?? source['联系电活'] ?? '',
  };
  return ORIGINAL_ROSTER_HEADERS.map((header) => {
    if (!header) return '';
    if (header === '姓名') {
      const name = source['姓名'] ?? student.name;
      return name.match(/[\u3400-\u9fff]+/g)?.join('') ?? name;
    }
    if (header === '精修笔试通过') {
      if (student.qualifiedForInterview == null) return '';
      return student.qualifiedForInterview ? '是' : '否';
    }
    if (header.endsWith('得分系数'))
      return coefficients.get(header.slice(0, -4)) ?? '';
    return source[header] ?? fallback[header] ?? '';
  });
}

function truncatedCoefficient(
  student: Student,
  dimension: Analysis['dimensions'][number],
  analysis: Analysis,
) {
  const actual = dimension.parts.reduce(
    (sum, id) => sum.plus(student.scores[id]),
    new Decimal(0),
  );
  const maximum = dimension.parts.reduce(
    (sum, id) =>
      sum.plus(analysis.parts.find((part) => part.id === id)!.max),
    new Decimal(0),
  );
  return {
    actual: actual.toNumber(),
    coefficient: actual
      .div(maximum)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN)
      .toNumber(),
  };
}

function styleHeader(row: ExcelJS.Row, color = '24684F') {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD7E2DC' } } };
  });
}

export async function buildDimensionCoefficientWorkbook({
  examName,
  analysis,
  students,
  includeScoreDetails = true,
}: DimensionCoefficientExportData): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '考试结果管理';
  workbook.created = new Date();

  const detail = workbook.addWorksheet('Sheet1', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 2, showGridLines: false }],
    properties: { defaultRowHeight: 22 },
  });
  const coefficientEnd = ORIGINAL_ROSTER_HEADERS.indexOf('写作能力得分系数') + 1;
  const rosterHeaders = includeScoreDetails
    ? ORIGINAL_ROSTER_HEADERS
    : ORIGINAL_ROSTER_HEADERS.slice(0, coefficientEnd);
  const headers = includeScoreDetails
    ? [
        ...rosterHeaders,
        ...analysis.parts.map((part) => part.label),
        '考试总分',
        '',
        ...analysis.dimensions.map((dimension) => `${dimension.name}总得分`),
      ]
    : rosterHeaders;
  detail.addRow(headers);
  styleHeader(detail.getRow(1));

  for (const student of students) {
    const dimensions = analysis.dimensions.map((dimension) =>
      truncatedCoefficient(student, dimension, analysis),
    );
    const coefficients = new Map(
      analysis.dimensions.map((dimension, index) => [
        dimension.name,
        dimensions[index].coefficient,
      ]),
    );
    const rosterValues = originalRosterValues(student, coefficients).slice(
      0,
      rosterHeaders.length,
    );
    detail.addRow(
      includeScoreDetails
        ? [
            ...rosterValues,
            ...analysis.parts.map((part) => Number(student.scores[part.id])),
            Number(student.total),
            '',
            ...dimensions.map((dimension) => dimension.actual),
          ]
        : rosterValues,
    );
  }

  const partStart = ORIGINAL_ROSTER_HEADERS.length + 1;
  const partEnd = partStart + analysis.parts.length;
  const totalStart = partEnd + 2;
  const totalEnd = totalStart + analysis.dimensions.length - 1;
  detail.getColumn(1).numFmt = '@';
  if (includeScoreDetails)
    for (let column = partStart; column <= totalEnd; column += 1)
      detail.getColumn(column).numFmt = '0.####';
  for (let column = 17; column <= 22; column += 1)
    detail.getColumn(column).numFmt = '0.00';
  for (let row = 2; row <= detail.rowCount; row += 1) {
    const current = detail.getRow(row);
    current.alignment = { vertical: 'middle' };
    if (row % 2 === 0) {
      current.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8F6' } };
      });
    }
  }
  detail.columns.forEach((column, index) => {
    if (index === 0) column.width = 14;
    else if (index === 1) column.width = 14;
    else if ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(index)) column.width = 16;
    else column.width = headers[index] ? 18 : 3;
  });
  detail.autoFilter = { from: 'A1', to: detail.getRow(1).getCell(headers.length).address };

  if (!includeScoreDetails) {
    const bytes = await workbook.xlsx.writeBuffer();
    return bytes;
  }

  const rules = workbook.addWorksheet('Sheet2', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 22 },
  });
  rules.columns = [
    { width: 18 },
    { width: 24 },
    { width: 50 },
    { width: 18 },
    { width: 54 },
  ];
  rules.addRow(['六维得分系数导出说明']);
  rules.mergeCells('A1:E1');
  rules.getCell('A1').font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF263F32' } };
  rules.getCell('A1').alignment = { vertical: 'middle' };
  rules.getRow(1).height = 34;
  rules.addRow(['考试名称', examName]);
  rules.mergeCells('B2:E2');
  rules.getCell('B2').alignment = { wrapText: true, vertical: 'middle' };
  rules.getRow(2).height = 42;
  rules.addRow(['导出学生数', students.length]);
  rules.addRow([]);
  rules.addRow(['计算与保留规则']);
  rules.mergeCells('A5:E5');
  styleHeader(rules.getRow(5));
  const notes = [
    ['维度总得分', '按当前试卷模板保存的映射，将该维度关联的所有Part原始分数相加。'],
    ['维度总满分', '将该维度关联的所有Part满分相加。'],
    ['真实得分系数', '维度总得分 ÷ 维度总满分。'],
    ['小数保留', '直接截断保留小数点后2位，不四舍五入；例如0.678显示为0.67。'],
    ['低分保护', '本表导出真实成绩系数，不采用预览页面的0.3最低显示保护。'],
    ['重复映射', '若同一个Part同时关联多个维度，该Part的得分和满分会完整计入每个关联维度，不进行均摊。'],
  ];
  for (const [label, explanation] of notes) {
    const row = rules.addRow([label, explanation]);
    rules.mergeCells(`B${row.number}:E${row.number}`);
    row.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF263F32' } };
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
    row.height = 34;
  }
  rules.addRow([]);
  const mappingHeader = rules.addRow(['维度', 'Part编号', 'Part名称与满分', '维度总满分', '计算公式']);
  styleHeader(mappingHeader);
  for (const dimension of analysis.dimensions) {
    const parts = dimension.parts.map((id) => analysis.parts.find((part) => part.id === id)!);
    const maximum = parts.reduce((sum, part) => sum.plus(part.max), new Decimal(0));
    const row = rules.addRow([
      dimension.name,
      parts.map((part) => part.id).join(' + '),
      parts.map((part) => `${part.label}（${part.max}分）`).join(' + '),
      maximum.toNumber(),
      `（${parts.map((part) => part.label).join(' + ')}）÷ ${maximum.toString()}，结果向下截断至2位小数`,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 48;
  }
  rules.getColumn(4).numFmt = '0.####';
  rules.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = { ...cell.font, name: 'Arial', size: cell.font?.size ?? 10 };
      cell.alignment = { ...cell.alignment, vertical: cell.alignment?.vertical ?? 'middle' };
    });
  });

  const bytes = await workbook.xlsx.writeBuffer();
  return bytes;
}

export function dimensionCoefficientFileName() {
  return `六维得分系数-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
}
