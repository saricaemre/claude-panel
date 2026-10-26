// Değişiklikler bölmesi: sohbetin klasöründeki çalışma ağacı değişiklikleri (git) ve dosya görünümü.
// Claude'un `show` aracı bölmeyi açar: değişiklik listesi ya da bir dosyanın belirli satırları.
const { ipcMain } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let send = () => {};
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // ilk commit'ten önce karşılaştırma tabanı
const MAX_FILES = 500;
const MAX_DIFF = 400 * 1024;
const MAX_FILE = 2 * 1024 * 1024;

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 15000 },
      (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout || '' }));
  });
}

// Metin dosyası mı (ilk 8 KB'de NUL yoksa)
function readText(file, limit = MAX_FILE) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('Dosya değil: ' + file);
  if (st.size > limit) throw new Error(`Dosya çok büyük (${Math.round(st.size / 1024)} KB)`);
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8192).includes(0)) throw new Error('İkili dosya');
  return buf.toString('utf8');
}

async function repo(cwd) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.code) return null;
  const root = top.out.trim();
  const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  return { root, base: head.code ? EMPTY_TREE : 'HEAD' };
}

// Çalışma ağacının HEAD'e göre değişiklikleri: dosya, durum, eklenen/silinen satır
async function list(cwd) {
  const r = await repo(cwd);
  if (!r) return { git: false };
  const [st, num] = await Promise.all([
    git(r.root, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']),
    git(r.root, ['diff', r.base, '--numstat', '-z', '--no-renames']),
  ]);
  const stats = new Map();
  for (const rec of num.out.split('\0')) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(rec);
    if (m) stats.set(m[3], { added: +m[1] || 0, removed: +m[2] || 0, binary: m[1] === '-' });
  }
  const files = [];
  for (const rec of st.out.split('\0')) {
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const file = rec.slice(3);
    const status = xy === '??' ? 'U' : xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : 'M';
    let s = stats.get(file);
    if (!s && status === 'U') {
      s = { added: 0, removed: 0, binary: false };
      try {
        const text = readText(path.join(r.root, file), 1024 * 1024);
        s.added = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
      } catch { s.binary = true; }
    }
    files.push({ path: file, status, ...(s || { added: 0, removed: 0, binary: false }) });
    if (files.length >= MAX_FILES) break;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { git: true, root: r.root, files, truncated: files.length >= MAX_FILES };
}

// Bir dosyanın birleşik diff'i (izlenmeyen dosya boş dosyaya göre)
async function diff(root, file) {
  const abs = path.resolve(root, file);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Depo dışında: ' + file);
  const r = await repo(root);
  if (!r || r.root !== root) throw new Error('Git deposu değil');
  const rel = path.relative(root, abs);
  const tracked = (await git(root, ['ls-files', '--error-unmatch', '--', rel])).code === 0;
  const out = tracked
    ? (await git(root, ['diff', r.base, '--no-color', '--no-ext-diff', '--no-renames', '--', rel])).out
    : (await git(root, ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', rel])).out;
  return out.length > MAX_DIFF ? { diff: out.slice(0, MAX_DIFF), truncated: true } : { diff: out };
}

// `@dosya` önerileri için klasördeki dosyalar (yazma kutusu, renderer/mentions.js). Yollar klasöre göre:
// Claude Code `@yol`'u sohbetin klasörüne göre açar. Git deposunda izlenen + yok sayılmayan izlenmeyenler (silinenler hariç),
// git dışında gizli klasörleri ve node_modules'u atlayan sınırlı bir tarama. Klasörler dosyalardan çıkarılır.
const MENTION_MAX = 20000;
const MENTION_TTL = 30 * 1000;
const mentionCache = new Map(); // klasör → { at, promise }

// Git dışı klasör: tarama ayrı süreçte (scripts/files.js; bulut klasörlerinde readdir takılabiliyor), en çok 2 sn ya da MENTION_MAX dosya
function walk(cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'scripts', 'files.js'), cwd],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    let files = [];
    let done = false;
    const finish = (truncated) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { p.kill('SIGKILL'); } catch {}
      resolve({ files: files.slice(0, MENTION_MAX), truncated });
    };
    const timer = setTimeout(() => finish(true), 2000);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => {
      buf += d;
      const end = buf.endsWith('\0\0');
      const parts = buf.split('\0');
      buf = end ? '' : parts.pop();
      files.push(...parts.filter(Boolean));
      if (files.length >= MENTION_MAX) finish(true);
      else if (end) finish(false);
    });
    p.on('error', () => finish(true));
    p.on('close', () => finish(false));
  });
}

async function listMentionable(cwd) {
  if (!cwd || !fs.statSync(cwd).isDirectory()) throw new Error('Klasör yok: ' + cwd);
  const inRepo = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).out.trim() === 'true';
  let files, truncated = false;
  if (inRepo) {
    const [all, gone] = await Promise.all([
      git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
      git(cwd, ['ls-files', '-z', '--deleted']),
    ]);
    const deleted = new Set(gone.out.split('\0'));
    files = [...new Set(all.out.split('\0'))].filter((f) => f && !deleted.has(f));
    if (files.length > MENTION_MAX) { files.length = MENTION_MAX; truncated = true; }
  } else ({ files, truncated } = await walk(cwd));
  const dirs = new Set();
  for (const f of files) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i + 1));
  return { git: inRepo, files, dirs: [...dirs], truncated };
}

function mentionable(cwd) {
  const hit = mentionCache.get(cwd);
  if (hit && Date.now() - hit.at < MENTION_TTL) return hit.promise;
  const promise = listMentionable(cwd);
  mentionCache.set(cwd, { at: Date.now(), promise });
  promise.catch(() => mentionCache.delete(cwd));
  if (mentionCache.size > 20) mentionCache.delete(mentionCache.keys().next().value);
  return promise;
}

// Claude'un aracı: bölmeyi açar. İzin sormaz (yalnız kullanıcıya gösterir, Claude'a içerik dönmez).
function createTool(sdk, z, { chatId, cwd }) {
  return sdk.tool(
    'show',
    'Claude Panel\'de sohbetin yanındaki bölmede kullanıcıya bir şey gösterir. "changes": bu klasördeki değişikliklerin listesi ve ' +
      'diff\'leri (path verilirse o dosya açık gelir); işi bitirince ya da kullanıcı "ne değişti" diye sorunca kullan. "file": bir dosyayı, ' +
      'verilen satırlar vurgulanmış hâlde açar (bir hatanın yerini ya da açıkladığın kodu göstermek için). İçerik sana dönmez.',
    {
      action: z.enum(['changes', 'file']).describe('Ne gösterilecek'),
      path: z.string().optional().describe('Dosya yolu (mutlak ya da çalışma klasörüne göre); file için gerekli'),
      line: z.number().optional().describe('file: vurgulanacak ilk satır'),
      end_line: z.number().optional().describe('file: vurgulanacak son satır'),
    },
    async (a) => {
      try {
        const abs = a.path ? path.resolve(cwd, a.path) : null;
        if (a.action === 'file') {
          if (!abs) throw new Error('path gerekli');
          readText(abs);
          send('changes:open', chatId, { mode: 'file', path: abs, line: a.line, endLine: a.end_line });
          return { content: [{ type: 'text', text: `${abs}${a.line ? ':' + a.line + (a.end_line ? '-' + a.end_line : '') : ''} kullanıcıya gösterildi` }] };
        }
        const r = await list(cwd);
        send('changes:open', chatId, { mode: 'changes', path: abs });
        const summary = r.git ? `${r.files.length} değişen dosya` : 'git deposu değil; bölmede bu oturumun düzenlemeleri var';
        return { content: [{ type: 'text', text: `Değişiklikler bölmesi açıldı (${summary})` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: 'Gösterilemedi: ' + (err?.message || err) }], isError: true };
      }
    }
  );
}

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  const wrap = (fn) => async (_e, ...args) => {
    try { return { ok: true, ...(await fn(...args)) }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  };
  ipcMain.handle('changes:list', wrap((cwd) => list(cwd)));
  ipcMain.handle('changes:diff', wrap((root, file) => diff(root, file)));
  ipcMain.handle('file:read', wrap((file) => ({ content: readText(file) })));
  ipcMain.handle('files:mentionable', wrap((cwd) => mentionable(cwd)));
  // Editörde aç / Finder'da göster: opener.js
}

module.exports = { setup, createTool, list, diff, mentionable };
