import Decimal from 'decimal.js';
import { z } from 'zod';

export const PARTS = [
  { id: 'L1', label: 'Listening Part1', max: 5 },
  { id: 'L2', label: 'Listening Part2', max: 5 },
  { id: 'L3', label: 'Listening Part3', max: 5 },
  { id: 'W1', label: 'Written Test Part1', max: 5 },
  { id: 'W2', label: 'Written Test Part2', max: 5 },
  { id: 'W3', label: 'Written Test Part3', max: 10 },
  { id: 'W4', label: 'Written Test Part4', max: 5 },
  { id: 'W5', label: 'Written Test Part5', max: 5 },
  { id: 'W6', label: 'Written Test Part6', max: 5 },
  { id: 'W7', label: 'Written Test Part7', max: 7 },
  { id: 'W8', label: 'Written Test Part8', max: 8 },
  { id: 'WR', label: 'Writing', max: 15 },
] as const;
export const DIMENSIONS = [
  { id: 'listening', name: '听力理解', parts: ['L1', 'L2', 'L3'] },
  { id: 'vocabulary', name: '词汇运用', parts: ['W1', 'W2'] },
  { id: 'grammar', name: '语法运用', parts: ['W3', 'W7'] },
  { id: 'communication', name: '交际能力', parts: ['W4', 'W5'] },
  { id: 'reading', name: '阅读理解', parts: ['W6', 'W7', 'W8'] },
  { id: 'writing', name: '写作能力', parts: ['WR'] },
] as const;
export const GRADES = ['卓越', '优秀', '良好', '待加强'] as const;
export const BRANCH_OPTIONS = [
  '牡丹广场分校',
  '滨河分校',
  '凯旋路分校',
  '太康路分校',
  '英才路分校',
  '科大分校',
  '纱厂路分校',
  '长兴街分校',
  '新街分校',
] as const;
export const YEAR_LEVEL_OPTIONS = [
  '一年级', '二年级', '三年级', '四年级', '五年级',
  '六年级', '七年级', '八年级', '九年级',
] as const;
export const HEADERS = [
  '考号',
  '学生姓名',
  '分校名称',
  '班级名称',
  '笔试时间',
  '年级',
  ...PARTS.map((p) => p.label),
  '总分',
];
const shortText = z.string().trim().min(1).max(160);
const tenth = z
  .number()
  .min(0)
  .max(1)
  .refine((n) => new Decimal(n).times(10).isInteger(), '阈值最多一位小数');
const image = z
  .string()
  .regex(/^$|^\/api\/assets\/[a-f0-9-]+\.(png|jpg|webp)$/);
const ruleSchema = z
  .object({ min: tenth, max: tenth, includeMax: z.boolean() })
  .strict()
  .refine((r) => r.min < r.max, '区间下限必须小于上限');
const evaluationSchema = z
  .object({
    title: shortText,
    paragraphs: z.tuple([
      z.string().max(2000),
      z.string().max(2000),
      z.string().max(2000),
    ]),
    image,
    placeholder: z.boolean(),
  })
  .strict();
export const analysisSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
            label: shortText.refine(
              (s) => !['考号', '学生姓名', '分校名称', '班级名称', '笔试时间', '年级', '总分'].includes(s),
              'Part名称不能与固定表头重复',
            ),
            max: z
              .number()
              .positive()
              .max(10000)
              .refine(
                (n) => new Decimal(n).times(10000).isInteger(),
                '满分最多4位小数',
              ),
          })
          .strict(),
      )
      .min(1)
      .max(60),
    dimensions: z
      .array(
        z
          .object({
            id: z.string(),
            name: shortText,
            parts: z.array(z.string()).min(1).max(60),
          })
          .strict(),
      )
      .length(6),
  })
  .strict()
  .superRefine((a, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (new Set(a.parts.map((p) => p.id)).size !== a.parts.length)
      issue('Part编号不可重复');
    if (new Set(a.parts.map((p) => p.label)).size !== a.parts.length)
      issue('Part名称不可重复');
    if (new Set(a.dimensions.map((d) => d.name)).size !== 6)
      issue('维度名称不可重复');
    a.dimensions.forEach((d, i) => {
      if (d.id !== DIMENSIONS[i].id)
        issue('须保留六个维度的固定标识和顺序，可编辑显示名称');
      if (new Set(d.parts).size !== d.parts.length)
        issue(`${d.name}的Part不可重复`);
      if (d.parts.some((id) => !a.parts.some((p) => p.id === id)))
        issue(`${d.name}引用了不存在的Part`);
    });
    if (a.parts.some((p) => !a.dimensions.some((d) => d.parts.includes(p.id))))
      issue('每个Part至少需要关联一个维度');
  });
export type Analysis = z.infer<typeof analysisSchema>;
export function defaultAnalysis(): Analysis {
  return {
    parts: PARTS.map((p) => ({ ...p })),
    dimensions: DIMENSIONS.map((d) => ({ ...d, parts: [...d.parts] })),
  };
}
export function scoreHeaders(analysis: Analysis) {
  return ['考号', '学生姓名', '分校名称', '班级名称', '笔试时间', '年级', ...analysis.parts.map((p) => p.label), '总分'];
}
export const studentInfoSchema = z.object({
  branch: z.string().trim().min(1, '请填写分校名称').max(80),
  className: z.string().trim().max(80),
  examSession: z.string().trim().max(80),
  yearLevel: z.string().trim().max(40).refine(
    (value) => !value || YEAR_LEVEL_OPTIONS.includes(value as typeof YEAR_LEVEL_OPTIONS[number]),
    '年级须使用“一年级”至“九年级”的写法',
  ),
}).strict();
export function fullMark(analysis: Analysis) {
  return analysis.parts
    .reduce((sum, p) => sum.plus(p.max), new Decimal(0))
    .toNumber();
}
export const DEFAULT_PAGE_COPY = {
  greeting: 'HELLO!',
  welcome: 'Welcome to the\nExam Result Query System.',
  queryFooter: '每一份成长，都值得看见。',
  abilityHeading: 'Your\nAbility\nAnalysis',
  abilitySubtitle: '六维成长评价',
  abilityHeadingFont: 'rounded' as const,
  abilityHeadingSize: 48,
  learningHeading: 'Your\nLearning\nSuggestions',
  learningHeadingFont: 'rounded' as const,
  learningHeadingSize: 44,
  learningLabel: '六维评价与学习建议',
  studentInfoTitle: '',
  studentInfoDescription: '',
};
const pageCopySchema = z
  .object({
    greeting: shortText,
    welcome: z.string().max(500),
    queryFooter: z.string().max(200),
    abilityHeading: shortText,
    abilitySubtitle: shortText.default('六维成长评价'),
    abilityHeadingFont: z.enum(['rounded', 'sans', 'serif']).default('rounded'),
    abilityHeadingSize: z.number().int().min(32).max(72).default(48),
    learningHeading: shortText,
    learningHeadingFont: z.enum(['rounded', 'sans', 'serif']).default('rounded'),
    learningHeadingSize: z.number().int().min(28).max(72).default(44),
    learningLabel: shortText,
    studentInfoTitle: z.string().max(100).default(''),
    studentInfoDescription: z.string().max(200).default(''),
  })
  .strict();
const admissionSchema = z
  .object({
    enabled: z.boolean().default(false),
    dimensionCutoffs: z
      .array(z.number().min(0).max(1))
      .length(6)
      .default([0, 0, 0, 0, 0, 0]),
    oralInterviewCutoff: z.number().min(0).max(10000).nullable().default(null),
    interviewMessage: shortText.default('Congratulations！🎉\n\n恭喜你获得「进阶班」入学资格\n可继续学习佳音课程\n\n并取得「精修班」\n🏆口试选拔考试资格🏆'),
    courseMessage: shortText.default('Congratulations！🎉\n\n恭喜你获得「进阶班」入学资格\n可继续学习佳音课程'),
    note: z.string().max(200).default(''),
  })
  .strict()
  .default(() => ({
    enabled: false,
    dimensionCutoffs: [0, 0, 0, 0, 0, 0],
    oralInterviewCutoff: null,
    interviewMessage: 'Congratulations！🎉\n\n恭喜你获得「进阶班」入学资格\n可继续学习佳音课程\n\n并取得「精修班」\n🏆口试选拔考试资格🏆',
    courseMessage: 'Congratulations！🎉\n\n恭喜你获得「进阶班」入学资格\n可继续学习佳音课程',
    note: '',
  }));
export const configSchema = z
  .object({
    analysis: analysisSchema.default(defaultAnalysis),
    paperSource: z
      .object({
        id: z.uuid(),
        name: z.string().max(80),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    examName: shortText,
    examInfo: z.string().max(1000),
    queryTitle: shortText,
    queryDescription: z.string().max(1000),
    closedMessage: shortText,
    failedMessage: shortText,
    paragraphTitles: z.tuple([shortText, shortText, shortText]),
    headerImage: image,
    footerImage: image,
    pageCopy: pageCopySchema.default(() => ({ ...DEFAULT_PAGE_COPY })),
    coverBackgroundImage: image.default(''),
    coverQrImage: image.default(''),
    coverText: z.string().max(500).default(''),
    coverFooter: z.string().max(200).default(''),
    admission: admissionSchema,
    thresholdsConfirmed: z.boolean(),
    contentConfirmed: z.boolean(),
    dimensions: z
      .array(
        z
          .object({
            id: z.string(),
            rules: z.tuple([ruleSchema, ruleSchema, ruleSchema, ruleSchema]),
            evaluations: z.tuple([
              evaluationSchema,
              evaluationSchema,
              evaluationSchema,
              evaluationSchema,
            ]),
          })
          .strict(),
      )
      .length(6),
  })
  .strict()
  .superRefine((c, ctx) => {
    c.dimensions.forEach((d, i) => {
      if (d.id !== DIMENSIONS[i].id)
        ctx.addIssue({
          code: 'custom',
          message: '维度标识与顺序不可变更',
        });
      const ordered = [...d.rules].reverse();
      if (
        ordered.some(
          (r, j) =>
            j > 0 &&
            (r.min < ordered[j - 1].max ||
              (r.min === ordered[j - 1].max && ordered[j - 1].includeMax)),
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: `${DIMENSIONS[i].name}的等级区间重叠或顺序错误`,
        });
      if (c.thresholdsConfirmed && !isComplete(d.rules))
        ctx.addIssue({
          code: 'custom',
          message: `${c.analysis.dimensions[i].name}未覆盖：${ruleGaps(d.rules).join('；')}，请修正后再确认`,
        });
    });
    if (
      c.contentConfirmed &&
      c.dimensions.some((d) =>
        d.evaluations.some(
          (e) => e.placeholder || e.paragraphs.some((p) => !p.trim()),
        ),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: '24套评价须填写完整并取消占位标记后，才可确认正式内容',
      });
  });
export type Config = z.infer<typeof configSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export function ruleGaps(rules: Rule[]): string[] {
  const gaps: string[] = [];
  let end = 0,
    included = false;
  for (const r of [...rules].sort((a, b) => a.min - b.min)) {
    if (r.min > end)
      gaps.push(
        `${end.toFixed(1)} ${included ? '<' : '≤'} 系数 < ${r.min.toFixed(1)}`,
      );
    if (r.max >= end) {
      included = r.max === end ? included || r.includeMax : r.includeMax;
      end = r.max;
    }
  }
  if (end < 1)
    gaps.push(`${end.toFixed(1)} ${included ? '<' : '≤'} 系数 ≤ 1.0`);
  else if (end === 1 && !included) gaps.push('系数 = 1.0');
  return gaps;
}
export function continuousRules(
  boundaries: number[] = [0.8, 0.6, 0.4],
): Config['dimensions'][number]['rules'] {
  return [
    { min: boundaries[0], max: 1, includeMax: true },
    { min: boundaries[1], max: boundaries[0], includeMax: false },
    { min: boundaries[2], max: boundaries[1], includeMax: false },
    { min: 0, max: boundaries[2], includeMax: false },
  ];
}
export type Student = {
  examNo: string;
  name: string;
  branch?: string;
  className?: string;
  examSession?: string;
  yearLevel?: string;
  /** Original roster values retained for round-trip exports. */
  sourceData?: Record<string, string>;
  scores: Record<string, string>;
  total: string;
};
export type State = {
  config: Config;
  revision: number;
  published: 'closed' | 'demo' | 'formal';
  batchId: string | null;
  importedAt: string | null;
  isDemoData: boolean;
  count: number;
};
export function isComplete(rules: Rule[]) {
  const ordered = [...rules].reverse();
  return (
    ordered[0].min === 0 &&
    ordered[3].max === 1 &&
    ordered[3].includeMax &&
    ordered.every(
      (r, i) =>
        i === 0 || (ordered[i - 1].max === r.min && !ordered[i - 1].includeMax),
    )
  );
}
export function defaultConfig(): Config {
  return {
    analysis: defaultAnalysis(),
    examName: '佳音 2026 英语综合能力测评\n2026 Joy English Proficiency Test',
    examInfo: '六维成长评价',
    queryTitle: '看见成长的每一面',
    queryDescription: '请输入学生中文姓名和考号，查看本次考试的六维评价。',
    closedMessage: '本次考试暂未开放查询，请稍后再试。',
    failedMessage: '姓名或考号不匹配，请核对后重试。',
    paragraphTitles: ['表现观察', '学习建议', '下一步方向'],
    headerImage: '',
    footerImage: '',
    pageCopy: { ...DEFAULT_PAGE_COPY },
    coverBackgroundImage: '',
    coverQrImage: '',
    coverText: '',
    coverFooter: '',
    admission: {
      enabled: false,
      dimensionCutoffs: [0, 0, 0, 0, 0, 0],
      oralInterviewCutoff: null,
      interviewMessage: 'Congratulations！🎉\n\n恭喜你获得「进阶班」入学资格\n可继续学习佳音课程\n\n并取得「精修班」\n🏆口试选拔考试资格🏆',
      courseMessage: 'Congratulations！🎉\n\n恭喜你获得「进阶班」入学资格\n可继续学习佳音课程',
      note: '',
    },
    thresholdsConfirmed: false,
    contentConfirmed: false,
    dimensions: DIMENSIONS.map((d) => ({
      id: d.id,
      rules: [
        { min: 0.8, max: 1, includeMax: true },
        { min: 0.6, max: 0.7, includeMax: true },
        { min: 0.4, max: 0.5, includeMax: true },
        { min: 0, max: 0.3, includeMax: true },
      ],
      evaluations: GRADES.map((g) => ({
        title: `${d.name} · ${g}`,
        paragraphs: [
          '本维度的能力表现正在完善中。',
          '可结合日常学习情况持续巩固。',
          '建议根据学习节奏制定下一步计划。',
        ],
        image: '',
        placeholder: true,
      })) as Config['dimensions'][number]['evaluations'],
    })),
  };
}
export function gradeFor(
  actual: Decimal.Value,
  max: Decimal.Value,
  rules: Rule[],
): number | null {
  // 等级始终按完整原始系数判断，不受页面展示取值影响。
  const a = new Decimal(actual),
    m = new Decimal(max);
  const index = rules.findIndex(
    (r) =>
      a.gte(m.times(r.min)) &&
      (r.includeMax ? a.lte(m.times(r.max)) : a.lt(m.times(r.max))),
  );
  return index < 0 ? null : index;
}
export function resultFor(student: Student, config: Config, isDemo: boolean) {
  return {
    name: student.name,
    branch: student.branch || 'XX 分校',
    className: student.className || '',
    examSession: student.examSession || '',
    yearLevel: student.yearLevel || '',
    examName: config.examName,
    examInfo: config.examInfo,
    isDemo,
    headerImage: config.headerImage,
    footerImage: config.footerImage,
    pageCopy: config.pageCopy,
    coverBackgroundImage: config.coverBackgroundImage,
    coverQrImage: config.coverQrImage,
    coverText: config.coverText,
    coverFooter: config.coverFooter,
    paragraphTitles: config.paragraphTitles,
    admission: config.admission.enabled
      ? (() => {
          const qualifiedForInterview =
            (config.admission.oralInterviewCutoff === null ||
              new Decimal(student.total).gte(config.admission.oralInterviewCutoff)) &&
            config.analysis.dimensions.every((dimension, index) => {
              const actual = dimension.parts.reduce(
                (sum, id) => sum.plus(student.scores[id]),
                new Decimal(0),
              );
              const max = dimension.parts.reduce(
                (sum, id) =>
                  sum.plus(
                    config.analysis.parts.find((p) => p.id === id)!.max,
                  ),
                new Decimal(0),
              );
              return actual.div(max).gte(config.admission.dimensionCutoffs[index]);
            });
          return {
            qualifiedForInterview,
            qualification: qualifiedForInterview ? '精修班口试资格' : '高阶入学资格',
            message: qualifiedForInterview
              ? config.admission.interviewMessage
              : config.admission.courseMessage,
            note: config.admission.note,
          };
        })()
      : null,
    dimensions: config.analysis.dimensions.map((d, i) => {
      const actual = d.parts.reduce(
        (sum, id) => sum.plus(student.scores[id]),
        new Decimal(0),
      );
      const max = d.parts.reduce(
        (sum, id) =>
          sum.plus(config.analysis.parts.find((p) => p.id === id)!.max),
        new Decimal(0),
      );
      // 仅用于页面展示：不四舍五入，直接截断至小数点后 1 位。
      const display = actual.div(max).toDecimalPlaces(1, Decimal.ROUND_DOWN);
      // 低分保护只影响报告与家长端的图表、文字展示；判级仍使用完整原始系数。
      // 写作能力保留真实的 0.0 起点，其余五个维度最低显示 0.3。
      const protectedDisplay = d.id === 'writing' ? display : Decimal.max(display, 0.3);
      const index = gradeFor(actual, max, config.dimensions[i].rules);
      return {
        id: d.id,
        name: d.name,
        coefficient: protectedDisplay.toFixed(1),
        percent: protectedDisplay.times(100).toNumber(),
        grade: index === null ? '等级待确认' : GRADES[index],
        gradeDescriptions: config.dimensions[i].evaluations.map(
          (evaluation, gradeIndex) => ({
            grade: GRADES[gradeIndex],
            description: evaluation.paragraphs[0],
            selected: gradeIndex === index,
          }),
        ),
        evaluation:
          index === null
            ? {
                title: '阈值边界待确认',
                paragraphs: [
                  '当前完整原始系数位于尚未明确的等级区间。',
                  '页面展示使用截断后的系数，不参与等级判断。',
                  '正式阈值确认后，将自动匹配评价。',
                ],
                image: '',
                placeholder: true,
              }
            : config.dimensions[i].evaluations[index],
      };
    }),
  };
}
export type Result = ReturnType<typeof resultFor>;
export function readiness(state: State): string[] {
  const issues = [];
  if (!state.count) issues.push('尚未导入学生成绩');
  if (state.isDemoData) issues.push('当前为测试数据');
  if (
    !state.config.thresholdsConfirmed ||
    state.config.dimensions.some((d) => !isComplete(d.rules))
  )
    issues.push('原始系数等级区间尚未完整确认');
  if (
    !state.config.contentConfirmed ||
    state.config.dimensions.some((d) =>
      d.evaluations.some(
        (e) => e.placeholder || e.paragraphs.some((p) => !p.trim()),
      ),
    )
  )
    issues.push('24套正式评价尚未补齐确认');
  return issues;
}
export const identitySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[\p{Script=Han}·•]+$/u, '请输入学生中文姓名'),
    examNo: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, '考号仅支持字母、数字、下划线和短横线'),
  })
  .strict();
