const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const chat = require('./chat-main');
const artifacts = require('./artifacts');

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

const DEFAULT_CONFIG = {
  accounts: [
    { id: 'is', name: 'İş', note: 'İş hesabı', color: '#3f9b84', configDir: '~/.claude-is' },
    { id: 'max', name: 'Max', note: 'Max üyelik', color: '#d97757', configDir: '~/.claude-max' },
    { id: 'pro', name: 'Pro', note: 'Pro üyelik', color: '#7c7ce0', configDir: '~/.claude-pro' },
  ],
  recents: {},
  lastAccount: 'is',
};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw, accounts: raw.accounts?.length ? raw.accounts : DEFAULT_CONFIG.accounts };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2));
}

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

function createPty({ accountId, cwd, mode, resumeId, cols, rows }) {
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

  const configDir = expandHome(account.configDir);
  if (configDir) {
    fs.mkdirSync(configDir, { recursive: true });
    env.CLAUDE_CONFIG_DIR = configDir;
  } else {
    delete env.CLAUDE_CONFIG_DIR; // boş bırakılırsa varsayılan ~/.claude kullanılır
  }

  const claude = `claude --allowedTools ${shellQuote(chat.AUTO_ALLOW_TOOLS.join(','))}`;
  const commands = {
    new: claude,
    continue: `${claude} --continue`,
    resume: `${claude} --resume`,
  };
  if (mode === 'resume-id' && /^[0-9a-f-]{36}$/i.test(resumeId || '')) commands['resume-id'] = `${claude} --resume ${resumeId}`;
  const cmd = commands[mode];
  // Giriş kabuğu (-l -i): .zprofile/.zshrc yüklenir, PATH ve alias'lar hazır olur.
  // Claude kapanınca aynı klasörde normal kabuk açık kalır.
  const args = cmd
    ? ['-l', '-i', '-c', `${cmd}; exec ${shellQuote(userShell)} -l -i`]
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
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', id, data);
  });
  proc.onExit(({ exitCode }) => {
    terms.delete(id);
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', id, exitCode);
  });

  // Son kullanılan klasörler
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
  saveConfig(cfg);
  return cfg;
});
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

ipcMain.on('notify', (_e, { title, body }) => {
  if (Notification.isSupported() && win && !win.isFocused()) {
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => { win.show(); win.focus(); });
    n.show();
  }
});

// ---------- Pencere ----------

function sendCmd(cmd, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('menu:cmd', cmd, arg);
}

function buildMenu() {
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
        { label: 'Hesap ayarları…', accelerator: 'CmdOrCtrl+,', click: () => sendCmd('settings') },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Yazıyı büyüt', accelerator: 'CmdOrCtrl+=', click: () => sendCmd('font', 1) },
        { label: 'Yazıyı küçült', accelerator: 'CmdOrCtrl+-', click: () => sendCmd('font', -1) },
        { label: 'Yazı boyutunu sıfırla', accelerator: 'CmdOrCtrl+0', click: () => sendCmd('font', 0) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Geliştirici araçları', accelerator: 'Alt+CmdOrCtrl+I', click: () => win?.webContents.toggleDevTools() },
      ],
    },
    { role: 'windowMenu' },
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
    backgroundColor: '#262624',
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

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Artifact önizlemelerinden açılan linkler varsayılan tarayıcıda açılsın, yeni Electron penceresi açılmasın
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

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
    expandHome,
    artifacts,
  });
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
