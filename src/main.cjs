const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen, shell, dialog, desktopCapturer, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { OpggProvider, BASE } = require('./core/opgg.cjs');
const { LeagueReader } = require('./core/league.cjs');
const { OcrReader } = require('./core/ocr.cjs');
const { DEFAULTS, validateSettings, overlayBounds } = require('./core/settings.cjs');

const smoke = process.argv.includes('--smoke-test');
app.setName('Hexthon');
if (smoke) app.setPath('userData', path.resolve(__dirname, '../.qa/profile'));
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start).catch(e => { console.error(e.stack || e.message); app.exit(1); });

let panel, overlay, tray, provider, reader, ocr, timer, quitting = false, manualOverlay = null, loadSerial = 0, lastScan = 0;
let settings = { ...DEFAULTS };
let state = { version: '0.1.0', catalog: null, selectedChampion: null, augments: [], builds: [],
  augmentMeta: null, buildMeta: null, game: { phase: 'Disconnected', lcuConnected: false, liveConnected: false },
  offeredIds: [], ocr: { status: 'idle', matches: [], text: '' }, overlayVisible: false,
  loading: false, error: '', shortcuts: {}, modeConfirmed: false, displays: [], imageAssets: {} };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const snapshot = () => ({ ...state, settings });
function publish() {
  for (const win of [panel, overlay]) if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('state', snapshot());
}
async function saveSettings(patch) {
  const oldPath = settings.leaguePath;
  settings = validateSettings(patch, settings);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsFile() + '.tmp', JSON.stringify(settings, null, 2));
  await fs.rename(settingsFile() + '.tmp', settingsFile());
  if (oldPath !== settings.leaguePath) reader.reset();
  positionOverlay(); updateOverlay(); publish();
}
function protect(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
}
function positionOverlay() {
  const displays = screen.getAllDisplays();
  state.displays = displays.map((d, i) => ({ id: d.id, label: `显示器 ${i + 1} · ${d.size.width} × ${d.size.height}`, primary: d.id === screen.getPrimaryDisplay().id }));
  if (!overlay) return;
  const display = displays.find(d => d.id === settings.displayId) || screen.getPrimaryDisplay();
  overlay.setBounds(overlayBounds(display.workArea, settings.anchor));
  overlay.setOpacity(settings.opacity);
}
function updateOverlay() {
  if (!overlay) return;
  const active = ['ChampSelect', 'InProgress', 'GameStart', 'Reconnect'].includes(state.game.phase);
  const visible = manualOverlay ?? (settings.autoOverlay && active && (state.game.isMayhem || state.modeConfirmed));
  if (visible && !smoke) overlay.showInactive(); else overlay.hide();
  state.overlayVisible = visible;
  updateTray();
}
function toggleOverlay() { manualOverlay = !state.overlayVisible; updateOverlay(); publish(); }
function showPanel() { if (!smoke) panel.showInactive(); }
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开控制面板', click: showPanel },
    { label: state.overlayVisible ? '隐藏浮层' : '显示浮层', click: toggleOverlay },
    { label: '识别当前强化符文', click: () => scanGame().catch(reportError) },
    { type: 'separator' },
    { label: '退出 Hexthon', click: () => { quitting = true; app.quit(); } },
  ]));
}
function reportError(e) { state.error = e.message || '操作失败'; publish(); }
function meta(d) { return d && { patch: d.patch, fetchedAt: d.fetchedAt, cacheStatus: d.cacheStatus || 'cached', warning: d.warning || '', url: d.url }; }
async function loadChampion(key, force = false) {
  const champion = state.catalog?.champions.find(c => c.key === key);
  if (!champion) return;
  if (state.selectedChampion?.key === key && !force && (state.loading || state.augmentMeta)) return;
  const serial = ++loadSerial;
  const changed = state.selectedChampion?.key !== key;
  state.selectedChampion = champion; state.loading = true; state.error = '';
  state.augments = state.catalog.augments; state.augmentMeta = null; state.buildMeta = null; state.builds = [];
  if (changed) { state.offeredIds = []; state.ocr = { status: 'idle', matches: [], text: '' }; }
  publish();
  const result = await Promise.allSettled([provider.get('augments', key, force), provider.get('build', key, force)]);
  if (serial !== loadSerial) return;
  const errors = [];
  if (result[0].status === 'fulfilled') {
    state.augments = result[0].value.augments; state.augmentMeta = meta(result[0].value);
  } else errors.push('英雄专属档位暂不可用，当前显示通用资料');
  if (result[1].status === 'fulfilled') { state.builds = result[1].value.builds; state.buildMeta = meta(result[1].value); }
  else errors.push('出装数据暂不可用');
  state.error = errors.join('；'); state.loading = false; publish();
}
async function refresh() {
  const d = await provider.get('index', null, true); state.catalog = d;
  await loadChampion(state.selectedChampion?.key || settings.manualChampion, true); publish();
}
async function poll() {
  try {
    const previous = state.game;
    state.game = await reader.poll(settings, state.catalog?.champions || []);
    const ended = previous.phase === 'InProgress' && state.game.phase !== 'InProgress';
    const newGame = previous.gameId && state.game.gameId && previous.gameId !== state.game.gameId;
    const newSelect = state.game.phase === 'ChampSelect' && previous.phase !== 'ChampSelect';
    const liveRestarted = previous.gameTime > 120 && state.game.gameTime != null && state.game.gameTime < 60;
    if (ended || newGame || newSelect || liveRestarted) {
      manualOverlay = null;
      state.offeredIds = []; state.modeConfirmed = false; state.ocr = { status: 'idle', matches: [], text: '' };
    }
    if (settings.autoFollow && state.game.championId) {
      const champion = state.catalog?.champions.find(c => c.id === state.game.championId);
      if (champion && champion.key !== state.selectedChampion?.key) loadChampion(champion.key).catch(reportError);
    }
    updateOverlay(); publish();
    if (settings.autoScan && state.game.liveConnected && (state.game.isMayhem || state.modeConfirmed) && Date.now() - lastScan > 12000 && !ocr.busy) scanGame().catch(() => {});
  } catch { state.error = '本地连接暂不可用，将自动重试'; publish(); }
  finally { if (!quitting && !smoke) timer = setTimeout(poll, 3000); }
}
async function recognizeImage(image, imported = false) {
  if (ocr.busy) throw new Error('识别正在进行');
  const championKey = state.selectedChampion?.key;
  state.ocr = { status: 'running', matches: [], text: '', message: '正在本地识别…' }; publish();
  try {
    const result = await ocr.read(image, settings.ocrRegion, state.catalog?.augments || []);
    if (championKey !== state.selectedChampion?.key) return;
    const exact = result.matches.filter(m => m.exact);
    state.ocr = { ...result, status: 'done', imported, message: exact.length === 3 ? '已识别三个名称，请对照游戏确认' : '识别结果待确认；可手动加入比较' };
    // Only a complete, unambiguous set replaces the previous offers.
    state.offeredIds = exact.length === 3 && result.matches.length === 3 ? exact.map(m => m.id) : [];
    publish();
  } catch (e) { state.ocr = { status: 'error', matches: [], text: '', message: e.message }; publish(); throw e; }
}
async function scanGame() {
  if (!state.game.liveConnected || !(state.game.isMayhem || state.modeConfirmed)) throw new Error('请先进入海克斯大乱斗；模式无法识别时，可在连接设置中手动确认本局模式');
  if (ocr.busy) throw new Error('识别正在进行');
  lastScan = Date.now();
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false });
  const game = sources.find(s => /^League of Legends \(TM\) Client$/i.test(s.name) || /^英雄联盟.*\(TM\)/i.test(s.name));
  if (!game || game.thumbnail.isEmpty()) throw new Error('未取得游戏窗口画面。请使用无边框模式，也可导入一张游戏截图识别');
  await recognizeImage(game.thumbnail);
}
function registerIpc() {
  const handler = (name, fn, allowOverlay = false) => ipcMain.handle(name, async (event, arg) => {
    if (event.sender !== panel.webContents && !(allowOverlay && event.sender === overlay.webContents)) return { ok: false, error: '无效的请求来源' };
    try { return { ok: true, data: await fn(arg) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  handler('get-state', () => snapshot(), true);
  handler('save-settings', async patch => { await saveSettings(patch || {}); return snapshot(); });
  handler('select-champion', async key => {
    if (!state.catalog.champions.some(c => c.key === key)) throw new Error('未知英雄');
    await saveSettings({ manualChampion: key, autoFollow: false }); await loadChampion(key); return snapshot();
  });
  handler('follow-champion', async () => {
    await saveSettings({ autoFollow: true });
    const champion = state.catalog.champions.find(c => c.id === state.game.championId);
    if (champion) await loadChampion(champion.key); return snapshot();
  });
  handler('refresh', refresh);
  handler('set-offers', ids => {
    if (!Array.isArray(ids) || ids.length > 3 || ids.some(id => !state.catalog.augments.some(a => a.id === id))) throw new Error('最多选择三个有效的强化符文');
    state.offeredIds = [...new Set(ids)]; publish();
  });
  handler('scan', scanGame);
  handler('import-image', async () => {
    const result = await dialog.showOpenDialog(panel, { title: '选择完整的游戏窗口截图', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled) return;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 25 * 1024 * 1024) throw new Error('图片超过 25 MB');
    const image = nativeImage.createFromPath(file); if (image.isEmpty()) throw new Error('无法读取图片');
    await recognizeImage(image, true);
  });
  handler('toggle-overlay', toggleOverlay);
  handler('confirm-mode', value => { state.modeConfirmed = value === true; updateOverlay(); publish(); });
  handler('open-source', async kind => {
    const key = state.selectedChampion?.key;
    const url = key && ['build', 'augments'].includes(kind) ? `${BASE}/${key}/${kind}` : BASE;
    if (!smoke) await shell.openExternal(url);
    return url;
  });
}
async function start() {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  try { settings = validateSettings(JSON.parse(await fs.readFile(settingsFile(), 'utf8'))); } catch { /* Defaults. */ }
  if (smoke) settings = { ...DEFAULTS };
  provider = new OpggProvider(path.join(app.getPath('userData'), 'cache'), path.resolve(__dirname, '../data/seed'));
  reader = new LeagueReader();
  ocr = new OcrReader(path.join(app.getPath('userData'), 'ocr'), message => { state.ocr.message = message; publish(); }, (bitmap, size) => nativeImage.createFromBitmap(bitmap, size));
  state.catalog = await provider.read('index');
  try { state.imageAssets = JSON.parse(await fs.readFile(path.resolve(__dirname, '../assets/manifest.json'), 'utf8')); } catch { /* Remote images remain available. */ }
  const prefs = { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true };
  const primary = screen.getPrimaryDisplay().workArea;
  panel = new BrowserWindow({ title: 'Hexthon · 海克斯大乱斗助手', width: Math.min(1240, primary.width), height: Math.min(860, primary.height), minWidth: 900, minHeight: 650,
    show: false, backgroundColor: '#0b1119', icon: path.resolve(__dirname, '../assets/icon.png'), webPreferences: prefs });
  overlay = new BrowserWindow({ width: 366, height: 610, show: false, frame: false, transparent: true, resizable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, webPreferences: prefs });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  for (const win of [panel, overlay]) protect(win);
  panel.on('close', e => { if (!quitting) { e.preventDefault(); panel.hide(); } });
  positionOverlay(); registerIpc();
  await Promise.all([panel.loadFile(path.join(__dirname, 'renderer/index.html')), overlay.loadFile(path.join(__dirname, 'renderer/overlay.html'))]);
  if (!smoke) {
    tray = new Tray(nativeImage.createFromPath(path.resolve(__dirname, '../assets/icon.png')).resize({ width: 32, height: 32 }));
    tray.setToolTip('Hexthon · 海克斯大乱斗助手'); tray.on('click', showPanel); updateTray();
    for (const [key, action] of [['Control+Alt+O', toggleOverlay], ['Control+Alt+H', showPanel], ['Control+Alt+S', () => scanGame().catch(reportError)]]) state.shortcuts[key] = globalShortcut.register(key, action);
    if (process.argv.includes('--panel')) showPanel();
    screen.on('display-metrics-changed', () => { positionOverlay(); publish(); });
    screen.on('display-added', () => { positionOverlay(); publish(); });
    screen.on('display-removed', () => { positionOverlay(); publish(); });
  }
  await loadChampion(settings.manualChampion);
  if (smoke) {
    const { runSmoke } = require('../scripts/smoke.cjs');
    try { await runSmoke({ panel, overlay, state, snapshot, publish, ocr }); quitting = true; app.exit(0); }
    catch (e) { console.error(e.stack); quitting = true; app.exit(1); }
  } else {
    poll();
    provider.get('index').then(d => { state.catalog = d; publish(); }).catch(reportError);
  }
}
app.on('second-instance', () => { if (panel) showPanel(); });
app.on('before-quit', () => { quitting = true; clearTimeout(timer); globalShortcut.unregisterAll(); if (ocr) ocr.close().catch(() => {}); });
app.on('window-all-closed', () => {});
