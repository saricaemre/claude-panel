// Sohbet görünümü: Claude Code'u resmi Agent SDK ile çalıştırır (terminal yok).
// Her sohbet, hesabın kendi ayar klasörüyle (CLAUDE_CONFIG_DIR) ayrı bir Claude Code süreci açar.
const { ipcMain, app } = require('electron');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let sdkPromise;
const loadSdk = () => (sdkPromise ||= import('@anthropic-ai/claude-agent-sdk'));

// Panelde izin sormadan çalışan MCP sunucuları (sunucu adı tüm araçlarını kapsar).
// Sohbet görünümüne allowedTools, terminaldeki claude'a --allowedTools olarak verilir.
const AUTO_ALLOW_MCP = ['blender', 'figma-console'];
const AUTO_ALLOW_TOOLS = AUTO_ALLOW_MCP.map((s) => `mcp__${s}`);

// ---------- Bağlayıcılar (MCP sunucuları) ----------
// Claude Code bir sunucuyu kapatınca hesabın .claude.json dosyasında, projenin kaydındaki
// disabledMcpServers listesine yazar (/mcp disable ile aynı). Proje anahtarı klasörün git köküdür
// (worktree'de ana deponun kökü), git dışında klasörün kendisi. Panel aynı kaydı okur ve yazar;
// Claude Code yazmadan önce dosyayı yeniden okuduğu için dışarıdan yapılan değişiklik ezilmez.
function projectKey(dir) {
  try {
    const [top, common] = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim().split('\n');
    if (common && path.basename(common) === '.git') return path.dirname(common);
    if (top) return top;
  } catch {}
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Var olan ama okunamayan (bozuk ya da o an yazılmakta olan) dosyanın üzerine asla yazılmaz
function readJsonForWrite(f) {
  if (!fs.existsSync(f)) return {};
  const data = readJson(f);
  if (!data || typeof data !== 'object') throw new Error(`${path.basename(f)} okunamadı; dosyaya dokunulmadı`);
  return data;
}

// Yarım dosya kalmasın diye geçici dosyaya yazıp yeniden adlandırır; dosyanın izinleri korunur
function writeJsonAtomic(f, data) {
  let mode = 0o600;
  try { mode = fs.statSync(f).mode & 0o777; } catch {}
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.panel-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, f);
}

// Symlink ise hedefi (ayarlari-esitle.sh ayar dosyalarını ~/.claude'a bağlar; symlink bozulmasın)
const realFile = (f) => { try { return fs.realpathSync(f); } catch { return f; } };

// ---------- Kullanıcının kabuk ortamı ----------
// Finder'dan açılan uygulamaların PATH'i kısa olur (pnpm, nvm, python bulunamaz).
// Bu yüzden giriş kabuğunu bir kez çalıştırıp gerçek ortamı alıyoruz.
let loginEnvPromise;
function loginEnv() {
  if (loginEnvPromise) return loginEnvPromise;
  loginEnvPromise = new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const marker = '__CLAUDE_PANEL_ENV__';
    let out = '';
    let done = false;
    const finish = (env) => { if (!done) { done = true; resolve(env); } };
    try {
      const p = spawn(shell, ['-l', '-i', '-c', `printf '${marker}'; env -0`], {
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      p.stdout.on('data', (d) => (out += d.toString('utf8')));
      p.on('close', () => {
        const i = out.lastIndexOf(marker);
        if (i < 0) return finish({ ...process.env });
        const env = {};
        for (const pair of out.slice(i + marker.length).split('\0')) {
          const eq = pair.indexOf('=');
          if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
        finish(env.PATH ? env : { ...process.env });
      });
      setTimeout(() => { try { p.kill(); } catch {} finish({ ...process.env }); }, 10000);
    } catch {
      finish({ ...process.env });
    }
  });
  return loginEnvPromise;
}

// ---------- Mesaj kuyruğu (SDK'ya akan kullanıcı mesajları) ----------
class InputQueue {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(item) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false }); else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
      return: () => { this.close(); return Promise.resolve({ value: undefined, done: true }); },
    };
  }
}

// ---------- Sohbetler ----------
const chats = new Map(); // id -> { q, queue, pending, accountId }
let nextChatId = 1;
let nextReqId = 1;

function setup({ getWindow, getAccount, expandHome, artifacts }) {
  const send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };

  async function accountEnv(accountId) {
    const account = getAccount(accountId);
    if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
    const env = { ...(await loginEnv()) };
    const configDir = expandHome(account.configDir);
    if (configDir) {
      fs.mkdirSync(configDir, { recursive: true });
      env.CLAUDE_CONFIG_DIR = configDir;
    } else {
      delete env.CLAUDE_CONFIG_DIR;
    }
    env.CLAUDE_AGENT_SDK_CLIENT_APP = 'claude-panel/' + app.getVersion();
    if (!env.LANG) env.LANG = 'en_US.UTF-8';
    return env;
  }

  ipcMain.handle('chat:start', async (_e, opts) => {
    try {
      const { accountId, cwd, mode, resumeId, model, permissionMode, effort } = opts;
      const sdk = await loadSdk();
      const env = await accountEnv(accountId);
      let dir = expandHome(cwd) || os.homedir();
      if (!fs.existsSync(dir)) dir = os.homedir();

      const id = nextChatId++;
      const queue = new InputQueue();
      const pending = new Map();
      let stderrTail = '';
      let sessionId = resumeId || null;

      // Artifacts: Claude'un yazdığı .html/.svg dosyaları ve publish_artifact aracı galeriye düşer
      const onArtifact = (info) => send('chat:artifact', id, info);
      const track = artifacts.createTracker({ cwd: dir, accountId, onArtifact });
      const panelMcp = await artifacts.createMcpServer(sdk, { cwd: dir, accountId, getSessionId: () => sessionId, onArtifact });

      const options = {
        cwd: dir,
        env,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'], // CLAUDE.md, hook'lar, izinler, skill'ler
        mcpServers: { panel: panelMcp },
        allowedTools: ['mcp__panel__publish_artifact', ...AUTO_ALLOW_TOOLS],
        includePartialMessages: true,
        includeHookEvents: true,
        allowDangerouslySkipPermissions: true, // "Tam yetki" moduna sonradan geçebilmek için
        stderr: (d) => { stderrTail = (stderrTail + d).slice(-4000); },
        canUseTool: (toolName, input, o) =>
          new Promise((resolve) => {
            const rid = nextReqId++;
            pending.set(rid, { resolve, suggestions: o.suggestions, input });
            send('chat:permission', id, {
              rid,
              toolName,
              input,
              title: o.title,
              description: o.description,
              decisionReason: o.decisionReason,
              blockedPath: o.blockedPath,
              canAlways: Array.isArray(o.suggestions) && o.suggestions.length > 0,
            });
            o.signal?.addEventListener('abort', () => {
              if (!pending.has(rid)) return;
              pending.delete(rid);
              send('chat:permissionDone', id, rid);
              resolve({ behavior: 'deny', message: 'İptal edildi' });
            });
          }),
      };
      // Test için: sahte bir Claude Code çalıştırılabiliri verilebilir
      if (process.env.CLAUDE_PANEL_CLAUDE_BIN) options.pathToClaudeCodeExecutable = process.env.CLAUDE_PANEL_CLAUDE_BIN;
      if (model) options.model = model;
      if (effort) options.effort = effort;
      if (permissionMode) options.permissionMode = permissionMode;
      if (mode === 'continue') options.continue = true;
      if (mode === 'resume' && resumeId) options.resume = resumeId;

      const q = sdk.query({ prompt: queue, options });
      chats.set(id, { q, queue, pending, accountId, project: projectKey(dir) });

      (async () => {
        try {
          for await (const msg of q) {
            if (msg.session_id) sessionId = msg.session_id;
            send('chat:msg', id, msg);
            track(msg);
          }
          send('chat:end', id, null);
        } catch (err) {
          const detail = stderrTail.trim().split('\n').slice(-6).join('\n');
          send('chat:end', id, (err?.message || String(err)) + (detail ? '\n' + detail : ''));
        } finally {
          for (const { resolve } of pending.values()) resolve({ behavior: 'deny', message: 'Oturum kapandı' });
          pending.clear();
          chats.delete(id);
        }
      })();

      // Model listesini arka planda iste
      q.supportedModels?.().then((models) => send('chat:models', id, models)).catch(() => {});

      return { ok: true, id, cwd: dir, title: path.basename(dir) || dir };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.on('chat:send', (_e, id, text, images) => {
    const c = chats.get(id);
    if (!c) return;
    const content = [];
    for (const img of images || []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    }
    content.push({ type: 'text', text });
    c.queue.push({
      type: 'user',
      message: { role: 'user', content: images?.length ? content : text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    });
  });

  ipcMain.on('chat:permissionReply', (_e, id, rid, reply) => {
    const c = chats.get(id);
    const p = c?.pending.get(rid);
    if (!p) return;
    c.pending.delete(rid);
    if (reply.behavior === 'allow') {
      const result = { behavior: 'allow', updatedInput: reply.updatedInput || p.input };
      if (reply.always && p.suggestions?.length) result.updatedPermissions = p.suggestions;
      p.resolve(result);
    } else {
      p.resolve({ behavior: 'deny', message: reply.message || 'Kullanıcı reddetti', interrupt: !!reply.interrupt });
    }
    send('chat:permissionDone', id, rid);
  });

  // ---------- Hesap bilgisi: model listesi ve plan kullanımı ----------
  // Yeni sohbet ekranında henüz oturum yoktur. Hesabın açık bir sohbeti varsa onun süreci kullanılır;
  // yoksa mesaj göndermeyen, kayıt tutmayan kısa ömürlü bir Claude Code süreci açılır (token harcamaz).
  const infoCache = new Map(); // accountId -> { models, modelsAt, usage, usageAt }
  const MODELS_TTL = 10 * 60 * 1000;
  const USAGE_TTL = 60 * 1000;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), ms))]);

  async function readUsage(q) {
    // SDK'da deneysel; yoksa ya da hata verirse kullanım "bilinmiyor" sayılır
    const fn = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof fn !== 'function') return null;
    const r = await withTimeout(fn.call(q, { skipBehaviors: true }), 20000);
    return { subscription: r?.subscription_type || null, available: !!r?.rate_limits_available, limits: r?.rate_limits || null };
  }

  async function probe(accountId) {
    const live = [...chats.values()].find((c) => c.accountId === accountId);
    if (live) {
      const [models, usage] = await Promise.all([
        withTimeout(live.q.supportedModels(), 20000).catch(() => null),
        readUsage(live.q).catch(() => null),
      ]);
      if (usage?.available) return { models, usage };
      // Claude Code giriş bilgisini süreç açılırken okur: girişten önce açılmış sohbet "plan yok" der.
      // Bu durumda kullanımı taze bir yoklama süreciyle yeniden sor.
      const fresh = await freshProbe(accountId);
      return { models: models?.length ? models : fresh.models, usage: fresh.usage || usage };
    }
    return freshProbe(accountId);
  }

  async function freshProbe(accountId) {
    const sdk = await loadSdk();
    const env = await accountEnv(accountId);
    const queue = new InputQueue();
    const options = { cwd: os.homedir(), env, settingSources: [], persistSession: false, stderr: () => {} };
    if (process.env.CLAUDE_PANEL_CLAUDE_BIN) options.pathToClaudeCodeExecutable = process.env.CLAUDE_PANEL_CLAUDE_BIN;
    const q = sdk.query({ prompt: queue, options });
    (async () => { try { for await (const _ of q); } catch {} })(); // akışı boşalt
    try {
      const models = await withTimeout(q.supportedModels(), 30000).catch(() => null);
      const usage = await readUsage(q).catch(() => null);
      return { models, usage };
    } finally {
      try { queue.close(); } catch {}
      try { q.close(); } catch {}
    }
  }

  const probing = new Map(); // accountId -> Promise (aynı anda tek yoklama)
  ipcMain.handle('account:info', async (_e, accountId, force) => {
    try {
      const c = infoCache.get(accountId) || {};
      const now = Date.now();
      const fresh = c.models && now - c.modelsAt < MODELS_TTL && c.usageAt && now - c.usageAt < USAGE_TTL;
      if (!fresh || force) {
        if (!probing.has(accountId)) probing.set(accountId, probe(accountId).finally(() => probing.delete(accountId)));
        const r = await probing.get(accountId);
        if (r.models?.length) Object.assign(c, { models: r.models, modelsAt: now });
        Object.assign(c, { usage: r.usage, usageAt: now });
        infoCache.set(accountId, c);
      }
      return { ok: true, models: c.models || [], usage: c.usage || null, at: c.usageAt };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ---------- Bağlayıcılar: listele, aç/kapat ----------
  const claudeJson = (account) => path.join(expandHome(account.configDir) || os.homedir(), '.claude.json');
  const SCOPE_ORDER = ['local', 'project', 'user', 'claudeai'];

  ipcMain.handle('mcp:list', (_e, accountId, cwd) => {
    try {
      const account = getAccount(accountId);
      if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
      const key = projectKey(expandHome(cwd) || os.homedir());
      const cfg = readJson(claudeJson(account)) || {};
      const proj = cfg.projects?.[key] || {};
      const off = new Set(proj.disabledMcpServers || []);
      const found = {
        local: Object.keys(proj.mcpServers || {}),
        project: Object.keys(readJson(path.join(key, '.mcp.json'))?.mcpServers || {}),
        user: Object.keys(cfg.mcpServers || {}),
        claudeai: cfg.claudeAiMcpEverConnected || [], // hesabın claude.ai bağlayıcıları (Figma, Drive…)
      };
      const servers = [];
      for (const scope of SCOPE_ORDER) {
        for (const name of found[scope]) {
          if (!servers.some((s) => s.name === name)) servers.push({ name, scope, enabled: !off.has(name) });
        }
      }
      return { ok: true, project: key, servers };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('mcp:toggle', async (_e, accountId, cwd, name, enabled) => {
    try {
      const account = getAccount(accountId);
      if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
      const key = projectKey(expandHome(cwd) || os.homedir());
      // Bu klasörde açık sohbet varsa Claude Code'a da söylenir: sunucu o oturumda hemen kapanır/açılır
      const live = [...chats.values()].filter((c) => c.accountId === accountId && c.project === key);
      const liveErrors = [];
      await Promise.all(live.map((c) => withTimeout(c.q.toggleMcpServer(name, !!enabled), 15000)
        .catch((e) => liveErrors.push(e?.message || String(e)))));
      // Kalıcı kayıt (Claude Code da aynı şeyi yazar; değer aynı olduğu için çakışma olmaz)
      const file = realFile(claudeJson(account));
      const cfg = readJsonForWrite(file);
      cfg.projects ||= {};
      const proj = (cfg.projects[key] ||= {});
      const list = (proj.disabledMcpServers || []).filter((n) => n !== name);
      if (!enabled) list.push(name);
      proj.disabledMcpServers = list;
      writeJsonAtomic(file, cfg);
      return { ok: true, enabled: !!enabled, live: live.length, liveErrors };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ---------- Eklentiler (Claude Code plugin'leri) ----------
  // Kurulu eklentiler <ayar klasörü>/plugins/installed_plugins.json'da, açık/kapalı durumu settings.json → enabledPlugins'te.
  // Panel hesabın genel (user) settings.json'unu değiştirir, Claude uygulamasındaki "Eklentileri yönet" gibi.
  // Dosya symlink ise hedefine yazılır; o dosyayı paylaşan tüm hesaplarda ve panel dışında da geçerli olur.
  // Klasörün .claude/settings(.local).json dosyası aynı eklentiyi belirliyorsa o kazanır (değiştirilemez gösterilir).
  const configHome = (account) => expandHome(account.configDir) || path.join(os.homedir(), '.claude');
  const userSettings = (account) => realFile(path.join(configHome(account), 'settings.json'));
  const pluginOn = (v) => v === true || Array.isArray(v) || (!!v && typeof v === 'object');

  ipcMain.handle('plugins:list', (_e, accountId, cwd) => {
    try {
      const account = getAccount(accountId);
      if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
      const home = configHome(account);
      const linkFile = path.join(home, 'settings.json');
      const file = userSettings(account);
      const key = projectKey(expandHome(cwd) || os.homedir());
      // Proje klasörü ev klasörüyse .claude/settings.json genel ayarın kendisidir; proje ayarı sayılmaz
      const scoped = (f) => (realFile(f) === file ? {} : readJson(f)?.enabledPlugins || {});
      const user = readJson(file)?.enabledPlugins || {};
      const proj = scoped(path.join(key, '.claude', 'settings.json'));
      const local = scoped(path.join(key, '.claude', 'settings.local.json'));
      const installed = readJson(path.join(home, 'plugins', 'installed_plugins.json'))?.plugins || {};
      const ids = [...new Set([...Object.keys(installed), ...Object.keys(user), ...Object.keys(proj), ...Object.keys(local)])];
      const plugins = ids.map((id) => {
        const [name, marketplace = ''] = id.split('@');
        const entries = installed[id] || [];
        const inst = entries.find((x) => x.scope === 'user') || entries[0];
        const manifest = inst?.installPath ? readJson(path.join(inst.installPath, '.claude-plugin', 'plugin.json')) : null;
        const override = id in local ? 'local' : id in proj ? 'project' : null;
        return {
          id, name: manifest?.name || name, marketplace,
          version: inst?.version || manifest?.version || '',
          description: manifest?.description || '',
          installed: !!inst,
          enabled: pluginOn(override === 'local' ? local[id] : override === 'project' ? proj[id] : user[id]),
          override,
        };
      }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      return { ok: true, plugins, file, shared: file !== linkFile };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('plugins:toggle', async (_e, accountId, id, enabled) => {
    try {
      const account = getAccount(accountId);
      if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
      const file = userSettings(account);
      const s = readJsonForWrite(file);
      s.enabledPlugins = { ...(s.enabledPlugins || {}), [id]: !!enabled };
      writeJsonAtomic(file, s);
      // Aynı ayar dosyasını kullanan açık sohbetler eklentileri diskten yeniden yükler
      const live = [...chats.values()].filter((c) => {
        const a = getAccount(c.accountId);
        return a && userSettings(a) === file;
      });
      const liveErrors = [];
      await Promise.all(live.map((c) => withTimeout(c.q.reloadPlugins(), 20000)
        .catch((e) => liveErrors.push(e?.message || String(e)))));
      return { ok: true, enabled: !!enabled, live: live.length, liveErrors };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('chat:interrupt', async (_e, id) => {
    try { await chats.get(id)?.q.interrupt(); return true; } catch { return false; }
  });
  ipcMain.handle('chat:setModel', async (_e, id, model) => {
    try { await chats.get(id)?.q.setModel(model || undefined); return true; } catch (e) { return e.message; }
  });
  ipcMain.handle('chat:setEffort', async (_e, id, level) => {
    try { await chats.get(id)?.q.applyFlagSettings({ effortLevel: level || null }); return true; } catch (e) { return e.message; }
  });
  ipcMain.handle('chat:setMode', async (_e, id, mode) => {
    try { await chats.get(id)?.q.setPermissionMode(mode); return true; } catch (e) { return e.message; }
  });
  ipcMain.on('chat:close', (_e, id) => closeChat(id));

  // Geçmiş oturumlar: SDK ayar klasörünü süreç başına bir kez okuduğu için
  // her hesap için ayrı, kısa ömürlü bir yardımcı süreçte okuyoruz.
  ipcMain.handle('chat:sessions', (_e, accountId, cwd) => runHelper(accountId, { op: 'list', dir: expandHome(cwd) }));
  ipcMain.handle('chat:history', (_e, accountId, sessionId, cwd) =>
    runHelper(accountId, { op: 'messages', sessionId, dir: expandHome(cwd) }));

  async function runHelper(accountId, payload) {
    const env = await accountEnv(accountId);
    env.ELECTRON_RUN_AS_NODE = '1';
    return new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(__dirname, 'scripts', 'sessions.mjs'), JSON.stringify(payload)], {
        env,
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('close', () => {
        try { resolve(JSON.parse(out)); } catch { resolve({ ok: false, error: err.slice(-500) || 'okunamadı' }); }
      });
      setTimeout(() => { try { p.kill(); } catch {} }, 20000);
    });
  }

  // Uygulama açılırken kabuk ortamını önceden hazırla
  loginEnv();
}

function closeChat(id) {
  const c = chats.get(id);
  if (!c) return;
  try { c.queue.close(); } catch {}
  try { c.q.close(); } catch {}
  chats.delete(id);
}

function closeAll() {
  for (const id of [...chats.keys()]) closeChat(id);
}

module.exports = { setup, closeAll, count: () => chats.size, AUTO_ALLOW_TOOLS };
