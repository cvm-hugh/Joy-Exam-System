import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { fixture } from './helpers';
import {
  defaultConfig,
  configSchema,
  GRADES,
  fullMark,
  scoreHeaders,
  resultFor,
  continuousRules,
} from '../lib/domain';
import {
  analysisFrom,
  analysisTemplateSchema,
  evaluationFrom,
  evaluationTemplateSchema,
  incompatibleStudents,
  withAnalysis,
  withEvaluation,
  thresholdsFrom,
  thresholdTemplateSchema,
  withThresholds,
  thresholdSummary,
  templatePayloadSchema,
  paperFrom,
  paperTemplateSchema,
  withPaper,
} from '../lib/templates';
import {
  parseEvaluations,
  makeEvaluationWorkbook,
  validateEvaluationRows,
} from '../lib/evaluation-importer';

test('配套试卷包含全部教学配置，不夹带考试信息、来源、学生或查询开关', () => {
  const config = defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  const data = paperFrom(config);
  assert.equal(paperTemplateSchema.safeParse(data).success, true);
  assert.deepEqual(Object.keys(data).sort(), [
    'admission',
    'analysis',
    'contentConfirmed',
    'dimensions',
    'paragraphTitles',
  ]);
  assert.equal(
    paperTemplateSchema.safeParse({ ...data, examName: '不可夹带' }).success,
    false,
  );
  const source = structuredClone(data);
  const candidate = withPaper(config, data);
  candidate.dimensions[0].rules[1].max = 0.7;
  assert.deepEqual(data, source);
  assert.equal(
    paperTemplateSchema.safeParse(paperFrom(candidate)).success,
    false,
  );
});
test('导入事务内重新校验套卷版本，已更新或已删除时名单与当前配置均不动', async (t) => {
  const h = await fixture();
  t.after(() => h.DB.sqlite.close());
  const config = (await h.store.state()).config;
  await h.store.replace(
    [
      {
        name: '保留学生',
        examNo: '001',
        total: '0',
        scores: Object.fromEntries(
          config.analysis.parts.map((p) => [p.id, '0']),
        ),
      },
    ],
    0,
    true,
  );
  const data = paperFrom(config);
  data.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  const id = await h.store.saveTemplate('并发保护', { kind: 'paper', data });
  const before = await h.store.state(),
    roster = await h.store.allStudents();
  await h.store.updatePaper(id, '并发保护', 0, { kind: 'paper', data });
  await assert.rejects(
    h.store.replace([], before.revision, false, withPaper(config, data), {
      id,
      revision: 0,
    }),
  );
  assert.deepEqual(await h.store.state(), before);
  assert.deepEqual(await h.store.allStudents(), roster);
  await h.store.deleteTemplate(id, 1);
  await assert.rejects(
    h.store.replace([], before.revision, false, withPaper(config, data), {
      id,
      revision: 1,
    }),
  );
  assert.deepEqual(await h.store.state(), before);
  assert.deepEqual(await h.store.allStudents(), roster);
});
import {
  ImportError,
  makeTemplate,
  parseFile,
  validateRows,
} from '../lib/importer';
import { demoRows } from './fixtures';
import { TemplateNameConflict, Conflict, Store } from '../lib/store';
const evaluationHeaders = [
  '维度',
  '等级',
  '能力描述',
  '学习建议',
  '下一步建议',
];
function evaluationRows() {
  return [
    evaluationHeaders,
    ...defaultConfig().analysis.dimensions.flatMap((d) =>
      GRADES.map((g) => [
        d.name,
        g,
        `${d.name}${g}能力内容`,
        '学习建议\n第二行',
        '下一步建议',
      ]),
    ),
  ];
}
test('旧配置无analysis字段时补默认规则，其他评价与内容不变', () => {
  const old = defaultConfig();
  old.dimensions[0].evaluations[0].paragraphs[0] = '保留自定义评价';
  const { analysis: ignored, ...legacy } = old;
  assert.equal(ignored.parts.length, 12);
  assert.deepEqual(configSchema.parse(legacy), old);
});
test('分析规则拒绝重复Part、错误映射、空维度、零满分、维度顺序改变', () => {
  const mutations = [
    (c: ReturnType<typeof defaultConfig>) => {
      c.analysis.parts[1].id = 'L1';
    },
    (c: ReturnType<typeof defaultConfig>) => {
      c.analysis.parts[1].label = '总分';
    },
    (c: ReturnType<typeof defaultConfig>) => {
      c.analysis.parts[0].max = 0;
    },
    (c: ReturnType<typeof defaultConfig>) => {
      c.analysis.dimensions[0].parts = [];
    },
    (c: ReturnType<typeof defaultConfig>) => {
      c.analysis.dimensions[0].parts = ['missing'];
    },
    (c: ReturnType<typeof defaultConfig>) => {
      c.analysis.dimensions[0].parts.push('L1');
    },
    (c: ReturnType<typeof defaultConfig>) => {
      c.analysis.dimensions.reverse();
    },
  ];
  for (const mutate of mutations) {
    const c = defaultConfig();
    mutate(c);
    assert.equal(configSchema.safeParse(c).success, false);
  }
});
test('动态Part与满分参与成绩校验、模板表头和六维计算；共享Part不重复计总分', async () => {
  const config = defaultConfig();
  config.analysis.parts = [{ id: 'NEW', label: '新试卷Part', max: 12.5 }];
  config.analysis.dimensions.forEach((d) => {
    d.parts = ['NEW'];
  });
  assert.equal(configSchema.safeParse(config).success, true);
  assert.equal(fullMark(config.analysis), 12.5);
  const students = validateRows(
    [scoreHeaders(config.analysis), ['001', '学生甲', '中心分校', '一班', '2026-09-12 上午场', '七年级', 10, 10]],
    config.analysis,
  );
  assert.ok(
    resultFor(students[0], config, false).dimensions.every(
      (d) => d.coefficient === '0.8' && d.grade === '卓越',
    ),
  );
  const template = await makeTemplate('xlsx', config.analysis);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(template as never);
  assert.deepEqual(
    (book.getWorksheet('成绩')!.getRow(1).values as unknown[]).slice(1),
    scoreHeaders(config.analysis),
  );
  book.getWorksheet('成绩')!.addRow(['001', '学生甲', '中心分校', '一班', '2026-09-12 上午场', '七年级', 10, 10]);
  const parsed = await parseFile(
    'scores.xlsx',
    new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer),
    config.analysis,
  );
  assert.deepEqual(parsed, students);
  assert.throws(
    () =>
      validateRows(
        [scoreHeaders(config.analysis), ['001', '学生甲', '中心分校', '一班', '2026-09-12 上午场', '七年级', 13, 13]],
        config.analysis,
      ),
    ImportError,
  );
});
test('分析模板与评价模板各自只携带本类配置，不夹带学生信息', () => {
  const c = defaultConfig();
  const a = analysisFrom(c),
    e = evaluationFrom(c);
  a.analysis.parts[0].max = 10;
  const next = withAnalysis(c, analysisTemplateSchema.parse(a));
  assert.deepEqual(
    next.dimensions.map((d) => d.evaluations),
    c.dimensions.map((d) => d.evaluations),
  );
  e.dimensions[0].evaluations[0].paragraphs = ['A', 'B', 'C'];
  const evaluated = withEvaluation(next, evaluationTemplateSchema.parse(e));
  assert.deepEqual(evaluated.analysis, next.analysis);
  assert.deepEqual(
    evaluated.dimensions.map((d) => d.rules),
    next.dimensions.map((d) => d.rules),
  );
  assert.equal(evaluated.contentConfirmed, false);
  assert.ok(!JSON.stringify(a).includes('examNo'));
});
test('24套Excel导入校验、名称别名映射、三段顺序及换行保留', () => {
  const rows = evaluationRows();
  rows[1][1] = '卓越';
  rows[3][1] = '良';
  rows[5][0] = '2. 词汇应用';
  rows[9][0] = '语言运用';
  rows[13][0] = '情景交际';
  rows[1][3] = '建议<br>如：';
  const config = defaultConfig();
  config.dimensions[0].evaluations[0].title = '自定义标题';
  config.dimensions[0].evaluations[0].image = '/api/assets/aaaa.png';
  const r = validateEvaluationRows(rows, config);
  assert.equal(r.rows.length, 24);
  assert.equal(r.data.dimensions[0].evaluations[0].paragraphs[1], '建议\n如：');
  assert.ok(r.warnings.some((s) => s.includes('词汇应用')));
  assert.ok(r.warnings.some((s) => s.includes('良好')));
  assert.ok(r.warnings.some((s) => s.includes('缺少例子')));
  assert.equal(r.data.dimensions[0].evaluations[0].title, '自定义标题');
  assert.equal(
    r.data.dimensions[0].evaluations[0].image,
    '/api/assets/aaaa.png',
  );
  assert.ok(
    r.data.dimensions.every((d) => d.evaluations.every((e) => !e.placeholder)),
  );
});
test('评价Excel缺行、重复、空正文、未知维度、公式、错位均拒绝，原配置不变', () => {
  const mutations: ((r: unknown[][]) => void)[] = [
    (r) => {
      r.pop();
    },
    (r) => {
      r[2] = [...r[1]];
    },
    (r) => {
      r[1][2] = '';
    },
    (r) => {
      r[1][0] = '不认识的维度';
    },
    (r) => {
      r[1][2] = { formula: '1+1', result: '2' };
    },
    (r) => {
      r[2] = ['优秀', '能力内容', '学习建议', '下一步建议', ''];
    },
  ];
  const c = defaultConfig(),
    before = structuredClone(c);
  for (const mutate of mutations) {
    const rows: unknown[][] = evaluationRows();
    mutate(rows);
    assert.throws(() => validateEvaluationRows(rows, c), ImportError);
  }
  assert.deepEqual(c, before);
});
test('Excel评价空模板有24行骨架，填写后可整批解析；导出正文可往返', async () => {
  const c = defaultConfig(),
    bytes = await makeEvaluationWorkbook(c);
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(bytes as never);
  const sheet = b.getWorksheet('评价内容')!;
  assert.equal(sheet.rowCount, 25);
  await assert.rejects(
    () => parseEvaluations('empty.xlsx', bytes, c),
    ImportError,
  );
  for (let i = 2; i <= 25; i++)
    for (let j = 3; j <= 5; j++) sheet.getCell(i, j).value = `第${i}行第${j}列`;
  const parsed = await parseEvaluations(
    'filled.xlsx',
    new Uint8Array((await b.xlsx.writeBuffer()) as ArrayBuffer),
    c,
  );
  const config = withEvaluation(c, parsed.data);
  const exported = await parseEvaluations(
    'export.xlsx',
    await makeEvaluationWorkbook(config, true),
    config,
  );
  assert.deepEqual(exported.data, parsed.data);
});
test('模板保存、重命名、同名保护、重新打开持久化；不改当前批次', async (t) => {
  const { DB, store } = await fixture();
  t.after(() => DB.sqlite.close());
  const before = await store.state();
  const id = await store.saveTemplate('卷A', {
    kind: 'analysis',
    data: analysisFrom(before.config),
  });
  await assert.rejects(
    () =>
      store.saveTemplate('卷A', {
        kind: 'analysis',
        data: analysisFrom(before.config),
      }),
    TemplateNameConflict,
  );
  await store.renameTemplate(id, '卷A-改名', 0);
  assert.equal((await store.template(id))!.name, '卷A-改名');
  assert.equal((await store.templates()).length, 1);
  await store.init();
  assert.equal((await store.templates()).length, 1);
  assert.deepEqual(await store.state(), before);
});
test('现有学生兼容性：改名可用、上限不足或缺少Part拒绝', () => {
  const c = defaultConfig();
  const students = validateRows([scoreHeaders(c.analysis), ...demoRows()]);
  assert.equal(incompatibleStudents(students, c), false);
  c.analysis.parts[0].label = '听力一';
  assert.equal(incompatibleStudents(students, c), false);
  c.analysis.parts[0].max = 4;
  assert.equal(incompatibleStudents(students, c), true);
  c.analysis.parts[0].max = 5;
  c.analysis.parts.pop();
  assert.equal(incompatibleStudents(students, c), true);
});
test('阈值模板只切换分档，支持逐维不同边界，不改维度名、Part、评语或确认内容', () => {
  const config = defaultConfig();
  const before = structuredClone(config);
  const data = thresholdsFrom(config);
  data.dimensions.forEach((d, i) => {
    d.rules = continuousRules(i === 0 ? [0.9, 0.7, 0.5] : [0.8, 0.6, 0.4]);
    d.name = `另一学科维度${i + 1}`;
  });
  const parsed = thresholdTemplateSchema.parse(data);
  assert.deepEqual(Object.keys(parsed), ['dimensions']);
  assert.ok(
    parsed.dimensions.every(
      (d) => Object.keys(d).sort().join(',') === 'id,name,rules',
    ),
  );
  const result = withThresholds(config, parsed);
  assert.equal(result.thresholdsConfirmed, true);
  assert.deepEqual(result.analysis, before.analysis);
  assert.deepEqual(result.paragraphTitles, before.paragraphTitles);
  assert.equal(result.contentConfirmed, before.contentConfirmed);
  assert.deepEqual(
    result.dimensions.map((d) => d.evaluations),
    before.dimensions.map((d) => d.evaluations),
  );
  assert.deepEqual(
    result.dimensions.map((d) => d.rules),
    data.dimensions.map((d) => d.rules),
  );
  assert.deepEqual(config, before);
});
test('阈值模板拒绝旧空档、重叠、缺维度、错序、多位小数和夹带配置', () => {
  const data = thresholdsFrom(defaultConfig());
  assert.equal(thresholdTemplateSchema.safeParse(data).success, false);
  data.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  const mutations: ((d: typeof data) => void)[] = [
    (d) => {
      d.dimensions.pop();
    },
    (d) => {
      d.dimensions.reverse();
    },
    (d) => {
      d.dimensions[0].rules[1].includeMax = true;
    },
    (d) => {
      d.dimensions[0].rules = continuousRules([0.85, 0.6, 0.4]);
    },
    (d) => {
      d.dimensions[0].rules = continuousRules([0.8, 0.8, 0.4]);
    },
    (d) => {
      d.dimensions[0].rules = continuousRules([0.6, 0.8, 0.4]);
    },
    (d) => {
      d.dimensions[0].rules[3].min = 0.1;
    },
  ];
  for (const mutate of mutations) {
    const next = structuredClone(data);
    mutate(next);
    assert.equal(thresholdTemplateSchema.safeParse(next).success, false);
  }
  assert.equal(
    thresholdTemplateSchema.safeParse({
      ...data,
      analysis: defaultConfig().analysis,
    }).success,
    false,
  );
  assert.equal(
    templatePayloadSchema.safeParse({ kind: 'thresholds', data }).success,
    true,
  );
});
test('当前阈值摘要保留真实旧区间，新分档按原始系数判级、页面系数截断展示', () => {
  const config = defaultConfig();
  assert.equal(
    thresholdSummary(config.dimensions[0].rules)[1],
    '0.6 ≤ 系数 ≤ 0.7',
  );
  const data = thresholdsFrom(config);
  data.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  const next = withThresholds(config, data);
  next.analysis.parts = [{ id: 'P', label: '测试大题', max: 1 }];
  next.analysis.dimensions.forEach((d) => {
    d.parts = ['P'];
  });
  for (const [score, grade, coefficient] of [
    ['0', '待加强', '0.3'],
    ['0.3999', '待加强', '0.3'],
    ['0.4', '良好', '0.4'],
    ['0.5999', '良好', '0.5'],
    ['0.6', '优秀', '0.6'],
    ['0.75', '优秀', '0.7'],
    ['0.7999', '优秀', '0.7'],
    ['0.8', '卓越', '0.8'],
    ['1', '卓越', '1.0'],
  ]) {
    const result = resultFor(
      { name: '边界测试', examNo: '001', scores: { P: score }, total: score },
      next,
      false,
    );
    assert.ok(
      result.dimensions.every(
        (d) =>
          d.grade === grade &&
          d.coefficient ===
            (d.id === 'writing' && score === '0' ? '0.0' : coefficient),
      ),
    );
  }
});
test('三类模板可按版本删除，持久消失但不改考试或学生；过期与重复删除拒绝', async (t) => {
  const { DB, store } = await fixture();
  t.after(() => DB.sqlite.close());
  await store.replace(
    validateRows([scoreHeaders(defaultConfig().analysis), ...demoRows()]),
    0,
    true,
  );
  const before = await store.state(),
    students = await store.allStudents();
  const threshold = thresholdsFrom(before.config);
  threshold.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  for (const payload of [
    { kind: 'analysis' as const, data: analysisFrom(before.config) },
    { kind: 'evaluation' as const, data: evaluationFrom(before.config) },
    { kind: 'thresholds' as const, data: threshold },
  ]) {
    const id = await store.saveTemplate('删除测试', payload);
    await store.renameTemplate(id, '改名后删除', 0);
    await assert.rejects(() => store.deleteTemplate(id, 0), Conflict);
    assert.ok(await store.template(id));
    await store.deleteTemplate(id, 1);
    assert.equal(await new Store(DB).template(id), null);
    await assert.rejects(() => store.deleteTemplate(id, 1), Conflict);
  }
  assert.deepEqual(await store.templates(), []);
  assert.deepEqual(await store.state(), before);
  assert.deepEqual(await store.allStudents(), students);
});
