import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyStandaloneDependencies } from '../services/results/scripts/standalone-dependencies.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows 包需在 Windows x64 构建环境生成。');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'desktop/windows');
const stage = join(desktop, 'build/runtime');
const results = join(root, 'services/results');
const python = process.env.JOY_WINDOWS_PYTHON || 'python';
const npmCLI = process.env.npm_execpath;
if (!npmCLI || !existsSync(npmCLI)) throw new Error('请通过 npm run desktop:build:windows 运行。');

function run(binary, args, cwd = root, env = {}) {
  const result = spawnSync(binary, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary} 执行失败：${result.status}`);
}
function npm(args, cwd = root, env = {}) { run(process.execPath, [npmCLI, ...args], cwd, env); }
function capture(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  return result.stdout.trim();
}
function copy(source, destination) { if (!existsSync(source)) throw new Error(`缺少构建资源：${source}`); cpSync(source, destination, { recursive: true, dereference: true }); }
function sha(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

const metadata = JSON.parse(capture(python, ['-c', 'import json,sys; print(json.dumps({"root":sys.base_prefix,"version":sys.version.split()[0],"bits":64 if sys.maxsize>2**32 else 32}))']));
if (!metadata.version.startsWith('3.12.') || metadata.bits !== 64) throw new Error('构建需要 Python 3.12 x64。');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const desktopMetadata = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
if (desktopMetadata.version !== version) throw new Error('桌面包与根目录版本号不一致。');

npm(['run', 'typecheck'], results);
npm(['run', 'lint'], results);
npm(['run', 'build:local'], results);
// This is a disposable build directory. Application data is never copied here.
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'python'), { recursive: true });
for (const name of readdirSync(metadata.root)) {
  if (/^(?:pythonw?\.exe|python(?:3|312)\.dll)$/i.test(name) || /^(?:vcruntime|msvcp|concrt).*\.dll$/i.test(name)) copy(join(metadata.root, name), join(stage, 'python', name));
  if (/^license(?:\.txt)?$/i.test(name)) copy(join(metadata.root, name), join(stage, 'python', name));
}
copy(join(metadata.root, 'DLLs'), join(stage, 'python/DLLs'));
cpSync(join(metadata.root, 'Lib'), join(stage, 'python/Lib'), { recursive: true, dereference: true, filter: (source) => {
  const relative = source.slice(join(metadata.root, 'Lib').length).replaceAll('\\', '/');
  return !/^\/(site-packages|test|idlelib|tkinter)(\/|$)/.test(relative) && !/(^|\/)__pycache__(\/|$)|\.pyc$/.test(relative);
} });
// Native image/array extensions require the app-local MSVC runtime.
for (const name of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'concrt140.dll']) {
  const source = join(process.env.SystemRoot || 'C:/Windows', 'System32', name);
  if (existsSync(source) && !existsSync(join(stage, 'python', name))) copy(source, join(stage, 'python', name));
}
run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:', '--target', join(stage, 'python/Lib/site-packages'), '-r', join(root, 'services/scanner/requirements-lock.txt')]);
mkdirSync(join(stage, 'scanner'), { recursive: true });
copy(join(root, 'services/scanner/app'), join(stage, 'scanner/app'));
copy(join(root, 'services/scanner/resources'), join(stage, 'scanner/resources'));
mkdirSync(join(stage, 'results/scripts'), { recursive: true });
copy(join(results, 'scripts/start-node.mjs'), join(stage, 'results/scripts/start-node.mjs'));
copy(join(results, 'dist/standalone'), join(stage, 'results/dist/standalone'));
const resultDependencies = verifyStandaloneDependencies(join(stage, 'results/dist/standalone'));
console.log('Packaged result dependencies:', JSON.stringify(resultDependencies));
writeFileSync(join(stage, 'results/package.json'), JSON.stringify({ type: 'module', version }, null, 2) + '\n');
writeFileSync(join(stage, 'build-manifest.json'), JSON.stringify({ application: '佳音考试管理', version, architecture: 'x64',
  target: ['Windows 10', 'Windows 11'], python: metadata.version, electron: desktopMetadata.devDependencies.electron,
  commit: capture('git', ['rev-parse', 'HEAD']), resultDependencies, scannerLockSha256: sha(join(root, 'services/scanner/requirements-lock.txt')) }, null, 2) + '\n');
npm(['run', 'check'], desktop);
npm(['run', 'package'], desktop, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
const output = join(root, 'output/windows');
const artifacts = readdirSync(output).filter((name) => name.endsWith('.exe') || name.endsWith('.zip')).sort();
if (!artifacts.some((name) => name.endsWith('-Setup.exe')) || !artifacts.some((name) => name.endsWith('.zip'))) throw new Error('Windows 构建产物不完整。');
writeFileSync(join(output, 'SHA256SUMS.txt'), artifacts.map((name) => `${sha(join(output, name))}  ${name}\n`).join(''));
copy(join(stage, 'build-manifest.json'), join(output, 'build-manifest.json'));
run(python, [join(root, 'scripts/inspect-windows-package.py'), output, version]);
console.log(`Windows 安装程序与便携包已生成：${output}`);
