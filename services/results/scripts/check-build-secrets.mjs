import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const runtime = resolve(process.argv[2] || fileURLToPath(new URL('../../../runtime/', import.meta.url)));
const varsPath = join(runtime, '.dev.vars');
assert.ok(existsSync(varsPath), '请先运行合并根目录的 npm run setup。');
const secrets = readFileSync(varsPath, 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('ADMIN_CREDENTIAL='))
  .map((line) => line.slice(line.indexOf('=') + 1).replaceAll('"', '').trim())
  .filter(Boolean);
const loginPath = join(runtime, '.local/admin-login.txt');
if (existsSync(loginPath)) {
  const password = readFileSync(loginPath, 'utf8').match(/管理员口令：([^\n]+)/)?.[1];
  if (password) secrets.push(password);
}
assert.ok(secrets.length, '未找到可检查的管理员配置。');
let count = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else {
      count++;
      const text = readFileSync(path).toString();
      assert.ok(secrets.every((secret) => !text.includes(secret)), `构建文件意外包含本地凭证：${path}`);
    }
  }
}
walk(fileURLToPath(new URL('../dist/', import.meta.url)));
console.log(`已检查 ${count} 个构建文件，未包含本地管理员口令或凭证哈希。`);
