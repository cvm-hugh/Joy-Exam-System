import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MANIFEST = 'runtime-dependencies.json';
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const portablePath = (path) => path.split(sep).join('/');

function inside(root, path) {
  const location = relative(root, path);
  if (!location || isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) {
    throw new Error(`运行依赖超出独立目录：${path}`);
  }
  return location;
}

// Read metadata without executing dependency code. Node's search paths preserve
// nested package versions, including the ones selected by package-lock overrides.
function packageJsonPath(name, importer) {
  const resolver = createRequire(join(importer, 'package.json'));
  for (const directory of resolver.resolve.paths(`${name}/package.json`) || []) {
    const candidate = join(directory, name, 'package.json');
    if (existsSync(candidate) && readJson(candidate).name === name) return candidate;
  }
  return null;
}

export function completeStandaloneDependencies(sourceRoot, standaloneRoot) {
  sourceRoot = resolve(sourceRoot);
  standaloneRoot = resolve(standaloneRoot);
  const sourceModules = realpathSync(join(sourceRoot, 'node_modules'));
  const targetModules = join(standaloneRoot, 'node_modules');
  const external = readJson(join(standaloneRoot, 'dist/server/vinext-externals.json'));
  if (!Array.isArray(external) || !external.includes('exceljs')) {
    throw new Error('Node 结果服务必须将 ExcelJS 作为完整运行依赖打包');
  }
  const seeds = [...new Set(['vinext', 'react', 'react-dom', 'react-server-dom-webpack', ...external])].sort((a, b) => a.localeCompare(b));
  const queue = seeds.map((name) => ({ name, importer: sourceRoot, optional: false }));
  const packages = new Map();
  while (queue.length) {
    const request = queue.shift();
    const sourceJson = packageJsonPath(request.name, request.importer);
    if (!sourceJson) {
      if (request.optional) continue;
      throw new Error(`缺少必需运行依赖 ${request.name}（来源：${request.importer}）`);
    }
    const packageRoot = dirname(realpathSync(sourceJson));
    const location = inside(sourceModules, packageRoot);
    if (packages.has(location)) continue;
    const metadata = readJson(sourceJson);
    const optional = metadata.optionalDependencies || {};
    const dependencies = Object.keys({ ...metadata.dependencies, ...optional }).sort((a, b) => a.localeCompare(b)).map((name) => {
      const dependencyJson = packageJsonPath(name, packageRoot);
      if (!dependencyJson && !(name in optional)) throw new Error(`缺少 ${metadata.name} 的必需依赖 ${name}`);
      return { name, optional: name in optional,
        path: dependencyJson ? portablePath(inside(sourceModules, dirname(realpathSync(dependencyJson)))) : null };
    });
    packages.set(location, { source: packageRoot, name: metadata.name, version: metadata.version,
      path: portablePath(location), dependencies });
    for (const dependency of dependencies) if (dependency.path) queue.push({
      name: dependency.name, importer: packageRoot, optional: dependency.optional,
    });
  }
  // vinext's flattened copy can collapse two different versions of a package.
  // Recreate only this disposable build tree using the installed npm layout.
  rmSync(targetModules, { recursive: true, force: true });
  mkdirSync(targetModules, { recursive: true });
  const ordered = [...packages.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of ordered) {
    cpSync(entry.source, join(targetModules, entry.path), { recursive: true, dereference: true,
      filter: (path) => !relative(entry.source, path).split(sep).includes('node_modules') });
  }
  const manifest = { format: 1, seeds, packages: ordered.map(({ source: _source, ...entry }) => entry) };
  writeFileSync(join(standaloneRoot, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return verifyStandaloneDependencies(standaloneRoot);
}

export function verifyStandaloneDependencies(standaloneRoot) {
  standaloneRoot = resolve(standaloneRoot);
  const targetModules = realpathSync(join(standaloneRoot, 'node_modules'));
  const manifest = readJson(join(standaloneRoot, MANIFEST));
  if (manifest.format !== 1 || !Array.isArray(manifest.packages) || !manifest.packages.length) {
    throw new Error('结果服务的运行依赖清单无效');
  }
  const declared = new Set(manifest.packages.map((entry) => entry.path));
  for (const entry of manifest.packages) {
    const packageRoot = resolve(targetModules, entry.path);
    inside(targetModules, packageRoot);
    const metadata = readJson(join(packageRoot, 'package.json'));
    if (metadata.name !== entry.name || metadata.version !== entry.version) {
      throw new Error(`运行依赖版本不匹配：${entry.name}`);
    }
    for (const dependency of entry.dependencies) {
      const found = packageJsonPath(dependency.name, packageRoot);
      if (!dependency.path) {
        if (!dependency.optional) throw new Error(`必需依赖被遗漏：${dependency.name}`);
        continue;
      }
      if (!found || !declared.has(dependency.path) ||
          portablePath(inside(targetModules, dirname(realpathSync(found)))) !== dependency.path) {
        throw new Error(`运行依赖缺失或版本位置错误：${entry.name} → ${dependency.name}`);
      }
    }
  }
  for (const name of manifest.seeds) {
    const found = packageJsonPath(name, standaloneRoot);
    if (!found || !declared.has(portablePath(inside(targetModules, dirname(realpathSync(found)))))) {
      throw new Error(`入口运行依赖缺失：${name}`);
    }
  }
  // Check the original failure without loading modules or creating user data.
  const excel = packageJsonPath('exceljs', standaloneRoot);
  const unzipper = excel && packageJsonPath('unzipper', dirname(excel));
  const fstream = unzipper && packageJsonPath('fstream', dirname(unzipper));
  const rimraf = fstream && packageJsonPath('rimraf', dirname(fstream));
  if (!rimraf || !declared.has(portablePath(inside(targetModules, dirname(realpathSync(rimraf)))))) {
    throw new Error('ExcelJS → unzipper → fstream → rimraf 的运行依赖未完整打包');
  }
  return { packages: manifest.packages.length, exceljsRimraf: 'present', nestedVersions: 'preserved' };
}
