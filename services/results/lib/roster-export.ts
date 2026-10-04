import ExcelJS from 'exceljs';
import { DIMENSIONS, type Student } from './domain';
import { normalizeYearLevel, summarizeStudentInformation } from './student-information';

export type RosterExportStudent = Student & { qualifiedForInterview?: boolean | null };

const ROSTER_IDENTITY_HEADERS = [
  '学号', '中英文名', '姓名', '年级', '上课科目', '课程', '班级', '毕业时间', '上课校区',
  '任课老师', '笔试时间', '备注', '是否报名TM', '联系电话', '精修笔试通过', '',
];
// Stable IDs select data; the roster keeps its established six column captions.
const coefficientFields = DIMENSIONS.map(({ id, name }) => ({ id, header: `${name}得分系数` }));
const coefficientIds = new Map<string, string>(coefficientFields.map(({ id, header }) => [header, id]));
export const COEFFICIENT_END = ROSTER_IDENTITY_HEADERS.length + coefficientFields.length;
export const COEFFICIENT_COLUMNS = coefficientFields.map((_, index) => ROSTER_IDENTITY_HEADERS.length + index + 1);
export const ORIGINAL_ROSTER_HEADERS = [
  ...ROSTER_IDENTITY_HEADERS, ...coefficientFields.map(({ header }) => header), '', '', '', '',
];

export function originalRosterValues(
  student: RosterExportStudent,
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
    // Export the current metadata, including values supplemented after import.
    if (header === '年级') return normalizeYearLevel(student.yearLevel);
    if (header === '班级') return student.className ?? '';
    if (header === '上课校区') return student.branch ?? '';
    if (header === '笔试时间') return student.examSession ?? '';
    if (header === '姓名') {
      const name = source['姓名'] ?? student.name;
      return name.match(/[\u3400-\u9fff]+/g)?.join('') ?? name;
    }
    if (header === '精修笔试通过') {
      if (student.qualifiedForInterview == null) return '';
      return student.qualifiedForInterview ? '是' : '否';
    }
    const dimensionId = coefficientIds.get(header);
    if (dimensionId) return coefficients.get(dimensionId) ?? '';
    return source[header] ?? fallback[header] ?? '';
  });
}

export function styleHeader(row: ExcelJS.Row, color = '24684F') {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD7E2DC' } } };
  });
}

export function appendInformationSheets(workbook: ExcelJS.Workbook, students: Student[]) {
  const checklist = workbook.addWorksheet('信息待补充');
  checklist.columns = [{ width: 18 }, { width: 18 }, { width: 18 }, { width: 24 }, { width: 44 }];
  checklist.addRow(['考号', '学生姓名', '信息字段', '当前填写内容', '提示']);
  for (const item of summarizeStudentInformation(students).items)
    checklist.addRow([item.examNo, item.name, item.label, item.value, item.message]);
  checklist.getColumn(1).numFmt = '@';
  checklist.views = [{ state: 'frozen', ySplit: 1 }];
  checklist.autoFilter = 'A1:E1';
  styleHeader(checklist.getRow(1), '98641D');

  const original = workbook.addWorksheet('原始名单信息');
  const sourceHeaders = [...new Set(students.flatMap((student) => Object.keys(student.sourceData ?? {})))];
  original.addRow(['当前考号', '当前学生姓名', ...sourceHeaders]);
  for (const student of students)
    original.addRow([student.examNo, student.name, ...sourceHeaders.map((header) => student.sourceData?.[header] ?? '')]);
  original.getColumn(1).numFmt = '@';
  original.columns.forEach((column) => { column.width = 22; column.numFmt = '@'; });
  original.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  styleHeader(original.getRow(1));
}
