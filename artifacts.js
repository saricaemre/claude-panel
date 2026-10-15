// Artifacts: panelde üretilen sayfa, görsel ve belgelerin ortak deposu (Claude uygulamasındaki galeri gibi).
// Depo: <userData>/artifacts/index.json + <id>/v<n> (ham içerik) + <id>/thumb-v<n>.png (küçük resim).
// Görüntüleme özel "artifact://" protokolüyle yapılır:
//   artifact://view/<id>/<n>/          → sayfa (html/svg olduğu gibi; md ve kod biçimlenmiş HTML olarak)
//   artifact://view/<id>/<n>/<yol>     → kaynak dosyanın klasöründeki görsel, css vb. (göreli bağlantılar)
//   artifact://thumb/<id>/<n>/         → küçük resim
const { app, ipcMain, protocol, session, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const KINDS = { html: ['html', 'htm'], svg: ['svg'], md: ['md', 'markdown'] };
const AUTO_EXT = new Set(['html', 'htm', 'svg']); // Claude bunları yazınca kendiliğinden eklenir
const MAX_BYTES = 8 * 1024 * 1024;

let index = null;
let send = () => {};

const root = () => path.join(app.getPath('userData'), 'artifacts');
const itemDir = (id) => path.join(root(), id);
const versionPath = (id, n) => path.join(itemDir(id), 'v' + n);
const thumbPath = (id, n) => path.join(itemDir(id), `thumb-v${n}.png`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load() {
  if (index) return index;
  try { index = JSON.parse(fs.readFileSync(path.join(root(), 'index.json'), 'utf8')); } catch { index = { items: [] }; }
  if (!Array.isArray(index.items)) index.items = [];
  return index;
}

function save() {
  fs.mkdirSync(root(), { recursive: true });
  const tmp = path.join(root(), 'index.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, path.join(root(), 'index.json'));
}

const changed = () => send('artifacts:changed');
const find = (id) => load().items.find((a) => a.id === id);
const byPath = (p) => (p ? load().items.find((a) => a.filePath === p) : null);
const latest = (a) => a.versions[a.versions.length - 1]?.n || 1;

function extOf(p) {
  return (path.extname(p || '').slice(1) || '').toLowerCase();
}

function kindFromExt(ext) {
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(ext)) return k;
  return 'code';
}

function deriveTitle(content, kind, fallback) {
  const pick = (re) => (content.match(re)?.[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  let t = '';
  if (kind === 'html') t = pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  else if (kind === 'svg') t = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  else if (kind === 'md') t = pick(/^#{1,2}\s+(.+)$/m);
  return (t || fallback || 'Adsız artifact').slice(0, 120);
}

function read(id, n) {
  const a = find(id);
  if (!a) return null;
  try { return fs.readFileSync(versionPath(id, n || latest(a)), 'utf8'); } catch { return null; }
}

// Yeni artifact ya da var olanın yeni sürümü. Aynı dosya yolu (ya da id) aynı artifact'tir.
function upsert({ id, title, content, filePath, kind, lang, source }) {
  content = String(content ?? '');
  if (!content.trim()) throw new Error('İçerik boş.');
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('Artifact çok büyük (en fazla 8 MB).');
  load();
  const ext = extOf(filePath) || lang || '';
  kind = kind || kindFromExt(ext);
  let a = (id && find(id)) || byPath(filePath);
  const now = Date.now();
  let created = false;

  if (!a) {
    created = true;
    a = {
      id: crypto.randomBytes(6).toString('hex'),
      title: '', customTitle: false, kind, lang: kind === 'code' ? ext : '', filePath: filePath || null,
      source: source || {}, createdAt: now, updatedAt: now, starred: false, versions: [],
    };
    index.items.push(a);
  } else if (read(a.id, latest(a)) === content) {
    if (title && !a.customTitle && title !== a.title) { a.title = title; save(); changed(); }
    return { artifact: a, created: false, version: latest(a), changed: false };
  }

  const n = a.versions.length ? latest(a) + 1 : 1;
  fs.mkdirSync(itemDir(a.id), { recursive: true });
  fs.writeFileSync(versionPath(a.id, n), content);
  a.versions.push({ n, at: now, size: Buffer.byteLength(content), thumb: false });
  a.updatedAt = now;
  if (source?.sessionId) a.source = { ...a.source, ...source };
  if (!a.customTitle) a.title = (title || deriveTitle(content, a.kind, filePath ? path.basename(filePath) : '')).trim();
  save();
  changed();
  queueThumb(a.id, n);
  return { artifact: a, created, version: n, changed: true };
}

function upsertFromFile(filePath, extra = {}) {
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error('Dosya değil: ' + filePath);
  if (st.size > MAX_BYTES) throw new Error('Dosya çok büyük (en fazla 8 MB).');
  return upsert({ ...extra, filePath, content: fs.readFileSync(filePath, 'utf8') });
}

function remove(id) {
  load();
  index.items = index.items.filter((a) => a.id !== id);
  save();
  try { fs.rmSync(itemDir(id), { recursive: true, force: true }); } catch {}
  changed();
}

function publicItem(a) {
  return { ...a, latest: latest(a) };
}

// ---------- Görüntüleme sayfaları ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DOC_CSS = `
  :root { color-scheme: dark; }
  html, body { margin: 0; background: #262624; color: #ece9e1; }
  body { font: 17px/1.7 ui-serif, "New York", Charter, Georgia, serif; padding: 48px 56px 64px; max-width: 820px; margin: 0 auto; }
  h1, h2, h3, h4 { line-height: 1.3; font-weight: 600; margin: 1.3em 0 .5em; }
  h1 { font-size: 2em; margin-top: 0; letter-spacing: -.01em; } h2 { font-size: 1.45em; } h3 { font-size: 1.15em; }
  a { color: #9fb7ff; }
  code { font: .82em "SF Mono", ui-monospace, Menlo, monospace; background: #1f1e1d; border: 1px solid #3b3a37; border-radius: 6px; padding: 1px 6px; color: #f0937a; }
  pre { background: #1f1e1d; border: 1px solid #3b3a37; border-radius: 12px; padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; border: 0; padding: 0; color: #d6d2c8; font-size: 13.5px; line-height: 1.55; }
  table { border-collapse: collapse; font: 14px -apple-system, sans-serif; margin: 1em 0; }
  th, td { border-bottom: 1px solid #3b3a37; padding: 8px 16px 8px 0; text-align: left; }
  blockquote { margin: 0 0 1em; padding-left: 16px; border-left: 3px solid #4a4945; color: #a6a39b; }
  hr { border: 0; border-top: 1px solid #3b3a37; margin: 2em 0; }
  img { max-width: 100%; border-radius: 8px; }
  li::marker { color: #a6a39b; }
`;

function mdPage(title, content) {
  let body;
  try { body = require('marked').marked.parse(content, { gfm: true }); } catch { body = `<pre>${esc(content)}</pre>`; }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}</style></head><body>${body}</body></html>`;
}

function codePage(title, content, lang) {
  const lines = content.replace(/\n$/, '').split('\n');
  const rows = lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td class="c">${esc(l) || ' '}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    html, body { margin: 0; background: #1f1e1d; color: #d6d2c8; }
    .bar { font: 12px -apple-system, sans-serif; color: #8a877f; padding: 14px 20px 6px; text-transform: uppercase; letter-spacing: .06em; }
    table { border-collapse: collapse; font: 13px/1.6 "SF Mono", ui-monospace, Menlo, monospace; width: 100%; }
    td.n { color: #5c5a55; text-align: right; padding: 0 14px 0 20px; user-select: none; width: 1%; white-space: nowrap; vertical-align: top; }
    td.c { white-space: pre-wrap; word-break: break-word; padding-right: 20px; }
  </style></head><body><div class="bar">${esc(lang || 'kod')}</div><table>${rows}</table></body></html>`;
}

function renderPage(a, content) {
  if (a.kind === 'md') return { type: 'text/html; charset=utf-8', body: mdPage(a.title, content) };
  if (a.kind === 'code') return { type: 'text/html; charset=utf-8', body: codePage(a.title, content, a.lang) };
  if (a.kind === 'svg') return { type: 'image/svg+xml; charset=utf-8', body: content };
  return { type: 'text/html; charset=utf-8', body: content };
}

// Kaynak klasörden yalnız sayfa varlıkları sunulur (.env, .json, anahtar dosyaları vb. asla)
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', woff2: 'font/woff2',
  woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', avif: 'image/avif', ico: 'image/x-icon', mp4: 'video/mp4',
  webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
};

// Sayfa hangi pencerede açılırsa açılsın (görüntüleyici iframe'i, küçük resim penceresi) kökensiz bir kum havuzunda çalışır:
// betikleri çalışır ama artifact:// içeriğini (yandaki dosyalar, başka artifact'ler) fetch ile okuyamaz.
// İzinler görüntüleyici iframe'inin sandbox özelliğiyle aynı (renderer/artifacts.js), allow-same-origin hariç.
const PAGE_SANDBOX = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

const notFound = () => new Response('Bulunamadı', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

function handleProtocol(req) {
  try {
    const u = new URL(req.url);
    const [, id, nStr, ...rest] = decodeURIComponent(u.pathname).split('/');
    const a = find(id);
    if (!a) return notFound();
    const n = Number(nStr) || latest(a);

    if (u.host === 'thumb') {
      const p = thumbPath(id, n);
      if (!fs.existsSync(p)) return notFound();
      return new Response(fs.readFileSync(p), { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } });
    }
    if (u.host !== 'view') return notFound();

    const sub = rest.join('/');
    if (sub) {
      // Kaynak dosyanın yanındaki yardımcı dosyalar (yalnız o klasörün içinden)
      // Symlink'ler çözülür; klasör dışı ve izin listesinde olmayan uzantılar reddedilir.
      if (!a.filePath) return notFound();
      let base, p;
      try {
        base = fs.realpathSync(path.dirname(a.filePath));
        p = fs.realpathSync(path.resolve(base, sub));
      } catch { return notFound(); }
      if (!p.startsWith(base + path.sep) || !MIME[extOf(p)] || !fs.statSync(p).isFile()) return notFound();
      return new Response(fs.readFileSync(p), { headers: { 'content-type': MIME[extOf(p)] } });
    }
    const content = read(id, n);
    if (content == null) return notFound();
    const page = renderPage(a, content);
    return new Response(page.body, { headers: { 'content-type': page.type, 'cache-control': 'no-cache', 'content-security-policy': PAGE_SANDBOX } });
  } catch {
    return notFound();
  }
}

// ---------- Küçük resimler (görünmez pencerede çizilip yakalanır) ----------

// Küçük resim kimse açmadan, kendiliğinden çizilir. Bu yüzden ayrı, bellekte bir oturumda çizilir:
// sayfa yalnız kendi içeriğini ve klasöründeki varlıkları alır, başka artifact'e ve ağa ulaşamaz
// (yoksa Claude'un yazdığı bir sayfa okuduğunu izinsiz dışarı gönderebilirdi). Electron bu şemada CORS
// uygulamadığı için sınır sunucu tarafında çizilir. İstisna: bilinen CDN'lerden betik, stil, yazı tipi (grafik kütüphaneleri).
const THUMB_CDN = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.tailwindcss.com', 'code.jquery.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const THUMB_CDN_TYPES = new Set(['script', 'stylesheet', 'font']);
let thumbSession = null;
let thumbJob = null; // o an çizilen [id, n]

function getThumbSession() {
  if (thumbSession) return thumbSession;
  thumbSession = session.fromPartition('artifact-thumbs');
  thumbSession.protocol.handle('artifact', (req) => {
    try {
      const u = new URL(req.url);
      const [, id, nStr] = decodeURIComponent(u.pathname).split('/');
      if (u.host !== 'view' || !thumbJob || id !== thumbJob[0] || Number(nStr) !== thumbJob[1]) return notFound();
    } catch { return notFound(); }
    return handleProtocol(req);
  });
  thumbSession.webRequest.onBeforeRequest((d, cb) => {
    let ok = false;
    try {
      const u = new URL(d.url);
      ok = ['artifact:', 'data:', 'blob:'].includes(u.protocol)
        || (u.protocol === 'https:' && d.method === 'GET' && THUMB_CDN.has(u.hostname) && THUMB_CDN_TYPES.has(d.resourceType));
    } catch {}
    cb({ cancel: !ok });
  });
  return thumbSession;
}

const thumbQueue = [];
let thumbBusy = false;

function queueThumb(id, n) {
  thumbQueue.push([id, n]);
  pumpThumbs();
}

async function pumpThumbs() {
  if (thumbBusy) return;
  const job = thumbQueue.shift();
  if (!job) return;
  thumbBusy = true;
  try { await makeThumb(...job); } catch {}
  thumbBusy = false;
  pumpThumbs();
}

async function makeThumb(id, n) {
  if (!find(id)) return;
  const w = new BrowserWindow({
    show: false, width: 1200, height: 760,
    webPreferences: { session: getThumbSession(), offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  thumbJob = [id, n];
  try {
    w.webContents.setAudioMuted(true);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await Promise.race([w.loadURL(`artifact://view/${id}/${n}/`).catch(() => {}), sleep(8000)]);
    await sleep(900); // yazı tipleri ve betikler otursun
    const img = await w.webContents.capturePage();
    const a = find(id);
    if (!a || img.isEmpty()) return;
    fs.writeFileSync(thumbPath(id, n), img.resize({ width: 600, quality: 'best' }).toPNG());
    const v = a.versions.find((x) => x.n === n);
    if (v) v.thumb = true;
    save();
    changed();
  } finally {
    thumbJob = null;
    w.destroy();
  }
}

// ---------- Kurulum ----------

// app hazır olmadan önce çağrılmalı
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'artifact', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

function slug(s) {
  return String(s || 'artifact').toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artifact';
}

function fileExt(a) {
  if (a.kind === 'html') return 'html';
  if (a.kind === 'svg') return 'svg';
  if (a.kind === 'md') return 'md';
  return a.lang || extOf(a.filePath) || 'txt';
}

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  protocol.handle('artifact', handleProtocol);

  // Küçük resmi eksik kalanları tamamla (ör. uygulama yarıda kapandıysa)
  for (const a of load().items) {
    const v = a.versions[a.versions.length - 1];
    if (v && !v.thumb) queueThumb(a.id, v.n);
  }

  const wrap = (fn) => async (_e, ...args) => {
    try { return { ok: true, ...(await fn(...args)) }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  };

  ipcMain.handle('artifacts:list', () => load().items.map(publicItem).sort((x, y) => y.updatedAt - x.updatedAt));
  ipcMain.handle('artifacts:read', (_e, id, n) => read(id, n));
  ipcMain.handle('artifacts:addFile', wrap((filePath, source) => {
    const r = upsertFromFile(filePath, { source });
    return { id: r.artifact.id, created: r.created, version: r.version };
  }));
  ipcMain.handle('artifacts:addContent', wrap((opts) => {
    const r = upsert({ title: opts.title, content: opts.content, lang: opts.lang, kind: opts.kind, source: opts.source });
    return { id: r.artifact.id, created: r.created, version: r.version };
  }));
  ipcMain.handle('artifacts:update', wrap((id, patch) => {
    const a = find(id);
    if (!a) throw new Error('Artifact bulunamadı.');
    if (typeof patch.title === 'string' && patch.title.trim()) { a.title = patch.title.trim().slice(0, 120); a.customTitle = true; }
    if (typeof patch.starred === 'boolean') a.starred = patch.starred;
    save();
    changed();
    return {};
  }));
  ipcMain.handle('artifacts:remove', wrap((id) => { remove(id); return {}; }));
  ipcMain.handle('artifacts:download', wrap(async (id, n) => {
    const a = find(id);
    const content = read(id, n);
    if (!a || content == null) throw new Error('Artifact bulunamadı.');
    const r = await dialog.showSaveDialog(getWindow(), {
      title: 'Artifact\'i kaydet',
      defaultPath: path.join(app.getPath('downloads'), `${slug(a.title)}.${fileExt(a)}`),
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, content);
    return { path: r.filePath };
  }));
  ipcMain.handle('artifacts:openExternal', wrap(async (id, n) => {
    const a = find(id);
    const content = read(id, n);
    if (!a || content == null) throw new Error('Artifact bulunamadı.');
    const dir = path.join(os.tmpdir(), 'claude-panel-artifacts');
    fs.mkdirSync(dir, { recursive: true });
    const page = renderPage(a, content);
    const ext = a.kind === 'svg' ? 'svg' : 'html';
    const p = path.join(dir, `${slug(a.title)}-${id}-v${n || latest(a)}.${ext}`);
    fs.writeFileSync(p, page.body);
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return {};
  }));
  ipcMain.handle('artifacts:reveal', wrap((id) => {
    const a = find(id);
    if (!a?.filePath || !fs.existsSync(a.filePath)) throw new Error('Kaynak dosya artık yok.');
    shell.showItemInFolder(a.filePath);
    return {};
  }));
}

// ---------- Sohbetten yakalama ----------

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

// Bir sohbetin mesaj akışını izler: Claude .html/.svg yazdığında ya da zaten artifact olan bir dosyayı
// düzenlediğinde, araç başarıyla bitince dosyayı okuyup artifact'i ekler/günceller.
function createTracker({ cwd, accountId, onArtifact }) {
  const pending = new Map(); // tool_use_id -> dosya yolu
  return (msg) => {
    const content = msg?.message?.content;
    if (!Array.isArray(content)) return;
    if (msg.type === 'assistant') {
      for (const b of content) {
        if (b.type === 'tool_use' && FILE_TOOLS.has(b.name) && typeof b.input?.file_path === 'string') {
          pending.set(b.id, path.resolve(cwd, b.input.file_path));
        }
      }
    } else if (msg.type === 'user') {
      for (const b of content) {
        if (b.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
        const p = pending.get(b.tool_use_id);
        pending.delete(b.tool_use_id);
        if (b.is_error || !(AUTO_EXT.has(extOf(p)) || byPath(p))) continue;
        try {
          const r = upsertFromFile(p, { source: { accountId, cwd, sessionId: msg.session_id } });
          if (r.changed) onArtifact(artifactEvent(r));
        } catch {}
      }
    }
  };
}

function artifactEvent(r) {
  return { id: r.artifact.id, title: r.artifact.title, kind: r.artifact.kind, version: r.version, created: r.created };
}

// Claude'un artifact yayımlayabilmesi için süreç içi MCP sunucusu ("mcp__panel__publish_artifact")
async function createMcpServer(sdk, { cwd, accountId, getSessionId, onArtifact }) {
  const { z } = await import('zod');
  const publish = sdk.tool(
    'publish_artifact',
    'Bir sayfayı, görseli ya da belgeyi Claude Panel\'in Artifacts galerisine yayımlar; kullanıcı orada önizler, sürümlerini görür, indirir. ' +
      'Kullanıcı bir HTML sayfası, pano, rapor, SVG, diyagram ya da saklanacak/paylaşılacak bir belge istediğinde kullan. ' +
      'Önce dosyayı yazıp file_path ver (aynı yolla yeniden çağırmak yeni sürüm yapar) ya da içeriği doğrudan content ile gönder. ' +
      'Not: .html ve .svg dosyaları Write/Edit ile yazıldığında zaten kendiliğinden eklenir; bu araçla başlık verebilir ya da md/kod gibi başka türleri ekleyebilirsin.',
    {
      title: z.string().describe('Galeride görünecek kısa ad (2-6 kelime)'),
      file_path: z.string().optional().describe('Yayımlanacak dosyanın yolu (mutlak ya da çalışma klasörüne göre)'),
      content: z.string().optional().describe('file_path yoksa doğrudan içerik'),
      kind: z.enum(['html', 'svg', 'md', 'code']).optional().describe('content için tür; verilmezse dosya uzantısından anlaşılır'),
      lang: z.string().optional().describe('kind=code için dil, ör. py, ts'),
      artifact_id: z.string().optional().describe('Var olan bir artifact\'i content ile güncellemek için id'),
    },
    async (args) => {
      try {
        const source = { accountId, cwd, sessionId: getSessionId() };
        let file = null;
        if (args.file_path) {
          // Yalnız çalışma klasörünün içindeki dosyalar (izin sormadan çalışan bir araç olduğu için)
          file = fs.realpathSync(path.resolve(cwd, args.file_path));
          const root = fs.realpathSync(cwd);
          if (!file.startsWith(root + path.sep)) throw new Error('file_path çalışma klasörünün içinde olmalı; dışarıdaki içerik için content kullan.');
        }
        const r = file
          ? upsertFromFile(file, { title: args.title, source })
          : upsert({ id: args.artifact_id, title: args.title, content: args.content, kind: args.kind || (args.lang ? 'code' : 'md'), lang: args.lang, source });
        if (r.changed) onArtifact(artifactEvent(r));
        const state = r.created ? 'yayımlandı' : r.changed ? `güncellendi (sürüm ${r.version})` : 'değişmedi (içerik aynı)';
        return { content: [{ type: 'text', text: `"${r.artifact.title}" artifact'i ${state}. id: ${r.artifact.id}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: 'Yayımlanamadı: ' + (err?.message || err) }], isError: true };
      }
    }
  );
  return sdk.createSdkMcpServer({
    name: 'panel',
    version: '1.0.0',
    instructions: 'Claude Panel\'de çalışıyorsun. Ürettiğin sayfa, rapor, diyagram ve belgeleri publish_artifact ile Artifacts galerisine yayımlayabilirsin.',
    tools: [publish],
    alwaysLoad: true,
  });
}

module.exports = { registerScheme, setup, createTracker, createMcpServer };
