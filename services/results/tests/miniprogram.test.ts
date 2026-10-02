import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
function loadCommonJS(relative: string, extras: Record<string, unknown> = {}) {
  const moduleFixture = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(
    readFileSync(path.resolve('miniprogram', relative), 'utf8'),
    {
      module: moduleFixture,
      exports: moduleFixture.exports,
      require: (p: string) =>
        loadCommonJS(path.join(path.dirname(relative), p + '.js'), extras),
      Promise,
      Error,
      ...extras,
    },
  );
  return moduleFixture.exports;
}
test('小程序JSON可解析，JS语法有效，无持久保存成绩', () => {
  function visit(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) visit(file);
      else if (file.endsWith('.json')) JSON.parse(readFileSync(file, 'utf8'));
      else if (file.endsWith('.js')) {
        const source = readFileSync(file, 'utf8');
        new vm.Script(source, { filename: file });
        assert.ok(!/setStorage|setStorageSync/.test(source));
      }
    }
  }
  visit('miniprogram');
});
test('雷达图六轴几何与百分比映射', () => {
  const { point } = loadCommonJS('components/radar/geometry.js') as {
    point: (
      i: number,
      r: number,
      cx: number,
      cy: number,
      radius: number,
    ) => number[];
  };
  assert.deepEqual(Array.from(point(0, 1, 100, 100, 50)), [100, 50]);
  for (let i = 0; i < 6; i++) {
    const [x, y] = point(i, 0.8, 100, 100, 50);
    assert.ok(Math.abs(Math.hypot(x - 100, y - 100) - 40) < 1e-8);
  }
});
test('六维图为红线灰网、轴旁系数；小程序与后台不再重复列出百分比', () => {
  const native = readFileSync('miniprogram/pages/result/index.wxml', 'utf8');
  assert.ok(!native.includes('item.percent'));
  assert.ok(!native.includes('dimension-values'));
  assert.ok(native.includes('ability-heading'));
  const canvas = readFileSync('miniprogram/components/radar/index.js', 'utf8');
  assert.ok(canvas.includes('#d83232'));
  assert.ok(canvas.includes('#cccccc'));
  assert.ok(canvas.includes('d.coefficient'));
  const resultView = readFileSync('components/report-pages.tsx', 'utf8');
  assert.ok(!resultView.includes('dimension-strip'));
  assert.ok(resultView.includes('dimension.coefficient'));
});
test('品牌视觉白底红色，Logo留空，入口与内容标题动态配置且封底二维码可选', () => {
  const query = readFileSync('miniprogram/pages/query/index.wxml', 'utf8');
  const result = readFileSync('miniprogram/pages/result/index.wxml', 'utf8');
  const theme = readFileSync('miniprogram/app.wxss', 'utf8');
  const settings = JSON.parse(readFileSync('miniprogram/app.json', 'utf8'));
  assert.equal(settings.window.navigationBarBackgroundColor, '#ffffff');
  assert.equal(settings.pages.length, 2);
  assert.match(theme, /--parent-accent:\s*#e60012/);
  assert.match(query, /class="brand-space" aria-hidden="true"><\/view>/);
  assert.match(result, /class="brand-space" aria-hidden="true"><\/view>/);
  assert.ok(query.includes('{{greeting}}') && query.includes('立即查询'));
  assert.ok(result.includes('class="result-swiper"'));
  assert.ok(result.includes('result.admission'));
  assert.ok(result.includes('wx:if="result.coverQrImage"'));
  assert.ok(
    result.includes('class="back-cover-qr"') &&
      result.includes('mode="aspectFit"'),
  );
  assert.ok(result.includes('result.coverBackgroundImage'));
  for (const text of ['已被录取', '二维码', 'Question Types', 'item.percent'])
    assert.ok(!(query + result).includes(text));
});
test('视觉改版保留身份输入与发布保护、三段动态评语和可选图片', () => {
  const query = readFileSync('miniprogram/pages/query/index.wxml', 'utf8');
  const result = readFileSync('miniprogram/pages/result/index.wxml', 'utf8');
  assert.ok(
    query.includes('bindinput="onName"') &&
      query.includes('bindinput="onExamNo"'),
  );
  assert.ok(query.includes('disabled="{{loading || !ready || !open}}"'));
  assert.ok(query.includes('{{title}}') && query.includes('{{description}}'));
  assert.ok(
    result.includes('result.dimensions') &&
      result.includes('dimension.gradeDescriptions') &&
      result.includes('dimension.evaluation.paragraphs[1]') &&
      result.includes('dimension.evaluation.paragraphs[2]'),
  );
  assert.ok(
    result.includes('dimension.evaluation.image') &&
      result.includes('result.headerImage'),
  );
});
test('小程序查询走POST body而非URL，发布版拒绝本地配置', async () => {
  let captured: Record<string, unknown> = {};
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    request: (options: Record<string, unknown>) => {
      captured = options;
      (options.success as (r: unknown) => void)({
        statusCode: 200,
        data: { ok: true },
      });
    },
  };
  const api = loadCommonJS('utils/api.js', { wx }) as {
    request: (p: string, d?: unknown) => Promise<unknown>;
  };
  await api.request('/public/query', { name: '测试甲', examNo: '000001' });
  assert.equal(captured.method, 'POST');
  assert.equal(captured.url, 'http://localhost:3000/api/public/query');
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } });
  await assert.rejects(() => api.request('/public/status'));
});
