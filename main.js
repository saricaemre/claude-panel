const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, Notification, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const url = require('url');

const chat = require('./chat-main');
const artifacts = require('./artifacts');
const simulator = require('./simulator');
const browser = require('./browser');
const terminals = require('./terminals');
const preview = require('./preview');
const changes = require('./changes');
const sessions = require('./sessions');
const environments = require('./environments');
const opener = require('./opener');
const prwatch = require('./prwatch');
const octopus = require('./octopus');
const hafiza = require('./hafiza');
const defter = require('./defter');
const sinav = require('./sinav');
const dogus = require('./dogus');
const danis = require('./danis');
const alma = require('./alma');

// Özel protokol app hazır olmadan kaydedilmeli
artifacts.registerScheme();

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  pty = null;
  console.error('node-pty yüklenemedi:', e);
}

// ---------- Ayarlar ----------

// Testler ayrı bir ayar klasörü kullanabilsin
if (process.env.CLAUDE_PANEL_USER_DATA) app.setPath('userData', process.env.CLAUDE_PANEL_USER_DATA);

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

// Sıfırdan kurulumda tek hesap: Claude Code'un varsayılan ayar klasörü (~/.claude; configDir boş). Başka hesaplar Ayarlar → Hesaplar'dan eklenir.
const DEFAULT_CONFIG = {
  accounts: [{ id: 'claude', name: 'Claude', note: '', color: '#cdb07a', configDir: '' }],
  recents: {},
  environments: [],
  lastAccount: 'claude',
};

// Ayar dosyasında hesap yoksa (ilk açılış) ya da ilk açılış sihirbazı yarım kaldıysa firstRun: arayüz sihirbazı açar (renderer/kurulum.js)
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
    const firstRun = !raw.accounts?.length || raw.welcome === 'pending';
    return { ...DEFAULT_CONFIG, ...raw, accounts: raw.accounts?.length ? raw.accounts : DEFAULT_CONFIG.accounts, firstRun };
  } catch {
    return { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), firstRun: true };
  }
}

function saveConfig(cfg) {
  const { firstRun, ...data } = cfg;
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  // Ortam değişkenleri düz metin durur: dosya yalnız kullanıcıya açık
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH(), 0o600); } catch {}
}

// Tema: 'system' (macOS'u izler, varsayılan), 'dark', 'light'. nativeTheme bütün sayfaların prefers-color-scheme'ini belirler:
// panelin stilleri, claude.ai (Web görünümü), artifact sayfaları ve sohbet içi görseller aynı temaya geçer.
const THEMES = ['system', 'dark', 'light'];
const themeOf = (cfg) => (THEMES.includes(cfg.theme) ? cfg.theme : 'system');
// Pencerenin zemini stillerdeki --canvas ile aynı: açılışta ve geçişte beyaz/siyah çakmasın
const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#100f0d' : '#efeadf');
function applyTheme(theme) {
  nativeTheme.themeSource = theme;
  if (win && !win.isDestroyed()) win.setBackgroundColor(windowBg());
}

// SDK'nın platform paketindeki Claude Code ikilisi (paketleme --no-asar: çalıştırılabilir). Testlerde sahte CLI.
function bundledClaude() {
  if (process.env.CLAUDE_PANEL_CLAUDE_BIN) return process.env.CLAUDE_PANEL_CLAUDE_BIN;
  try {
    const dir = path.dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`));
    return fs.existsSync(path.join(dir, 'claude')) ? path.join(dir, 'claude') : null;
  } catch { return null; }
}

// İzin sormadan çalışan MCP sunucuları (config.json → autoAllowMcp; arayüzü yok, elle yazılır). Yalnız sunucu adı biçimindekiler alınır.
const cleanMcpNames = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[\w.-]{1,64}$/.test(x)) : []);

// Maliyet eşikleri (K7): danışmada bu tahminin üstü onay kartıyla, sınavda bu tahminin altı onaysız. Boş = varsayılan.
const THRESHOLD_MAX = 2000000;
const cleanThreshold = (v) => { const n = Math.round(+v); return Number.isFinite(n) && n >= 0 && n <= THRESHOLD_MAX ? n : null; };

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ---------- Terminaller ----------

const terms = new Map(); // id -> { proc, accountId }
let nextId = 1;
let win;

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function createPty({ accountId, cwd, mode, resumeId, envId, cols, rows }) {
  if (!pty) throw new Error('node-pty yüklenemedi. Klasörde "npm install" çalıştırın.');
  const cfg = loadConfig();
  const account = cfg.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('Hesap bulunamadı: ' + accountId);

  let dir = expandHome(cwd) || os.homedir();
  if (!fs.existsSync(dir)) dir = os.homedir();

  const userShell = process.env.SHELL || '/bin/zsh';
  const env = { ...process.env };
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'ClaudePanel';
  if (!env.LANG) env.LANG = 'en_US.UTF-8';
  if (!env.LC_CTYPE) env.LC_CTYPE = 'UTF-8';

  // Seçili ortam: değişkenler süreç ortamına, kurulum betiği kabukta Claude'dan önce (environments.js)
  const profile = envId ? (cfg.environments || []).find((e) => e.id === envId) : null;
  if (profile) environments.applyVars(env, profile.vars);
  const setup = profile?.setup?.trim() ? profile.setup : '';
  if (setup) env.CLAUDE_PANEL_SETUP = setup;
  else delete env.CLAUDE_PANEL_SETUP;

  const configDir = expandHome(account.configDir);
  if (configDir) {
    fs.mkdirSync(configDir, { recursive: true });
    env.CLAUDE_CONFIG_DIR = configDir;
  } else {
    delete env.CLAUDE_CONFIG_DIR; // boş bırakılırsa varsayılan ~/.claude kullanılır
  }

  const allow = chat.autoAllowTools();
  const claude = allow.length ? `claude --allowedTools ${shellQuote(allow.join(','))}` : 'claude';
  // Claude Code'un komut satırı kurulu değilse (temiz Mac) SDK'nın içindeki ikili çalışır: sihirbazın "Terminalde giriş yap"ı da
  const bundled = bundledClaude();
  const prelude = bundled ? `command -v claude >/dev/null 2>&1 || claude() { ${shellQuote(bundled)} "$@"; }; ` : '';
  const commands = {
    new: claude,
    continue: `${claude} --continue`,
    resume: `${claude} --resume`,
    login: `${claude} /login`, // ilk açılış sihirbazı: hesabın girişi
  };
  if (mode === 'resume-id' && /^[0-9a-f-]{36}$/i.test(resumeId || '')) commands['resume-id'] = `${claude} --resume ${resumeId}`;
  const cmd = commands[mode];
  // Kurulum betiği giriş kabuğunda görünür biçimde çalışır; hata verirse Claude açılmaz, kabuk açık kalır.
  // Betik ortam değişkeniyle gelir (komut satırında görünmesin), çalışmadan önce silinir; export'ları sonraki kabuğa geçer.
  const run = (cmd ? prelude : '') + (setup
    ? '__k="$CLAUDE_PANEL_SETUP"; unset CLAUDE_PANEL_SETUP; if eval "$__k"; then unset __k;' + (cmd ? ` ${cmd};` : '') +
      ` else printf '\\n[Claude Panel] Ortam kurulum betiği hata verdi (çıkış %s)${cmd ? '; Claude başlatılmadı' : ''}.\\n' $?; fi; `
    : cmd ? `${cmd}; ` : '');
  // Giriş kabuğu (-l -i): .zprofile/.zshrc yüklenir, PATH ve alias'lar hazır olur.
  // Claude kapanınca aynı klasörde normal kabuk açık kalır.
  const args = run
    ? ['-l', '-i', '-c', `${run}exec ${shellQuote(userShell)} -l -i`]
    : ['-l', '-i'];

  const proc = pty.spawn(userShell, args, {
    name: 'xterm-256color',
    cols: cols || 100,
    rows: rows || 30,
    cwd: dir,
    env,
  });

  const id = nextId++;
  terms.set(id, { proc, accountId });

  proc.onData((data) => {
    terminals.noteData(id, data);
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', id, data);
  });
  proc.onExit(({ exitCode }) => {
    terms.delete(id);
    terminals.noteExit(id);
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', id, exitCode);
  });

  // Son kullanılan klasörler (giriş terminali ev klasöründe açılır, listeye girmez)
  if (mode === 'login') return { id, cwd: dir, title: 'Giriş' };
  cfg.recents = cfg.recents || {};
  const list = (cfg.recents[accountId] || []).filter((d) => d !== dir);
  list.unshift(dir);
  cfg.recents[accountId] = list.slice(0, 8);
  saveConfig(cfg);

  return { id, cwd: dir, title: path.basename(dir) || dir };
}

function killAll() {
  for (const { proc } of terms.values()) {
    try { proc.kill(); } catch {}
  }
  terms.clear();
  chat.closeAll();
  simulator.detach(false);
  hafiza.shutdown();
}

// ---------- IPC ----------

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_e, patch) => {
  // Sadece hesaplar ve son seçili hesap arayüzden güncellenir; "son klasörler" ana süreçte tutulur.
  const cfg = loadConfig();
  if (Array.isArray(patch.accounts)) cfg.accounts = patch.accounts;
  if (patch.lastAccount) cfg.lastAccount = patch.lastAccount;
  if (patch.fontSize) cfg.fontSize = patch.fontSize;
  if (patch.recents) cfg.recents = patch.recents;
  if (patch.chatPrefs) cfg.chatPrefs = { ...(cfg.chatPrefs || {}), ...patch.chatPrefs };
  if (Array.isArray(patch.environments)) cfg.environments = environments.sanitize(patch.environments);
  if (typeof patch.keepAwake === 'boolean') cfg.keepAwake = patch.keepAwake;
  if (typeof patch.autoVerify === 'boolean') cfg.autoVerify = patch.autoVerify; // önizlemeyle kendiliğinden doğrulama (preview.js)
  if (typeof patch.promptSuggestions === 'boolean') cfg.promptSuggestions = patch.promptSuggestions; // önerilen istem (chat-main.js)
  if (typeof patch.sidebarHidden === 'boolean') cfg.sidebarHidden = patch.sidebarHidden;
  if (typeof patch.sidePanelOpen === 'boolean') cfg.sidePanelOpen = patch.sidePanelOpen; // sohbetin sağ yan paneli (yoksa kapalı)
  if (THEMES.includes(patch.theme)) cfg.theme = patch.theme;
  if (typeof patch.editor === 'string') cfg.editor = patch.editor;
  if (patch.autoCompact === 'ask' || patch.autoCompact === 'allow') cfg.autoCompact = patch.autoCompact;
  if (patch.welcome === 'pending' || patch.welcome === 'done') cfg.welcome = patch.welcome;
  if (patch.thresholds && typeof patch.thresholds === 'object') {
    const t = { ...(cfg.thresholds || {}) };
    for (const k of ['danis', 'sinav']) {
      if (!(k in patch.thresholds)) continue;
      const n = patch.thresholds[k] === '' || patch.thresholds[k] == null ? null : cleanThreshold(patch.thresholds[k]);
      if (n == null) delete t[k]; else t[k] = n;
    }
    cfg.thresholds = t;
  }
  saveConfig(cfg);
  if (typeof patch.keepAwake === 'boolean') chat.updateAwake();
  if (THEMES.includes(patch.theme)) { applyTheme(patch.theme); buildMenu(); }
  return loadConfig();
});
// Ortam düzenleyicisi kaydetmeden önce değişken satırlarını denetletir (biçim kuralları tek yerde: environments.js)
ipcMain.handle('env:check', (_e, text) => environments.parseVars(text).errors);
ipcMain.handle('app:info', () => ({ home: os.homedir(), ptyOk: !!pty, platform: process.platform }));

ipcMain.handle('dialog:pickFolder', async (_e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Çalışma klasörünü seç',
    defaultPath: expandHome(defaultPath) || os.homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pty:create', (_e, opts) => {
  try {
    return { ok: true, ...createPty(opts) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.on('pty:write', (_e, id, data) => terms.get(id)?.proc.write(data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  try { terms.get(id)?.proc.resize(Math.max(cols, 2), Math.max(rows, 2)); } catch {}
});
ipcMain.on('pty:kill', (_e, id) => {
  try { terms.get(id)?.proc.kill(); } catch {}
  terms.delete(id);
});

ipcMain.on('open:external', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.on('open:folder', (_e, dir) => shell.openPath(expandHome(dir)));

// Electron 42+ macOS bildirimini UNNotification ile gösterir; imzasız (ad-hoc) uygulamada reddedilir (ölçüldü).
// Reddedilince Dock simgesi zıplar ve okunmamış sayısını gösterir; pencereye dönünce sayı silinir.
let dockUnseen = 0;
function dockAlert() {
  if (!app.dock) return;
  app.dock.setBadge(String(++dockUnseen));
  app.dock.bounce('informational');
}
function clearDockAlert() {
  if (!dockUnseen) return;
  dockUnseen = 0;
  app.dock?.setBadge('');
}

ipcMain.on('notify', (_e, { title, body }) => {
  if (!win || win.isFocused()) return;
  if (!Notification.isSupported()) return dockAlert();
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { win.show(); win.focus(); });
  n.on('failed', dockAlert);
  n.show();
});

// ---------- Pencere ----------

// Menüden tema: kaydet, uygula, arayüzdeki ayar penceresine haber ver (açıksa seçimi güncellesin)
function setTheme(theme) {
  const cfg = loadConfig();
  cfg.theme = theme;
  saveConfig(cfg);
  applyTheme(theme);
  buildMenu();
  sendCmd('theme', theme);
}

function sendCmd(cmd, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('menu:cmd', cmd, arg);
}

function buildMenu() {
  const theme = themeOf(loadConfig());
  const accountItems = loadConfig().accounts.slice(0, 9).map((a, i) => ({
    label: a.name,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => sendCmd('account', a.id),
  }));

  const template = [
    { role: 'appMenu' },
    {
      label: 'Panel',
      submenu: [
        { label: 'Yeni sohbet', accelerator: 'CmdOrCtrl+N', click: () => sendCmd('newChat') },
        { label: 'Artifacts', accelerator: 'CmdOrCtrl+Shift+A', click: () => sendCmd('artifacts') },
        { label: 'iOS Simülatörü', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCmd('simulator') },
        { label: 'Tarayıcı', accelerator: 'CmdOrCtrl+Shift+B', click: () => sendCmd('browser') },
        { label: 'Değişiklikler', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendCmd('changes') },
        { type: 'separator' },
        ...accountItems,
        { type: 'separator' },
        { label: 'Code / Chat arasında geç', accelerator: 'CmdOrCtrl+K', click: () => sendCmd('toggle') },
        { label: 'Code görünümü', accelerator: 'CmdOrCtrl+Shift+C', click: () => sendCmd('view', 'code') },
        { label: 'Chat görünümü', accelerator: 'CmdOrCtrl+Shift+H', click: () => sendCmd('view', 'chat') },
        { type: 'separator' },
        { label: 'Yeni terminal sekmesi', accelerator: 'CmdOrCtrl+T', click: () => sendCmd('newTab') },
        { label: 'Sekmeyi kapat', accelerator: 'CmdOrCtrl+W', click: () => sendCmd('closeTab') },
        { label: 'Sonraki sekme', accelerator: 'CmdOrCtrl+Alt+Right', click: () => sendCmd('nextTab', 1) },
        { label: 'Önceki sekme', accelerator: 'CmdOrCtrl+Alt+Left', click: () => sendCmd('nextTab', -1) },
        { type: 'separator' },
        { label: 'Ayarlar…', accelerator: 'CmdOrCtrl+,', click: () => sendCmd('settings') },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Kenar çubuğunu gizle / göster', accelerator: 'CmdOrCtrl+B', click: () => sendCmd('sidebar') },
        { type: 'separator' },
        { label: 'Yazıyı büyüt', accelerator: 'CmdOrCtrl+=', click: () => sendCmd('font', 1) },
        { label: 'Yazıyı küçült', accelerator: 'CmdOrCtrl+-', click: () => sendCmd('font', -1) },
        { label: 'Yazı boyutunu sıfırla', accelerator: 'CmdOrCtrl+0', click: () => sendCmd('font', 0) },
        { type: 'separator' },
        { label: 'Tema', submenu: [['system', 'Sistem'], ['dark', 'Koyu'], ['light', 'Açık']].map(([id, label]) => ({
          label, type: 'radio', checked: theme === id, click: () => setTheme(id),
        })) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Geliştirici araçları', accelerator: 'Alt+CmdOrCtrl+I', click: () => win?.webContents.toggleDevTools() },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Octopus nasıl çalışır?', click: () => sendCmd('octopusIntro') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    title: 'Claude Panel',
    backgroundColor: windowBg(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });

  const PAGE = path.join(__dirname, 'renderer', 'index.html');
  win.loadFile(PAGE);

  // Ana pencere kendi sayfasından ayrılmaz (sohbetteki bir form, sürüklenip bırakılan bir link vb.).
  // Ayrılsaydı açılan sayfa da preload'un window.panel köprüsünü (terminal, dosyalar) alırdı.
  win.webContents.on('will-navigate', (e, target) => {
    let own = false;
    try { own = new URL(target).protocol === 'file:' && url.fileURLToPath(target) === PAGE; } catch {}
    if (!own) e.preventDefault();
  });

  // Gömülü sayfalar (claude.ai Web görünümü, tarayıcı bölmesi) panelin köprüsünü ve Node'u asla almaz;
  // yalnız bilinen çerez bölmeleri ve http(s)/about:blank başlangıç adresi kabul edilir
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    const part = /^persist:(chat|browser)-[A-Za-z0-9_.-]+$/.exec(params.partition || '');
    if (!part || (params.src && !/^(https?:|about:blank$)/.test(params.src))) return e.preventDefault();
    if (part[1] === 'browser') prefs.sandbox = true;
  });

  // Artifact önizlemelerinden açılan linkler varsayılan tarayıcıda açılsın, yeni Electron penceresi açılmasın
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('focus', clearDockAlert);

  win.on('close', (e) => {
    const running = terms.size + chat.count();
    if (running > 0) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Kapat', 'Vazgeç'],
        defaultId: 1,
        cancelId: 1,
        message: `${running} açık Claude oturumu var.`,
        detail: 'Panel kapanırsa içlerindeki Claude Code oturumları da kapanır. Oturumlara daha sonra "Devam et" ile dönebilirsiniz.',
      });
      if (choice === 1) { e.preventDefault(); return; }
    }
    killAll();
  });
}

// claude.ai'nin gömülü pencereyi normal tarayıcı gibi görmesi için "Electron" ifadesini kaldır.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(/\s?claude-panel\/\S+/i, '')
  .replace(/\s?Claude Panel\/\S+/i, '');

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  // Tarayıcı bölmesi kendi kurallarıyla (browser.js): izinler kapalı, indirme yok, açılır pencere aynı bölmede
  if (browser.isBrowserSession(contents.session)) return browser.configureContents(contents);

  // claude.ai içinden açılan dış linkler varsayılan tarayıcıda açılsın
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(.+\.)?claude\.ai\//.test(url)) {
      contents.loadURL(url);
    } else if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const ses = contents.session;
  if (!ses.__panelConfigured) {
    ses.__panelConfigured = true;
    const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications', 'media', 'fullscreen']);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  }
});

app.whenReady().then(() => {
  artifacts.setup({ getWindow: () => win });
  chat.setup({
    getWindow: () => win,
    getAccount: (id) => loadConfig().accounts.find((a) => a.id === id),
    getEnvironment: (id) => (id ? (loadConfig().environments || []).find((e) => e.id === id) : null),
    expandHome,
    artifacts,
    getKeepAwake: () => loadConfig().keepAwake !== false,
    getAutoCompact: () => (loadConfig().autoCompact === 'allow' ? 'allow' : 'ask'),
    getAutoAllow: () => cleanMcpNames(loadConfig().autoAllowMcp),
    getPromptSuggestions: () => loadConfig().promptSuggestions === true, // önerilen istem (varsayılan kapalı; yeni sohbetlerde geçerli)
  });
  simulator.setup({ getWindow: () => win, loginEnv: chat.loginEnv });
  browser.setup({ getWindow: () => win });
  terminals.setup({ getWindow: () => win });
  // Önizleme (launch.json); kendiliğinden doğrulama config.json → autoVerify (varsayılan kapalı)
  preview.setup({ getWindow: () => win, getAutoVerify: () => loadConfig().autoVerify === true });
  changes.setup({ getWindow: () => win });
  sessions.setup({ getWindow: () => win });
  prwatch.setup({ getWindow: () => win });
  octopus.setup({ getWindow: () => win, getAccountName: (id) => loadConfig().accounts.find((a) => a.id === id)?.name });
  defter.setup({ getWindow: () => win });
  sinav.setup({ getWindow: () => win });
  dogus.setup({ getWindow: () => win });
  hafiza.setup({ getAccounts: () => loadConfig().accounts, getExtra: () => loadConfig().memoryProjects || [], expandHome,
    projectKey: (cwd) => chat.projectKey(expandHome(cwd) || os.homedir()) });
  alma.setup({ projectKey: chat.projectKey, expandHome, listSessions: chat.listSessions, getConfig: loadConfig, saveConfig });
  danis.configure({ getThreshold: () => loadConfig().thresholds?.danis ?? null });
  sinav.configure({ getThreshold: () => loadConfig().thresholds?.sinav ?? null });
  opener.setup({ getEditor: () => loadConfig().editor || '' });
  applyTheme(themeOf(loadConfig()));
  nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) win.setBackgroundColor(windowBg()); });
  buildMenu();
  createWindow();
  ipcMain.on('menu:rebuild', buildMenu);
});

app.on('window-all-closed', () => {
  killAll();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
