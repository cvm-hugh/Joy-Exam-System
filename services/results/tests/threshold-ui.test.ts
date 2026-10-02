import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ThresholdTemplates } from '../components/threshold-templates';
import { ThresholdEditor } from '../components/threshold-editor';
import {
  AnalysisEditor,
  EvaluationTemplates,
} from '../components/template-manager';
import { defaultConfig, continuousRules, ruleGaps } from '../lib/domain';

test('阈值页渲染真实已存规则与独立草稿区，不把旧上限伪装成新分档', () => {
  const config = defaultConfig();
  const props = {
    config,
    revision: 19,
    locked: true,
    parentDirty: false,
    templates: [],
    busy: false,
    reload: async () => {},
    act: async () => {},
    onApplied: async () => {},
    onDirtyChange: () => {},
  };
  const html = renderToStaticMarkup(createElement(ThresholdTemplates, props));
  const currentTable = html.slice(
    html.indexOf('<table'),
    html.indexOf('</table>'),
  );
  assert.match(currentTable, /0\.6 ≤ 系数 ≤ 0\.7/);
  assert.match(currentTable, /0\.4 ≤ 系数 ≤ 0\.5/);
  assert.ok(html.includes('等级阈值模板'));
  assert.ok(!html.includes('threshold-template-confirmed'));
  assert.ok(!html.includes('另存模板名称'));
  assert.ok(html.includes('0.3 &lt; 系数 &lt; 0.4'));
  config.dimensions.forEach((d) => {
    d.rules = continuousRules();
  });
  config.thresholdsConfirmed = true;
  const updated = renderToStaticMarkup(
    createElement(ThresholdTemplates, { ...props, locked: false }),
  );
  assert.ok(updated.includes('已确认且区间完整'));
  assert.ok(updated.includes('0.6 ≤ 系数 &lt; 0.8'));
  assert.ok(!updated.includes('当前已保存规则的具体空档'));
});
test('删除入口包含具体模板名、二次确认和版本；教学套卷与行政服务分组且有离开保护', () => {
  const library = readFileSync('components/template-library.tsx', 'utf8');
  assert.ok(library.includes('删除模板'));
  assert.ok(library.includes('current.name'));
  assert.ok(library.includes('confirmDelete: true'));
  assert.ok(library.includes('revision: current.revision'));
  const admin = readFileSync('components/admin.tsx', 'utf8');
  assert.ok(admin.includes("group: '教学支撑'"));
  assert.ok(admin.includes("group: '行政服务'"));
  assert.ok(admin.includes("tab === 'papers' &&"));
  assert.ok(admin.includes('paperDirty'));
  assert.ok(!admin.includes('维度与评价'));
  assert.ok(!admin.includes('查看当前阈值 / 管理等级阈值模板'));
});
test('阈值输入框与实际保存值一致，不在旧值之上绘制新值', () => {
  const rules = defaultConfig().dimensions[0].rules;
  const old = renderToStaticMarkup(
    createElement(ThresholdEditor, {
      rules,
      onChange: () => {},
      disabled: false,
      idPrefix: 'test',
    }),
  );
  assert.match(old, /id="test-upper-1"[^>]*value="0.7"/);
  assert.ok(old.includes('0.6 ≤ 系数 ≤'));
  assert.deepEqual(ruleGaps(rules), [
    '0.3 < 系数 < 0.4',
    '0.5 < 系数 < 0.6',
    '0.7 < 系数 < 0.8',
  ]);
  const good = continuousRules();
  assert.deepEqual(ruleGaps(good), []);
  assert.deepEqual(ruleGaps(continuousRules([0.9, 0.7, 0.5])), []);
  const updated = renderToStaticMarkup(
    createElement(ThresholdEditor, {
      rules: good,
      onChange: () => {},
      disabled: false,
      idPrefix: 'test',
    }),
  );
  assert.match(updated, /id="test-upper-1"[^>]*value="0.8"/);
});
test('分析、评价默认只展示模板选择，编辑与Excel导入不铺开', () => {
  const props = {
    config: defaultConfig(),
    revision: 1,
    count: 0,
    locked: false,
    parentDirty: false,
    busy: false,
    templates: [],
    reload: async () => {},
    act: async () => {},
    onApplied: async () => {},
    onDirtyChange: () => {},
  };
  const analysis = renderToStaticMarkup(createElement(AnalysisEditor, props));
  assert.ok(analysis.includes('载入并编辑'));
  assert.ok(!analysis.includes('01 · 试卷Part与得分上限'));
  assert.ok(!analysis.includes('另存模板名称'));
  const evaluation = renderToStaticMarkup(
    createElement(EvaluationTemplates, {
      ...props,
      dirty: false,
      edit: () => {},
      editing: false,
      onStart: () => {},
      onClose: () => {},
    }),
  );
  assert.ok(evaluation.includes('通过Excel批量导入评价'));
  assert.ok(!evaluation.includes('type="file"'));
  assert.ok(!evaluation.includes('另存模板名称'));
});
