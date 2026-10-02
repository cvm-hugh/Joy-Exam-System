import type { Student } from './domain';

const UNKNOWN_VALUES = new Set(['', '/', '／', '-', '—', '未知', '不详', '不清楚', '待补充', '未填写', 'n/a']);
const YEAR_LEVEL_ALIASES: Record<string, string> = { 初一: '七年级', 初二: '八年级', 初三: '九年级' };
const YEAR_LEVELS = Array.from('一二三四五六七八九', (value) => `${value}年级`);

export const STUDENT_INFORMATION_FIELDS = [
  { key: 'branch', label: '分校名称' },
  { key: 'className', label: '班级名称' },
  { key: 'examSession', label: '笔试时间' },
  { key: 'yearLevel', label: '年级' },
] as const;
export type StudentInformationKey = typeof STUDENT_INFORMATION_FIELDS[number]['key'];
export type StudentInformation = Pick<Student, StudentInformationKey>;
export type StudentInformationIssue = {
  examNo: string;
  name: string;
  field: StudentInformationKey;
  label: string;
  value: string;
  message: string;
};
export type StudentInformationSummary = {
  studentCount: number;
  issueCount: number;
  items: StudentInformationIssue[];
};

export function isUnknownInformation(value: string | undefined) {
  return UNKNOWN_VALUES.has((value ?? '').trim().toLowerCase());
}

export function normalizeYearLevel(value: string | undefined) {
  const text = (value ?? '').trim();
  return isUnknownInformation(text) ? '' : YEAR_LEVEL_ALIASES[text] ?? text;
}

export function studentInformationIssues(student: Pick<Student, 'examNo' | 'name'> & StudentInformation): StudentInformationIssue[] {
  return STUDENT_INFORMATION_FIELDS.flatMap(({ key, label }) => {
    const original = (student[key] ?? '').trim();
    const value = key === 'yearLevel' ? normalizeYearLevel(original) : original;
    const missing = isUnknownInformation(value) || (key === 'branch' && value === 'XX 分校');
    const unrecognized = key === 'yearLevel' && !!value && !YEAR_LEVELS.includes(value);
    if (!missing && !unrecognized) return [];
    return [{
      examNo: student.examNo, name: student.name, field: key, label, value: original,
      message: missing ? '该信息需要填充' : '年级写法需要核对，原值已保留',
    }];
  });
}

export function summarizeStudentInformation(students: Array<Pick<Student, 'examNo' | 'name'> & StudentInformation>): StudentInformationSummary {
  const items = students.flatMap(studentInformationIssues);
  return { studentCount: new Set(items.map((item) => item.examNo)).size, issueCount: items.length, items };
}
