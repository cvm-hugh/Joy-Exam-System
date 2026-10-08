'use strict';
const { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');

const TITLE = '佳音考试管理';
const URLS = { scanner: 'http://127.0.0.1:8510/', results: 'http://127.0.0.1:3010/' };
const token = randomBytes(32).toString('hex');
const children = new Set();
const reservedDownloads = new Set();
const loadingViews = new Map();
let window, views = {}, selected = 'scanner', ready = false, quitting = false, stopped = false, fatalShown = false, exportSession = null, logStream;
let runtimeRoot;

app.setName(TITLE);
app.setPath('userData', path.join(app.getPath('appData'), TITLE));
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });

function writeLog(text) { if (logStream && !logStream.writableEnded && !logStream.destroyed) logStream.write(text); }
function log(text) { writeLog(`[${new Date().toISOString()}] ${text}\n`); }
function status(text) { if (window && !window.isDestroyed()) window.webContents.send('joy-status', text); }
function safeName(value) {
  let name = path.basename(String(value || '导出文件')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  if (!name || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + (name || '导出文件');
  return name;
}
function availablePath(directory, name, directoryOnly = false) {
  const ext = directoryOnly ? '' : path.extname(name), base = directoryOnly ? name : path.basename(name, ext);
  for (let n = 0; n < 10000; n++) {
    const candidate = path.join(directory, n ? `${base} (${n})${ext}` : name);
    if (!fs.existsSync(candidate) && !reservedDownloads.has(candidate)) { reservedDownloads.add(candidate); return candidate; }
  }
  throw new Error('无法生成可用的导出文件名');
}
function localUrl(value) {
  try { const u = new URL(value); return u.protocol === 'http:' && u.hostname === '127.0.0.1' && ['8510', '3010'].includes(u.port); } catch { return false; }
}
function allowedSender(event, kind) {
  if (kind === 'shell') return event.sender === window?.webContents;
  return event.sender === views[kind]?.webContents && localUrl(event.senderFrame?.url || '');
}
function bounds() {
  if (!window) return;
  const { width, height } = window.getContentBounds();
  for (const view of Object.values(views)) view.setBounds({ x: 0, y: 52, width, height: Math.max(1, height - 52) });
}
async function loadStage(stage) {
  selected = stage;
  if (!ready) { status('本地服务正在启动，请稍等。'); return; }
  const view = views[stage];
  for (const candidate of Object.values(views)) candidate.setVisible(candidate === view);
  bounds();
  window.setTitle(`${TITLE} · ${stage === 'scanner' ? '阅卷' : '结果管理'}`);
  window.webContents.send('joy-stage-active', stage);
  if (!view.webContents.getURL() && !loadingViews.has(stage)) {
    const loading = view.webContents.loadURL(stage === 'results' ? URLS.results + 'api/desktop/session' : URLS.scanner,
      stage === 'results' ? { extraHeaders: `X-Joy-Desktop-Token: ${token}\n` } : {});
    loadingViews.set(stage, loading);
    try { await loading; } catch (error) { if (error.code !== 'ERR_ABORTED' && error.errno !== -3) throw error; }
    finally { loadingViews.delete(stage); }
  }
}
function configureView(view) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (localUrl(url)) void view.webContents.loadURL(url);
    else if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => { if (!localUrl(url)) { event.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url); } });
  view.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (mainFrame && code !== -3 && !quitting) { log(`页面加载失败 ${code}: ${description} ${url}`); status('页面加载失败，请从菜单重新加载页面。'); }
  });
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`端口 ${port} 已被使用，请关闭其他考试管理程序后重试。`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function startProcess(binary, args, cwd, env) {
  const stdio = binary === process.execPath ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'];
  const child = spawn(binary, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio });
  children.add(child);
  child.stdout.on('data', writeLog);
  child.stderr.on('data', writeLog);
  child.once('error', (error) => { log(error.stack); if (!quitting) void fatal(error.message); });
  child.once('exit', (code) => { children.delete(child); if (!quitting) void fatal(`本地服务已停止（${code ?? '未知状态'}）。请关闭后重新打开。`); });
  return child;
}
async function healthy(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); return response.ok; } catch { return false; }
}
async function startServices() {
  if (process.platform !== 'win32') throw new Error('此桌面入口用于 Windows 10/11 64 位。');
  await Promise.all([freePort(8510), freePort(3010)]);
  const bundle = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'build/runtime');
  const python = path.join(bundle, 'python/python.exe');
  const scanner = path.join(bundle, 'scanner');
  const results = path.join(bundle, 'results');
  for (const file of [python, path.join(scanner, 'app/scan_ui.py'), path.join(results, 'scripts/start-node.mjs')]) {
    if (!fs.existsSync(file)) throw new Error('安装包缺少运行文件，请重新下载完整安装包。');
  }
  status('正在启动阅卷与结果管理…');
  startProcess(process.execPath, [path.join(results, 'scripts/start-node.mjs')], results,
    { ELECTRON_RUN_AS_NODE: '1', JOY_MERGE_RUNTIME_ROOT: runtimeRoot, DESKTOP_BRIDGE_TOKEN: token, HOST: '127.0.0.1', PORT: '3010' });
  startProcess(python, ['-B', '-m', 'streamlit', 'run', 'app/scan_ui.py', '--server.address', '127.0.0.1', '--server.port', '8510', '--server.headless', 'true', '--browser.gatherUsageStats', 'false'], scanner,
    { PYTHONHOME: path.join(bundle, 'python'), PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: scanner,
      DINGWEICE_DATA_DIR: path.join(runtimeRoot, 'scanner'), DINGWEICE_PORT: '8510', DINGWEICE_HEADLESS: '1', RESULTS_BRIDGE_URL: URLS.results + 'api/desktop/handoff', RESULTS_BRIDGE_TOKEN: token });
  const deadline = Date.now() + 120000;
  while (!quitting && !fatalShown && Date.now() < deadline) {
    if ((await Promise.all([healthy(URLS.scanner + '_stcore/health'), healthy(URLS.results + 'api/health')])).every(Boolean)) {
      ready = true;
      await loadStage(selected);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!quitting && !fatalShown) throw new Error('本地服务启动超时。请打开数据目录中的 logs 查看启动日志。');
}
async function fatal(message) {
  if (quitting || fatalShown) return;
  fatalShown = true;
  log(message); status(message);
  if (window) { for (const view of Object.values(views)) view.setVisible(false); }
  await dialog.showMessageBox(window, { type: 'error', title: TITLE, message, detail: `日志与考试数据保存在：${runtimeRoot}`, buttons: ['关闭程序', '打开数据目录'] }).then(({ response }) => { if (response === 1) void shell.openPath(runtimeRoot); });
  app.quit();
}
async function exportControl(message) {
  if (!message || typeof message !== 'object') return false;
  if (message.action === 'end') { exportSession = null; return true; }
  if (message.action !== 'begin' || exportSession) return false;
  const current = { destination: null };
  exportSession = current;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { title: '选择学生成绩报告保存位置', properties: ['openDirectory', 'createDirectory'] });
    if (canceled || !filePaths[0]) { exportSession = null; views.results.webContents.send('joy-export-cancelled'); return false; }
    let destination = filePaths[0];
    if (message.createBatchFolder === true) { destination = availablePath(destination, safeName(message.folderName || '学生成绩报告'), true); fs.mkdirSync(destination); }
    current.destination = destination;
    return true;
  } catch (error) { log(error.message); exportSession = null; views.results.webContents.send('joy-export-cancelled'); return false; }
}
function installDownloads(browserSession) {
  browserSession.on('will-download', (_event, item, contents) => {
    if (contents !== views.results?.webContents && contents !== views.scanner?.webContents) { item.cancel(); return; }
    const name = safeName(item.getFilename());
    const group = exportSession;
    if (!group || contents !== views.results?.webContents) {
      item.setSaveDialogOptions({ title: '保存导出文件', defaultPath: path.join(app.getPath('downloads'), name) });
    } else {
      if (!group.destination || quitting) { item.cancel(); return; }
      try { item.setSavePath(availablePath(group.destination, name)); }
      catch (error) { log(error.message); item.cancel(); }
    }
    item.once('done', (_done, state) => {
      if (state === 'interrupted') { log(`下载未完成：${name}`); if (!quitting) void dialog.showMessageBox(window, { type: 'error', message: `文件未能保存：${name}。请重新导出。` }); }
    });
  });
}
async function stopServices() {
  const active = [...children];
  for (const child of active) { try { if (child.connected) child.send({ type: 'joy-shutdown' }); } catch {} }
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await Promise.all(active.filter((child) => child.exitCode === null && child.pid).map((child) => new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('exit', resolve); killer.once('error', () => { child.kill(); resolve(); });
  })));
  logStream?.end();
}
app.on('before-quit', (event) => {
  if (stopped) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void stopServices().finally(() => { stopped = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(async () => {
  runtimeRoot = path.join(app.getPath('userData'), 'runtime');
  fs.mkdirSync(path.join(runtimeRoot, 'logs'), { recursive: true });
  logStream = fs.createWriteStream(path.join(runtimeRoot, 'logs/desktop.log'), { flags: 'a' });
  logStream.on('error', (error) => { status(`无法写入应用日志：${error.message}`); });
  window = new BrowserWindow({ width: 1320, height: 900, minWidth: 900, minHeight: 650, title: TITLE,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'app-icon.png') : path.join(__dirname, '../assets/app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const browserSession = session.fromPartition('persist:joy-exam-desktop');
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  for (const stage of ['scanner', 'results']) {
    const view = new WebContentsView({ webPreferences: { session: browserSession, preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    views[stage] = view; window.contentView.addChildView(view); view.setVisible(false); configureView(view);
  }
  window.on('resize', bounds); bounds(); installDownloads(browserSession);
  ipcMain.on('joy-stage', (event, stage) => { if (['scanner', 'results'].includes(stage) && (allowedSender(event, 'shell') || allowedSender(event, 'scanner'))) void loadStage(stage).catch((error) => fatal(error.message)); });
  ipcMain.on('joy-open-data', (event) => { if (allowedSender(event, 'shell')) void shell.openPath(runtimeRoot); });
  ipcMain.handle('joy-export-session', (event, message) => allowedSender(event, 'results') ? exportControl(message) : false);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '打开数据目录', click: () => void shell.openPath(runtimeRoot) }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '查看', submenu: [{ label: '重新加载当前页面', accelerator: 'CmdOrCtrl+R', click: () => views[selected]?.webContents.reload() }, { role: 'togglefullscreen', label: '全屏' }] },
  ]));
  await window.loadFile(path.join(__dirname, 'shell.html'));
  await startServices();
}).catch((error) => fatal(error.message));
