import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { completeStandaloneDependencies } from './standalone-dependencies.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules/vinext/dist/cli.js');
if (!existsSync(cli)) throw new Error('请先安装结果服务的本项目依赖');
const result = spawnSync(process.execPath, [cli, 'build'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, JOY_RESULTS_TARGET: 'node' },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const standalone = join(root, 'dist/standalone');
const dependencies = completeStandaloneDependencies(root, standalone);
console.log('Standalone runtime dependencies:', JSON.stringify(dependencies));
cpSync(join(root, 'local-runtime'), join(standalone, 'local-runtime'), { recursive: true });
cpSync(join(root, 'scripts/start-node.mjs'), join(standalone, 'joy-server.mjs'));
// The conventional standalone entry also enforces the desktop loopback host.
cpSync(join(root, 'scripts/start-node.mjs'), join(standalone, 'server.js'));
writeFileSync(join(standalone, '.joy-local-node.json'), JSON.stringify({ target: 'node', minimumNode: '22.13.0' }) + '\n');
console.log('Local Node entry: dist/standalone/joy-server.mjs');
