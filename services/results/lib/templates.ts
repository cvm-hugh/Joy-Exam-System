import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  configSchema,
  defaultConfig,
  isComplete,
  type Config,
  type Student,
} from './domain';

const base = configSchema.safeParse(defaultConfig());
if (!base.success) throw new Error('默认配置无效');
// Reuse the same validators used for the live configuration, including thresholds.
const fields = configSchema.shape;
export const analysisTemplateSchema = z
  .object({
    analysis: fields.analysis,
    dimensions: z
      .array(fields.dimensions.element.pick({ id: true, rules: true }))
      .length(6),
    thresholdsConfirmed: z.boolean(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const candidate = withAnalysis(defaultConfig(), data);
    const parsed = configSchema.safeParse(candidate);
    if (!parsed.success)
      parsed.error.issues.forEach((i) =>
        ctx.addIssue({ code: 'custom', message: i.message }),
      );
  });
export const evaluationTemplateSchema = z
  .object({
    paragraphTitles: fields.paragraphTitles,
    dimensions: z
      .array(
        fields.dimensions.element
          .pick({ id: true, evaluations: true })
          .extend({ name: z.string().trim().min(1).max(160) }),
      )
      .length(6),
  })
  .strict()
  .superRefine((data, ctx) => {
    const parsed = configSchema.safeParse(
      withEvaluation(defaultConfig(), data),
    );
    if (!parsed.success)
      parsed.error.issues.forEach((i) =>
        ctx.addIssue({ code: 'custom', message: i.message }),
      );
  });
export type AnalysisTemplate = {
  analysis: Config['analysis'];
  dimensions: Pick<Config['dimensions'][number], 'id' | 'rules'>[];
  thresholdsConfirmed: boolean;
};
export type EvaluationTemplate = {
  paragraphTitles: Config['paragraphTitles'];
  dimensions: (Pick<Config['dimensions'][number], 'id' | 'evaluations'> & {
    name: string;
  })[];
};
export type ThresholdTemplate = {
  dimensions: (Pick<Config['dimensions'][number], 'id' | 'rules'> & {
    name: string;
  })[];
};
export const thresholdTemplateSchema = z
  .object({
    dimensions: z
      .array(
        fields.dimensions.element.pick({ id: true, rules: true }).extend({
          name: z.string().trim().min(1).max(160),
        }),
      )
      .length(6),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.dimensions.length !== 6) return;
    const parsed = configSchema.safeParse(
      withThresholds(defaultConfig(), data),
    );
    if (!parsed.success)
      parsed.error.issues.forEach((i) =>
        ctx.addIssue({ code: 'custom', message: i.message }),
      );
  });
export const TEMPLATE_LABELS = {
  paper: '试卷模板',
  analysis: '分析模板',
  evaluation: '评价模板',
  thresholds: '等级阈值模板',
} as const;
// A paper owns all teaching configuration. Exam copy and student records are not templates.
export type PaperTemplate = Pick<
  Config,
  'analysis' | 'dimensions' | 'paragraphTitles' | 'contentConfirmed' | 'admission'
>;
export function paperFrom(config: Config): PaperTemplate {
  return structuredClone({
    analysis: config.analysis,
    dimensions: config.dimensions,
    paragraphTitles: config.paragraphTitles,
    contentConfirmed: config.contentConfirmed,
    admission: config.admission,
  });
}
export function withPaper(config: Config, data: PaperTemplate): Config {
  return { ...config, ...structuredClone(data), thresholdsConfirmed: true };
}
export const paperTemplateSchema = z
  .object({
    analysis: fields.analysis,
    dimensions: fields.dimensions,
    paragraphTitles: fields.paragraphTitles,
    contentConfirmed: fields.contentConfirmed,
    admission: fields.admission,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.dimensions.length !== 6) return;
    const parsed = configSchema.safeParse(withPaper(defaultConfig(), data));
    if (!parsed.success)
      parsed.error.issues.forEach((i) =>
        ctx.addIssue({ code: 'custom', message: i.message }),
      );
  });
export const templatePayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('paper'), data: paperTemplateSchema }).strict(),
  z
    .object({ kind: z.literal('analysis'), data: analysisTemplateSchema })
    .strict(),
  z
    .object({ kind: z.literal('evaluation'), data: evaluationTemplateSchema })
    .strict(),
  z
    .object({ kind: z.literal('thresholds'), data: thresholdTemplateSchema })
    .strict(),
]);
export type TemplatePayload = z.infer<typeof templatePayloadSchema>;
export type SavedTemplate = TemplatePayload & {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
};
export const templateNameSchema = z
  .string()
  .trim()
  .min(1, '请填写模板名称')
  .max(80);
export function analysisFrom(config: Config): AnalysisTemplate {
  return structuredClone({
    analysis: config.analysis,
    dimensions: config.dimensions.map(({ id, rules }) => ({ id, rules })),
    thresholdsConfirmed: config.thresholdsConfirmed,
  });
}
export function evaluationFrom(config: Config): EvaluationTemplate {
  return structuredClone({
    paragraphTitles: config.paragraphTitles,
    dimensions: config.dimensions.map(({ id, evaluations }, i) => ({
      id,
      name: config.analysis.dimensions[i].name,
      evaluations,
    })),
  });
}
export function thresholdsFrom(config: Config): ThresholdTemplate {
  return structuredClone({
    dimensions: config.dimensions.map(({ id, rules }, i) => ({
      id,
      rules,
      name: config.analysis.dimensions[i].name,
    })),
  });
}
// Names describe the saved six slots; applying thresholds never renames live dimensions.
export function withThresholds(
  config: Config,
  data: ThresholdTemplate,
): Config {
  return {
    ...config,
    thresholdsConfirmed: true,
    dimensions: config.dimensions.map((d, i) => ({
      ...d,
      id: data.dimensions[i].id,
      rules: structuredClone(data.dimensions[i].rules),
    })),
  };
}
export function thresholdSummary(rules: Config['dimensions'][number]['rules']) {
  return rules.map(
    (r) =>
      `${r.min.toFixed(1)} ≤ 系数 ${r.includeMax ? '≤' : '<'} ${r.max.toFixed(1)}`,
  );
}
export function completeThresholds(config: Config) {
  return config.dimensions.every((d) => isComplete(d.rules));
}
export function withAnalysis(config: Config, data: AnalysisTemplate): Config {
  return {
    ...config,
    analysis: data.analysis,
    thresholdsConfirmed: data.thresholdsConfirmed,
    contentConfirmed:
      JSON.stringify(config.analysis.dimensions.map((d) => d.name)) ===
      JSON.stringify(data.analysis.dimensions.map((d) => d.name))
        ? config.contentConfirmed
        : false,
    dimensions: config.dimensions.map((d, i) => ({
      ...d,
      id: data.dimensions[i].id,
      rules: data.dimensions[i].rules,
    })),
  };
}
export function withEvaluation(
  config: Config,
  data: EvaluationTemplate,
): Config {
  return {
    ...config,
    paragraphTitles: data.paragraphTitles,
    contentConfirmed: false,
    dimensions: config.dimensions.map((d, i) => ({
      ...d,
      id: data.dimensions[i].id,
      evaluations: data.dimensions[i].evaluations,
    })),
  };
}
export function incompatibleStudents(students: Student[], config: Config) {
  return students.some(
    (s) =>
      Object.keys(s.scores).length !== config.analysis.parts.length ||
      config.analysis.parts.some((p) => {
        const score = s.scores[p.id];
        return (
          score === undefined ||
          !new Decimal(score).isFinite() ||
          new Decimal(score).lt(0) ||
          new Decimal(score).gt(p.max)
        );
      }),
  );
}
