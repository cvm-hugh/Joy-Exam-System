import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers';
import { validateRows } from '../lib/importer';
import { demoRows } from './fixtures';
import { HEADERS } from '../lib/domain';
import { Conflict } from '../lib/store';
test('整批替换不混入旧成绩，同名不同考号可区分', async (t) => {
  const { DB, store } = await fixture();
  t.after(() => DB.sqlite.close());
  const s = validateRows([HEADERS, ...demoRows()]);
  await store.replace(s, 0, true);
  assert.equal((await store.state()).count, 3);
  await store.replace([{ ...s[0], examNo: '009999' }], 1, true);
  assert.equal((await store.state()).count, 1);
  assert.equal(await store.student(s[0].name, s[0].examNo), null);
  assert.ok(await store.student(s[0].name, '009999'));
});
test('数据库中途失败整批回滚，旧数据及版本保留', async (t) => {
  const { DB, store } = await fixture();
  t.after(() => DB.sqlite.close());
  const s = validateRows([HEADERS, ...demoRows()]);
  await store.replace(s, 0, true);
  await assert.rejects(() => store.replace([s[0], s[0]], 1, true));
  assert.equal((await store.state()).count, 3);
  assert.equal((await store.state()).revision, 1);
  assert.ok(await store.student(s[2].name, s[2].examNo));
});
test('旧版本导入不会清空、覆盖新批次', async (t) => {
  const { DB, store } = await fixture();
  t.after(() => DB.sqlite.close());
  const s = validateRows([HEADERS, ...demoRows()]);
  await store.replace(s, 0, true);
  await assert.rejects(() => store.replace([s[0]], 0, true), Conflict);
  assert.equal((await store.state()).count, 3);
});
test('开放期间禁止替换、改配置；关闭后可改', async (t) => {
  const { DB, store } = await fixture();
  t.after(() => DB.sqlite.close());
  const s = validateRows([HEADERS, ...demoRows()]);
  await store.replace(s, 0, true);
  await store.publish('demo', 1);
  const state = await store.state();
  await assert.rejects(() => store.replace(s, state.revision, true), Conflict);
  await assert.rejects(
    () => store.saveConfig(state.config, state.revision),
    Conflict,
  );
  await store.publish('closed', state.revision);
  await store.saveConfig(state.config, state.revision + 1);
});
test('精确查询按考号主键索引，SQL特殊字符无法扩大查询', async (t) => {
  const { DB, store } = await fixture();
  t.after(() => DB.sqlite.close());
  await store.replace(validateRows([HEADERS, ...demoRows()]), 0, true);
  assert.equal(await store.student("' OR 1=1 --", '000001'), null);
  assert.equal(await store.student('测试乙', '000001'), null);
  const plan = DB.sqlite
    .prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM students WHERE exam_no=? AND name=?',
    )
    .all('000001', '测试甲');
  assert.ok(JSON.stringify(plan).includes('INDEX'));
});
