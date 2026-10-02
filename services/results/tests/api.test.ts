import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers';
import { handleApi, type ApiEnv } from '../lib/api';
import { makeFixtureFile } from './fixtures';
import {
  analysisFrom,
  evaluationFrom,
  thresholdsFrom,
  paperFrom,
  withPaper,
  type SavedTemplate,
} from '../lib/templates';
import {
  scoreHeaders,
  configSchema,
  continuousRules,
  fullMark,
} from '../lib/domain';
import { providedEvaluationRows } from '../resources/provided-evaluations';
import Papa from 'papaparse';
async function harness(t: { after: (f: () => void) => void }) {
  const f = await fixture();
  t.after(() => f.DB.sqlite.close());
  let cookie = '';
  async function call(
    path: string,
    method = 'GET',
    data?: unknown,
    auth = true,
    csrf = true,
  ) {
    const multipart = data instanceof FormData;
    const headers: Record<string, string> = {};
    if (auth && cookie) headers.cookie = cookie;
    if (csrf) headers['x-exam-request'] = '1';
    if (data !== undefined && !multipart)
      headers['Content-Type'] = 'application/json';
    const options: RequestInit = { method, headers };
    if (method !== 'GET' && data !== undefined)
      options.body = multipart ? data : JSON.stringify(data);
    return handleApi(
      new Request(`http://localhost:3000/api/${path}`, options),
      f.env,
    );
  }
  async function login() {
    const r = await call('admin/login', 'POST', { password: f.password });
    assert.equal(r.status, 200);
    cookie = r.headers.get('set-cookie')!.split(';')[0];
    return r;
  }
  async function importFixtures(revision: number) {
    const form = new FormData();
    form.set('file', new File([await makeFixtureFile('xlsx')], 'scores.xlsx'));
    form.set('revision', String(revision));
    form.set('isDemo', 'true');
    return call('admin/import', 'POST', form);
  }
  return { ...f, call, login, importFixtures };
}
test('批量长图数据仅管理员可读，保留四项学生信息、匹配资格，旧版本拒绝，参考信息缺失允许导出', async (t) => {
  const h = await harness(t);
  assert.equal((await h.call('admin/report-batch', 'POST', { revision: 0, offset: 0 }, false)).status, 401);
  await h.login(); await h.importFixtures(0);
  const state = await h.store.state();
  state.config.admission = { ...state.config.admission, enabled: true, oralInterviewCutoff: 60 };
  await h.store.saveConfig(state.config, state.revision);
  const body = { revision: state.revision + 1, offset: 0 };
  assert.equal((await h.call('admin/report-batch', 'POST', body, true, false)).status, 403);
  const response = await h.call('admin/report-batch', 'POST', body);
  assert.equal(response.status, 200);
  const data = await response.json() as { records: { examNo: string; result: Record<string, unknown> }[] };
  assert.equal(data.records.length, 3);
  assert.equal(data.records[0].examNo, '000001');
  assert.equal(data.records[0].result.className, '一班');
  assert.equal(data.records[0].result.yearLevel, '七年级');
  assert.equal(data.records[0].result.examSession, '2026-09-12 上午场');
  assert.equal((data.records[0].result.admission as { qualifiedForInterview: boolean }).qualifiedForInterview, true);
  assert.equal((data.records[1].result.admission as { qualifiedForInterview: boolean }).qualifiedForInterview, false);
  assert.equal('total' in data.records[0].result, false);
  assert.equal((await h.call('admin/report-batch', 'POST', { ...body, revision: 0 })).status, 409);
  await h.DB.prepare("UPDATE students SET class_name='' WHERE exam_no='000001'").run();
  const missing = await h.call('admin/report-batch', 'POST', body);
  assert.equal(missing.status, 200);
  assert.match(JSON.stringify(await missing.json()), /000001/);
});
test('合并桌面版可自动建立会话并直接交接阅卷成绩，无需密码或人工导入', async (t) => {
  const h = await harness(t);
  const token = 'desktop-bridge-test-token';
  (h.env as ApiEnv).DESKTOP_BRIDGE_TOKEN = token;
  const unauthorized = await handleApi(
    new Request('http://localhost:3010/api/desktop/session'),
    h.env,
  );
  assert.equal(unauthorized.status, 401);

  const session = await handleApi(
    new Request('http://localhost:3010/api/desktop/session', {
      headers: { 'x-joy-desktop-token': token },
    }),
    h.env,
  );
  assert.equal(session.status, 303);
  assert.match(session.headers.get('set-cookie')!, /exam_session=/);

  const form = new FormData();
  form.set('file', new File([await makeFixtureFile('xlsx')], '阅卷内部交接.xlsx'));
  const handoff = await handleApi(
    new Request('http://localhost:3010/api/desktop/handoff', {
      method: 'POST',
      headers: { 'x-joy-desktop-token': token },
      body: form,
    }),
    h.env,
  );
  assert.equal(handoff.status, 200);
  assert.deepEqual(await handoff.json(), { ok: true, count: 3 });
  assert.equal((await h.store.state()).count, 3);
});

test('结果发布页仅向管理员返回精修口试过线学生的最小名单', async (t) => {
  const h = await harness(t);
  assert.equal((await h.call('admin/admission-summary', 'GET', undefined, false)).status, 401);
  await h.login();
  await h.importFixtures(0);
  const state = await h.store.state();
  state.config.admission = {
    ...state.config.admission,
    enabled: true,
    oralInterviewCutoff: 60,
    dimensionCutoffs: [0, 0, 0, 0, 0, 0],
  };
  await h.store.saveConfig(state.config, state.revision);
  const response = await h.call('admin/admission-summary');
  assert.equal(response.status, 200);
  const data = await response.json() as {
    enabled: boolean;
    total: number;
    interviewCount: number;
    interviewStudents: Record<string, unknown>[];
  };
  assert.equal(data.enabled, true);
  assert.equal(data.total, 3);
  assert.equal(data.interviewCount, 2);
  assert.deepEqual(data.interviewStudents, [
    { examNo: '000001', name: '测试甲', branch: '中心分校' },
    { examNo: '000003', name: '测试丙', branch: '中心分校' },
  ]);
  assert.ok(data.interviewStudents.every((student) => !('scores' in student) && !('total' in student)));
});
test('六维系数导出接口仅返回所选学生的原始Part成绩与当前计分规则', async (t) => {
  const h = await harness(t);
  assert.equal((await h.call('admin/dimension-coefficient-batch', 'POST', { revision: 0, offset: 0 }, false)).status, 401);
  await h.login();
  await h.importFixtures(0);
  const state = await h.store.state();
  const response = await h.call('admin/dimension-coefficient-batch', 'POST', {
    revision: state.revision,
    offset: 0,
    examNos: ['000002'],
  });
  assert.equal(response.status, 200);
  const data = await response.json() as {
    count: number;
    analysis: { parts: { id: string }[]; dimensions: { parts: string[] }[] };
    records: {
      examNo: string;
      scores: Record<string, string>;
      sourceData?: Record<string, string>;
      qualifiedForInterview: boolean | null;
    }[];
  };
  assert.equal(data.count, 1);
  assert.equal(data.records[0].examNo, '000002');
  assert.equal(data.records[0].scores.L1, '3');
  assert.equal(data.records[0].sourceData?.['学号'], undefined);
  assert.equal(data.records[0].qualifiedForInterview, null);
  assert.deepEqual(data.analysis.dimensions[0].parts, ['L1', 'L2', 'L3']);
  assert.equal((await h.call('admin/dimension-coefficient-batch', 'POST', {
    revision: state.revision,
    offset: 0,
    examNos: ['不存在'],
  })).status, 409);
});
test('单人补录接口有登录、跨站、批次与发布保护；自动合计且不覆盖原学生', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const state = await h.store.state(),
    original = await h.store.allStudents();
  const student = {
    name: '新增学生',
    examNo: '000099',
    branch: '中心分校', className: '一班', examSession: '2026-09-12 上午场', yearLevel: '七年级',
    scores: Object.fromEntries(
      state.config.analysis.parts.map((p) => [p.id, '0.1']),
    ),
  };
  const body = { revision: state.revision, batchId: state.batchId, student };
  assert.equal(
    (await h.call('admin/students/append', 'POST', body, false)).status,
    401,
  );
  assert.equal(
    (await h.call('admin/students/append', 'POST', body, true, false)).status,
    403,
  );
  assert.equal(
    (
      await h.call('admin/students/append', 'POST', {
        ...body,
        batchId: 'wrong',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.call('admin/students/append', 'POST', {
        ...body,
        student: { ...student, total: '100' },
      })
    ).status,
    422,
  );
  assert.equal(
    (await h.call('admin/students/append', 'POST', body)).status,
    200,
  );
  const after = await h.store.state();
  assert.equal(after.count, state.count + 1);
  assert.equal(
    (await h.store.student(student.name, student.examNo))?.total,
    '1.2',
  );
  assert.deepEqual(after.config, state.config);
  assert.equal(
    (
      await h.call('admin/students/append', 'POST', {
        ...body,
        revision: after.revision,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.call('admin/students/append', 'POST', {
        ...body,
        student: { ...student, examNo: 'late' },
      })
    ).status,
    409,
  );
  await h.store.publish('demo', after.revision);
  assert.equal(
    (
      await h.call('admin/students/append', 'POST', {
        ...body,
        revision: after.revision + 1,
        student: { ...student, examNo: 'locked' },
      })
    ).status,
    409,
  );
  for (const row of original)
    assert.deepEqual(await h.store.student(row.name, row.examNo), row);
});

test('后台学生分页默认10名、支持10至50名，末页与越界正确，非法参数与未登录拦截', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const example = (await h.store.allStudents())[0];
  await h.store.replace(
    Array.from({ length: 53 }, (_, i) => ({
      ...example,
      examNo: String(i).padStart(6, '0'),
      name: `分页测试${i}`,
    })),
    1,
    true,
  );
  const before = await h.store.state();
  const first = (await (await h.call('admin/students')).json()) as {
    students: { examNo: string }[];
    page: number;
    pageSize: number;
    count: number;
  };
  assert.equal(first.pageSize, 10);
  assert.equal(first.students.length, 10);
  assert.equal(first.count, 53);
  assert.equal(first.students[0].examNo, '000000');
  for (const size of [10, 20, 30, 40, 50]) {
    const page = (await (
      await h.call(`admin/students?page=2&pageSize=${size}`)
    ).json()) as typeof first;
    assert.equal(page.students.length, Math.min(size, 53 - size));
    assert.equal(page.students[0].examNo, String(size).padStart(6, '0'));
    const last = (await (
      await h.call(`admin/students?page=999&pageSize=${size}`)
    ).json()) as typeof first;
    assert.equal(last.page, Math.ceil(53 / size));
    assert.equal(last.students.at(-1)?.examNo, '000052');
  }
  for (const value of ['0', '9', '51', '1000', '10.5', 'abc', '']) {
    assert.equal(
      (await h.call(`admin/students?pageSize=${value}`)).status,
      422,
    );
  }
  assert.equal(
    (await h.call('admin/students?pageSize=50', 'GET', undefined, false))
      .status,
    401,
  );
  assert.deepEqual(await h.store.state(), before);
  assert.equal((await h.store.allStudents()).length, 53);
});

test('配套试卷默认版本独立保存与重命名；同名、陈旧版本、缺口和权限拦截，现有学生不变', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const before = await h.store.state(),
    students = await h.store.allStudents();
  const data = paperFrom(before.config);
  data.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  const payload = { kind: 'paper', data };
  const created = await h.call('admin/templates', 'POST', {
    name: '配套英语卷',
    payload,
  });
  assert.equal(created.status, 200);
  const { id } = (await created.json()) as { id: string };
  assert.equal(
    (await h.call('admin/templates', 'POST', { name: '配套英语卷', payload }))
      .status,
    409,
  );
  data.dimensions[0].evaluations[0].paragraphs[0] = '下一版配套评语';
  const update = { id, name: '配套英语卷第二版', revision: 0, data };
  assert.equal(
    (await h.call('admin/papers', 'PUT', update, false)).status,
    401,
  );
  assert.equal(
    (await h.call('admin/papers', 'PUT', update, true, false)).status,
    403,
  );
  assert.equal((await h.call('admin/papers', 'PUT', update)).status, 200);
  assert.equal((await h.call('admin/papers', 'PUT', update)).status, 409);
  const saved = await h.store.template(id);
  assert.equal(saved?.revision, 1);
  assert.equal(saved?.name, update.name);
  assert.deepEqual(saved?.data, data);
  const broken = structuredClone(data);
  broken.dimensions[0].rules[1].max = 0.7;
  assert.equal(
    (
      await h.call('admin/papers', 'PUT', {
        ...update,
        revision: 1,
        data: broken,
      })
    ).status,
    422,
  );
  const image = structuredClone(data);
  image.dimensions[0].evaluations[0].image = '/api/assets/abcd.png';
  assert.equal(
    (
      await h.call('admin/papers', 'PUT', {
        ...update,
        revision: 1,
        data: image,
      })
    ).status,
    400,
  );
  assert.deepEqual(await h.store.state(), before);
  assert.deepEqual(await h.store.allStudents(), students);
  await h.call('admin/publish', 'POST', {
    revision: before.revision,
    mode: 'demo',
  });
  assert.equal(
    (await h.call('admin/papers', 'PUT', { ...update, revision: 1 })).status,
    200,
  );
  assert.equal((await h.store.state()).published, 'demo');
  assert.deepEqual((await h.store.state()).config, before.config);
});
test('成绩导入原子绑定整套试卷：题型满分、维度、阈值、24套评价与来源快照同时生效', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const before = await h.store.state(),
    students = await h.store.allStudents();
  const data = paperFrom(before.config);
  data.analysis.parts[0].label = '新卷第一大题';
  data.analysis.parts[0].max = 20;
  data.analysis.dimensions[0].name = '新卷理解能力';
  data.dimensions.forEach((d) => {
    d.rules = continuousRules([0.9, 0.7, 0.5]);
    d.evaluations.forEach((e, i) => {
      e.title = `新卷评价${i}`;
      e.paragraphs = ['新卷能力', '新卷学习', '新卷建议'];
      e.placeholder = false;
    });
  });
  data.contentConfirmed = true;
  const id = await h.store.saveTemplate('配套数学卷', { kind: 'paper', data });
  const form = new FormData();
  form.set('revision', String(before.revision));
  form.set('isDemo', 'true');
  form.set('paperTemplateId', id);
  form.set('paperRevision', '0');
  form.set('file', new File([await makeFixtureFile('xlsx')], 'wrong.xlsx'));
  assert.equal((await h.call('admin/import', 'POST', form)).status, 422);
  assert.deepEqual(await h.store.state(), before);
  assert.deepEqual(await h.store.allStudents(), students);
  const csv = Papa.unparse([
    scoreHeaders(data.analysis),
    [
      '00001',
      '测试学生',
      '中心分校', '一班', '2026-09-12 上午场', '七年级',
      ...data.analysis.parts.map((p) => String(p.max)),
      String(fullMark(data.analysis)),
    ],
  ]);
  form.set('file', new File([csv], 'scores.csv'));
  assert.equal((await h.call('admin/import', 'POST', form)).status, 200);
  const after = await h.store.state();
  assert.deepEqual(after.config, {
    ...withPaper(before.config, data),
    paperSource: { id, name: '配套数学卷', revision: 0 },
  });
  assert.equal(after.count, 1);
  assert.equal(after.config.examName, before.config.examName);
  const next = structuredClone(data);
  next.dimensions[0].evaluations[0].title = '模板再次编辑';
  assert.equal(
    (
      await h.call('admin/papers', 'PUT', {
        id,
        revision: 0,
        name: '配套数学卷',
        data: next,
      })
    ).status,
    200,
  );
  assert.deepEqual(await h.store.state(), after);
  const download = await h.call(
    `admin/template?format=csv&paperTemplateId=${id}&paperRevision=1`,
  );
  assert.equal(download.status, 200);
  assert.ok((await download.text()).includes('新卷第一大题'));
  assert.equal(
    (await h.call(`admin/template?paperTemplateId=${id}&paperRevision=0`))
      .status,
    409,
  );
  form.set('revision', String(after.revision));
  assert.equal((await h.call('admin/import', 'POST', form)).status, 409);
  form.set('paperRevision', '1');
  form.set('analysisTemplateId', id);
  assert.equal((await h.call('admin/import', 'POST', form)).status, 400);
  form.delete('analysisTemplateId');
  form.delete('paperRevision');
  assert.equal((await h.call('admin/import', 'POST', form)).status, 409);
  await h.call('admin/templates', 'DELETE', {
    id,
    revision: 1,
    confirmDelete: true,
  });
  form.set('paperRevision', '1');
  assert.equal((await h.call('admin/import', 'POST', form)).status, 409);
  assert.deepEqual(await h.store.state(), after);
});
test('试卷Excel评价导出与校验采用教学草稿的维度，不依赖当前考试、不直接保存', async (t) => {
  const h = await harness(t);
  await h.login();
  const before = await h.store.state();
  const data = paperFrom(before.config);
  data.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  data.analysis.dimensions.forEach((d, i) => {
    d.name = `新学科能力${i + 1}`;
  });
  data.dimensions.forEach((d) =>
    d.evaluations.forEach((e) => {
      e.paragraphs = ['能力正文', '学习正文', '建议正文'];
      e.placeholder = false;
    }),
  );
  const r = await h.call('admin/paper-evaluation-template', 'POST', {
    data,
    filled: true,
  });
  assert.equal(r.status, 200);
  const form = new FormData();
  form.set('file', new File([await r.arrayBuffer()], 'evaluation.xlsx'));
  form.set('paper', JSON.stringify(data));
  const response = await h.call(
    'admin/paper-evaluations-preview',
    'POST',
    form,
  );
  assert.equal(response.status, 200);
  const preview = (await response.json()) as { rows: { dimension: string }[] };
  assert.equal(preview.rows.length, 24);
  assert.equal(preview.rows[0].dimension, '新学科能力1');
  assert.deepEqual(await h.store.state(), before);
  assert.deepEqual(await h.store.templates(), []);
});
test('登录、会话、CSRF、注销与未登录接口隔离', async (t) => {
  const h = await harness(t);
  assert.equal((await h.call('admin/state')).status, 401);
  assert.equal(
    (await h.call('admin/login', 'POST', { password: h.password }, true, false))
      .status,
    403,
  );
  assert.equal(
    (await h.call('admin/login', 'POST', { password: 'wrong' })).status,
    401,
  );
  const login = await h.login();
  assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  assert.equal((await h.call('admin/state')).status, 200);
  assert.equal(
    (await h.call('admin/import-demo', 'POST', { revision: 0 }, true, false))
      .status,
    403,
  );
  await h.call('admin/logout', 'POST');
  assert.equal((await h.call('admin/state')).status, 401);
});
test('原虚构学生入口已移除；匿名用户无法访问模板或上传评语', async (t) => {
  const h = await harness(t);
  for (const path of ['admin/templates', 'admin/evaluation-template'])
    assert.equal((await h.call(path)).status, 401);
  await h.login();
  assert.equal(
    (await h.call('admin/import-demo', 'POST', { revision: 0 })).status,
    404,
  );
  const template = await h.call('admin/template?format=csv&demo=1');
  assert.ok(!(await template.text()).includes('测试甲'));
  assert.equal((await h.store.state()).count, 0);
});
test('模板删除需登录、同源及明确确认；开放期间只删除指定副本，保留图片及现有配置', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  await h.call('admin/publish', 'POST', { revision: 1, mode: 'demo' });
  const before = await h.store.state(),
    students = await h.store.allStudents();
  const data = evaluationFrom(before.config);
  h.files.set('aaaa.png', {
    bytes: new Uint8Array([1]),
    httpMetadata: { contentType: 'image/png' },
  });
  data.dimensions[0].evaluations[0].image = '/api/assets/aaaa.png';
  const response = await h.call('admin/templates', 'POST', {
    name: '待删除副本',
    payload: { kind: 'evaluation', data },
  });
  assert.equal(response.status, 200);
  const { id } = (await response.json()) as { id: string };
  const keep = await h.store.saveTemplate('另一个模板', {
    kind: 'analysis',
    data: analysisFrom(before.config),
  });
  const request = { id, revision: 0, confirmDelete: true };
  assert.equal(
    (await h.call('admin/templates', 'DELETE', request, false)).status,
    401,
  );
  assert.equal(
    (await h.call('admin/templates', 'DELETE', request, true, false)).status,
    403,
  );
  assert.equal(
    (await h.call('admin/templates', 'DELETE', { id, revision: 0 })).status,
    422,
  );
  assert.equal(
    (await h.call('admin/templates', 'DELETE', { ...request, id: '*' })).status,
    422,
  );
  assert.equal(
    (await h.call('admin/templates', 'DELETE', { ...request, revision: 1 }))
      .status,
    409,
  );
  assert.ok(await h.store.template(id));
  assert.equal(
    (await h.call('admin/templates', 'DELETE', request)).status,
    200,
  );
  assert.equal(
    (await h.call('admin/templates', 'DELETE', request)).status,
    409,
  );
  assert.equal(await h.store.template(id), null);
  assert.ok(await h.store.template(keep));
  assert.ok(h.files.has('aaaa.png'));
  assert.deepEqual(await h.store.state(), before);
  assert.deepEqual(await h.store.allStudents(), students);
});
test('等级阈值模板保存与重命名不影响考试；确认应用只改变规则且旧版本拒绝', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const before = await h.store.state(),
    students = await h.store.allStudents();
  const data = thresholdsFrom(before.config);
  data.dimensions.forEach((d) => {
    d.rules = continuousRules();
    d.name = `数学-${d.name}`;
  });
  const payload = { kind: 'thresholds', data };
  const created = await h.call('admin/templates', 'POST', {
    name: '卷A分档',
    payload,
  });
  assert.equal(created.status, 200);
  const { id } = (await created.json()) as { id: string };
  assert.equal(
    (await h.call('admin/templates', 'POST', { name: '卷A分档', payload }))
      .status,
    409,
  );
  assert.equal(
    (
      await h.call('admin/templates', 'PUT', {
        id,
        revision: 0,
        name: '卷B分档',
      })
    ).status,
    200,
  );
  assert.equal((await h.store.template(id))!.name, '卷B分档');
  assert.deepEqual(await h.store.state(), before);
  const body = { revision: before.revision, data, confirmApply: true };
  assert.equal(
    (await h.call('admin/thresholds', 'PUT', body, false)).status,
    401,
  );
  assert.equal(
    (await h.call('admin/thresholds', 'PUT', body, true, false)).status,
    403,
  );
  assert.equal(
    (
      await h.call('admin/thresholds', 'PUT', {
        revision: before.revision,
        data,
      })
    ).status,
    422,
  );
  assert.equal(
    (await h.call('admin/thresholds', 'PUT', { ...body, revision: 0 })).status,
    409,
  );
  const invalid = structuredClone(data);
  invalid.dimensions[0].rules[1].max = 0.7;
  assert.equal(
    (await h.call('admin/thresholds', 'PUT', { ...body, data: invalid }))
      .status,
    422,
  );
  invalid.dimensions.pop();
  assert.equal(
    (
      await h.call('admin/templates', 'POST', {
        name: '缺维度',
        payload: { kind: 'thresholds', data: invalid },
      })
    ).status,
    422,
  );
  assert.deepEqual(await h.store.state(), before);
  assert.equal((await h.call('admin/thresholds', 'PUT', body)).status, 200);
  const after = await h.store.state();
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.config.thresholdsConfirmed, true);
  const expected = structuredClone(before);
  expected.revision++;
  expected.config.thresholdsConfirmed = true;
  expected.config.dimensions.forEach((d, i) => {
    d.rules = data.dimensions[i].rules;
  });
  assert.deepEqual(after, expected);
  assert.deepEqual(await h.store.allStudents(), students);
  assert.equal((await h.call('admin/thresholds', 'PUT', body)).status, 409);
  assert.equal(
    (
      await h.call('admin/templates', 'DELETE', {
        id,
        revision: 1,
        confirmDelete: true,
      })
    ).status,
    200,
  );
  assert.deepEqual(await h.store.state(), after);
});
test('查询开放时可保存删除阈值模板，但禁止应用新阈值', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  await h.call('admin/publish', 'POST', { revision: 1, mode: 'demo' });
  const before = await h.store.state();
  const data = thresholdsFrom(before.config);
  data.dimensions.forEach((d) => {
    d.rules = continuousRules([0.9, 0.7, 0.5]);
  });
  const created = await h.call('admin/templates', 'POST', {
    name: '其他学科',
    payload: { kind: 'thresholds', data },
  });
  assert.equal(created.status, 200);
  const { id } = (await created.json()) as { id: string };
  assert.equal(
    (
      await h.call('admin/thresholds', 'PUT', {
        revision: before.revision,
        data,
        confirmApply: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.call('admin/templates', 'DELETE', {
        id,
        revision: 0,
        confirmDelete: true,
      })
    ).status,
    200,
  );
  assert.deepEqual(await h.store.state(), before);
});
test('分析模板新试卷导入：失败不切换规则或名单，成功一起切换，旧版本拒绝', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const before = await h.store.state();
  const data = analysisFrom(before.config);
  data.analysis.parts = [{ id: 'A1', label: '新卷大题', max: 20 }];
  data.analysis.dimensions.forEach((d) => {
    d.parts = ['A1'];
  });
  const created = await h.call('admin/templates', 'POST', {
    name: '20分试卷',
    payload: { kind: 'analysis', data },
  });
  assert.equal(created.status, 200);
  const { id } = (await created.json()) as { id: string };
  assert.deepEqual(await h.store.state(), before);
  const template = await h.call(
    `admin/template?format=csv&analysisTemplateId=${id}`,
  );
  assert.match(await template.text(), /新卷大题/);
  const form = new FormData();
  form.set('analysisTemplateId', id);
  form.set('revision', '1');
  form.set('isDemo', 'false');
  form.set(
    'file',
    new File(
      [Papa.unparse([scoreHeaders(data.analysis), ['009', '新学生', '中心分校', '一班', '2026-09-12 上午场', '七年级', 21, 21]])],
      'bad.csv',
    ),
  );
  assert.equal((await h.call('admin/import', 'POST', form)).status, 422);
  assert.deepEqual(await h.store.state(), before);
  form.set(
    'file',
    new File(
      [Papa.unparse([scoreHeaders(data.analysis), ['009', '新学生', '中心分校', '一班', '2026-09-12 上午场', '七年级', 16, 16]])],
      'new.csv',
    ),
  );
  assert.equal((await h.call('admin/import', 'POST', form)).status, 200);
  const after = await h.store.state();
  assert.equal(after.count, 1);
  assert.deepEqual(after.config.analysis, data.analysis);
  const result = (await (
    await h.call('admin/preview', 'POST', { name: '新学生', examNo: '009' })
  ).json()) as { dimensions: { coefficient: string }[] };
  assert.ok(result.dimensions.every((d) => d.coefficient === '0.8'));
  assert.equal((await h.call('admin/import', 'POST', form)).status, 409);
  assert.deepEqual(await h.store.state(), after);
});
test('当前规则修改须显式确认，不兼容现有学生时完整拒绝，兼容时不改原始成绩', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const before = await h.store.state(),
    students = await h.store.allStudents();
  const config = structuredClone(before.config);
  config.analysis.parts[0].max = 4;
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 1, config })).status,
    409,
  );
  assert.equal(
    (
      await h.call('admin/config', 'PUT', {
        revision: 1,
        config,
        confirmAnalysis: true,
      })
    ).status,
    409,
  );
  assert.deepEqual(await h.store.state(), before);
  config.analysis.parts[0].max = 10;
  assert.equal(
    (
      await h.call('admin/config', 'PUT', {
        revision: 1,
        config,
        confirmAnalysis: true,
      })
    ).status,
    200,
  );
  assert.deepEqual(await h.store.allStudents(), students);
});
test('开放期间可以保存或重命名模板，但不能改当前考试；同名与旧版本保护', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  await h.call('admin/publish', 'POST', { revision: 1, mode: 'demo' });
  const before = await h.store.state(),
    payload = { kind: 'evaluation', data: evaluationFrom(before.config) };
  const response = await h.call('admin/templates', 'POST', {
    name: '测试评语模板',
    payload,
  });
  assert.equal(response.status, 200);
  const { id } = (await response.json()) as { id: string };
  assert.equal(
    (await h.call('admin/templates', 'POST', { name: '测试评语模板', payload }))
      .status,
    409,
  );
  assert.equal(
    (
      await h.call('admin/templates', 'PUT', {
        id,
        revision: 0,
        name: '已改名',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await h.call('admin/templates', 'PUT', {
        id,
        revision: 0,
        name: '过期修改',
      })
    ).status,
    409,
  );
  const list = (await (await h.call('admin/templates')).json()) as {
    templates: SavedTemplate[];
  };
  assert.equal(list.templates[0].name, '已改名');
  assert.equal(
    (
      await h.call('admin/config', 'PUT', {
        revision: before.revision,
        config: before.config,
      })
    ).status,
    409,
  );
  assert.deepEqual(await h.store.state(), before);
});
test('Excel评语预览与另存均不修改当前配置；陈旧预览请求被拒绝', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const before = await h.store.state();
  const form = new FormData();
  form.set('revision', '1');
  form.set(
    'file',
    new File([Papa.unparse(providedEvaluationRows)], 'evaluation.csv'),
  );
  const r = await h.call('admin/evaluations-preview', 'POST', form);
  assert.equal(r.status, 200);
  const preview = (await r.json()) as {
    data: ReturnType<typeof evaluationFrom>;
    warnings: string[];
    rows: unknown[];
  };
  assert.equal(preview.rows.length, 24);
  assert.ok(preview.warnings.some((s) => s.includes('如：')));
  assert.equal(
    (
      await h.call('admin/templates', 'POST', {
        name: '待核对评语',
        payload: { kind: 'evaluation', data: preview.data },
      })
    ).status,
    200,
  );
  assert.deepEqual(await h.store.state(), before);
  form.set('revision', '0');
  assert.equal(
    (await h.call('admin/evaluations-preview', 'POST', form)).status,
    409,
  );
});
test('模板配置错误、无效图片引用与跨站保存均被拒绝', async (t) => {
  const h = await harness(t);
  await h.login();
  const config = configSchema.parse((await h.store.state()).config),
    data = evaluationFrom(config);
  data.dimensions[0].evaluations[0].image = '/api/assets/aaaa.png';
  assert.equal(
    (
      await h.call('admin/templates', 'POST', {
        name: '坏图片',
        payload: { kind: 'evaluation', data },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.call('admin/templates', 'POST', {
        name: '',
        payload: { kind: 'analysis', data: analysisFrom(config) },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await h.call(
        'admin/templates',
        'POST',
        {
          name: '跨站',
          payload: { kind: 'analysis', data: analysisFrom(config) },
        },
        true,
        false,
      )
    ).status,
    403,
  );
  assert.equal((await h.store.templates()).length, 0);
});
test('完整闭环：导入→后台预览→演示开放→查询→关闭→拒绝查询', async (t) => {
  const h = await harness(t);
  await h.login();
  assert.equal(
    (
      await h.call(
        'public/query',
        'POST',
        { name: '测试甲', examNo: '000001' },
        false,
      )
    ).status,
    403,
  );
  assert.equal((await h.importFixtures(0)).status, 200);
  const preview = await h.call('admin/preview', 'POST', {
    name: '测试甲',
    examNo: '000001',
  });
  assert.equal(preview.status, 200);
  const previewBody = (await preview.clone().json()) as {
    adminMatch: { examNo: string; listIndex: number };
  };
  assert.deepEqual(previewBody.adminMatch, { examNo: '000001', listIndex: 0 });
  assert.equal(
    (await h.call('admin/publish', 'POST', { revision: 1, mode: 'demo' }))
      .status,
    200,
  );
  const response = await h.call(
    'public/query',
    'POST',
    { name: '测试甲', examNo: '000001' },
    false,
  );
  assert.equal(response.status, 200);
  const r = (await response.json()) as { dimensions: unknown[] };
  assert.equal(r.dimensions.length, 6);
  for (const key of ['scores', 'total', 'examNo', 'rank'])
    assert.ok(!JSON.stringify(r).includes(`"${key}"`));
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(
    (await h.call('admin/publish', 'POST', { revision: 2, mode: 'closed' }))
      .status,
    200,
  );
  assert.equal(
    (
      await h.call(
        'public/query',
        'POST',
        { name: '测试甲', examNo: '000001' },
        false,
      )
    ).status,
    403,
  );
});
test('同名错误考号、错误姓名统一失败', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  await h.call('admin/publish', 'POST', { revision: 1, mode: 'demo' });
  const a = await h.call(
    'public/query',
    'POST',
    { name: '测试甲', examNo: '000002' },
    false,
  );
  const b = await h.call(
    'public/query',
    'POST',
    { name: '测试乙', examNo: '000001' },
    false,
  );
  assert.equal(a.status, 404);
  assert.deepEqual(await a.json(), await b.json());
});
test('CSV和xlsx经过服务端上传导入，而非只在浏览器解析', async (t) => {
  const h = await harness(t);
  await h.login();
  for (const [index, ext] of ['csv', 'xlsx'].entries()) {
    const f = new FormData();
    f.set(
      'file',
      new File([await makeFixtureFile(ext as 'csv' | 'xlsx')], `scores.${ext}`),
    );
    f.set('revision', String(index));
    f.set('isDemo', 'true');
    const r = await h.call('admin/import', 'POST', f);
    assert.equal(r.status, 200);
    assert.equal((await h.store.state()).count, 3);
  }
});
test('错误导入不改变当前批次', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const f = new FormData();
  f.set('file', new File(['bad,headers\n1,2'], 'scores.csv'));
  f.set('revision', '1');
  f.set('isDemo', 'true');
  assert.equal((await h.call('admin/import', 'POST', f)).status, 422);
  assert.equal((await h.store.state()).count, 3);
  assert.equal((await h.store.state()).revision, 1);
});
test('配置保存、发布期间只读、正式发布保护', async (t) => {
  const h = await harness(t);
  await h.login();
  const s = await h.store.state();
  s.config.examName = '测试考试名称';
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 0, config: s.config }))
      .status,
    200,
  );
  assert.equal((await h.store.state()).config.examName, '测试考试名称');
  await h.importFixtures(1);
  assert.equal(
    (await h.call('admin/publish', 'POST', { revision: 2, mode: 'formal' }))
      .status,
    403,
  );
  await h.call('admin/publish', 'POST', { revision: 2, mode: 'demo' });
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 3, config: s.config }))
      .status,
    409,
  );
});
test('页面文案与独立封底图片保存回显，二维码可留空，资产与发布保护保持不变', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  const beforeStudents = await h.store.allStudents();
  const config = (await h.store.state()).config;
  const upload = async () => {
    const form = new FormData();
    form.set(
      'file',
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        'image.png',
      ),
    );
    return (
      (await (await h.call('admin/assets', 'POST', form)).json()) as {
        url: string;
      }
    ).url;
  };
  config.coverBackgroundImage = await upload();
  config.coverQrImage = '';
  config.coverText = '更多学习咨询';
  config.pageCopy.greeting = 'WELCOME!';
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 1, config })).status,
    200,
  );
  const restored = (await h.store.state()).config;
  assert.equal(restored.coverBackgroundImage, config.coverBackgroundImage);
  assert.equal(restored.coverQrImage, '');
  assert.equal(restored.coverText, config.coverText);
  assert.equal(
    (
      await h.call(
        config.coverBackgroundImage.slice(5),
        'GET',
        undefined,
        false,
      )
    ).status,
    404,
  );
  const status = (await (
    await h.call('public/status', 'GET', undefined, false)
  ).json()) as { greeting: string };
  assert.equal(status.greeting, 'WELCOME!');
  config.coverQrImage = '/api/assets/aaaa.png';
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 2, config })).status,
    400,
  );
  config.coverQrImage = await upload();
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 2, config }, false))
      .status,
    401,
  );
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 2, config }, true, false))
      .status,
    403,
  );
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 2, config })).status,
    200,
  );
  assert.equal(
    (await h.call('admin/publish', 'POST', { revision: 3, mode: 'demo' }))
      .status,
    200,
  );
  for (const image of [config.coverBackgroundImage, config.coverQrImage])
    assert.equal(
      (await h.call(image.slice(5), 'GET', undefined, false)).status,
      200,
    );
  const result = (await (
    await h.call(
      'public/query',
      'POST',
      { name: '测试甲', examNo: '000001' },
      false,
    )
  ).json()) as { coverBackgroundImage: string; coverQrImage: string };
  assert.equal(result.coverBackgroundImage, config.coverBackgroundImage);
  assert.equal(result.coverQrImage, config.coverQrImage);
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 4, config })).status,
    409,
  );
  await h.call('admin/publish', 'POST', { revision: 4, mode: 'closed' });
  assert.equal(
    (await h.call(config.coverQrImage.slice(5), 'GET', undefined, false))
      .status,
    404,
  );
  config.coverQrImage = '';
  assert.equal(
    (await h.call('admin/config', 'PUT', { revision: 5, config })).status,
    200,
  );
  assert.equal(
    (await h.store.state()).config.coverBackgroundImage,
    config.coverBackgroundImage,
  );
  assert.deepEqual(await h.store.allStudents(), beforeStudents);
});

test('图片上传检查实际类型；未发布不提供公开图片', async (t) => {
  const h = await harness(t);
  await h.login();
  const fake = new FormData();
  fake.set('file', new File(['<svg></svg>'], 'x.png', { type: 'image/png' }));
  assert.equal((await h.call('admin/assets', 'POST', fake)).status, 400);
  const f = new FormData();
  f.set(
    'file',
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'image.png'),
  );
  const upload = await h.call('admin/assets', 'POST', f);
  assert.equal(upload.status, 200);
  const data = (await upload.json()) as { url: string };
  assert.equal(
    (await h.call(data.url.slice(5), 'GET', undefined, false)).status,
    404,
  );
  assert.equal((await h.call(data.url.slice(5))).status, 200);
});
test('连续失败登录会限流', async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await h.call('admin/login', 'POST', { password: 'wrong' })).status,
      401,
    );
  const r = await h.call('admin/login', 'POST', { password: 'wrong' });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '900');
});
test('无Content-Length的超大请求仍然受限', async (t) => {
  const h = await harness(t);
  const r = await h.call(
    'public/query',
    'POST',
    { name: '甲'.repeat(250001), examNo: '1' },
    false,
  );
  assert.equal(r.status, 413);
});
test('同一考号查询限流，公开状态不含学生或成绩', async (t) => {
  const h = await harness(t);
  await h.login();
  await h.importFixtures(0);
  await h.call('admin/publish', 'POST', { revision: 1, mode: 'demo' });
  for (let i = 0; i < 12; i++)
    assert.equal(
      (
        await h.call(
          'public/query',
          'POST',
          { name: '测试甲', examNo: '000001' },
          false,
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await h.call(
        'public/query',
        'POST',
        { name: '测试甲', examNo: '000001' },
        false,
      )
    ).status,
    429,
  );
  const data = await (
    await h.call('public/status', 'GET', undefined, false)
  ).json();
  assert.ok(!JSON.stringify(data).includes('测试甲'));
});
