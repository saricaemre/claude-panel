// Sohbet görünümü: Claude Code'u resmi Agent SDK ile çalıştırır (terminal yok).
// Her sohbet, hesabın kendi ayar klasörüyle (CLAUDE_CONFIG_DIR) ayrı bir Claude Code süreci açar.
const { ipcMain, app, powerSaveBlocker } = require('electron');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const simulator = require('./simulator');
const browser = require('./browser');
const terminals = require('./terminals');
const changes = require('./changes');
const sessions = require('./sessions');
const worktrees = require('./worktrees');
const wrapup = require('./wrapup');
const defter = require('./defter');
const opener = require('./opener');
const prwatch = require('./prwatch');
const environments = require('./environments');
const octopus = require('./octopus');
const hooks = require('./hooks');
const compaction = require('./compaction');
const hafiza = require('./hafiza');
const danis = require('./danis');
const sinav = require('./sinav');
const dogus = require('./dogus');

let sdkPromise;
let helper = null; // scripts/sessions.mjs çalıştırıcısı (setup'ta); alma.js geçmiş oturumları bununla okur
const loadSdk = () => (sdkPromise ||= import('@anthropic-ai/claude-agent-sdk'));

// Panelde izin sormadan çalışan MCP sunucuları (sunucu adı tüm araçlarını kapsar): config.json → autoAllowMcp, varsayılan boş.
// Sohbet görünümüne allowedTools, terminaldeki claude'a --allowedTools olarak verilir.
let getAutoAllowMcp = () => [];
const autoAllowTools = () => getAutoAllowMcp().map((s) => `mcp__${s}`);

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

// Kullanıcı mesajı (yazma alanından, karttan ya da ana süreçten: dogus.js) Claude Code'a gider
function pushUser(id, c, content) {
  sessions.noteBusy(id);
  setBusy(id, true);
  c.queue.push({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    origin: { kind: 'human' },
  });
}

// ---------- Sohbetler ----------
const chats = new Map(); // id -> { q, queue, pending, accountId, project, worktree, dir, parentId, getSessionId }
let nextChatId = 1;
let send = () => {};

// ---------- Uyanık tutma ----------
// Bir sohbette Claude çalışırken (mesaj gönderildi, tur bitmedi) Mac uyumaz; ekran kararabilir.
// Ayar: config.json → keepAwake (varsayılan açık).
const busy = new Set();
let blocker = null;
let keepAwake = () => true;
function updateAwake() {
  const want = busy.size > 0 && keepAwake();
  if (want && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!want && blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
}
const setBusy = (id, on) => { on ? busy.add(id) : busy.delete(id); updateAwake(); };
let nextReqId = 1;

function setup({ getWindow, getAccount, getEnvironment, expandHome, artifacts, getKeepAwake, getAutoCompact, getAutoAllow }) {
  if (getAutoAllow) getAutoAllowMcp = getAutoAllow;
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  if (getKeepAwake) keepAwake = getKeepAwake;
  // Otomatik sıkıştırma onaya bağlı (compaction.js, OCTOPUS-PLANI.md İ1)
  compaction.setup({ send: (...a) => send(...a), getPolicy: () => (getAutoCompact ? getAutoCompact() : 'ask') });
  ipcMain.handle('hooks:log', (_e, id) => hooks.log(id));
  danis.setup(); // önceki oturumdan kalan danışma dalları (çökme): dizin taraması başlamadan silinir
  ipcMain.handle('awake:status', () => ({ active: blocker != null && powerSaveBlocker.isStarted(blocker), busy: busy.size }));

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
      const { accountId, cwd, mode, resumeId, model, permissionMode, effort, envId, parentId, title, worktree: wantWorktree, octopus: wantOctopus } = opts;
      const sdk = await loadSdk();
      let env = await accountEnv(accountId);
      let dir = expandHome(cwd) || os.homedir();
      if (!fs.existsSync(dir)) dir = os.homedir();
      const folderTitle = path.basename(dir) || dir;
      // Ayrı çalışma kopyası (worktrees.js): sohbet kendi dalında, <kök>/.claude/worktrees/<ad> içinde çalışır
      let worktree = null;
      if (wantWorktree && mode === 'new') {
        worktree = await worktrees.create(dir, title || folderTitle);
        dir = worktree.cwd;
      }

      // Seçili ortam (environments.js): değişkenler, ardından kurulum betiği; betik hata verirse sohbet başlamaz
      const profile = getEnvironment(envId);
      if (profile) {
        environments.applyVars(env, profile.vars);
        if (profile.setup?.trim()) {
          const r = await environments.runSetup(profile.setup, { cwd: dir, env });
          if (!r.ok) worktrees.cleanup(worktree);
          if (!r.ok) return { ok: false, error: `"${profile.name}" ortamının kurulum betiği hata verdi${r.code > 0 ? ` (çıkış ${r.code})` : ''}.` + (r.output ? '\n' + r.output : '') };
          env = r.env;
        }
      }

      const id = nextChatId++;
      const queue = new InputQueue();
      const pending = new Map();
      let stderrTail = '';
      let sessionId = resumeId || null;

      const project = projectKey(dir);
      // İzin kartı (arayüz: chat:permission → chat:permissionReply). canUseTool ve kartı kendisi açan araçlar (danis.js: eşiğin üstü) kullanır.
      const openCard = ({ toolName, input, title, description, decisionReason, blockedPath, suggestions, signal, onAllow, waitTitle = title }) => new Promise((resolve) => {
        const rid = nextReqId++;
        const done = onAllow ? (r) => { if (r.behavior === 'allow') onAllow(); resolve(r); } : resolve;
        pending.set(rid, { resolve: done, suggestions, input });
        // Yan oturumsa (kol) başlatan sohbete "seni bekliyor" kartı gider (sessions.js)
        sessions.noteWaiting(id, true, waitingSummary(toolName, input, waitTitle));
        send('chat:permission', id, {
          rid, toolName, input, title, description, decisionReason, blockedPath,
          canAlways: Array.isArray(suggestions) && suggestions.length > 0,
        });
        signal?.addEventListener('abort', () => {
          if (!pending.has(rid)) return;
          pending.delete(rid);
          if (!pending.size) sessions.noteWaiting(id, false);
          send('chat:permissionDone', id, rid);
          resolve({ behavior: 'deny', message: 'İptal edildi' });
        });
      });
      // Artifacts: Claude'un yazdığı .html/.svg dosyaları ve publish_artifact aracı galeriye düşer
      const onArtifact = (info) => send('chat:artifact', id, info);
      const track = artifacts.createTracker({ cwd: dir, accountId, onArtifact });
      // Simülatör aracı: Claude simülatörü açınca bu sohbetin sekmesinde canlı görüntü bölmesi açılır
      // Tarayıcı aracı: ilk kullanımda bu sohbetin yanında tarayıcı bölmesi açılır
      const extraTools = (z) => [
        simulator.createTool(sdk, z, { cwd: dir, onAttach: () => send('sim:open', id) }),
        browser.createTool(sdk, z, { chatId: id, onOpen: () => send('browser:open', id) }),
        terminals.createTool(sdk, z, { chatId: id, accountId, cwd: dir, envId }),
        changes.createTool(sdk, z, { chatId: id, cwd: dir }),
        sessions.createTool(sdk, z, { chatId: id, cwd: dir }),
        wrapup.createTool(sdk, z),
        opener.createTool(sdk, z, { cwd: dir }),
        prwatch.createTool(sdk, z, { chatId: id, cwd: dir, env }),
        ...hafiza.createTools(sdk, z, { accountId, project, getSessionId: () => sessionId }), // hatirla, hatirla_oku
        defter.createTool(sdk, z, { chatId: id, getSessionId: () => sessionId }), // her sohbete; çağrılınca ahtapotun başı mı diye bakar
        // Geçmiş beyne ya da kola danışma: izin kartını araç kendisi açar (tahmin eşiği aşınca), SDK'nın kartı açılmaz (allowedTools)
        danis.createTool(sdk, z, {
          chatId: id, accountId, getSessionId: () => sessionId,
          env: () => accountEnv(accountId), helper: (payload) => runHelper(accountId, payload),
          ask: ({ title, input, signal }) => openCard({ toolName: 'mcp__panel__danis', input, title, signal }).then((r) => r.behavior === 'allow'),
        }),
      ];
      const panelMcp = await artifacts.createMcpServer(sdk, { cwd: dir, accountId, getSessionId: () => sessionId, onArtifact, extraTools });
      // Ahtapotun başı (octopus.js): yeni ahtapot ('new') ya da "Devam et" ile açılan baş (ahtapot kimliği).
      // Ayrı kopyada açılmaz: kopya kapanınca silinir, baş oraya geri dönemezdi. Sistem istemi (hafıza talimatı) buna bağlı olduğu için
      // seçeneklerden önce; arada await yok, sohbet kaydıyla (chats.set) aynı eşzamanlı adımda kalır.
      const octoId = wantOctopus && !worktree && !parentId
        ? octopus.bindHead(id, { octopus: wantOctopus, accountId, project: { key: project, cwd: dir, name: path.basename(project) || project } })
        : null;

      const options = {
        cwd: dir,
        env,
        // Başa hafıza ve defter talimatı (hafiza.js, defter.js → HEAD_PROMPT): bağlamda olmayanı önce hatirla ile arasın; ret, zevk, karar,
        // kural ve açık işi deftere yazsın. "Beyin yap" ile baş olan sohbet bunları ancak yeniden açılınca alır (sistem istemi süreç açılırken verilir).
        systemPrompt: { type: 'preset', preset: 'claude_code', ...(octoId ? { append: hafiza.HEAD_PROMPT + '\n\n' + defter.HEAD_PROMPT } : {}) },
        settingSources: ['user', 'project', 'local'], // CLAUDE.md, hook'lar, izinler, skill'ler
        mcpServers: { panel: panelMcp },
        allowedTools: ['mcp__panel__publish_artifact', 'mcp__panel__show', 'mcp__panel__show_widget', 'mcp__panel__wrap_up', 'mcp__panel__open',
          'mcp__panel__hatirla', 'mcp__panel__hatirla_oku', 'mcp__panel__defter', 'mcp__panel__danis', ...autoAllowTools()],
        includePartialMessages: true,
        includeHookEvents: true,
        hooks: hooks.create({ chatId: id, accountId }), // Claude Code kancaları (hooks.js): günlük, otomatik sıkıştırma izni (compaction.js), defteri masaya koyma (defter.js)
        allowDangerouslySkipPermissions: true, // "Tam yetki" moduna sonradan geçebilmek için
        stderr: (d) => { stderrTail = (stderrTail + d).slice(-4000); },
        canUseTool: (toolName, input, o) => {
          // Simülatör: bakmak/dokunmak/yazmak sormadan; .app başlatmak ve adres açmak izin kartıyla (simulator.js → ASK_ACTIONS)
          if (toolName === 'mcp__panel__simulator' && !simulator.ASK_ACTIONS.has(input?.action)) {
            return Promise.resolve({ behavior: 'allow', updatedInput: input });
          }
          // Tarayıcı: yerel ve izinli siteler sormadan; dış sitede site başına kart (onaylanınca site bu sohbette izinli).
          // "Hep izin ver" önerisi verilmez: araç düzeyinde kural site ve komut denetimini atlatırdı.
          // Terminal: okumak sormadan; komut çalıştırmak her seferinde, Claude'un açmadığı sekmeyi durdurmak kartla (terminals.js)
          // PR: bakmak ve izlemek sormadan; otomatik düzeltmeyi açmak kartla (prwatch.js)
          let site = null;
          const RULES = { mcp__panel__browser: browser, mcp__panel__terminal: terminals, mcp__panel__sessions: sessions, mcp__panel__pr: prwatch };
          if (RULES[toolName]) {
            site = RULES[toolName].permission(id, input, { cwd: dir, project });
            if (!site) return Promise.resolve({ behavior: 'allow', updatedInput: input });
          }
          const suggestions = site ? undefined : o.suggestions;
          return openCard({ toolName, input, title: site?.title || o.title, description: o.description, decisionReason: o.decisionReason,
            blockedPath: o.blockedPath, suggestions, signal: o.signal, waitTitle: site?.title, onAllow: site?.origin ? () => browser.allowOrigin(id, site.origin) : null });
        },
      };
      // Test için: sahte bir Claude Code çalıştırılabiliri verilebilir
      if (process.env.CLAUDE_PANEL_CLAUDE_BIN) options.pathToClaudeCodeExecutable = process.env.CLAUDE_PANEL_CLAUDE_BIN;
      if (model) options.model = model;
      if (effort) options.effort = effort;
      if (permissionMode) options.permissionMode = permissionMode;
      if (mode === 'continue') options.continue = true;
      if (mode === 'resume' && resumeId) options.resume = resumeId;

      // Sohbetin kaydı. Beden (Claude Code süreci: q, queue) yeniden doğuşta (dogus.js) değişir; sohbet kimliği, sekme, kollar ve kartlar aynı kalır.
      const c = {
        q: null, queue: null, pending, accountId, project, worktree, dir, parentId: parentId || null, getSessionId: () => sessionId,
        body: 0, waiters: [], model: model || null, effort: effort || null, permissionMode: permissionMode || null, rebirthing: false,
      };
      chats.set(id, c);

      // Bir beden: süreç ve mesaj akışı. Eski bedenin geç gelen mesajları, kapanışı ve tur sonu ölçümü yok sayılır (c.body).
      const startBody = (opts) => {
        const body = ++c.body;
        const queue = new InputQueue();
        const q = sdk.query({ prompt: queue, options: opts });
        Object.assign(c, { q, queue });
        let turnText = []; // bu turun Claude metni (ana süreçten gönderilen turlar onu bekler: c.turn)
        (async () => {
          try {
            for await (const msg of q) {
              if (c.body !== body) break;
              if (msg.session_id && msg.session_id !== sessionId) { sessionId = msg.session_id; octopus.noteSession(id, sessionId); }
              if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
                defter.noteCompacted(id); // SessionStart (compact) gelmezse defter sonraki mesajda
                sinav.noteDue(id, 'compact'); // PostCompact kancası gelmezse de sınav yapılır
              }
              send('chat:msg', id, msg);
              track(msg);
              if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
                const blocks = msg.message?.content || [];
                const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
                sessions.noteText(id, text);
                if (text) turnText.push(text);
                const todo = blocks.findLast((b) => b.type === 'tool_use' && b.name === 'TodoWrite');
                if (todo) octopus.noteTodos(id, todo.input?.todos); // kolun ilerlemesi ahtapot kaydına
              }
              if (msg.type === 'result') {
                setBusy(id, false);
                sessions.turnEnded(id, msg.subtype === 'success');
                compaction.refresh(id, q).then((u) => { if (c.body === body) sinav.turnEnded(id, u); }); // sınavın tahmini bu ölçümden
                hafiza.noteTurn();
                c.waiters.shift()?.({ result: msg, text: turnText.join('\n') });
                turnText = [];
              }
            }
            if (c.body === body) send('chat:end', id, null);
          } catch (err) {
            if (c.body !== body) return;
            const detail = stderrTail.trim().split('\n').slice(-6).join('\n');
            send('chat:end', id, (err?.message || String(err)) + (detail ? '\n' + detail : ''));
          } finally {
            if (c.body === body) {
              for (const { resolve } of pending.values()) resolve({ behavior: 'deny', message: 'Oturum kapandı' });
              pending.clear();
              for (const w of c.waiters.splice(0)) w(null);
              chats.delete(id);
              setBusy(id, false);
              browser.forget(id);
              sessions.closed(id);
              octopus.chatClosed(id);
              prwatch.forget(id);
              hooks.forget(id);
              compaction.forget(id);
              defter.forget(id);
              sinav.forget(id);
              dogus.forget(id);
            }
          }
        })();
        // Model listesini arka planda iste
        q.supportedModels?.().then((models) => { if (c.body === body) send('chat:models', id, models); }).catch(() => {});
      };
      startBody(options);

      // Ana süreçten bir tur (dogus.js): mesaj gider, tur sonunda { result, text } döner; sohbet kapanırsa null
      c.turn = (text) => new Promise((resolve) => { c.waiters.push(resolve); pushUser(id, c, text); });
      // Yeniden doğuş: aynı seçeneklerle (devam etmeden) yeni bir süreç açılır, eski bedenin süreci kapanır (oturum dosyası kalır: fosil).
      // İlk mesaj devir notudur; ilk tur bitince döner. Panelin MCP sunucusu yeni süreç için yeniden kurulur.
      c.rebirth = async (text) => {
        const old = { q: c.q, queue: c.queue };
        const mcp = await artifacts.createMcpServer(sdk, { cwd: dir, accountId, getSessionId: () => sessionId, onArtifact, extraTools });
        const o = { ...options, mcpServers: { panel: mcp } };
        delete o.resume;
        delete o.continue;
        for (const k of ['model', 'effort', 'permissionMode']) if (c[k]) o[k] = c[k];
        sessionId = null;
        stderrTail = '';
        octopus.expectBody(id, 'rebirth'); // ilk session_id kayıtta yeni beden
        startBody(o);
        try { old.queue.close(); } catch {}
        try { old.q.close(); } catch {}
        sinav.noteDue(id, 'rebirth'); // yeni bedenin ilk turundan sonra sınav
        return c.turn(text);
      };

      // Sınav (sinav.js): başın sıkıştırmasından sonra, tur sonunda; dal danışmayla aynı yoldan açılır
      sinav.register(id, { sdk, cwd: dir, getSessionId: () => sessionId, env: () => accountEnv(accountId), helper: (payload) => runHelper(accountId, payload) });
      // Yeniden doğuş (dogus.js): yalnız ahtapotun başında; oturum dosyası hesabın ayar klasöründen okunur
      dogus.register(id, {
        accountId, dir, getSessionId: () => sessionId, isBusy: () => busy.has(id),
        configDir: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
        turn: (text) => c.turn(text), rebirth: (text) => c.rebirth(text), setRebirthing: (on) => { c.rebirthing = !!on; },
      });
      // Yan oturum (sessions.js): başlatan sohbet açıksa ona bağlanır; her tur sonunda ona bildirim gider
      if (parentId && chats.has(parentId)) sessions.register(id, parentId, title, dir, worktree);

      return { ok: true, id, cwd: dir, title: folderTitle, worktree: worktree && { branch: worktree.branch, path: worktree.path }, octopus: octoId };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // İçerik düz metin ya da blok dizisidir (ekli görseller + ekli dosyalar + metin; bkz. renderer/chat.js → messageContent).
  // Yalnız Claude Code'un kabul ettiği iki blok tipi geçer.
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const cleanContent = (content) => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const out = [];
    for (const b of content) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text) out.push({ type: 'text', text: b.text });
      else if (b?.type === 'image' && IMAGE_TYPES.has(b.source?.media_type) && typeof b.source?.data === 'string') {
        out.push({ type: 'image', source: { type: 'base64', media_type: b.source.media_type, data: b.source.data } });
      }
    }
    return out;
  };

  ipcMain.on('chat:send', (_e, id, raw) => {
    const c = chats.get(id);
    const content = cleanContent(raw);
    if (!c || !content.length) return;
    if (c.rebirthing) return; // yeniden doğuş sürerken (dogus.js) turlar karışmasın; arayüz de göndermez
    // Kolun görev tanımı, ilk mesajına eklenen defter kısmı olmadan (defter.js → armNote)
    octopus.noteBrief(id, defter.stripArmNote(typeof content === 'string' ? content : content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')));
    pushUser(id, c, content);
  });

  ipcMain.on('chat:permissionReply', (_e, id, rid, reply) => {
    const c = chats.get(id);
    const p = c?.pending.get(rid);
    if (!p) return;
    c.pending.delete(rid);
    if (!c.pending.size) sessions.noteWaiting(id, false);
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

  // Hesabın girişi (ilk açılış sihirbazı, renderer/kurulum.js): mesaj göndermeyen kısa ömürlü süreçte accountInfo (token harcamaz).
  // Gerçek Claude Code 2.1.300'de ölçüldü (2026-10-17): girişsiz {"tokenSource":"none","apiProvider":"firstParty"},
  // girişli { email, organization, subscriptionType, apiProvider }. API anahtarı ya da 3. taraf sağlayıcı da giriş sayılır.
  ipcMain.handle('account:login', async (_e, accountId) => {
    let queue, q;
    try {
      const sdk = await loadSdk();
      const env = await accountEnv(accountId);
      queue = new InputQueue();
      const options = { cwd: os.homedir(), env, settingSources: [], persistSession: false, stderr: () => {} };
      if (process.env.CLAUDE_PANEL_CLAUDE_BIN) options.pathToClaudeCodeExecutable = process.env.CLAUDE_PANEL_CLAUDE_BIN;
      q = sdk.query({ prompt: queue, options });
      (async () => { try { for await (const _ of q); } catch {} })();
      const a = (await withTimeout(q.accountInfo(), 30000)) || {};
      const loggedIn = !!(a.email || (a.tokenSource && a.tokenSource !== 'none') || (a.apiKeySource && a.apiKeySource !== 'none') ||
        (a.apiProvider && a.apiProvider !== 'firstParty'));
      if (loggedIn) infoCache.delete(accountId); // girişten önce yoklanan kullanım "plan yok" kalmasın
      return { ok: true, loggedIn, email: a.email || '', plan: a.subscriptionType || '' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      try { queue?.close(); } catch {}
      try { q?.close(); } catch {}
    }
  });

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

  // Arayüzde gösterilecek bağlantı bilgisi: komut ya da adres. env ve headers gizli anahtar taşıyabildiği için gönderilmez.
  const mcpDetail = (conf) => {
    if (!conf || typeof conf !== 'object') return null;
    if (conf.url) return { type: conf.type || 'http', target: String(conf.url) };
    if (conf.command) return { type: conf.type || 'stdio', target: [conf.command, ...(Array.isArray(conf.args) ? conf.args : [])].join(' ') };
    return { type: conf.type || '', target: '' };
  };

  ipcMain.handle('mcp:list', async (_e, accountId, cwd, withStatus) => {
    try {
      const account = getAccount(accountId);
      if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
      const key = projectKey(expandHome(cwd) || os.homedir());
      const cfg = readJson(claudeJson(account)) || {};
      const proj = cfg.projects?.[key] || {};
      const off = new Set(proj.disabledMcpServers || []);
      const found = {
        local: proj.mcpServers || {},
        project: readJson(path.join(key, '.mcp.json'))?.mcpServers || {},
        user: cfg.mcpServers || {},
        // hesabın claude.ai bağlayıcıları (Figma, Drive…): yapılandırması claude.ai'de
        claudeai: Object.fromEntries((cfg.claudeAiMcpEverConnected || []).map((n) => [n, null])),
      };
      const servers = [];
      for (const scope of SCOPE_ORDER) {
        for (const [name, conf] of Object.entries(found[scope])) {
          if (!servers.some((s) => s.name === name)) servers.push({ name, scope, enabled: !off.has(name), detail: mcpDetail(conf) });
        }
      }
      // "Bağlayıcıları yönet": bu klasörde açık bir sohbet varsa bağlantı durumu ve araç sayısı onun Claude Code sürecinden
      let live = false;
      const c = withStatus && [...chats.values()].find((x) => x.accountId === accountId && x.project === key);
      if (c) {
        const list = await withTimeout(c.q.mcpServerStatus(), 8000).catch(() => null);
        if (Array.isArray(list)) {
          live = true;
          for (const st of list) {
            const s = servers.find((x) => x.name === st.name);
            if (!s) continue; // panelin kendi sunucusu (panel) gibi yapılandırma dışı olanlar
            s.status = st.status;
            s.tools = Array.isArray(st.tools) ? st.tools.length : null;
            if (st.error) s.error = String(st.error).slice(0, 300);
          }
        }
      }
      return { ok: true, project: key, servers, live };
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

  // ---------- Kayıt saklama süresi (cleanupPeriodDays) ----------
  // Claude Code oturum kayıtlarını varsayılan olarak 30 günde siler. Panel yalnız kullanıcının onayıyla,
  // hesabın genel settings.json'una (symlink ise hedefine) tek bir değer yazar (OCTOPUS-PLANI.md İ1, P2.2).
  const RETENTION_DAYS = 3650;
  ipcMain.handle('settings:retention', (_e, accountId) => {
    try {
      const account = getAccount(accountId);
      if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
      const file = userSettings(account);
      const v = readJson(file)?.cleanupPeriodDays;
      return { ok: true, days: typeof v === 'number' ? v : null, want: RETENTION_DAYS, file, shared: file !== path.join(configHome(account), 'settings.json') };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  ipcMain.handle('settings:setRetention', (_e, accountId) => {
    try {
      const account = getAccount(accountId);
      if (!account) throw new Error('Hesap bulunamadı: ' + accountId);
      const file = userSettings(account);
      const s = readJsonForWrite(file);
      s.cleanupPeriodDays = RETENTION_DAYS;
      writeJsonAtomic(file, s);
      return { ok: true, days: RETENTION_DAYS };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('chat:interrupt', async (_e, id) => {
    try { await chats.get(id)?.q.interrupt(); return true; } catch { return false; }
  });
  ipcMain.handle('chat:setModel', async (_e, id, model) => {
    const c = chats.get(id);
    if (c) c.model = model || null; // yeniden doğuşta yeni beden aynı modelle açılır
    try { await c?.q.setModel(model || undefined); return true; } catch (e) { return e.message; }
  });
  ipcMain.handle('chat:setEffort', async (_e, id, level) => {
    const c = chats.get(id);
    if (c) c.effort = level || null;
    try { await c?.q.applyFlagSettings({ effortLevel: level || null }); return true; } catch (e) { return e.message; }
  });
  ipcMain.handle('chat:setMode', async (_e, id, mode) => {
    const c = chats.get(id);
    if (c) c.permissionMode = mode || null;
    try { await c?.q.setPermissionMode(mode); return true; } catch (e) { return e.message; }
  });
  ipcMain.on('chat:close', (_e, id) => closeChat(id));

  // Geçmiş oturumlar: SDK ayar klasörünü süreç başına bir kez okuduğu için
  // her hesap için ayrı, kısa ömürlü bir yardımcı süreçte okuyoruz.
  ipcMain.handle('chat:sessions', (_e, accountId, cwd) => runHelper(accountId, { op: 'list', dir: expandHome(cwd) }));
  // Yeni sohbet ekranındaki "Octopus olarak başlat" için: klasörün ahtapotu ve geçmiş oturum sayısı (yalnız okunur).
  // Geçmişi olan klasörde anahtar kapalı gelir: var olan proje sormadan beyne çevrilmez (OCTOPUS-PLANI.md İ1, K8).
  ipcMain.handle('octopus:folder', async (_e, accountId, cwd) => {
    const dir = expandHome(cwd);
    const rec = octopus.forProject(accountId, projectKey(dir));
    const r = await runHelper(accountId, { op: 'list', dir });
    return { octopusId: rec?.id || null, history: r?.ok ? r.sessions.length : null };
  });
  // "Bu sohbeti beyin yap": açık sohbet projenin başı olur. Yalnız panelin ahtapot kaydı yazılır; oturuma ve projeye dokunulmaz (İ1).
  ipcMain.handle('octopus:adopt', (_e, id) => {
    try {
      const c = chats.get(id);
      if (!c) throw new Error('Sohbet açık değil.');
      if (c.parentId) throw new Error('Yan oturum beyin yapılamaz; baş ancak ana sohbet olabilir.');
      if (c.worktree) throw new Error('Ayrı kopyadaki sohbet beyin yapılamaz: kopya kapanınca silinir, baş oraya geri dönemez.');
      const octoId = octopus.adopt(id, { accountId: c.accountId, sessionId: c.getSessionId(),
        project: { key: c.project, cwd: c.dir, name: path.basename(c.project) || c.project } });
      if (!octoId) throw new Error('Bu projenin zaten bir ahtapotu var.');
      return { ok: true, id: octoId };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  ipcMain.handle('chat:history', (_e, accountId, sessionId, cwd) =>
    runHelper(accountId, { op: 'messages', sessionId, dir: expandHome(cwd) }));

  helper = runHelper;
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

// Başlatan sohbetin "seni bekliyor" kartında görünen kısa açıklama
function waitingSummary(toolName, input = {}, title) {
  if (toolName === 'AskUserQuestion') return 'Soru: ' + (input.questions?.[0]?.question || '');
  if (toolName === 'ExitPlanMode') return 'Plan onayı bekliyor';
  if (title) return title;
  return 'İzin: ' + toolName + (typeof input.command === 'string' ? ' · ' + input.command.slice(0, 120) : '');
}

// Sekme kapanınca (ya da panel kapanırken) çağrılır. Ayrı kopya temizse silinir, değilse korunur ve arayüze bildirilir.
function closeChat(id) {
  const c = chats.get(id);
  if (!c) return;
  try { c.queue.close(); } catch {}
  try { c.q.close(); } catch {}
  chats.delete(id);
  setBusy(id, false);
  prwatch.forget(id);
  if (c.worktree) {
    const r = worktrees.cleanup(c.worktree);
    if (!r.removed) send('worktree:kept', { branch: c.worktree.branch, path: c.worktree.path, dirty: r.dirty, ahead: r.ahead, error: r.error });
  }
}

function closeAll() {
  octopus.shutdown(); // panel kapanıyor: kapanan kollar "kesildi" sayılmaz
  for (const id of [...chats.keys()]) closeChat(id);
}

// Bir hesabın bir klasördeki geçmiş oturumları (yalnız okunur; SDK ayrı süreçte, CLAUDE.md §5)
const listSessions = (accountId, dir) => (helper ? helper(accountId, { op: 'list', dir }) : Promise.resolve({ ok: false, error: 'hazır değil' }));

module.exports = { setup, closeAll, count: () => chats.size, autoAllowTools, loginEnv, updateAwake, projectKey, listSessions };
