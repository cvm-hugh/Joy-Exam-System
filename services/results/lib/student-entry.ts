import Decimal from 'decimal.js';
import { z } from 'zod';
import { identitySchema, studentInfoSchema, type Analysis, type Student } from './domain';
import { normalizeYearLevel } from './student-information';

export function parseStudentEntry(input: unknown, analysis: Analysis): Student {
  const shape = Object.fromEntries(
    analysis.parts.map((p) => [
      p.id,
      z
        .string()
        .trim()
        .max(30)
        .regex(/^\d+(\.\d{1,4})?$/, `${p.label}：请填写非负数字，最多4位小数`)
        .refine(
          (v) => /^\d+(\.\d{1,4})?$/.test(v) && new Decimal(v).lte(p.max),
          `${p.label}：分数不能超过${p.max}分`,
        ),
    ]),
  );
  const parsed = z
    .object({ ...identitySchema.shape, ...studentInfoSchema.shape, scores: z.object(shape).strict() })
    .strict()
    .parse(input);
  const scores = Object.fromEntries(
    Object.entries(parsed.scores).map(([id, score]) => [
      id,
      new Decimal(score).toString(),
    ]),
  );
  const total = Object.values(scores)
    .reduce((sum, score) => sum.plus(score), new Decimal(0))
    .toString();
  return { ...parsed, yearLevel: normalizeYearLevel(parsed.yearLevel), sourceData: {
    考号: parsed.examNo, 学生姓名: parsed.name, 分校名称: parsed.branch,
    班级名称: parsed.className, 笔试时间: parsed.examSession, 年级: parsed.yearLevel,
  }, scores, total };
}
