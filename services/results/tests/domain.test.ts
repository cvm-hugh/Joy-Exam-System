import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTS,
  DIMENSIONS,
  defaultConfig,
  resultFor,
  gradeFor,
  configSchema,
  isComplete,
  readiness,
  HEADERS,
  continuousRules,
} from '../lib/domain';
import { validateRows } from '../lib/importer';
import { demoRows } from './fixtures';
test('旧配置兼容新增页面文案和封底，原图片保留且二维码不强制', () => {
  const config = defaultConfig();
  config.headerImage = '/api/assets/aaaa.png';
  config.footerImage = '/api/assets/bbbb.png';
  const added = [
    'pageCopy',
    'coverBackgroundImage',
    'coverQrImage',
    'coverText',
    'coverFooter',
  ];
  const old = Object.fromEntries(
    Object.entries(config).filter(([key]) => !added.includes(key)),
  );
  const loaded = configSchema.parse(old);
  assert.equal(loaded.headerImage, config.headerImage);
  assert.equal(loaded.footerImage, config.footerImage);
  assert.equal(loaded.coverBackgroundImage, '');
  assert.equal(loaded.coverQrImage, '');
  assert.equal(loaded.pageCopy.greeting, 'HELLO!');
  loaded.coverBackgroundImage = '/api/assets/cccc.png';
  assert.ok(configSchema.safeParse(loaded).success);
  loaded.coverQrImage = 'https://untrusted.invalid/qr.png';
  assert.ok(!configSchema.safeParse(loaded).success);
});

test('新确认分档覆盖0到1：系数截断到1位后展示并判级', () => {
  const rules = continuousRules();
  assert.equal(isComplete(rules), true);
  for (const [value, expected] of [
    ['0', 3],
    ['0.3999', 3],
    ['0.4', 2],
    ['0.5999', 2],
    ['0.6', 1],
    ['0.7999', 1],
    ['0.8', 0],
    ['1', 0],
  ] as const)
    assert.equal(gradeFor(value, 1, rules), expected);
  const config = defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  config.thresholdsConfirmed = true;
  assert.equal(configSchema.safeParse(config).success, true);
  const student = validateRows([HEADERS, ...demoRows()])[0];
  student.scores.L1 = '3.75';
  student.scores.L2 = '3.75';
  student.scores.L3 = '3.75';
  const result = resultFor(student, config, false).dimensions[0];
  assert.equal(result.coefficient, '0.7');
  assert.equal(result.grade, '优秀');
  assert.equal(result.gradeDescriptions.length, 4);
  assert.deepEqual(
    result.gradeDescriptions.map((item) => item.selected),
    [false, true, false, false],
  );
  assert.deepEqual(
    result.gradeDescriptions.map((item) => item.description),
    config.dimensions[0].evaluations.map((item) => item.paragraphs[0]),
  );
});
test('自定义相邻分界联动，不允许倒序或相等分界确认', () => {
  const config = defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = continuousRules([0.9, 0.7, 0.3]);
  });
  config.thresholdsConfirmed = true;
  assert.equal(configSchema.safeParse(config).success, true);
  assert.equal(
    config.dimensions[0].rules[0].min,
    config.dimensions[0].rules[1].max,
  );
  config.dimensions[0].rules = continuousRules([0.6, 0.8, 0.4]);
  assert.equal(configSchema.safeParse(config).success, false);
  config.dimensions[0].rules = continuousRules([0.8, 0.8, 0.4]);
  assert.equal(configSchema.safeParse(config).success, false);
});
test('试卷满分80；Part7两维复用，维度满分合计87', () => {
  assert.equal(
    PARTS.reduce((s, p) => s + p.max, 0),
    80,
  );
  assert.deepEqual(
    DIMENSIONS.map((d) =>
      d.parts.reduce((s, id) => s + PARTS.find((p) => p.id === id)!.max, 0),
    ),
    [15, 10, 17, 10, 20, 15],
  );
});
test('完整24套三段占位配置，但正式发布就绪检查不通过', () => {
  const c = defaultConfig();
  assert.equal(configSchema.safeParse(c).success, true);
  assert.equal(c.dimensions.flatMap((d) => d.evaluations).length, 24);
  assert.equal(
    readiness({
      config: c,
      count: 3,
      isDemoData: true,
      revision: 0,
      published: 'closed',
      batchId: null,
      importedAt: null,
    }).length,
    3,
  );
});
test('满分六维100%，等级卓越', () => {
  const student = validateRows([HEADERS, demoRows()[2]])[0];
  const r = resultFor(student, defaultConfig(), true);
  assert.ok(
    r.dimensions.every(
      (d) => d.percent === 100 && d.coefficient === '1.0' && d.grade === '卓越',
    ),
  );
});
test('完整原始系数判级，0.75展示0.7但不擅自跨入0.8档', () => {
  const student = validateRows([HEADERS, demoRows()[2]])[0];
  student.scores.WR = '11.25';
  const r = resultFor(student, defaultConfig(), true).dimensions[5];
  assert.equal(r.coefficient, '0.7');
  assert.equal(r.percent, 70);
  assert.equal(r.grade, '等级待确认');
});
test('完整原始系数判级，展示截断不干预旧规则空档', () => {
  const r = defaultConfig().dimensions[0].rules;
  for (const [n, expected] of [
    [0, 3],
    [0.3, 3],
    [0.35, null],
    [0.4, 2],
    [0.5, 2],
    [0.55, null],
    [0.6, 1],
    [0.7, 1],
    [0.75, null],
    [0.8, 0],
    [1, 0],
  ] as const)
    assert.equal(gradeFor(n, 1, r), expected);
  assert.equal(gradeFor('7.999999999999999999', 10, r), null);
});
test('系数0.65直接截断为0.6，仍为优秀', () => {
  const s = validateRows([HEADERS, demoRows()[2]])[0];
  s.scores.WR = '9.75';
  const r = resultFor(s, defaultConfig(), true).dimensions[5];
  assert.equal(r.coefficient, '0.6');
  assert.equal(r.grade, '优秀');
});
test('不能确认有空档的阈值，不能填两位小数', () => {
  const c = defaultConfig();
  c.thresholdsConfirmed = true;
  assert.equal(configSchema.safeParse(c).success, false);
  c.thresholdsConfirmed = false;
  c.dimensions[0].rules[0].min = 0.81;
  assert.equal(configSchema.safeParse(c).success, false);
});
test('阈值覆盖完整，且原始系数边界使用含下限不含上限', () => {
  const c = defaultConfig();
  c.dimensions.forEach((d) => {
    d.rules = [
      { min: 0.8, max: 1, includeMax: true },
      { min: 0.6, max: 0.8, includeMax: false },
      { min: 0.4, max: 0.6, includeMax: false },
      { min: 0, max: 0.4, includeMax: false },
    ];
  });
  c.thresholdsConfirmed = true;
  assert.ok(isComplete(c.dimensions[0].rules));
  assert.ok(configSchema.safeParse(c).success);
  assert.equal(gradeFor('.799999', 1, c.dimensions[0].rules), 1);
  assert.equal(gradeFor('.8', 1, c.dimensions[0].rules), 0);
});
test('区间重叠、错误维度、占位内容无法确认为正式', () => {
  const c = defaultConfig();
  c.dimensions[0].rules[1].max = 0.8;
  assert.equal(configSchema.safeParse(c).success, false);
  const d = defaultConfig();
  d.contentConfirmed = true;
  assert.equal(configSchema.safeParse(d).success, false);
  d.contentConfirmed = false;
  d.dimensions[0].id = 'other';
  assert.equal(configSchema.safeParse(d).success, false);
});
test('家长结果白名单没有原始成绩、总分、排名、考号', () => {
  const r = resultFor(
    validateRows([HEADERS, ...demoRows()])[0],
    defaultConfig(),
    true,
  );
  const serialized = JSON.stringify(r);
  for (const field of [
    'scores',
    'total',
    'rawCoefficient',
    'rank',
    'examNo',
    'students',
  ])
    assert.ok(!serialized.includes(`"${field}"`));
  assert.equal(r.dimensions.length, 6);
  assert.ok(r.dimensions.every((d) => d.gradeDescriptions.length === 4));
});
