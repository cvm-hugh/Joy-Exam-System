import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { FilesystemBucket, SqliteDatabase } from './node-storage.mjs';
import { initializeSchema } from './schema.mjs';

const environmentKey = Symbol.for('joy.results.node.environment');

function runtimeRoot() {
  const supplied = process.env.JOY_MERGE_RUNTIME_ROOT;
  if (!supplied || !isAbsolute(supplied))
    throw new Error('JOY_MERGE_RUNTIME_ROOT must name an absolute per-user data directory');
  return resolve(supplied);
}

async function localConfiguration(directory) {
  const configPath = join(directory, 'env.json');
  try {
    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    if (saved.version !== 1 || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(saved.ADMIN_CREDENTIAL) ||
        !['true', 'false'].includes(saved.DEMO_MODE) ||
        !['true', 'false'].includes(saved.ALLOW_FORMAL_PUBLISH))
      throw new Error('Local results configuration is invalid; existing credentials were preserved');
    return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const password = randomBytes(18).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  const config = {
    version: 1, ADMIN_CREDENTIAL: `${salt}:${hash}`,
    DEMO_MODE: 'false', ALLOW_FORMAL_PUBLISH: 'true',
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return localConfiguration(directory);
    throw error;
  }
  await writeFile(join(directory, 'admin-login.txt'),
    `佳音考试管理本地后台\n网址：http://127.0.0.1:3010/\n管理员口令：${password}\n\n此口令仅用于本机，勿上传或沿用到其他环境。\n`,
    { mode: 0o600, flag: 'wx' });
  return config;
}

async function createEnvironment(root) {
  const directory = join(root, 'results');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configuration = await localConfiguration(join(directory, '.local'));
  const db = new SqliteDatabase(join(directory, 'results.sqlite'));
  try {
    await initializeSchema(db);
    return {
      DB: db, FILES: new FilesystemBucket(join(directory, 'files')),
      ADMIN_CREDENTIAL: configuration.ADMIN_CREDENTIAL,
      DEMO_MODE: configuration.DEMO_MODE,
      ALLOW_FORMAL_PUBLISH: configuration.ALLOW_FORMAL_PUBLISH,
      DESKTOP_BRIDGE_TOKEN: process.env.DESKTOP_BRIDGE_TOKEN,
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function getNodeEnvironment() {
  const root = runtimeRoot();
  const current = globalThis[environmentKey];
  if (current && current.root !== root)
    throw new Error('The results runtime data directory cannot change while the server is running');
  if (current) return current.promise;
  const promise = createEnvironment(root);
  globalThis[environmentKey] = { root, promise };
  promise.catch(() => {
    if (globalThis[environmentKey]?.promise === promise) delete globalThis[environmentKey];
  });
  return promise;
}
