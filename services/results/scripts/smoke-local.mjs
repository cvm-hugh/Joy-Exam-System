// Read-only business checks: never import, publish, save configuration, or replace students.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base = process.env.JOY_BASE_URL || 'http://127.0.0.1:3010';
const credential = readFileSync(process.env.JOY_ADMIN_LOGIN_FILE || fileURLToPath(new URL('../../../runtime/.local/admin-login.txt', import.meta.url)), 'utf8').match(
  /管理员口令：([^\n]+)/,
)?.[1];
assert.ok(credential, '请先运行 npm run setup');
let cookie = '';
async function call(path, method = 'GET', data, auth = true) {
  const headers = { 'x-exam-request': '1' };
  if (auth && cookie) headers.cookie = cookie;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(base + '/api/' + path, {
    method,
    headers,
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
}
assert.equal((await call('admin/state', 'GET', undefined, false)).status, 401);
const login = await call('admin/login', 'POST', { password: credential });
assert.equal(login.status, 200, '本地管理员登录失败');
cookie = login.headers.get('set-cookie').split(';')[0];
try {
  const before = await (await call('admin/state')).json();
  assert.equal((await call('admin/templates')).status, 200);
  for (const route of [
    'admin/template?format=xlsx',
    'admin/template?format=csv',
    'admin/evaluation-template',
    'admin/evaluation-template?filled=1',
  ]) {
    const r = await call(route);
    assert.equal(r.status, 200);
    assert.ok((await r.arrayBuffer()).byteLength > 20);
  }
  const list = await (await call('admin/students')).json();
  if (list.students.length) {
    const { name, examNo } = list.students[0];
    const r = await call('admin/preview', 'POST', { name, examNo });
    assert.equal(r.status, 200);
    const result = await r.json();
    assert.equal(result.dimensions.length, 6);
    for (const key of ['scores', 'total', 'examNo', 'rank'])
      assert.ok(!(key in result));
  }
  const after = await (await call('admin/state')).json();
  assert.deepEqual(after, before, '检查期间状态发生变化，请核对是否有人工操作');
  console.log(
    `本地HTTP只读检查通过：${before.count}名学生，模板下载、模板库、后台结果预览可用；成绩、配置、发布状态未修改。`,
  );
} finally {
  await call('admin/logout', 'POST');
}
