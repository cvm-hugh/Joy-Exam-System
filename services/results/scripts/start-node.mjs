import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13))
  throw new Error('佳音考试管理本地结果服务需要 Node.js 22.13 或以上版本');

const entryDirectory = dirname(fileURLToPath(import.meta.url));
const standaloneRoot = existsSync(join(entryDirectory, '.joy-local-node.json'))
  ? entryDirectory : resolve(entryDirectory, '../dist/standalone');
if (!existsSync(join(standaloneRoot, '.joy-local-node.json')) ||
    !existsSync(join(standaloneRoot, 'dist/server/index.js')))
  throw new Error('缺少本地 Node 构建，请先在结果服务目录运行 npm run build:local');

// The packaged service always binds to this loopback endpoint.
process.env.NODE_ENV = 'production';
process.env.HOST = '127.0.0.1';
process.env.PORT = '3010';
process.chdir(standaloneRoot);

const { getNodeEnvironment } = await import(pathToFileURL(join(standaloneRoot, 'local-runtime/node-environment.mjs')).href);
const environment = await getNodeEnvironment();
const { startProdServer } = await import(pathToFileURL(join(standaloneRoot, 'node_modules/vinext/dist/server/prod-server.js')).href);
const { server } = await startProdServer({
  host: '127.0.0.1', port: 3010, outDir: join(standaloneRoot, 'dist'),
});
console.log('[joy-results] Ready at http://127.0.0.1:3010');

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => {
    environment.DB.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    environment.DB.close();
    process.exit(0);
  }, 5000);
  deadline.unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('message', (message) => {
  if (message && typeof message === 'object' && message.type === 'joy-shutdown') shutdown();
});
