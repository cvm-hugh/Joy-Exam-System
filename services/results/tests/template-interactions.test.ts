import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as domain from '../lib/domain';
import * as templates from '../lib/templates';
import * as studentEntry from '../lib/student-entry';
import * as paperTemplateFile from '../lib/paper-template-file';
import * as studentList from '../lib/student-list';
import { z } from 'zod';

// The VM exposes untyped JSX props and callbacks; this alias is confined to the test host.
// oxlint-disable-next-line typescript/no-explicit-any
type RuntimeValue = any;

// Exercise the real event handlers with a deterministic hook host, no browser or live DB.
function host(
  file: string,
  exported: string,
  props: Record<string, RuntimeValue> = {},
) {
  const values: RuntimeValue[] = [];
  let cursor = 0;
  let accepted = true;
  let effects: (() => RuntimeValue)[] = [];
  const requests: RuntimeValue[] = [];
  let request: (
    ...args: RuntimeValue[]
  ) => Promise<RuntimeValue> = async () => ({});
  const state = (initial: RuntimeValue) => {
    const i = cursor++;
    if (!(i in values))
      values[i] = typeof initial === 'function' ? initial() : initial;
    return [
      values[i],
      (next: RuntimeValue) => {
        values[i] = typeof next === 'function' ? next(values[i]) : next;
      },
    ];
  };
  const ask = async (...args: RuntimeValue[]) => {
    requests.push(args);
    return accepted;
  };
  const exports: RuntimeValue = {};
  const require = (name: string): RuntimeValue => {
    if (name === 'react')
      return {
        useState: state,
        useEffect: (effect: () => RuntimeValue) => effects.push(effect),
        useRef: (v: RuntimeValue) => state({ current: v })[0],
        useCallback: (fn: RuntimeValue) => fn,
        createContext: () => ({ Provider: 'Provider' }),
        useContext: () => ask,
      };
    if (name === 'react/jsx-runtime')
      return {
        jsx: (type: RuntimeValue, props: RuntimeValue) => ({ type, props }),
        jsxs: (type: RuntimeValue, props: RuntimeValue) => ({ type, props }),
        Fragment: 'Fragment',
      };
    if (name.endsWith('confirm-action')) return { useConfirm: () => ask };
    if (name.endsWith('template-library'))
      return {
        TemplateLibrary: 'TemplateLibrary',
        TemplateSelect: 'TemplateSelect',
      };
    if (name.endsWith('threshold-editor'))
      return { ThresholdEditor: 'ThresholdEditor' };
    if (name.endsWith('paper-workspace'))
      return { PaperWorkspace: 'PaperWorkspace' };
    if (name.endsWith('publication-panel'))
      return { PublicationPanel: 'PublicationPanel' };
    if (name.endsWith('page-configuration'))
      return { PageConfiguration: 'PageConfiguration' };
    if (name.endsWith('back-cover')) return { BackCover: 'BackCover' };
    if (name === './student-entry') return { StudentEntry: 'StudentEntry' };
    if (name === './report-export') return { ReportExport: 'ReportExport' };
    if (name === './report-pages') return { ReportPages: 'ReportPages' };
    if (name === '@/lib/student-entry') return studentEntry;
    if (name === 'zod') return { z };
    if (name === 'recharts') return new Proxy({}, { get: (_, key) => key });
    if (name === '@/lib/domain') return domain;
    if (name === '@/lib/templates') return templates;
    if (name === '@/lib/paper-template-file') return paperTemplateFile;
    if (name === '@/lib/student-list') return studentList;
    if (name === '@/lib/client')
      return { api: (...args: RuntimeValue[]) => request(...args) };
    if (name.startsWith('@/components/ui/') || name === 'lucide-react')
      return new Proxy({}, { get: (_, key) => key });
    throw new Error(`unexpected import ${name}`);
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(file, 'utf8') +
        (exported === 'AdminScreen' ? '\nexport { AdminScreen };' : ''),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      require,
      structuredClone,
      FormData,
      File,
      setTimeout,
      Error,
      window: { addEventListener: () => {}, removeEventListener: () => {} },
      confirm: () => {
        throw new Error('native confirm must not be called');
      },
    },
  );
  const render = () => {
    cursor = 0;
    effects = [];
    return exports[exported](props);
  };
  return {
    render,
    props,
    requests,
    flushEffects: () => effects.forEach((effect) => effect()),
    accept: (value: boolean) => {
      accepted = value;
    },
    api: (fn: typeof request) => {
      request = fn;
    },
  };
}
function nodes(tree: RuntimeValue): RuntimeValue[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree: RuntimeValue): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object') return text(tree.props?.children);
  return tree == null ? '' : String(tree);
}
const kind = (node: RuntimeValue) =>
  typeof node.type === 'function' ? node.type.name : node.type;
function node(tree: RuntimeValue, name: string) {
  const found = nodes(tree).find((n) => kind(n) === name);
  assert.ok(found, `missing ${name}`);
  return found;
}
function button(tree: RuntimeValue, label: string) {
  const found = nodes(tree).find(
    (n) => kind(n) === 'Button' && text(n) === label,
  );
  assert.ok(found, `missing button ${label}`);
  return found;
}
const shared = () => ({
  busy: false,
  templates: [],
  reload: async () => {},
  act: async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {}
  },
});

test('成绩导入默认使用指定套卷，切换即采用最新版本，无刷新按钮且下载在独立右侧区域', async () => {
  const config = domain.defaultConfig();
  const snapshot = {
    config,
    revision: 1,
    count: 1,
    published: 'closed',
    readiness: [],
    demoAllowed: true,
    formalAllowed: false,
  };
  const preferred = {
    id: 'P',
    name: '学业水平统测｜英语2608',
    revision: 2,
    kind: 'paper',
    data: templates.paperFrom(config),
  };
  const alternate = { ...preferred, id: 'Q', name: '另一套卷', revision: 3 };
  const h = host('components/admin.tsx', 'AdminScreen');
  h.api(async (path: string) =>
    path === 'state'
      ? snapshot
      : path === 'templates'
        ? { templates: [preferred, alternate] }
        : { students: [] },
  );
  h.render();
  h.flushEffects();
  await new Promise(setImmediate);
  h.render();
  h.render();
  await nodes(h.render())
    .find((n) => n.type === 'button' && text(n) === '成绩导入')
    .props.onClick();
  await new Promise(setImmediate);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, 'P');
  assert.ok(!text(h.render()).includes('刷新可用试卷'));
  assert.ok(!text(h.render()).includes('先选套卷，再维护卷内配套内容'));
  assert.ok(text(h.render()).includes('学生姓名仅使用中文名'));
  assert.ok(text(h.render()).includes('数据类型'));
  let dataKinds = nodes(h.render()).filter(
    (n) => n.type === 'input' && n.props.type === 'radio',
  );
  assert.deepEqual(
    dataKinds.map((n) => [n.props.value, n.props.checked]),
    [
      ['formal', true],
      ['demo', false],
    ],
  );
  dataKinds[1].props.onChange();
  dataKinds = nodes(h.render()).filter(
    (n) => n.type === 'input' && n.props.type === 'radio',
  );
  assert.deepEqual(
    dataKinds.map((n) => n.props.checked),
    [false, true],
  );
  const links = nodes(h.render()).filter(
    (n) => n.type === 'a' && n.props.download,
  );
  assert.ok(
    links.every(
      (n) =>
        n.props.href.includes('paperTemplateId=P') &&
        n.props.href.includes('paperRevision=2'),
    ),
  );
  assert.equal(
    nodes(h.render()).filter(
      (n) => n.props?.className === 'actions import-downloads',
    ).length,
    1,
  );
  alternate.revision = 4;
  node(h.render(), 'TemplateSelect').props.onChange('Q');
  await new Promise(setImmediate);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, 'Q');
  assert.ok(
    nodes(h.render())
      .filter((n) => n.type === 'a' && n.props.download)
      .every((n) => n.props.href.includes('paperRevision=4')),
  );
  assert.equal(h.requests.length, 0);
  node(h.render(), 'TemplateSelect').props.onChange('');
  await new Promise(setImmediate);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
  assert.ok(node(h.render(), 'StudentEntry'));
});

test('单人补录先校验后确认，取消不写；成功清空草稿，失败不清空输入且批次变化禁止提交', async () => {
  const snapshot = {
    config: domain.defaultConfig(),
    batchId: 'batch-A',
    revision: 7,
    count: 235,
    published: 'closed',
    isDemoData: false,
    importedAt: '',
  };
  const writes: RuntimeValue[] = [];
  const h = host('components/student-entry.tsx', 'StudentEntry', {
    snapshot,
    busy: false,
    configDirty: false,
    onBusyChange: () => {},
    onDirtyChange: () => {},
    onSaved: async () => {},
  });
  h.api(async (...args) => {
    writes.push(args);
    return { ok: true };
  });
  button(h.render(), '补录一名学生').props.onClick();
  await new Promise(setImmediate);
  const fill = (id: string, value: string) =>
    nodes(h.render())
      .find((n) => n.props?.id === id)
      .props.onChange({ target: { value } });
  fill('entry-name', '补录学生');
  fill('entry-number', '000099');
  fill('entry-班级名称', '一班');
  fill('entry-笔试时间', '2026-09-12 上午场');
  fill('entry-年级', '七年级');
  snapshot.config.analysis.parts.forEach((p) => fill(`entry-${p.id}`, '0.1'));
  node(h.render(), 'form').props.onSubmit({ preventDefault() {} });
  assert.ok(text(h.render()).includes('自动合计总分：1.2'));
  assert.equal(writes.length, 0);
  h.accept(false);
  button(h.render(), '确认补录，不替换名单').props.onClick();
  await new Promise(setImmediate);
  assert.equal(writes.length, 0);
  h.accept(true);
  h.api(async () => {
    throw Error('该考号已存在');
  });
  button(h.render(), '确认补录，不替换名单').props.onClick();
  await new Promise(setImmediate);
  assert.ok(text(h.render()).includes('该考号已存在'));
  assert.equal(
    nodes(h.render()).find((n) => n.props?.id === 'entry-number').props.value,
    '000099',
  );
  snapshot.revision = 8;
  assert.equal(button(h.render(), '确认补录，不替换名单').props.disabled, true);
  snapshot.revision = 7;
  h.api(async (...args) => {
    writes.push(args);
    return { ok: true };
  });
  button(h.render(), '确认补录，不替换名单').props.onClick();
  await new Promise(setImmediate);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'students/append');
  assert.equal(writes[0][2].batchId, 'batch-A');
  assert.equal(writes[0][2].student.examNo, '000099');
  assert.equal(writes[0][2].student.total, undefined);
  assert.ok(text(h.render()).includes('已成功补录1名学生'));
  assert.ok(!nodes(h.render()).some((n) => kind(n) === 'Input'));
});

test('首页只有三项概览；学生默认10人，调整页容量回到首页且页码正确', async () => {
  const config = domain.defaultConfig();
  config.paperSource = {
    id: '00000000-0000-4000-8000-000000000000',
    name: '当前批次真实来源模板',
    revision: 1,
  };
  const snapshot = {
    config,
    revision: 3,
    count: 235,
    published: 'closed',
    readiness: [],
    demoAllowed: true,
    formalAllowed: false,
  };
  const calls: string[] = [];
  const h = host('components/admin.tsx', 'AdminScreen');
  h.api(async (path: string) => {
    calls.push(path);
    if (path === 'state') return snapshot;
    if (path === 'templates') return { templates: [] };
    if (path.startsWith('students?')) {
      const params = new URLSearchParams(path.split('?')[1]);
      const size = Number(params.get('pageSize')),
        page = Number(params.get('page'));
      return {
        students: Array.from(
          { length: Math.min(size, 235 - (page - 1) * size) },
          (_, i) => ({
            examNo: String((page - 1) * size + i),
            name: '分页用例',
            total: '1',
          }),
        ),
      };
    }
    throw Error(`Unexpected API ${path}`);
  });
  h.render();
  h.flushEffects();
  await new Promise(setImmediate);
  const stats = nodes(h.render()).find((n) => n.props?.className === 'stats');
  assert.equal(nodes(stats).filter((n) => n.type === 'section').length, 3);
  assert.ok(text(stats).includes('当前批次真实来源模板'));
  for (const removed of ['工作流程', '正式发布准备', '六个维度，清晰呈现'])
    assert.ok(!text(h.render()).includes(removed));
  assert.ok(text(h.render()).includes('配置与发布'));
  await nodes(h.render())
    .find((n) => n.type === 'button' && text(n) === '学生预览')
    .props.onClick();
  h.render();
  h.flushEffects();
  await new Promise(setImmediate);
  assert.ok(calls.includes('students?page=1&pageSize=10'));
  assert.equal(
    nodes(node(h.render(), 'tbody')).filter((n) => n.type === 'tr').length,
    10,
  );
  button(h.render(), '下一页').props.onClick();
  h.render();
  h.flushEffects();
  await new Promise(setImmediate);
  assert.ok(text(h.render()).includes('第 2 / 24 页'));
  node(h.render(), 'Select').props.onValueChange('50');
  h.render();
  h.flushEffects();
  await new Promise(setImmediate);
  assert.ok(calls.includes('students?page=1&pageSize=50'));
  assert.equal(
    nodes(node(h.render(), 'tbody')).filter((n) => n.type === 'tr').length,
    50,
  );
  assert.ok(text(h.render()).includes('第 1 / 5 页'));
  for (let i = 0; i < 4; i++) button(h.render(), '下一页').props.onClick();
  h.render();
  h.flushEffects();
  await new Promise(setImmediate);
  assert.equal(
    nodes(node(h.render(), 'tbody')).filter((n) => n.type === 'tr').length,
    35,
  );
  assert.equal(button(h.render(), '下一页').props.disabled, true);
});

test('三页编辑紧邻预览，开放关闭效果独立；图片分开赋值、二维码可移除', () => {
  const config = domain.defaultConfig();
  let saves = 0;
  const h = host('components/page-configuration.tsx', 'PageConfiguration', {
    config,
    locked: false,
    busy: false,
    dirty: false,
    mode: 'formal',
    onModeChange: (mode: string) => {
      h.props.mode = mode;
    },
    onEdit: (mutate: (c: domain.Config) => void) => {
      mutate(config);
      h.props.dirty = true;
    },
    onSave: () => {
      saves++;
    },
    onUpload: (file: File, assign: (c: domain.Config, url: string) => void) =>
      assign(config, `/api/assets/${file.name}`),
    renderEntrance: (mode: string) => ({
      type: 'EntranceSpecimen',
      props: { mode, title: config.queryTitle },
    }),
    renderResult: (result: domain.Result) => ({
      type: 'ContentSpecimen',
      props: { result },
    }),
  });
  assert.equal(
    nodes(h.render()).filter((n) => kind(n) === 'Textarea').length,
    0,
  );
  assert.equal(node(h.render(), 'EntranceSpecimen').props.mode, 'formal');
  button(h.render(), '关闭状态预览').props.onClick();
  assert.equal(node(h.render(), 'EntranceSpecimen').props.mode, 'closed');
  button(h.render(), '开放状态预览').props.onClick();
  assert.equal(node(h.render(), 'EntranceSpecimen').props.mode, 'formal');
  assert.ok(!text(h.render()).includes('查看当前状态'));
  button(h.render(), '编辑入口页文字').props.onClick();
  nodes(h.render())
    .find((n) => n.props?.id === 'page-text-queryTitle')
    .props.onChange({ target: { value: '入口新标题' } });
  assert.equal(node(h.render(), 'EntranceSpecimen').props.title, '入口新标题');
  const querySection = nodes(h.render()).find(
    (n) => n.type === 'section' && n.props.id === 'query-entrance-preview',
  );
  assert.ok(nodes(querySection).some((n) => kind(n) === 'Textarea'));
  assert.ok(nodes(querySection).some((n) => kind(n) === 'EntranceSpecimen'));
  button(h.render(), '保存页面配置').props.onClick();
  assert.equal(saves, 1);
  button(h.render(), '编辑能力图与六维评价').props.onClick();
  nodes(h.render())
    .find((n) => n.props?.id === 'page-text-examInfo')
    .props.onChange({ target: { value: '内容页说明新文字' } });
  assert.equal(
    node(h.render(), 'ContentSpecimen').props.result.examInfo,
    '内容页说明新文字',
  );
  assert.equal(
    node(h.render(), 'ContentSpecimen').props.result.name,
    '学生中文名',
  );
  assert.equal(node(h.render(), 'ContentSpecimen').props.result.isDemo, true);
  assert.ok(text(h.render()).includes('750 × 300 像素'));
  button(h.render(), '编辑封底文字与图片').props.onClick();
  assert.ok(text(h.render()).includes('750 × 1334 像素'));
  assert.ok(text(h.render()).includes('480 × 480 像素'));
  nodes(h.render())
    .find((n) => n.props?.id === 'page-image-coverBackgroundImage')
    .props.onChange({
      target: {
        files: [new File(['x'], 'background.png')],
        value: 'background',
      },
    });
  nodes(h.render())
    .find((n) => n.props?.id === 'page-image-coverQrImage')
    .props.onChange({
      target: { files: [new File(['x'], 'qr.png')], value: 'qr' },
    });
  assert.equal(config.coverBackgroundImage, '/api/assets/background.png');
  assert.equal(config.coverQrImage, '/api/assets/qr.png');
  button(h.render(), '移除中心二维码（选填）').props.onClick();
  assert.equal(config.coverQrImage, '');
  assert.equal(config.coverBackgroundImage, '/api/assets/background.png');
  h.props.locked = true;
  assert.ok(
    nodes(h.render())
      .filter((n) => kind(n) === 'Textarea' || n.props?.type === 'file')
      .every((n) => n.props.disabled),
  );
  assert.equal(button(h.render(), '保存页面配置').props.disabled, true);
});

test('封底无配置时隐藏；只有底图可展示；二维码独立且不生成占位图', () => {
  const config = domain.defaultConfig();
  const h = host('components/back-cover.tsx', 'BackCover', { config });
  assert.equal(h.render(), null);
  config.coverBackgroundImage = '/api/assets/aaaa.png';
  assert.equal(nodes(h.render()).filter((n) => n.type === 'img').length, 1);
  assert.ok(
    !nodes(h.render()).some((n) => n.props?.className === 'back-cover-qr'),
  );
  config.coverQrImage = '/api/assets/bbbb.png';
  assert.equal(nodes(h.render()).filter((n) => n.type === 'img').length, 2);
  assert.equal(
    nodes(h.render()).find((n) => n.props?.className === 'back-cover-qr').props
      .src,
    config.coverQrImage,
  );
});

test('配置与发布：左侧只预览、右侧控制查询，两种状态互斥且禁用条件不阻止关闭', () => {
  const published: string[] = [];
  const status = {
    published: 'closed',
    count: 235,
    demoAllowed: true,
    formalAllowed: false,
    readiness: [],
  };
  const h = host('components/publication-panel.tsx', 'PublicationPanel', {
    status,
    config: domain.defaultConfig(),
    busy: false,
    dirty: false,
    onPublish: (mode: string) => published.push(mode),
  });
  const switches = () => nodes(h.render()).filter((n) => kind(n) === 'Switch');
  assert.deepEqual(
    switches().map((n) => n.props.checked),
    [false, false],
  );
  assert.equal(switches()[1].props.disabled, true);
  button(h.render(), '结果查询演示预览').props.onClick();
  assert.equal(node(h.render(), 'PageConfiguration').props.mode, 'demo');
  button(h.render(), '正式开放小程序查询').props.onClick();
  assert.equal(node(h.render(), 'PageConfiguration').props.mode, 'formal');
  node(h.render(), 'PageConfiguration').props.onModeChange('closed');
  assert.equal(node(h.render(), 'PageConfiguration').props.mode, 'closed');
  assert.equal(published.length, 0);
  switches()[1].props.onCheckedChange(true);
  assert.equal(published.length, 0);
  switches()[0].props.onCheckedChange(true);
  assert.deepEqual(published, ['demo']);
  status.published = 'demo';
  assert.deepEqual(
    switches().map((n) => n.props.checked),
    [true, false],
  );
  h.props.dirty = true;
  status.count = 0;
  status.demoAllowed = false;
  assert.equal(switches()[0].props.disabled, false);
  switches()[0].props.onCheckedChange(false);
  assert.equal(published.at(-1), 'closed');
  status.published = 'formal';
  assert.equal(switches()[1].props.disabled, false);
  switches()[1].props.onCheckedChange(false);
  assert.equal(published.at(-1), 'closed');
  h.props.busy = true;
  assert.equal(switches()[1].props.disabled, true);
  const previous = published.length;
  switches()[1].props.onCheckedChange(false);
  assert.equal(published.length, previous);
});

test('入口效果使用配置文案、保留logo空位且不包含查询请求；关闭与演示正确显示', () => {
  const config = domain.defaultConfig();
  config.queryTitle = '入口预览标题';
  config.closedMessage = '请等待学校通知';
  const h = host('components/publication-panel.tsx', 'QueryEntrancePreview', {
    config,
    mode: 'closed',
  });
  assert.ok(text(h.render()).includes(config.queryTitle));
  assert.ok(text(h.render()).includes(config.closedMessage));
  assert.ok(
    nodes(h.render()).some(
      (n) => n.props?.['aria-label'] === '品牌标志预留位置',
    ),
  );
  assert.ok(
    nodes(h.render())
      .filter((n) => kind(n) === 'Input')
      .every((n) => n.props.readOnly),
  );
  assert.equal(button(h.render(), '暂未开放查询').props.disabled, true);
  h.props.mode = 'demo';
  assert.ok(!text(h.render()).includes('开发测试 · 非正式考试结果'));
  assert.ok(!text(h.render()).includes(config.closedMessage));
  assert.equal(button(h.render(), '立即查询').props.onClick, undefined);
});

test('模板库首次默认载入学业水平统测；异步加载、手动切换和清空不会覆盖草稿', async () => {
  const config = domain.defaultConfig();
  const preferred = {
    id: 'preferred',
    name: '学业水平统测｜英语2608',
    revision: 1,
    kind: 'paper',
    data: templates.paperFrom(config),
  };
  const other = { ...preferred, id: 'other', name: '其他试卷' };
  for (const delayed of [false, true]) {
    const h = host('components/paper-workspace.tsx', 'PaperWorkspace', {
      config,
      templates: delayed ? [] : [other, preferred],
      reload: async () => {},
      onDirtyChange: () => {},
    });
    const writes: RuntimeValue[] = [];
    h.api(async (...args) => {
      writes.push(args);
      return {};
    });
    h.render();
    h.flushEffects();
    if (delayed) {
      assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
      h.props.templates = [other, preferred];
      h.render();
      h.flushEffects();
    }
    assert.equal(node(h.render(), 'TemplateSelect').props.value, 'preferred');
    assert.ok(!nodes(h.render()).some((n) => kind(n) === 'Input'));
    node(h.render(), 'TemplateSelect').props.onChange('other');
    await new Promise(setImmediate);
    h.render();
    h.flushEffects();
    assert.equal(node(h.render(), 'TemplateSelect').props.value, 'other');
    button(h.render(), '编辑名称 / 另存套卷').props.onClick();
    node(h.render(), 'Input').props.onChange({
      target: { value: '未保存名称' },
    });
    h.props.templates = [preferred, other];
    h.render();
    h.flushEffects();
    assert.equal(node(h.render(), 'Input').props.value, '未保存名称');
    node(h.render(), 'TemplateSelect').props.onChange('');
    await new Promise(setImmediate);
    h.render();
    h.flushEffects();
    assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
    assert.equal(writes.length, 0);
  }
});

test('没有指定默认套卷时不随意选择，用户先建立草稿后到达的默认模板不抢占', async () => {
  const config = domain.defaultConfig();
  const h = host('components/paper-workspace.tsx', 'PaperWorkspace', {
    config,
    templates: [],
    reload: async () => {},
    onDirtyChange: () => {},
  });
  h.render();
  h.flushEffects();
  assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
  button(h.render(), '建立首套试卷模板').props.onClick();
  await new Promise(setImmediate);
  const originalName = node(h.render(), 'Input').props.value;
  h.props.templates = [
    {
      id: 'preferred',
      name: '学业水平统测｜英语2608',
      kind: 'paper',
      revision: 1,
      data: templates.paperFrom(config),
    },
  ];
  h.render();
  h.flushEffects();
  assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
  assert.equal(node(h.render(), 'Input').props.value, originalName);
});

test('先选配套套卷再进入编辑：评价正文不含计算面板；保存更新同一套卷默认版本而非当前考试', async () => {
  const config = domain.defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = domain.continuousRules();
  });
  const data = templates.paperFrom(config);
  const entry = {
    id: 'A',
    name: '英语配套卷',
    revision: 3,
    kind: 'paper',
    data,
  };
  const h = host('components/paper-workspace.tsx', 'PaperWorkspace', {
    config,
    templates: [entry],
    reload: async () => {},
    onDirtyChange: () => {},
  });
  assert.ok(!text(h.render()).includes('进入编辑'));
  node(h.render(), 'TemplateSelect').props.onChange('A');
  await new Promise(setImmediate);
  assert.ok(
    !nodes(h.render()).some(
      (n) => kind(n) === 'Button' && text(n) === '载入套卷',
    ),
  );
  assert.ok(!nodes(h.render()).some((n) => kind(n) === 'Input'));
  const nav = nodes(h.render()).find((n) => n.type === 'nav');
  nodes(nav)
    .find((n) => kind(n) === 'Button' && text(n).startsWith('评价管理'))
    .props.onClick();
  const panel = nodes(h.render())
    .filter((n) => n.type === 'section')
    .at(-1);
  assert.ok(!text(panel).includes('系数'));
  assert.ok(!text(panel).includes('Part'));
  assert.ok(!text(panel).includes('计算规则'));
  assert.ok(!text(panel).includes('阈值'));
  assert.ok(!nodes(panel).some((n) => kind(n) === 'Textarea'));
  button(h.render(), '进入编辑').props.onClick();
  node(h.render(), 'Textarea').props.onChange({
    target: { value: '编辑后的正式能力描述' },
  });
  const calls: RuntimeValue[] = [];
  h.api(async (...args) => {
    calls.push(args);
    return { ok: true };
  });
  button(h.render(), '保存本套卷').props.onClick();
  await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'papers');
  assert.equal(calls[0][1], 'PUT');
  assert.equal(calls[0][2].id, 'A');
  assert.equal(calls[0][2].revision, 3);
  assert.equal(
    calls[0][2].data.dimensions[0].evaluations[0].paragraphs[0],
    '编辑后的正式能力描述',
  );
  assert.deepEqual(calls[0][2].data.analysis, data.analysis);
  assert.deepEqual(
    calls[0][2].data.dimensions[0].rules,
    data.dimensions[0].rules,
  );
  assert.ok(!nodes(h.render()).some((n) => kind(n) === 'Textarea'));
  assert.ok(text(h.render()).includes('已保存版本 5'));
  assert.notEqual(
    config.dimensions[0].evaluations[0].paragraphs[0],
    '编辑后的正式能力描述',
  );
});
test('配套套卷删除取消不请求；删除成功清空编辑状态，随后仍可载入另一套卷', async () => {
  const config = domain.defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = domain.continuousRules();
  });
  const entries = ['A', 'B'].map((id) => ({
    id,
    name: `套卷${id}`,
    revision: 0,
    kind: 'paper',
    data: templates.paperFrom(config),
  }));
  const props = {
    config,
    templates: entries,
    reload: async () => {},
    onDirtyChange: () => {},
  };
  const h = host('components/paper-workspace.tsx', 'PaperWorkspace', props);
  const calls: RuntimeValue[] = [];
  h.api(async (...args) => {
    calls.push(args);
    props.templates = props.templates.filter((t) => t.id !== args[2].id);
  });
  node(h.render(), 'TemplateSelect').props.onChange('A');
  await new Promise(setImmediate);
  h.accept(false);
  button(h.render(), '删除选中套卷').props.onClick();
  await new Promise(setImmediate);
  assert.equal(calls.length, 0);
  h.accept(true);
  button(h.render(), '删除选中套卷').props.onClick();
  await new Promise(setImmediate);
  assert.equal(calls[0][0], 'templates');
  assert.equal(calls[0][1], 'DELETE');
  assert.equal(calls[0][2].id, 'A');
  assert.equal(calls[0][2].confirmDelete, true);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
  assert.ok(!text(h.render()).includes('套卷总览'));
  node(h.render(), 'TemplateSelect').props.onChange('B');
  await new Promise(setImmediate);
  assert.ok(text(h.render()).includes('套卷B'));
  assert.ok(text(h.render()).includes('套卷总览'));
});

test('自动选卷遇到未保存修改：取消保留原选择及草稿，确认后才切换或清空', async () => {
  const config = domain.defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = domain.continuousRules();
  });
  const entries = ['A', 'B'].map((id) => ({
    id,
    name: `套卷${id}`,
    revision: 0,
    kind: 'paper',
    data: templates.paperFrom(config),
  }));
  const h = host('components/paper-workspace.tsx', 'PaperWorkspace', {
    config,
    templates: entries,
    reload: async () => {},
    onDirtyChange: () => {},
  });
  node(h.render(), 'TemplateSelect').props.onChange('A');
  await new Promise(setImmediate);
  button(h.render(), '编辑名称 / 另存套卷').props.onClick();
  node(h.render(), 'Input').props.onChange({
    target: { value: '尚未保存的名称' },
  });
  h.accept(false);
  node(h.render(), 'TemplateSelect').props.onChange('B');
  await new Promise(setImmediate);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, 'A');
  assert.equal(node(h.render(), 'Input').props.value, '尚未保存的名称');
  node(h.render(), 'TemplateSelect').props.onChange('');
  await new Promise(setImmediate);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, 'A');
  h.accept(true);
  node(h.render(), 'TemplateSelect').props.onChange('B');
  await new Promise(setImmediate);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, 'B');
  assert.ok(text(h.render()).includes('套卷B'));
  assert.ok(!text(h.render()).includes('尚未保存的名称'));
  node(h.render(), 'TemplateSelect').props.onChange('');
  await new Promise(setImmediate);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
  assert.ok(!text(h.render()).includes('套卷总览'));
});

test('复制新建取当前载入模板而非当前考试；副本独立编辑，保存使用新增请求', async () => {
  const config = domain.defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = domain.continuousRules();
  });
  const data = templates.paperFrom(config);
  data.analysis.parts[0].label = '模板专属题型';
  data.dimensions[0].evaluations[0].paragraphs[0] = '模板专属评语';
  const source = {
    id: 'A',
    name: '另一个学科模板',
    revision: 0,
    kind: 'paper',
    data,
  };
  const h = host('components/paper-workspace.tsx', 'PaperWorkspace', {
    config,
    templates: [source],
    reload: async () => {},
    onDirtyChange: () => {},
  });
  const calls: RuntimeValue[] = [];
  h.api(async (...args) => {
    calls.push(args);
    return { id: 'COPY' };
  });
  assert.equal(
    button(h.render(), '从当前试卷模板复制新建').props.disabled,
    true,
  );
  node(h.render(), 'TemplateSelect').props.onChange('A');
  await new Promise(setImmediate);
  button(h.render(), '从当前试卷模板复制新建').props.onClick();
  await new Promise(setImmediate);
  assert.equal(calls.length, 0);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
  assert.equal(node(h.render(), 'Input').props.value, '另一个学科模板 · 副本');
  node(h.render(), 'Input').props.onChange({ target: { value: '新学科模板' } });
  button(h.render(), '保存本套卷').props.onClick();
  await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'templates');
  assert.equal(calls[0][1], 'POST');
  assert.equal(calls[0][2].name, '新学科模板');
  assert.deepEqual(calls[0][2].payload.data, data);
  assert.equal(source.name, '另一个学科模板');
  assert.notEqual(config.analysis.parts[0].label, data.analysis.parts[0].label);
});

test('没有套卷时仍能建立首套模板；复制按钮不假装复制当前考试', async () => {
  const config = domain.defaultConfig();
  config.dimensions.forEach((d) => {
    d.rules = domain.continuousRules();
  });
  const h = host('components/paper-workspace.tsx', 'PaperWorkspace', {
    config,
    templates: [],
    reload: async () => {},
    onDirtyChange: () => {},
  });
  assert.equal(
    button(h.render(), '从当前试卷模板复制新建').props.disabled,
    true,
  );
  button(h.render(), '建立首套试卷模板').props.onClick();
  await new Promise(setImmediate);
  assert.ok(text(h.render()).includes('套卷总览'));
  assert.equal(node(h.render(), 'Input').props.value, '');
});

test('页面内确认框：取消返回false、确认返回true，不依赖原生弹窗', async () => {
  const h = host('components/confirm-action.tsx', 'ConfirmProvider', {
    children: 'page',
  });
  const ask = h.render().props.value;
  let pending = ask('确认删除模板A？', { destructive: true });
  assert.equal(node(h.render(), 'AlertDialog').props.open, true);
  node(h.render(), 'AlertDialogCancel').props.onClick();
  assert.equal(await pending, false);
  pending = ask('确认载入？');
  node(h.render(), 'AlertDialogAction').props.onClick();
  assert.equal(await pending, true);
  assert.equal(node(h.render(), 'AlertDialog').props.open, false);
});
test('删除取消不请求；确认后请求指定模板并清空选择，其他模板仍可载入', async () => {
  const payload = {
    kind: 'evaluation',
    data: templates.evaluationFrom(domain.defaultConfig()),
  };
  const entries = ['A', 'B'].map((id) => ({
    ...payload,
    id,
    name: `模板${id}`,
    revision: 0,
  }));
  let loaded = '';
  const props = {
    ...shared(),
    payload,
    templates: entries,
    locked: false,
    editing: false,
    onStart: () => {},
    onClose: () => {},
    onLoad: (t: RuntimeValue) => {
      loaded = t.id;
    },
  };
  const h = host('components/template-library.tsx', 'TemplateLibrary', props);
  const calls: RuntimeValue[] = [];
  h.api(async (...args) => {
    calls.push(args);
    props.templates = props.templates.filter((t) => t.id !== args[2].id);
  });
  node(h.render(), 'TemplateSelect').props.onChange('A');
  h.accept(false);
  await button(h.render(), '删除模板').props.onClick();
  assert.equal(calls.length, 0);
  h.accept(true);
  await button(h.render(), '删除模板').props.onClick();
  assert.equal(calls[0][0], 'templates');
  assert.equal(calls[0][1], 'DELETE');
  assert.equal(calls[0][2].id, 'A');
  assert.equal(calls[0][2].confirmDelete, true);
  assert.equal(node(h.render(), 'TemplateSelect').props.value, '');
  assert.equal(button(h.render(), '载入并编辑').props.disabled, true);
  node(h.render(), 'TemplateSelect').props.onChange('B');
  assert.equal(button(h.render(), '载入并编辑').props.disabled, false);
  button(h.render(), '载入并编辑').props.onClick();
  await new Promise(setImmediate);
  assert.equal(loaded, 'B');
});
test('删除被版本保护拒绝时就地显示错误，仍能选择并载入其他模板', async () => {
  const payload = {
    kind: 'analysis',
    data: templates.analysisFrom(domain.defaultConfig()),
  };
  let loaded = '';
  const h = host('components/template-library.tsx', 'TemplateLibrary', {
    ...shared(),
    payload,
    locked: false,
    editing: false,
    onStart: () => {},
    onClose: () => {},
    onLoad: (t: RuntimeValue) => {
      loaded = t.id;
    },
    templates: ['A', 'B'].map((id) => ({
      ...payload,
      id,
      name: id,
      revision: 0,
    })),
  });
  h.api(async () => {
    throw new Error('版本已更新，请刷新模板库');
  });
  node(h.render(), 'TemplateSelect').props.onChange('A');
  await button(h.render(), '删除模板').props.onClick();
  assert.ok(text(h.render()).includes('版本已更新'));
  node(h.render(), 'TemplateSelect').props.onChange('B');
  button(h.render(), '载入并编辑').props.onClick();
  await new Promise(setImmediate);
  assert.equal(loaded, 'B');
});
test('阈值编辑先展开，填入连续分档立即更新真正payload，保存模板与应用都通过完整校验', async () => {
  const h = host('components/threshold-templates.tsx', 'ThresholdTemplates', {
    ...shared(),
    config: domain.defaultConfig(),
    revision: 20,
    locked: false,
    parentDirty: false,
    onApplied: async () => {},
    onDirtyChange: () => {},
  });
  assert.equal(node(h.render(), 'TemplateLibrary').props.editing, false);
  node(h.render(), 'TemplateLibrary').props.onStart();
  button(h.render(), '填入本次确认分档：0.8 / 0.6 / 0.4').props.onClick();
  const payload = node(h.render(), 'TemplateLibrary').props.payload;
  assert.equal(node(h.render(), 'TemplateLibrary').props.saveDisabled, false);
  assert.ok(templates.templatePayloadSchema.safeParse(payload).success);
  assert.deepEqual(payload.data.dimensions[0].rules, domain.continuousRules());
  node(h.render(), 'Checkbox').props.onCheckedChange(true);
  const calls: RuntimeValue[] = [];
  h.api(async (...args) => {
    calls.push(args);
  });
  await button(h.render(), '确认应用阈值到当前考试').props.onClick();
  await new Promise(setImmediate);
  assert.equal(calls[0][0], 'thresholds');
  assert.equal(calls[0][2].confirmApply, true);
  assert.deepEqual(
    calls[0][2].data.dimensions[0].rules,
    domain.continuousRules(),
  );
});
