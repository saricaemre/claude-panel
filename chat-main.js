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
const preview = require('./preview');
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
const skills = require('./skills');
const kabuk = require('./kabuk');

let sdkPromise;
let helper = null; // scripts/sessions.mjs çalıştırıcısı (setup'ta); alma.js geçmiş oturumları bununla okur
const loadSdk = () => (sdkPromise ||= import('@anthropic-ai/claude-agent-sdk'));

// Panelde izin sormadan çalışan MCP sunucuları (sunucu adı tüm araçlarını kapsar): config.json → autoAllowMcp, varsayılan boş.
// Sohbet görünümüne allowedTools, terminaldeki claude'a --allowedTools olarak verilir.
let getAutoAllowMcp = () => [];
const autoAllowTools = () => getAutoAllowMcp().map((s) => `mcp__${s}`);

// Ahtapotun başında yüklü kalan panel araçları (sistem istemi bunları anar: octopus/hafiza/defter.js → HEAD_PROMPT)
const HEAD_TOOLS = ['sessions', 'hatirla', 'hatirla_oku', 'defter', 'danis'];

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

// Kullanıcı mesajı (yazma alanından, karttan ya da ana süreçten: dogus.js) Claude Code'a gider.
// uuid: arayüzün verdiği kimlik; Claude Code kayda bu kimlikle yazar, kod checkpoint'i de ona bağlanır (geri sarma, 2026-10-25'te gerçek CLI'de ölçüldü)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pushUser(id, c, content, uuid) {
  const msg = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } };
  if (typeof uuid === 'string' && UUID_RE.test(uuid)) {
    msg.uuid = uuid;
    // Kayıt okunamazsa (sahte CLI kayıt yazmaz) konuşmanın geri sarılacağı yer: o an akışta görülen son kayıt.
    // Claude çalışırken giden mesaj turun ortasında araya girer, kendi kaydı ve checkpoint'i olmaz (at: false).
    // epoch: o ana kadarki sıkıştırma sayısı; sonradan sıkıştırılan mesaja konuşma geri sarılamaz
    c.forks.set(uuid, { at: busy.has(id) ? false : c.lastChain, epoch: c.epoch });
    c.queued.set(uuid, msg); // Claude Code alana kadar (command_lifecycle started): geri alma ve hemen gönderme bundan
  }
  sessions.noteBusy(id);
  setBusy(id, true);
  c.queue.push(msg);
}

// Kabuk kipinin çıktısı (kabuk.js): shouldQuery: false ile Claude Code'un kaydına eklenir, tur açmaz ve API'ye gitmez; sonraki mesajla
// birlikte okunur (2026-10-26'da gerçek CLI 2.1.310'da ölçüldü: olcum/kolayliklar.mjs kabuk). UserPromptSubmit kancası çağrılmaz (defter
// satırı eklenmez), kod checkpoint'i yok (geri sarılamaz). Claude çalışırken gönderilirse kuyruktaki mesaj gibi sonraki araç adımında araya girer.
function pushShell(c, text) {
  const uuid = require('crypto').randomUUID();
  c.shells.add(uuid);
  c.queue.push({ type: 'user', uuid, message: { role: 'user', content: text }, parent_tool_use_id: null, shouldQuery: false, origin: { kind: 'human' } });
}
// Boştayken gelen kabuk mesajını Claude Code kendi "turunda" işler: session_state_changed running, lifecycle queued → started, init, boş
// result, completed, idle (ölçüldü). Panel bunu tur saymaz: meşgul olmaz, tur sonu işleri (yan oturum bildirimi, sınav, ölçüm, tur özeti)
// çalışmaz, arayüze gitmez. shellTurn: 'run' (sürüyor), 'after' (result geldi, idle bekleniyor); gerçek bir mesajın started'ı onu bitirir.
function shellSwallows(c, msg) {
  if (!c.shells.size && !c.shellTurn) return false;
  const u = msg.type === 'command_lifecycle' ? msg.command_uuid : null;
  if (u && c.shells.has(u)) {
    if (msg.state === 'started' && !c.inTurn) c.shellTurn = 'run'; // c.inTurn: tur sürerken araya girdi (kendi turu yok)
    if (msg.state !== 'queued' && msg.state !== 'started') c.shells.delete(u);
    return true;
  }
  if (u && msg.state === 'started') { c.shellTurn = false; return false; }
  if (msg.type === 'system' && msg.subtype === 'session_state_changed') {
    if (msg.state === 'running' && !c.inTurn && !busy.has(c.id) && c.shells.size) { c.shellTurn = 'run'; return true; }
    if (msg.state === 'idle' && c.shellTurn) { c.shellTurn = false; return true; }
    return false;
  }
  if (c.shellTurn !== 'run') return false;
  if (msg.type === 'system' && msg.subtype === 'init') return true;
  if (msg.type === 'result') { c.shellTurn = 'after'; return true; }
  return false;
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
// Arka planda görevi süren sohbet de sayılır (Mac uyursa arka plandaki komut ve alt ajan da durur)
function updateAwake() {
  const want = (busy.size > 0 || [...chats.values()].some((c) => c.bgTasks > 0)) && keepAwake();
  if (want && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!want && blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
}
const setBusy = (id, on) => { on ? busy.add(id) : busy.delete(id); updateAwake(); };
let nextReqId = 1;

function setup({ getWindow, getAccount, getEnvironment, expandHome, artifacts, getKeepAwake, getAutoCompact, getAutoAllow, getPromptSuggestions }) {
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

  // Aynı oturum iki sohbette açılmaz: iki Claude Code süreci aynı kayda yazar, eski bellekli süreç yazınca kayıt dallanır. Hesaplar
  // projects klasörünü paylaşabildiği için başka hesabın sohbeti de sayılır. Arayüz önce açık sekmeye geçer (renderer/chat.js →
  // openSessionTab); bu son savunma. Başlatılmakta olanlar da sayılır (opening): denetimle chats.set arasında await var.
  const opening = new Map(); // oturum kimliği -> hesap
  function sessionOwner(sessionId) {
    if (opening.has(sessionId)) return opening.get(sessionId);
    for (const c of chats.values()) if (c.getSessionId() === sessionId) return c.accountId;
    return null;
  }

  ipcMain.handle('chat:start', async (_e, opts) => {
    const claim = opts?.mode === 'resume' && opts.resumeId ? opts.resumeId : null;
    if (claim) {
      const owner = sessionOwner(claim);
      if (owner) return { ok: false, error: `Bu oturum ${getAccount(owner)?.name || owner} hesabında açık bir sohbette; aynı oturum iki sohbette açılamaz.` };
      opening.set(claim, opts.accountId);
    }
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

      // Claude Code kendiliğinden tur açınca (arka plan görevi bitti) session_state_changed gelsin: arayüz "çalışıyor" gösterir.
      // Değişken olmadan gelmiyor (2026-10-25'te gerçek CLI 2.1.300'de ölçüldü)
      env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';
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
      // MCP elicitation (sunucu kullanıcıdan form ya da adres ister): aynı kart yolu, yanıt ElicitResult. Sinyal sunucunun zaman aşımında
      // ve "Durdur"da düşer (2026-10-26'da gerçek CLI 2.1.310'da ölçüldü: docs/claude-code-eksikleri/olcum/elicitation.mjs)
      const openElicitation = (request, signal) => new Promise((resolve) => {
        const rid = nextReqId++;
        const el = elicitationRequest(request);
        pending.set(rid, { resolve, elicit: el });
        sessions.noteWaiting(id, true, (el.mode === 'url' ? 'Adres: ' : 'Form: ') + el.serverName + ' · ' + el.message.slice(0, 120));
        send('chat:permission', id, { rid, toolName: 'mcp__' + el.serverName, elicitation: el });
        signal?.addEventListener('abort', () => {
          if (!pending.has(rid)) return;
          pending.delete(rid);
          if (!pending.size) sessions.noteWaiting(id, false);
          send('chat:permissionDone', id, rid, 'cancelled');
          resolve({ action: 'cancel' });
        });
      });
      // Ahtapotun kolu (başın açtığı yan oturum): sistem istemine rapor biçimi (octopus.js → ARM_PROMPT) gider, wrap_up verilmez:
      // kolun okuru baştır, kutuyu (ve içindeki soruyu) baş görmez; rapor son mesajdır (sessions.js → turnEnded)
      // "Devam et" ile açılan kol da koldur (octopus.findArm): baş yeniden açılınca onu görür, bitirir, kapatır
      const armRef = !parentId && !wantOctopus && mode === 'resume' ? octopus.findArm(accountId, resumeId) : null;
      const asArm = parentId ? octopus.roleOf(parentId)?.role === 'head' : !!armRef;
      // Artifacts: Claude'un yazdığı .html/.svg dosyaları ve publish_artifact aracı galeriye düşer
      const onArtifact = (info) => send('chat:artifact', id, info);
      const track = artifacts.createTracker({ cwd: dir, accountId, onArtifact });
      // Simülatör aracı: Claude simülatörü açınca bu sohbetin sekmesinde canlı görüntü bölmesi açılır
      // Tarayıcı aracı: ilk kullanımda bu sohbetin yanında tarayıcı bölmesi açılır
      const extraTools = (z) => [
        simulator.createTool(sdk, z, { cwd: dir, onAttach: () => send('sim:open', id) }),
        browser.createTool(sdk, z, { chatId: id, onOpen: () => send('browser:open', id) }),
        terminals.createTool(sdk, z, { chatId: id, accountId, cwd: dir, envId }),
        preview.createTool(sdk, z, { chatId: id, bypass: () => chats.get(id)?.permissionMode === 'bypassPermissions', openUrl: (url) => browser.openUrl(id, url, () => send('browser:open', id)) }),
        changes.createTool(sdk, z, { chatId: id, cwd: dir }),
        sessions.createTool(sdk, z, { chatId: id, cwd: dir, getModels: () => chats.get(id)?.models || infoCache.get(accountId)?.models }),
        ...(asArm ? [] : [wrapup.createTool(sdk, z)]),
        // Görev listesi kollarda da: kolun ilerlemesi ahtapot kaydına gider (TodoWrite'la aynı yol)
        wrapup.createPlanTool(sdk, z, { onChange: (items) => octopus.noteTodos(id, items) }),
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
      // Panelin araçlarından yalnız sık kullanılanlar yüklü, öbürleri araç aramasına ertelenir (artifacts.js → ALWAYS_LOAD);
      // başın sistem istemi kolları, hafızayı, defteri ve danışmayı andığı için başta onlar da yüklü
      // Kendiliğinden doğrulama (preview.js): ayar açık ve projede launch.json varsa talimat sistem istemine, andığı araçlar yüklü
      const { verify } = preview.bind(id, { accountId, dir, envId });
      const load = [...(wantOctopus && !worktree && !parentId ? HEAD_TOOLS : []), ...(verify ? preview.VERIFY_TOOLS : [])];
      const panelMcp = await artifacts.createMcpServer(sdk, { cwd: dir, accountId, getSessionId: () => sessionId, onArtifact, extraTools, load });
      // Ahtapotun başı (octopus.js): yeni ahtapot ('new') ya da "Devam et" ile açılan baş (ahtapot kimliği).
      // Ayrı kopyada açılmaz: kopya kapanınca silinir, baş oraya geri dönemezdi. Sistem istemi (hafıza talimatı) buna bağlı olduğu için
      // seçeneklerden önce; arada await yok, sohbet kaydıyla (chats.set) aynı eşzamanlı adımda kalır.
      const octoId = wantOctopus && !worktree && !parentId
        ? octopus.bindHead(id, { octopus: wantOctopus, accountId, sessionId: claim, project: { key: project, cwd: dir, name: path.basename(project) || project } })
        : null;
      if (octoId) sessions.relink(id, octoId); // baş yeniden açıldı: açık kolları yeni sohbete bağlanır
      if (armRef) octopus.bindArm(id, armRef);

      const options = {
        cwd: dir,
        env,
        // Başa hafıza, görev ve defter talimatı (hafiza.js, octopus.js, defter.js → HEAD_PROMPT): bağlamda olmayanı önce hatirla ile arasın; işi kollara versin; ret, zevk, karar,
        // kural ve açık işi deftere yazsın. "Beyin yap" ile baş olan sohbet bunları ancak yeniden açılınca alır (sistem istemi süreç açılırken verilir).
        // Kola rapor biçimi (octopus.js → ARM_PROMPT).
        // Her sohbete görev listesi talimatı (wrapup.js → PLAN_PROMPT), rolün talimatından sonra; açıksa kendiliğinden doğrulama (preview.js).
        systemPrompt: { type: 'preset', preset: 'claude_code',
          append: [...(octoId ? [hafiza.HEAD_PROMPT, octopus.HEAD_PROMPT, defter.HEAD_PROMPT] : asArm ? [octopus.ARM_PROMPT] : []), wrapup.PLAN_PROMPT,
            ...(verify ? [preview.VERIFY_PROMPT] : [])].join('\n\n') },
        settingSources: ['user', 'project', 'local'], // CLAUDE.md, hook'lar, izinler, skill'ler
        mcpServers: { panel: panelMcp },
        allowedTools: ['mcp__panel__publish_artifact', 'mcp__panel__show', 'mcp__panel__show_widget', 'mcp__panel__wrap_up', 'mcp__panel__plan', 'mcp__panel__open',
          'mcp__panel__hatirla', 'mcp__panel__hatirla_oku', 'mcp__panel__defter', 'mcp__panel__danis', ...autoAllowTools()],
        includePartialMessages: true,
        includeHookEvents: true,
        // Kod checkpoint'leri: her mesajdan önce Claude'un dosya araçlarıyla değişecek dosyalar yedeklenir, rewindFiles ile geri gelir.
        // Yedekler ayar klasöründe (file-history), süreç değişince de kullanılır (ölçüldü). Bash'in ve alt ajanların değiştirdikleri yedeklenmez.
        enableFileCheckpointing: true,
        // Arka plan görevlerini arayüz tek tek durdurur (chat:stopTask): "Durdur" yalnız turu keser, arka plandaki alt ajanlar sürer.
        // Bildirilmezse "Durdur" arka plandaki alt ajanları da öldürür (ölçüldü; arka plan Bash'i öldürmüyor)
        perTaskStopAffordance: true,
        // Önerilen istem (config.json → promptSuggestions, varsayılan kapalı): 2. turdan itibaren her tur sonunda (result'tan sonra)
        // prompt_suggestion. Claude Code bunu aynı modele, ana konuşmanın önbelleğiyle ayrı bir istekle üretir (2026-10-26'da gerçek CLI
        // 2.1.310'da ölçüldü: olcum/kolayliklar.mjs oneri); ilk turda, plan kipinde ve kabuk mesajından sonra istek yok. Yan oturumlara verilmez.
        ...(getPromptSuggestions?.() && !parentId ? { promptSuggestions: true } : {}),
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
          // Önizleme: listelemek, okumak, durdurmak sormadan; bir yapılandırmanın komutu bu sohbette ilk kez çalışırken kartla (preview.js)
          const RULES = { mcp__panel__browser: browser, mcp__panel__terminal: terminals, mcp__panel__sessions: sessions, mcp__panel__pr: prwatch, mcp__panel__preview: preview };
          if (RULES[toolName]) {
            site = RULES[toolName].permission(id, input, { cwd: dir, project, models: chats.get(id)?.models || infoCache.get(accountId)?.models });
            if (!site) return Promise.resolve({ behavior: 'allow', updatedInput: input });
          }
          const suggestions = site ? undefined : o.suggestions;
          return openCard({ toolName, input, title: site?.title || o.title, description: o.description, decisionReason: site?.detail || o.decisionReason,
            blockedPath: o.blockedPath, suggestions, signal: o.signal, waitTitle: site?.title,
            onAllow: site?.onAllow || (site?.origin ? () => browser.allowOrigin(id, site.origin) : null) });
        },
        // Verilmezse SDK her isteği kendiliğinden reddeder (decline); kancalar (Elicitation) önce çalışır
        onElicitation: (request, o) => openElicitation(request, o.signal),
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
        id, q: null, queue: null, pending, accountId, project, worktree, dir, parentId: parentId || null, getSessionId: () => sessionId,
        body: 0, waiters: [], model: model || null, effort: effort || null, permissionMode: permissionMode || null, rebirthing: false,
        // Geri sarma: akışta görülen son zincir kaydı (yeni oturumda null: ilk mesajın öncesi yok; sürdürülende bilinmiyor) ve mesaj başına o anki değeri
        lastChain: mode === 'new' ? null : undefined, forks: new Map(), epoch: 0, rewinding: false,
        // Kuyruk: Claude Code'a gidip henüz alınmamış mesajlar (uuid → mesaj) ve bir turun sürüp sürmediği (araya girme / kendi turu ayrımı)
        queued: new Map(), inTurn: false,
        bgTasks: 0, // arka planda süren görev sayısı (süreç başına; yeni bedende sıfır)
        env, // kabuk kipi (kabuk.js) komutu Claude'un ortamıyla çalıştırır
        shells: new Set(), shellTurn: false, // Claude Code'a gidip henüz işlenmemiş kabuk mesajları ve onların boş "turu" (pushShell)
        configDir: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), // oturum kaydı burada (yalnız okunur)
      };
      chats.set(id, c);

      // Bir beden: süreç ve mesaj akışı. Eski bedenin geç gelen mesajları, kapanışı ve tur sonu ölçümü yok sayılır (c.body).
      // probe: deneme bedeni (geri sarma: c.rewindTo). Açılışı doğrulanana kadar mesajları bekletilir, kapanışı sohbeti kapatmaz;
      // dönen release() bekletilenleri akıtır ve bedeni asıl beden yapar.
      const startBody = (opts, probe) => {
        const body = ++c.body;
        const queue = new InputQueue();
        const q = sdk.query({ prompt: queue, options: opts });
        Object.assign(c, { q, queue });
        let turnText = []; // bu turun Claude metni (ana süreçten gönderilen turlar onu bekler: c.turn)
        let held = probe ? [] : null;
        const handle = (msg) => {
          if (msg.session_id && msg.session_id !== sessionId) { sessionId = msg.session_id; octopus.noteSession(id, sessionId); }
          if (shellSwallows(c, msg)) return;
          // Zincirdeki son kayıt (Claude'un mesajı ya da araç sonucu; alt ajanınki sayılmaz): kayıttaki ebeveynle aynı kimlik (ölçüldü)
          if (msg.uuid && !msg.parent_tool_use_id && !msg.isReplay && (msg.type === 'assistant' || (msg.type === 'user' && Array.isArray(msg.message?.content)))) c.lastChain = msg.uuid;
          if (msg.type === 'assistant' && !msg.parent_tool_use_id) c.inTurn = true;
          // Kuyruk (2026-10-26'da gerçek CLI 2.1.310'da ölçüldü): kimlikli her mesaja command_lifecycle queued → started → completed ya da
          // cancelled. started tur sürerken gelirse mesaj sonraki araç adımında araya girdi (kayıtta queued_command, kendi turu yok); tur
          // bittikten sonra gelirse kendi turunu açtı (araçsız turda, priority 'later'da, "Durdur"dan sonra): o tur da meşgul sayılır,
          // session_state_changed arada idle'a düşmediği için başka işaret yok. Geri sarmanın yeri de buna göre düzelir.
          if (msg.type === 'command_lifecycle' && msg.command_uuid) {
            const u = msg.command_uuid;
            if (msg.state !== 'queued') c.queued.delete(u);
            if (msg.state === 'started') {
              const f = c.forks.get(u);
              if (f) Object.assign(f, { at: c.inTurn ? false : c.lastChain, epoch: c.epoch });
              if (!c.inTurn && !busy.has(id)) { sessions.noteBusy(id); setBusy(id, true); }
              c.inTurn = true;
            }
          }
          // Gerçek izin kipi (ayarlardaki defaultMode dahil): önizleme aracı "Tam yetki"de kartsız çalışır, öbür kiplerde onay ister (preview.js)
          if (msg.type === 'system' && (msg.subtype === 'init' || msg.subtype === 'status') && msg.permissionMode) c.permissionMode = msg.permissionMode;
          // Claude Code'un kendiliğinden açtığı tur (arka plan görevi bitti): panel de meşgul sayar (uyanık tutma, geri sarma, kolun durumu)
          if (msg.type === 'system' && msg.subtype === 'session_state_changed' && msg.state === 'running' && !busy.has(id)) { sessions.noteBusy(id); setBusy(id, true); }
          // Sunucu adres kipindeki isteğin tamamlandığını bildirdi: kart hâlâ açıksa kabul sayılır (kullanıcı "Tamamladım"a basmadan bitirdi)
          if (msg.type === 'system' && msg.subtype === 'elicitation_complete') {
            for (const [rid, p] of pending) {
              if (p.elicit?.elicitationId !== msg.elicitation_id || p.elicit.serverName !== msg.mcp_server_name) continue;
              pending.delete(rid);
              if (!pending.size) sessions.noteWaiting(id, false);
              p.resolve({ action: 'accept' });
              send('chat:permissionDone', id, rid, 'complete');
            }
          }
          // Arka plandaki görevlerin tamamı (her değişimde yeniden): uyanık tutma ve geri sarma uyarısı bundan
          if (msg.type === 'system' && msg.subtype === 'background_tasks_changed') { c.bgTasks = (msg.tasks || []).filter((t) => !t.ambient).length; updateAwake(); }
          if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
            c.epoch++; // geri sarma: bundan önceki mesajların öncesine dönülemez (Claude Code "No message found" der)
            if (msg.uuid) c.lastChain = msg.uuid; // sınır da zincirde bir kayıttır; sonraki mesaj buraya geri sarılabilir
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
            c.inTurn = false;
            setBusy(id, false);
            sessions.turnEnded(id, msg.subtype === 'success');
            compaction.refresh(id, q).then((u) => { if (c.body === body) sinav.turnEnded(id, u); }); // sınavın tahmini bu ölçümden
            hafiza.noteTurn();
            c.waiters.shift()?.({ result: msg, text: turnText.join('\n') });
            turnText = [];
          }
        };
        (async () => {
          try {
            for await (const msg of q) {
              // Eski beden: döngü biter. Geri sarmanın denemesi sürerken bitmez (deneme tutmazsa bu beden geri gelir), mesajı atlanır
              if (c.body !== body) { if (c.probing) continue; break; }
              if (held) held.push(msg); else handle(msg);
            }
            if (c.body === body && !held) send('chat:end', id, null);
          } catch (err) {
            if (c.body !== body || held) return;
            const detail = stderrTail.trim().split('\n').slice(-6).join('\n');
            send('chat:end', id, (err?.message || String(err)) + (detail ? '\n' + detail : ''));
          } finally {
            if (c.body === body && !held) {
              for (const { resolve, elicit } of pending.values()) resolve(elicit ? { action: 'cancel' } : { behavior: 'deny', message: 'Oturum kapandı' });
              pending.clear();
              for (const w of c.waiters.splice(0)) w(null);
              chats.delete(id);
              setBusy(id, false);
              browser.forget(id);
              preview.forget(id);
              sessions.closed(id);
              octopus.chatClosed(id);
              prwatch.forget(id);
              hooks.forget(id);
              compaction.forget(id);
              defter.forget(id);
              sinav.forget(id);
              dogus.forget(id);
              kabuk.forget(String(id));
            }
          }
        })();
        // Model listesini arka planda iste
        q.supportedModels?.().then((models) => { if (c.body !== body) return; c.models = models; send('chat:models', id, models); }).catch(() => {}); // c.models: sessions start'ın model adı
        return () => { const h = held || []; held = null; for (const m of h) handle(m); };
      };
      startBody(options);

      // Ana süreçten bir tur (dogus.js): mesaj gider, tur sonunda { result, text } döner; sohbet kapanırsa null
      c.turn = (text) => new Promise((resolve) => { c.waiters.push(resolve); pushUser(id, c, text); });
      // Yeniden doğuş: aynı seçeneklerle (devam etmeden) yeni bir süreç açılır, eski bedenin süreci kapanır (oturum dosyası kalır: fosil).
      // İlk mesaj devir notudur; ilk tur bitince döner. Panelin MCP sunucusu yeni süreç için yeniden kurulur.
      c.rebirth = async (text) => {
        const old = { q: c.q, queue: c.queue };
        const mcp = await artifacts.createMcpServer(sdk, { cwd: dir, accountId, getSessionId: () => sessionId, onArtifact, extraTools, load });
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
        c.lastChain = null;
        c.forks.clear();
        c.bgTasks = 0; // eski sürecin arka plan görevleri onunla kapandı
        updateAwake();
        return c.turn(text);
      };

      // Konuşmayı geri sarma: aynı oturum, at'e (geri sarılan mesajın kayıttaki ebeveyni) kadar yüklenen yeni bir süreçte sürer.
      // Oturum kimliği değişmez (ölçüldü): ahtapot kaydı, kollar, bölmeler aynı kalır. Kayıt dallanır; geçmiş yüklenince yeni dal görünür.
      // Yeni süreç önce deneme bedenidir: Claude Code bilinmeyen ya da son sıkıştırmadan önceki bir noktada açılışta "No message found…"
      // hatasıyla kapanır (ölçüldü, ~0,7 sn), mesajsız getContextUsage da aynı hatayla reddedilir. O zaman eski beden yerinde kalır.
      c.rewindTo = async (at) => {
        const old = { q: c.q, queue: c.queue, body: c.body, lastChain: c.lastChain };
        const mcp = await artifacts.createMcpServer(sdk, { cwd: dir, accountId, getSessionId: () => sessionId, onArtifact, extraTools, load });
        const o = { ...options, mcpServers: { panel: mcp }, resume: sessionId, resumeSessionAt: at };
        delete o.continue;
        for (const k of ['model', 'effort', 'permissionMode']) if (c[k]) o[k] = c[k];
        const tail = stderrTail;
        stderrTail = '';
        const release = startBody(o, true);
        c.probing = true;
        try {
          await withTimeout(c.q.getContextUsage({ detail: 'summary' }), 30000);
        } catch (err) {
          c.probing = false;
          const bad = { q: c.q, queue: c.queue };
          Object.assign(c, { q: old.q, queue: old.queue, body: old.body, lastChain: old.lastChain });
          stderrTail = tail;
          try { bad.queue.close(); } catch {}
          try { bad.q.close(); } catch {}
          const why = String(err?.message || err);
          throw new Error(/No message found/i.test(why) ? 'Bu nokta son sıkıştırmadan önce kalıyor; konuşma oraya geri sarılamaz.' : 'Claude Code o noktadan açılamadı: ' + why);
        }
        c.probing = false;
        release();
        c.lastChain = at;
        c.bgTasks = 0; // eski sürecin arka plan görevleri onunla kapanır
        updateAwake();
        try { old.queue.close(); } catch {}
        try { old.q.close(); } catch {}
        defter.untable(id); // masadaki özeti koyan mesaj silinmiş olabilir; sonraki ilk mesaj yeniden koyar
        compaction.refresh(id, c.q).catch(() => {}); // bağlam halkası kısalan konuşmayı göstersin
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
      else if (armRef) sessions.rebind(id, armRef, dir);

      return { ok: true, id, cwd: dir, title: folderTitle, worktree: worktree && { branch: worktree.branch, path: worktree.path }, octopus: octoId };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      if (claim) opening.delete(claim);
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

  ipcMain.on('chat:send', (_e, id, raw, uuid) => {
    const c = chats.get(id);
    const content = cleanContent(raw);
    if (!c || !content.length) return;
    if (c.rebirthing || c.rewinding) return; // yeniden doğuş (dogus.js) ya da geri sarma sürerken turlar karışmasın; arayüz de göndermez
    // Kolun görev tanımı, ilk mesajına eklenen defter kısmı olmadan (defter.js → armNote)
    octopus.noteBrief(id, defter.stripArmNote(typeof content === 'string' ? content : content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')));
    pushUser(id, c, content, uuid);
  });

  // ---------- Kabuk kipi: "!komut" (kabuk.js) ----------
  // Komut sohbetin klasöründe ve ortamında çalışır, çıktı arayüze akar (chat:shellData); bitince Claude'a kayıt eki olarak gider.
  // Sohbet bu arada kapandıysa ya da yeniden doğuş/geri sarma sürüyorsa gitmez (sent: false).
  ipcMain.handle('chat:shell', async (_e, id, runId, cmd) => {
    const c = chats.get(id);
    if (!c?.queue) return { ok: false, error: 'Sohbet kapalı.' };
    if (typeof cmd !== 'string' || !cmd.trim() || cmd.length > 20000 || !/^[\w-]{1,40}$/.test(String(runId))) return { ok: false, error: 'Geçersiz komut.' };
    if (c.rebirthing || c.rewinding) return { ok: false, error: 'Yeniden doğuş ya da geri sarma sürüyor.' };
    const r = await kabuk.run({ key: `${id}:${runId}`, cmd, cwd: c.dir, env: c.env, onData: (stream, text) => send('chat:shellData', id, runId, stream, text) }).done;
    const cc = chats.get(id);
    const sent = !!cc?.queue && cc === c && !c.rebirthing && !c.rewinding;
    if (sent) pushShell(c, kabuk.message(cmd, r));
    return { ok: true, sent, code: r.code, signal: r.signal, error: r.error, ms: r.ms, stopped: r.stopped, timedOut: r.timedOut, truncated: r.truncated };
  });
  ipcMain.handle('chat:shellStop', (_e, id, runId) => kabuk.stop(`${id}:${runId}`));

  // ---------- Kuyruk: Claude çalışırken giden mesajı geri alma ve hemen gönderme (2026-10-26'da gerçek CLI 2.1.310'da ölçüldü) ----------
  // cancelAsyncMessage alınmamış mesajda true (command_lifecycle cancelled, API'ye hiç gitmez), araya girmiş ya da bilinmeyende false döner.
  // İptal edilen kimlikle yeniden gönderilen mesaj sessizce düşer (lifecycle bile gelmez): hemen gönderme yeni kimlik alır.
  // priority 'now': süren aracı (Bash, MCP) arka plana alıp mesajı hemen verir; araçsız yanıtı keser (kesinti işareti yok), mesaj kendi
  // turunda gider. CLI'nin iç "Send now"ı (interrupt + send_now) aynısını yapar ama SDK'da yok; bu yol yalnız tiplerdeki alanları kullanır.
  const withdrawQueued = async (c, uuid) => {
    const msg = c.queued.get(uuid); // beklemeden önce: cancelled olayı yanıttan önce gelir ve kaydı siler
    if (!msg) return { ok: false, taken: true };
    let ok;
    try { ok = (await withTimeout(c.q.cancelAsyncMessage(uuid), 10000)) === true; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
    if (!ok) return { ok: false, taken: true }; // bu arada aldı (started yolda)
    c.queued.delete(uuid);
    c.forks.delete(uuid);
    return { ok: true, msg };
  };
  ipcMain.handle('chat:withdraw', async (_e, id, uuid) => {
    const c = chats.get(id);
    if (!c?.q || typeof uuid !== 'string') return { ok: false, error: 'Sohbet kapalı.' };
    const r = await withdrawQueued(c, uuid);
    return { ok: r.ok, taken: r.taken, error: r.error };
  });
  ipcMain.handle('chat:sendNow', async (_e, id, uuid) => {
    const c = chats.get(id);
    if (!c?.q || typeof uuid !== 'string') return { ok: false, error: 'Sohbet kapalı.' };
    if (c.rebirthing || c.rewinding) return { ok: false, error: 'Yeniden doğuş ya da geri sarma sürüyor.' }; // chat:send gibi
    const r = await withdrawQueued(c, uuid);
    if (!r.ok) return { ok: false, taken: r.taken, error: r.error };
    const fresh = require('crypto').randomUUID();
    const msg = { ...r.msg, uuid: fresh, priority: 'now' };
    c.forks.set(fresh, { at: false, epoch: c.epoch }); // started gelince düzelir
    c.queued.set(fresh, msg);
    c.queue.push(msg);
    return { ok: true, uuid: fresh };
  });

  // ---------- Arka plan görevleri (Claude Code'un /tasks'ı ve Ctrl+B'si; 2026-10-25'te gerçek CLI 2.1.300'de ölçüldü) ----------
  // Tek görevi durdurur: task_notification 'stopped' gelir; durdurulan alt ajandan sonra Claude Code kendiliğinden tur açar, Bash'ten sonra açmaz
  const TASK_ID_RE = /^[\w-]{1,80}$/;
  ipcMain.handle('chat:stopTask', async (_e, id, taskId) => {
    const c = chats.get(id);
    if (!c?.q) return { ok: false, error: 'Sohbet kapalı.' };
    if (!TASK_ID_RE.test(String(taskId))) return { ok: false, error: 'Görev kimliği geçersiz.' };
    try { await withTimeout(c.q.stopTask(taskId), 15000); return { ok: true }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
  // Ön planda süren Bash ya da alt ajanı arka plana alır: araç "arka plana alındı" diye hemen döner, tur sürer. Ancak görev olduktan
  // sonra işe yarar (Bash ~3 sn sonra task_started ile görev olur; önce çağrılırsa true döner ama bir şey olmaz, ölçüldü)
  ipcMain.handle('chat:backgroundTask', async (_e, id, toolUseId) => {
    const c = chats.get(id);
    if (!c?.q) return { ok: false, error: 'Sohbet kapalı.' };
    if (!TASK_ID_RE.test(String(toolUseId))) return { ok: false, error: 'Araç kimliği geçersiz.' };
    try { return { ok: !!(await withTimeout(c.q.backgroundTasks(toolUseId), 15000)) }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });

  // ---------- Geri sarma (Claude Code'un /rewind'i): kod checkpoint'e, konuşma o mesajın öncesine ----------
  // Konuşmanın geri sarılacağı yer: mesajın kayıttaki ebeveyni (kesin; kayıt yalnız okunur). Kayıt yoksa (sahte CLI kayıt yazmaz)
  // mesaj gönderildiğinde akışta görülen son kayıt; ikisi gerçek CLI'de aynı kimlik (2026-10-25'te ölçüldü).
  // reason: first (oturumun ilk mesajı, öncesi yok), queued (Claude çalışırken araya girdi: kayıtta kendi satırı yok), missing
  const REWIND_WHY = {
    first: 'Bu, oturumun ilk mesajı; öncesinde dönülecek bir konuşma yok. Baştan başlamak için yeni sohbet açın.',
    queued: 'Bu mesaj Claude çalışırken araya girdi; kendi turu olmadığı için konuşma ona geri sarılamaz. Bir önceki mesajı seçin.',
    missing: 'Bu mesaj oturum kaydında bulunamadı.',
    compacted: 'Bu mesaj son sıkıştırmadan önce kalıyor; konuşma oraya geri sarılamaz.',
  };
  async function rewindPoint(c, uuid) {
    const no = (reason) => ({ ok: false, reason, text: REWIND_WHY[reason] });
    const f = c.forks.get(uuid); // bu süreçte gönderildiyse
    if (f && f.epoch < c.epoch) return no('compacted');
    const sid = c.getSessionId();
    const file = sid && dogus.sessionFile(c.configDir, sid);
    if (file) {
      const o = await dogus.findEntry(file, uuid, 'user').catch(() => null);
      if (o) return o.parentUuid ? { ok: true, at: o.parentUuid } : no('first');
      return no(f?.at === false ? 'queued' : 'missing');
    }
    if (f?.at === false) return no('queued');
    if (f?.at === null) return no('first');
    return f?.at ? { ok: true, at: f.at } : no('missing');
  }
  // Claude Code'un kod geri sarma hatası (İngilizce): bilineni Türkçe
  const codeWhy = (e) => (/no file checkpoint/i.test(e || '') ? 'Bu mesajın kod checkpoint\'i yok (Claude çalışırken araya girmiş olabilir).' : e || 'Kod geri sarılamadı.');
  const rewindBlocked = (id, c) => (!c?.q ? 'Sohbet kapalı.' : busy.has(id) || c.rebirthing || c.rewinding
    ? 'Claude çalışırken geri sarılamaz; turun bitmesini bekleyin ya da durdurun.' : null);
  // Ön izleme: kodda ne değişecek (rewindFiles dryRun), konuşma geri sarılabilir mi
  ipcMain.handle('chat:rewindPreview', async (_e, id, uuid) => {
    const c = chats.get(id);
    const blocked = rewindBlocked(id, c);
    if (blocked) return { ok: false, error: blocked };
    if (!UUID_RE.test(String(uuid))) return { ok: false, error: 'Mesajın kimliği yok.' };
    const [code, convo] = await Promise.all([
      withTimeout(c.q.rewindFiles(uuid, { dryRun: true }), 20000).catch((e) => ({ canRewind: false, error: e?.message || String(e) }))
        .then((r) => (r.canRewind ? r : { ...r, error: codeWhy(r.error) })),
      rewindPoint(c, uuid),
    ]);
    return { ok: true, code, convo, bgTasks: c.bgTasks }; // konuşma geri sarılınca eski süreç kapanır, arka plandaki görevleri de
  });
  // Uygula: önce kod (başarısızsa konuşmaya dokunulmaz), sonra konuşma
  ipcMain.handle('chat:rewind', async (_e, id, uuid, choice = {}) => {
    const c = chats.get(id);
    const blocked = rewindBlocked(id, c);
    if (blocked) return { ok: false, error: blocked };
    if (!UUID_RE.test(String(uuid))) return { ok: false, error: 'Mesajın kimliği yok.' };
    c.rewinding = true;
    try {
      let files = null;
      if (choice.code) {
        files = await withTimeout(c.q.rewindFiles(uuid), 60000);
        if (!files?.canRewind) return { ok: false, error: codeWhy(files?.error) };
      }
      if (choice.convo) {
        const p = await rewindPoint(c, uuid);
        if (!p.ok) return { ok: false, error: p.text, files };
        await c.rewindTo(p.at);
      }
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      c.rewinding = false;
    }
  });

  ipcMain.on('chat:permissionReply', (_e, id, rid, reply) => {
    const c = chats.get(id);
    const p = c?.pending.get(rid);
    if (!p) return;
    c.pending.delete(rid);
    if (!c.pending.size) sessions.noteWaiting(id, false);
    if (p.elicit) p.resolve(elicitationResult(p.elicit, reply));
    else if (reply.behavior === 'allow') {
      const result = { behavior: 'allow', updatedInput: reply.updatedInput || p.input };
      if (reply.always && p.suggestions?.length) result.updatedPermissions = p.suggestions;
      p.resolve(result);
    } else {
      p.resolve({ behavior: 'deny', message: reply.message || 'Kullanıcı reddetti', interrupt: !!reply.interrupt });
    }
    send('chat:permissionDone', id, rid);
  });
  // Adres kipindeki elicitation: adres arayüzden değil, ana süreçte saklanan istekten açılır (yalnız http/https)
  ipcMain.handle('chat:elicitationOpen', (_e, id, rid) => {
    const url = chats.get(id)?.pending.get(rid)?.elicit?.url;
    if (!/^https?:$/.test(safeUrl(url)?.protocol || '')) return { ok: false, error: 'Bu adres açılamaz (yalnız http ve https).' };
    if (process.env.CLAUDE_PANEL_OPEN_LOG) fs.appendFileSync(process.env.CLAUDE_PANEL_OPEN_LOG, JSON.stringify({ how: 'external', args: [url] }) + '\n');
    else require('electron').shell.openExternal(url);
    return { ok: true };
  });

  // ---------- Hesap bilgisi: model listesi ve plan kullanımı ----------
  // Yeni sohbet ekranında henüz oturum yoktur. Hesabın açık bir sohbeti varsa onun süreci kullanılır;
  // yoksa mesaj göndermeyen, kayıt tutmayan kısa ömürlü bir Claude Code süreci açılır (token harcamaz).
  const infoCache = new Map(); // accountId -> { models, modelsAt, usage, usageAt }
  const MODELS_TTL = 10 * 60 * 1000;
  const USAGE_TTL = 60 * 1000;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), ms))]);

  // Skill'ler (skills.js): liste kısa ömürlü yoklama sürecinden, açıp kapama genel settings.json → skillOverrides
  skills.setup({
    getAccount, expandHome, accountEnv, loadSdk, InputQueue, withTimeout, readJson, readJsonForWrite, writeJsonAtomic, realFile, projectKey,
    getChat: (id) => chats.get(id),
  });

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

  // "Durdur" her şeyi durdurur: kuyruktaki mesajlar da çekilir (cancelQueued; SDK belgesinin arayüz Durdur'u için önerdiği), yoksa
  // durdurulan turun hemen ardından kendi turlarında çalışırlardı (ölçüldü). Çekilenlerin kimlikleri arayüze döner, yazma kutusuna geri konur.
  // SDK'nın interrupt() tipi argüman almıyor ama gövdesi { cancelQueued } okuyor (0.3.310); cevaptaki cancelled tiplerde var.
  ipcMain.handle('chat:interrupt', async (_e, id) => {
    const c = chats.get(id);
    try {
      const r = await c?.q.interrupt({ cancelQueued: true });
      const cancelled = (r?.cancelled || []).filter((u) => typeof u === 'string');
      for (const u of cancelled) { c.queued.delete(u); c.forks.delete(u); }
      return { ok: true, cancelled };
    } catch { return { ok: false, cancelled: [] }; }
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

// MCP sunucusunun elicitation isteği (SDK ElicitationRequest): metinler sunucunundur, arayüzde düz metin olarak çizilir.
// Şema yalnız formda, adres yalnız adres kipinde.
function elicitationRequest(r = {}) {
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const mode = r.mode === 'url' ? 'url' : 'form';
  const schema = mode === 'form' && r.requestedSchema && typeof r.requestedSchema === 'object' ? r.requestedSchema : null;
  return {
    serverName: str(r.serverName, 200) || 'MCP', message: str(r.message, 4000), mode,
    url: mode === 'url' ? str(r.url, 4000) : '', elicitationId: str(r.elicitationId, 200) || null, requestedSchema: schema,
    title: str(r.title, 200), displayName: str(r.displayName, 200), description: str(r.description, 1000),
  };
}
// Arayüzün yanıtından ElicitResult. Formda yalnız şemadaki alanlar ve düz değerler geçer; şemaya uymayan içerik
// Claude Code'da reddedilir (-32602 "does not match requested schema", araç hata döner; ölçüldü), arayüz bu yüzden önce denetler.
function elicitationResult(el, reply = {}) {
  const action = ['accept', 'decline', 'cancel'].includes(reply.action) ? reply.action : 'cancel';
  if (action !== 'accept' || el.mode !== 'form') return { action };
  const props = el.requestedSchema?.properties || {};
  const content = {};
  for (const [k, v] of Object.entries(reply.content || {})) {
    if (!Object.hasOwn(props, k)) continue;
    if (['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) content[k] = v;
  }
  return { action, content };
}
const safeUrl = (u) => { try { return new URL(u); } catch { return null; } };

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
  kabuk.forget(); // süren kabuk komutları (süreç grupları) panelle ölür
  for (const id of [...chats.keys()]) closeChat(id);
}

// Bir hesabın bir klasördeki geçmiş oturumları (yalnız okunur; SDK ayrı süreçte, CLAUDE.md §5)
const listSessions = (accountId, dir) => (helper ? helper(accountId, { op: 'list', dir }) : Promise.resolve({ ok: false, error: 'hazır değil' }));

module.exports = { setup, closeAll, count: () => chats.size, autoAllowTools, loginEnv, updateAwake, projectKey, listSessions };
