import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['.git', '.local', '.venv', '.wrangler', '.next', '.vinext', 'node_modules', 'runtime', 'output', 'outputs', 'dist', 'build', 'docs', '__pycache__', 'coverage']);
const codeExtensions = /\.(?:py|sh|swift|ts|tsx|js|cjs|mjs|json|html|yaml|yml)$/;
const oldWorkspacePath = /\/Users\/contiference\/Documents\/ChatGPT\//;
const issues = [];
let count = 0;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      issues.push(`源码中存在软链接：${relative(root, path)}`);
    } else if (entry.isDirectory()) {
      walk(path);
    } else if (codeExtensions.test(entry.name)) {
      count++;
      if (oldWorkspacePath.test(readFileSync(path, 'utf8'))) {
        issues.push(`源码仍引用旧工作区：${relative(root, path)}`);
      }
    }
  }
}
walk(root);
for (const path of ['.venv', 'node_modules', 'services/results/node_modules']) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) issues.push(`缺少本项目依赖：${path}；请运行 npm run setup`);
  else if (lstatSync(absolute).isSymbolicLink()) issues.push(`依赖仍为共享软链接：${path}`);
}
assert.equal(issues.length, 0, issues.join('\n'));
console.log(`已检查 ${count} 个源码和配置文件；未发现旧工作区路径或共享依赖链接。`);
