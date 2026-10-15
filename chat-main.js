// Sohbet görünümü: Claude Code'u resmi Agent SDK ile çalıştırır (terminal yok).
// Her sohbet, hesabın kendi ayar klasörüyle (CLAUDE_CONFIG_DIR) ayrı bir Claude Code süreci açar.
const { ipcMain, app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let sdkPromise;
const loadSdk = () => (sdkPromise ||= import('@anthropic-ai/claude-agent-sdk'));

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

function setup({ getWindow, getAccount, expandHome }) {
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

      const options = {
        cwd: dir,
        env,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'], // CLAUDE.md, hook'lar, izinler, skill'ler
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
      chats.set(id, { q, queue, pending, accountId });

      (async () => {
        try {
          for await (const msg of q) send('chat:msg', id, msg);
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

module.exports = { setup, closeAll, count: () => chats.size };
