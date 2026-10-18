// Defter (docs/octopus/OCTOPUS-PLANI.md §7.4, P5.1): ahtapotun küçük, yapılandırılmış hafızası. Ret, zevk, karar, kural, açık iş, bilgi.
// Yalnız eklenerek büyüyen bir olay günlüğü (İ2): <userData>/octopus/<ahtapot>/defter.jsonl (klasör 700, dosya 600; İ7).
// Düzeltme, sabitleme, yerine koyma, kapatma ve geri alma da birer olaydır; bellekteki görünüm (view) olaylar baştan oynatılarak kurulur.
// Yazanlar: başın `defter` aracı (by: 'bas') ve ahtapot bölmesindeki Defter sekmesi (by: 'kullanici'). Kollar yalnız okur.
// Masaya koyma (P5.2): başın ilk mesajında ve sıkıştırmadan sonra defter özeti, sonraki mesajlarda mesaja uyan satırlar (hooks.js),
// kolun ilk mesajında kural/ret/zevk. İçe aktarma: projenin kendi karar dosyaları (ör. docs/kararlar/K*.md) salt okunur satırlar olarak gelir.
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const octopus = require('./octopus');
const hafiza = require('./hafiza');
const hooks = require('./hooks');
const { norm } = require('./hafiza-isci');

const TYPES = { karar: 'karar', ret: 'ret', zevk: 'zevk', kural: 'kural', acik: 'açık iş', bilgi: 'bilgi' };
// Listeleme sırası (§7.4): sabitlenmiş > kural > ret > zevk > karar > açık; bilgi en sonda
const ORDER = ['kural', 'ret', 'zevk', 'karar', 'acik', 'bilgi'];
const TEXT_MAX = 600, WHY_MAX = 600, LIST_MAX = 30000;
const ID_RE = /^D-\d+$/;

let send = () => {};
const cache = new Map(); // ahtapot kimliği -> { events, broken } (broken: dosya yarım satırla bitiyor; sonraki ekleme yeni satırda başlar)

const fileOf = (octoId) => path.join(octopus.root(), octoId, 'defter.jsonl');
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const idNum = (id) => +String(id).slice(2) || 0;

// Okunamayan satır atlanır; dosyanın üzerine hiç yazılmaz, yalnız eklenir
function load(octoId) {
  if (cache.has(octoId)) return cache.get(octoId);
  let raw = '';
  try { raw = fs.readFileSync(fileOf(octoId), 'utf8'); } catch {}
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.ev === 'string' && Number.isInteger(e.n)) events.push(e);
    } catch {}
  }
  const c = { events, broken: raw.length > 0 && !raw.endsWith('\n') };
  cache.set(octoId, c);
  return c;
}

function append(octoId, evs) {
  const c = load(octoId);
  let n = c.events.reduce((m, e) => Math.max(m, e.n), 0);
  const at = octopus.now();
  const out = evs.map((e) => ({ n: ++n, ...e, at }));
  octopus.privateDir(octopus.root());
  octopus.privateDir(path.join(octopus.root(), octoId));
  const f = fileOf(octoId);
  fs.appendFileSync(f, (c.broken ? '\n' : '') + out.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(f, 0o600);
  c.broken = false;
  c.events.push(...out);
  send('defter:changed', octoId);
  return out;
}

// Olaylardan satırlar. Geri alınan olaylar (revert) hiç olmamış sayılır: eklemesi geri alınan satır görünmez,
// geri alınan düzeltmenin yerine önceki metin kalır, geri alınan yerine koyma eski satırı yeniden açar.
// İçe aktarılan dosya satırları olaylardan önce konur: sabitleme, kapatma ve yerine koyma onlara da olay olarak uygulanır (dosyaya yazılmaz).
function view(octoId) {
  const { events } = load(octoId);
  const reverted = new Set();
  for (const e of events) if (e.ev === 'revert') for (const x of e.of || []) reverted.add(x);
  const rows = new Map();
  const rec = octopus.get(octoId);
  for (const r of rec ? imported(rec) : []) rows.set(r.id, { ...r, events: [] });
  for (const e of events) {
    if (e.ev === 'revert' || reverted.has(e.n)) continue;
    const r = rows.get(e.id);
    if (e.ev === 'add') {
      if (!r) rows.set(e.id, { id: e.id, type: e.type, text: e.text, why: e.why || '', source: e.source || null, by: e.by, at: e.at,
        updatedAt: e.at, pinned: false, status: 'open', supersededBy: null, closeWhy: '', events: [e.n] });
      continue;
    }
    if (!r) continue;
    if (e.ev === 'supersede' && !rows.has(e.by_id)) continue;
    r.events.push(e.n);
    r.updatedAt = e.at;
    if (e.ev === 'edit') for (const k of ['type', 'text', 'why']) { if (e[k] !== undefined) r[k] = e[k]; }
    else if (e.ev === 'supersede') { r.status = 'superseded'; r.supersededBy = e.by_id; }
    else if (e.ev === 'close') { r.status = 'closed'; r.closeWhy = e.why || ''; }
    else if (e.ev === 'pin') r.pinned = true;
    else if (e.ev === 'unpin') r.pinned = false;
  }
  // Açıklar önce, içinde sabitler; sonra defterin kendi satırları, dosyadan gelenler; tür sırası; yeni olan önce
  return [...rows.values()].sort((a, b) =>
    (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (b.pinned - a.pinned) || (!!a.imported - !!b.imported)
    || ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || numOf(b.id) - numOf(a.id));
}
const numOf = (id) => +(String(id).match(/\d+/) || [0])[0];

const day = (ts) => {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
};

// Bir satırın Claude'a giden biçimi: [D-14 ret] metin (30 Eyl)
// Dosyadan gelen satır: [K667 karar, dosya docs/kararlar/K667-….md, yerini K668 aldı] başlık (30 Eyl). whyMax: masada gerekçe kısaltılır.
function line(r, whyMax = WHY_MAX) {
  const tags = [TYPES[r.type] || r.type];
  if (r.imported) tags.push('dosya ' + r.file);
  if (r.pinned) tags.push('sabit');
  if (r.status === 'superseded') tags.push('yerini ' + r.supersededBy + ' aldı');
  if (r.status === 'closed') tags.push('kapandı');
  const cut = (s) => (s.length > whyMax ? s.slice(0, whyMax - 1) + '…' : s);
  return `[${r.id} ${tags.join(', ')}] ${r.text} (${day(r.at)})` + (r.why ? `\n  neden: ${cut(r.why)}` : '')
    + (r.closeWhy ? `\n  kapanış: ${cut(r.closeWhy)}` : '');
}

// Defteri değiştiren tek yol (araç da arayüz de buradan): { ok, row, events: [olay numaraları] } ya da { ok: false, error }
function apply(octoId, op, a = {}, by = 'kullanici', source = null) {
  if (!octopus.get(octoId)) return { ok: false, error: 'Ahtapot bulunamadı.' };
  const rows = view(octoId);
  const row = (id) => rows.find((r) => r.id === id);
  const need = (id) => {
    if (!id || typeof id !== 'string') return { error: 'Satır kimliği gerekli (ör. D-3).' };
    const r = row(id);
    return r ? { r } : { error: id + ' defterde yok.' };
  };
  const type = a.type === undefined ? undefined : String(a.type);
  if (type !== undefined && !TYPES[type]) return { ok: false, error: 'Tür şunlardan biri olmalı: ' + Object.keys(TYPES).join(', ') + '.' };
  const nextId = () => 'D-' + (load(octoId).events.filter((e) => e.ev === 'add').reduce((m, e) => Math.max(m, idNum(e.id)), 0) + 1);
  const added = (evs, id) => ({ ok: true, events: evs.map((e) => e.n), row: view(octoId).find((r) => r.id === id) || null });

  if (op === 'add' || op === 'supersede') {
    const text = clip(a.text, TEXT_MAX);
    if (!text) return { ok: false, error: 'Metin boş olamaz.' };
    let old = null;
    if (op === 'supersede') {
      const x = need(a.id);
      if (x.error) return { ok: false, error: x.error };
      old = x.r;
      if (old.status !== 'open') return { ok: false, error: old.id + ' zaten ' + (old.status === 'closed' ? 'kapalı' : 'yerini ' + old.supersededBy + '\'e bırakmış') + '.' };
    }
    const id = nextId();
    const ev = { ev: 'add', id, type: type || old?.type, text, ...(clip(a.why, WHY_MAX) ? { why: clip(a.why, WHY_MAX) } : {}), source, by };
    if (!ev.type) return { ok: false, error: 'Tür gerekli: ' + Object.keys(TYPES).join(', ') + '.' };
    return added(append(octoId, old ? [ev, { ev: 'supersede', id: old.id, by_id: id, by }] : [ev]), id);
  }
  if (op === 'edit') {
    const x = need(a.id);
    if (x.error) return { ok: false, error: x.error };
    if (x.r.imported) return { ok: false, error: `${x.r.id} projenin bir dosyasından geliyor (${x.r.file}); dosyaya yazılmaz. Yerine yenisini koy ya da kapat.` };
    const patch = {};
    if (type !== undefined && type !== x.r.type) patch.type = type;
    if (a.text !== undefined) { const t = clip(a.text, TEXT_MAX); if (!t) return { ok: false, error: 'Metin boş olamaz.' }; if (t !== x.r.text) patch.text = t; }
    if (a.why !== undefined && clip(a.why, WHY_MAX) !== x.r.why) patch.why = clip(a.why, WHY_MAX);
    if (!Object.keys(patch).length) return { ok: false, error: 'Değişen bir şey yok.' };
    return added(append(octoId, [{ ev: 'edit', id: x.r.id, ...patch, by }]), x.r.id);
  }
  if (op === 'close' || op === 'pin' || op === 'unpin') {
    const x = need(a.id);
    if (x.error) return { ok: false, error: x.error };
    if (op === 'close' && x.r.status !== 'open') return { ok: false, error: x.r.id + ' zaten açık değil.' };
    if (op !== 'close' && x.r.pinned === (op === 'pin')) return { ok: false, error: x.r.id + (op === 'pin' ? ' zaten sabit.' : ' sabit değil.') };
    const why = op === 'close' ? clip(a.why, WHY_MAX) : '';
    return added(append(octoId, [{ ev: op, id: x.r.id, ...(why ? { why } : {}), by }]), x.r.id);
  }
  if (op === 'revert') {
    const ns = [...new Set((Array.isArray(a.ns) ? a.ns : [a.ns]).map(Number))];
    const { events } = load(octoId);
    const gone = new Set(events.filter((e) => e.ev === 'revert').flatMap((e) => e.of || []));
    const targets = ns.map((n) => events.find((e) => e.n === n));
    if (!ns.length || targets.some((e) => !e || e.ev === 'revert')) return { ok: false, error: 'Geri alınacak olay bulunamadı.' };
    if (targets.every((e) => gone.has(e.n))) return { ok: false, error: 'Bu değişiklik zaten geri alınmış.' };
    const of = targets.filter((e) => !gone.has(e.n)).map((e) => e.n);
    const ids = [...new Set(targets.map((e) => e.id))];
    return { ok: true, events: append(octoId, [{ ev: 'revert', of, ids, by }]).map((e) => e.n), row: null };
  }
  return { ok: false, error: 'Bilinmeyen işlem: ' + op };
}

// ---------- İçe aktarma (P5.2): projenin kendi karar dosyaları salt okunur satırlar olarak ----------
// Desen ahtapot kaydında durur (settings.import), projeye yazılmaz (İ1). Desen proje köküne göredir; yalnız son parçada * ve ? olur
// (docs/kararlar/K*.md). Dosyalar yalnız okunur, realpath'i projenin içinde kalanlar alınır. §6.3: diskte duran karar masaya konmayınca unutuluyor;
// bu satırlar mesaja uyunca masaya gelir, sabitlenirse her zaman.
const IMPORT_MAX_PATTERNS = 10, IMPORT_MAX_FILES = 2000, IMPORT_READ = 64 * 1024, IMPORT_TTL = 30 * 1000;
const importCache = new Map(); // ahtapot kimliği -> { key, at, rows, files: realpath -> ayrıştırılmış dosya }

function cleanPattern(p) {
  const s = String(p || '').trim().replace(/^\.\/+/, '');
  if (!s || s.length > 200 || path.isAbsolute(s) || s.includes('\\')) return null;
  const parts = s.split('/');
  if (parts.some((x) => !x || x === '.' || x === '..')) return null;
  if (parts.slice(0, -1).some((x) => /[*?]/.test(x))) return null;
  return s;
}
const globRe = (seg) => new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(IMPORT_READ);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, IMPORT_READ, 0));
  } finally { fs.closeSync(fd); }
}

// Dosyadan başlık, tür, tarih ve durum. Genel biçimler: YAML ön bilgisi (status:, tarih:), satır içi alan ("**Durum** | … |", "Status: …")
// ya da "## Durum" / "## Status" başlığının altındaki ilk satır (ADR). Durum "geçersiz / reddedildi / superseded…" ise satır kapalı,
// "yerine: K668" / "superseded by ADR-7" varsa yerini o aldı sayılır.
function parseFile(text, id) {
  const fm = {};
  let body = text;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (m) {
    for (const l of m[1].split('\n')) { const x = /^([\p{L}_]+)\s*:\s*(.*)$/u.exec(l.trim()); if (x) fm[x[1].toLocaleLowerCase('tr')] = x[2].replace(/^["']|["']$/g, ''); }
    body = text.slice(m[0].length);
  }
  const plain = (s) => String(s || '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  const field = (names) => {
    for (const n of names) if (fm[n]) return plain(fm[n]);
    const alt = names.join('|');
    const inline = new RegExp(`^\\s*\\|?\\s*\\**(?:${alt})\\**\\s*(?:\\||:)\\s*(.+?)\\s*\\|?\\s*$`, 'imu').exec(body);
    if (inline) return plain(inline[1]);
    const head = new RegExp(`^#{2,4}\\s*(?:${alt})\\s*\\r?\\n+\\s*([^#\\s].*)$`, 'imu').exec(body);
    return head ? plain(head[1]) : '';
  };
  const title = plain((/^#\s+(.+)$/m.exec(body) || /^\s*(\S.*)$/m.exec(body) || [, ''])[1])
    .replace(new RegExp('^' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[—–:.-]?\\s*', 'i'), '');
  const status = field(['durum', 'status']);
  const type = field(['tür', 'tur', 'type']).toLocaleLowerCase('tr');
  const date = (/^\d{4}-\d{2}-\d{2}/.exec(field(['tarih', 'date'])) || [])[0];
  const by = /(?:yerine|superseded by|replaced by)\s*:?\s*([A-Za-z]{1,8}-?\d+)/i.exec(status);
  const gone = by || /geçersiz|reddedil|iptal|kaldırıl|vazgeçil|superseded|deprecated|rejected|obsolete|withdrawn/i.test(status);
  return {
    text: clip(title, TEXT_MAX) || id,
    type: TYPES[type] ? type : type === 'açık' ? 'acik' : 'karar',
    date: date ? date + 'T00:00:00Z' : null,
    status: by ? 'superseded' : gone ? 'closed' : 'open',
    supersededBy: by ? by[1] : null,
    closeWhy: gone ? clip('Dosyada: ' + status, 300) : '',
  };
}

// Ahtapotun içe aktarılan satırları (önbellekte 30 sn; dosya değişmediyse yeniden ayrıştırılmaz)
function imported(rec) {
  const patterns = (rec.settings?.import || []).map(cleanPattern).filter(Boolean);
  if (!patterns.length) return [];
  const key = JSON.stringify(patterns);
  const c = importCache.get(rec.id);
  if (c && c.key === key && Date.now() - c.at < IMPORT_TTL) return c.rows;
  const r = collect(rec.project.key, patterns, c?.files);
  importCache.set(rec.id, { key, at: Date.now(), rows: r.rows, files: r.files });
  return r.rows;
}

// Kaydı henüz olmayan bir projede desenlerin satırları ("Projeyi Octopus'a al", alma.js): önbelleksiz, yalnız okur
const previewImport = (projectRoot, patterns) => collect(projectRoot, patterns.map(cleanPattern).filter(Boolean)).rows;

function collect(projectRoot, patterns, prev) {
  let root;
  try { root = fs.realpathSync(projectRoot); } catch { return { rows: [], files: new Map() }; }
  const rows = [], ids = new Set(), seen = new Set(), files = new Map();
  for (const p of patterns) {
    const dir = path.posix.dirname(p), re = globRe(path.posix.basename(p));
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir)).filter((n) => re.test(n)).sort((a, b) => a.localeCompare(b, 'tr', { numeric: true })); } catch { continue; }
    for (const n of names.slice(0, IMPORT_MAX_FILES)) {
      const rel = dir === '.' ? n : dir + '/' + n;
      let real, st;
      try { real = fs.realpathSync(path.join(root, rel)); st = fs.statSync(real); } catch { continue; }
      if (!st.isFile() || !real.startsWith(root + path.sep) || seen.has(real)) continue;
      seen.add(real);
      // Kimlik dosya adından (K667-arayuz-….md → K667); defterin D-numaralarıyla karışmasın
      const base = n.replace(/\.[^.]+$/, '');
      let id = (/^([A-Za-z]{1,8}-?\d+)(?=$|[-_ .])/.exec(base) || [])[1] || base;
      if (ID_RE.test(id) || ids.has(id)) id = base;
      if (ID_RE.test(id) || ids.has(id)) continue;
      ids.add(id);
      const sig = st.size + ':' + st.mtimeMs;
      let f = prev?.get(real);
      if (!f || f.sig !== sig || f.id !== id) {
        try { f = { sig, id, ...parseFile(readHead(real), id) }; } catch { continue; }
      }
      files.set(real, f);
      const at = f.date || st.mtime.toISOString();
      rows.push({ id, type: f.type, text: f.text, why: '', source: null, by: 'ice-aktarma', at, updatedAt: at, pinned: false,
        status: f.status, supersededBy: f.supersededBy, closeWhy: f.closeWhy, imported: true, file: rel });
    }
  }
  return { rows, files };
}

// ---------- Masaya koyma (P5.2, §7.4, §7.7) ----------
// Başa: oturumun ilk UserPromptSubmit'inde (açılış, "Devam et", sonradan "beyin yap") ve SessionStart (compact) ile defter özeti.
// SessionStart startup/resume callback'i gerçek CLI'de gelmiyor (P2.1), bu yüzden açılış ilk mesajda. Compact callback'i gerçek CLI'de
// denenmedi: gelmezse compact_boundary'den sonraki ilk mesajda özet yeniden konur (noteCompacted).
// Sonraki mesajlarda mesaja uyan en çok 5 satır. Kola: ilk mesajının sonuna kural, ret ve zevk (sessions.js → armNote).
const TABLE_MAX = 9000, ARM_MAX = 4000, RELEVANT_N = 5, RELEVANT_MAX = 2000, TABLE_WHY = 240;
const ARM_MARK = '\n\n---\nBeyin defterinden';
const COMPACT_NOTE = 'Bağlamın az önce sıkıştırıldı. Özette olmayan bir ayrıntı gerekirse `hatirla` ile ara, `hatirla_oku` ile kelimesi kelimesine oku.';
const tabled = new Map(); // chatId -> { octoId, via: 'prompt' | 'compact', at }: bu süreçte masaya kondu

// Özet: açık satırlar (dosyadan gelenler yalnız sabitse), view sırasıyla: sabit > kural > ret > zevk > karar > açık > bilgi.
// Sığmayan satırlar sayılır; dosya satırlarının sayısı ve "tamamı için" notu her zaman sonda.
function digest(octoId, { types = null, max = TABLE_MAX, head, tail = 'Tamamı için: `defter listele`.' }) {
  const rows = view(octoId).filter((r) => r.status === 'open' && (!types || types.includes(r.type)));
  const shown = rows.filter((r) => !r.imported || r.pinned);
  const files = rows.length - shown.length;
  if (!rows.length) return '';
  const end = (files ? `\nAyrıca projenin dosyalarından ${files} açık satır var (${(octopus.get(octoId)?.settings?.import || []).join(', ')}); mesajına uyanlar ayrıca gelir.` : '') + '\n' + tail;
  let out = head;
  let left = 0;
  for (let i = 0; i < shown.length; i++) {
    const l = '\n' + line(shown[i], TABLE_WHY);
    if (out.length + l.length + end.length + 40 > max) { left = shown.length - i; break; }
    out += l;
  }
  if (left) out += `\n… ${left} satır daha sığmadı.`;
  return out + end;
}

// max: kancada 9.000 (10.000 sınırı); devir notunda (dogus.js) daha geniş, not mesajın kendisi
const headDigest = (octoId, max = TABLE_MAX) => digest(octoId, { max,
  head: 'Beyin defteri (Claude Panel): bu projede kullanıcıyla vardığınız kurallar, retler, zevk, kararlar ve açık işler. ' +
    'Sıkıştırmalardan sonra da masana konur; buna göre çalış, değişen bir şey olursa `defter` ile güncelle.',
});

// Kolun ilk mesajına eklenen kısım; boş defterde hiçbir şey
const armDigest = (octoId) => digest(octoId, { types: ['kural', 'ret', 'zevk'], max: ARM_MAX,
  head: ' (başın defteri: kurallar, retler, zevk; bunlara uy, defteri yalnız baş yazar):' });
function armNote(octoId) {
  const d = armDigest(octoId);
  return d ? ARM_MARK + d : '';
}
// Kolun görev tanımı (octopus.js → brief) eklenen kısım olmadan saklanır
const stripArmNote = (text) => { const i = String(text).indexOf(ARM_MARK); return i >= 0 ? text.slice(0, i) : text; };

// Kullanıcının mesajına uyan satırlar: Türkçe arama biçimiyle (norm) kelime başları (en çok 5 harf, ekler düşsün) aranır;
// az satırda geçen kelime daha ağır basar, satırların yarısından çoğunda geçen sayılmaz. Mesajda geçen kimlik (D-3, K667) doğrudan eşleşir.
// Kapanmış ve yerini başkasına bırakmış satırlar da gelir (K667'nin "yerini K668 aldı"sı tam bu anda gerekir), ama geride.
const STOP = new Set(['ama', 'ancak', 'bana', 'benim', 'beni', 'bir', 'biz', 'bize', 'bizim', 'bunu', 'bunun', 'bunlar', 'daha', 'diye', 'gibi', 'hem',
  'icin', 'ile', 'iste', 'kadar', 'neden', 'nasil', 'olan', 'olarak', 'olsun', 'once', 'sonra', 'sana', 'senin', 'seni', 'simdi', 'sey', 'seyi', 'sunu',
  'tamam', 'var', 'veya', 'yok', 'yap', 'yapalim', 'devam', 'evet', 'hayir', 'lutfen', 'bakalim', 'olur', 'iyi', 'guzel', 'burada', 'hepsi', 'her',
  'cok', 'biraz', 'bence', 'sence', 'olmus', 'olmamis', 'the', 'and', 'for', 'with', 'this', 'that', 'you', 'are', 'not', 'but', 'please']);
// Kullanıcı yazmadı: yan oturum ve CI bildirimleri (sessions.js, prwatch.js), yeniden doğuşun adımları ve devir notu (dogus.js; defter notun içinde)
const AUTO_PROMPT = /^\s*(?:<(?:yan-oturum-olayi|ci-izleme-olayi)\b|\[Claude Panel (?:devir notu\]|· yeniden doğuş))/;

function relevant(octoId, prompt) {
  const text = String(prompt || '').slice(0, 20000);
  const words = [...new Set(norm(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 5)))];
  const named = new Set((text.match(/\b[A-Za-z]{1,8}-?\d+\b/g) || []).map((x) => x.toUpperCase()));
  const rows = view(octoId);
  if (!rows.length || (!words.length && !named.size)) return [];
  const texts = rows.map((r) => norm(`${r.id} ${r.text} ${r.why}`));
  const limit = Math.max(1, rows.length / 2);
  const weights = words.map((w) => { const df = texts.filter((t) => t.includes(w)).length; return df && df <= limit ? Math.log(1 + rows.length / df) : 0; });
  return rows.map((r, i) => {
    let s = named.has(r.id.toUpperCase()) ? 10 : 0;
    words.forEach((w, j) => { if (weights[j] && texts[i].includes(w)) s += weights[j]; });
    return { r, s: r.status === 'open' ? s : s * 0.6 };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, RELEVANT_N).map((x) => x.r);
}
// Yerini başkasına bırakmış satırın hemen ardına yenisi (K667 → K668): eski karar tek başına gelince yeniden canlanmasın (§6.3)
function withSuccessors(octoId, picked) {
  const rows = view(octoId);
  const out = new Map();
  for (const r of picked) {
    let x = r;
    for (let hop = 0; x && hop < 4; hop++) {
      if (!out.has(x.id)) out.set(x.id, x);
      x = x.status === 'superseded' && rows.find((y) => y.id === x.supersededBy);
    }
  }
  return [...out.values()];
}

function relevantText(octoId, prompt) {
  if (AUTO_PROMPT.test(prompt || '')) return '';
  const rows = withSuccessors(octoId, relevant(octoId, prompt));
  if (!rows.length) return '';
  let out = 'Defterden bu mesaja uyan satırlar (dosya satırları projenin kendi kayıtlarıdır):';
  for (const r of rows) {
    const l = '\n' + line(r, TABLE_WHY);
    if (out.length + l.length > RELEVANT_MAX) break;
    out += l;
  }
  return out;
}

// Sınavda (sinav.js, P7.2) hatırlanmayan satırlar: sonraki ilk mesajda masaya konur, sonra silinir.
// Aynı mesajda özet de gidiyorsa yalnız özette olmayanlar eklenir; hepsi kancanın 10.000 sınırının içinde kalır.
const MISSED_MAX = 2000;
const missed = new Map(); // chatId -> { octoId, ids }
const MISSED_WHEN = { compact: 'sıkıştırmadan sonra', rebirth: 'yeniden doğuştan sonra' };
function noteMissed(chatId, octoId, ids, reason = 'compact') {
  if (ids?.length) missed.set(chatId, { octoId, ids: [...ids], reason }); else missed.delete(chatId);
}
function missedText(chatId, octoId, already = '', budget = MISSED_MAX) {
  const m = missed.get(chatId);
  if (!m || m.octoId !== octoId) return '';
  missed.delete(chatId);
  const rows = view(octoId).filter((r) => m.ids.includes(r.id) && !already.includes(`\n[${r.id} `));
  if (!rows.length) return '';
  let out = `Son sınavda (${MISSED_WHEN[m.reason] || MISSED_WHEN.compact}) hatırlamadığın defter satırları; yeniden masanda:`;
  let left = 0;
  for (let i = 0; i < rows.length; i++) {
    const l = '\n' + line(rows[i], TABLE_WHY);
    if (out.length + l.length + 40 > budget) { left = rows.length - i; break; }
    out += l;
  }
  return left ? out + `\n… ${left} satır daha (defter listele).` : out;
}

function provideHooks() {
  hooks.provide('UserPromptSubmit', (input, { chatId }) => {
    const where = octopus.roleOf(chatId);
    if (where?.role !== 'head') return null;
    const t = tabled.get(chatId);
    const join = (...parts) => { const c = parts.filter(Boolean).join('\n\n'); return c ? { additionalContext: c } : null; };
    if (!t || t.octoId !== where.octoId) {
      tabled.set(chatId, { octoId: where.octoId, via: 'prompt', at: Date.now() });
      const d = headDigest(where.octoId);
      return join(d, missedText(chatId, where.octoId, d, Math.min(MISSED_MAX, 9900 - d.length)));
    }
    return join(missedText(chatId, where.octoId), relevantText(where.octoId, input?.prompt));
  });
  hooks.provide('SessionStart', (input, { chatId }) => {
    if (input?.source !== 'compact') return null;
    const where = octopus.roleOf(chatId);
    if (!where) return null;
    tabled.set(chatId, { octoId: where.octoId, via: 'compact', at: Date.now() });
    const arm = where.role === 'head' ? '' : armDigest(where.octoId);
    const d = where.role === 'head' ? headDigest(where.octoId) : arm && 'Beyin defterinden' + arm;
    return { additionalContext: COMPACT_NOTE + (d ? '\n\n' + d : '') };
  });
}

// chat-main.js: compact_boundary geldi. SessionStart (compact) az önce masaya koymadıysa sonraki ilk mesaj koyar.
function noteCompacted(chatId) {
  const t = tabled.get(chatId);
  if (t && !(t.via === 'compact' && Date.now() - t.at < 60000)) tabled.delete(chatId);
}
// Yeniden doğuş (dogus.js): yeni bedenin ilk mesajı devir notudur ve defter özeti onun içinde; kanca özeti ikinci kez koymaz,
// önceki sınavın kaçırılanları da notta (özette) olduğu için düşer
function markTabled(chatId, octoId) {
  tabled.set(chatId, { octoId, via: 'prompt', at: Date.now() });
  missed.delete(chatId);
}
const forget = (chatId) => { tabled.delete(chatId); missed.delete(chatId); };

// ---------- Claude'un aracı: defter (§7.6; izinsiz, her yazma sohbette satır olarak görünür ve geri alınabilir) ----------

const TOOL_OPS = { ekle: 'add', duzenle: 'edit', yerine_koy: 'supersede', kapat: 'close' };

function createTool(sdk, z, { chatId, getSessionId }) {
  const text = (t, isError) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
  return sdk.tool(
    'defter',
    'Projenin defteri: sıkıştırmalardan sonra da masaya konan küçük hafıza (ret, zevk, karar, kural, açık iş, bilgi). ' +
      'listele: defterin açık satırları (hepsi: true ile kapananlar ve yerini başkasına bırakanlar da). ' +
      'ekle: { tur, metin, neden } yeni satır; kaynak verilmezse bu oturumdaki şimdiki an bağlanır, geçmişten (hatirla) bulduğun bir kayda dayanıyorsa kaynak: { oturum, uuid }. ' +
      'duzenle: { id, metin | neden | tur }. yerine_koy: { id, metin, neden } eski satırı silmeden yerine yenisini koyar (değişen karar, kaldırılan ret). ' +
      'kapat: { id } biten açık iş ya da geçersiz kalan satır. Hiçbir şey silinmez; kullanıcı her yazmayı görür, düzeltebilir ya da geri alabilir. ' +
      'Projenin kendi karar dosyalarından içe aktarılan satırlar (ör. K667, "dosya" etiketli) salt okunurdur: düzenlenmez, ama yerine_koy ve kapat ile defterde işaretlenir (dosyaya yazılmaz).',
    {
      islem: z.enum(['listele', 'ekle', 'duzenle', 'yerine_koy', 'kapat']),
      id: z.string().optional().describe('Satır kimliği (D-3 ya da içe aktarılmış K667); duzenle, yerine_koy, kapat için'),
      tur: z.enum(Object.keys(TYPES)).optional().describe('karar | ret | zevk (beğeni, kalite çıtası) | kural | acik (yapılacak iş) | bilgi'),
      metin: z.string().optional().describe('Satırın kendisi: kısa ve kendi başına anlaşılır (en çok 600 karakter)'),
      neden: z.string().optional().describe('Gerekçe; kullanıcının sözüyse kısa alıntı'),
      kaynak: z.object({ oturum: z.string(), uuid: z.string() }).optional().describe('hatirla sonucundaki oturum= ve uuid='),
      hepsi: z.boolean().optional().describe('listele: kapanan ve yerini başkasına bırakan satırlar da'),
    },
    async (a) => {
      try {
        const where = octopus.roleOf(chatId);
        if (!where) return text('Bu sohbet bir ahtapotun başı değil; defter yalnız Octopus ahtapotlarında var.', true);
        if (a.islem === 'listele') {
          const rows = view(where.octoId).filter((r) => a.hepsi || r.status === 'open');
          if (!rows.length) return text(a.hepsi ? 'Defter boş.' : 'Defterde açık satır yok.');
          let out = `Defter: ${rows.length} satır${a.hepsi ? '' : ' (açık)'}.\n\n` + rows.map(line).join('\n');
          if (out.length > LIST_MAX) out = out.slice(0, LIST_MAX) + '\n… (devamı kırpıldı)';
          return text(out);
        }
        if (where.role !== 'head') return text('Defteri yalnız baş yazar. Deftere girmesi gereken bir şey varsa raporunda başa öner.', true);
        const op = TOOL_OPS[a.islem];
        const source = op === 'add' || op === 'supersede'
          ? (a.kaynak ? { sessionId: a.kaynak.oturum, uuid: a.kaynak.uuid, ts: null } : { sessionId: getSessionId() || null, uuid: null, ts: octopus.now() })
          : null;
        const r = apply(where.octoId, op, { id: a.id, type: a.tur, text: a.metin, why: a.neden }, 'bas', source);
        if (!r.ok) return text(r.error, true);
        const verb = { add: 'Deftere yazıldı', edit: 'Düzeltildi', supersede: 'Yerine konuldu', close: 'Kapatıldı' }[op];
        const extra = op === 'supersede' ? ` (${a.id} yerini ${r.row.id}'e bıraktı)` : '';
        return text(`${verb}${extra}: ${line(r.row)}\n(olay ${r.events.map((n) => '#' + n).join(', ')}; kullanıcı görür, düzeltebilir ya da geri alabilir)`);
      } catch (err) {
        return text('Defter yazılamadı: ' + (err?.message || err), true);
      }
    }
  );
}

// Başın sistem istemine eklenen talimat (chat-main.js → systemPrompt.append). Seçim §6.2'deki kayıplara göre:
// üst üste sıkıştırmada önce retler, zevk ve kalite çıtası, günün ilk görevi düşüyordu.
const HEAD_PROMPT = 'Projenin defteri (`defter` aracı) sıkıştırmalardan sonra da masana konacak küçük hafızan. Şunları olduğu anda, sormadan yaz: ' +
  'kullanıcı bir şeyi reddettiğinde `ret` (neyi reddettiğini ve gerekçesini; kullanıcının sözünü `neden`e kısa alıntıla), ' +
  'zevkini ya da kalite çıtasını söylediğinde `zevk`, bir karar verildiğinde `karar`, bir kural konduğunda `kural`, yapılacak bir iş doğduğunda `acik`. ' +
  'Satırı kısa ve kendi başına anlaşılır yaz. Eski bir satır değişince silmeye çalışma, `yerine_koy` kullan; biten işi `kapat`. ' +
  'Aynısı var mı diye emin değilsen önce `defter listele`. Gelip geçici ayrıntıları yazma; defter küçük kalmalı. ' +
  'Kullanıcı her yazmayı görür, düzeltebilir ya da geri alabilir. ' +
  'Defterin özeti oturumun ilk mesajında ve her sıkıştırmadan sonra masana konur, sonraki mesajlarda mesaja uyan satırlar gelir; ' +
  'açtığın kolların ilk mesajına kurallar, retler ve zevk eklenir.';

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  const known = (id) => typeof id === 'string' && /^oc_[0-9a-f]{16}$/.test(id) && octopus.get(id);
  provideHooks();
  ipcMain.handle('defter:list', (_e, octoId) => {
    const rec = known(octoId);
    if (!rec) return { ok: false, error: 'Ahtapot bulunamadı.' };
    return { ok: true, rows: view(octoId), types: TYPES, imports: rec.settings?.import || [], root: rec.project.key };
  });
  // İçe aktarma deseni (ahtapot kaydına; projeye yazılmaz). Boş liste içe aktarmayı kapatır.
  ipcMain.handle('defter:import', (_e, octoId, patterns) => {
    const rec = known(octoId);
    if (!rec) return { ok: false, error: 'Ahtapot bulunamadı.' };
    const list = (Array.isArray(patterns) ? patterns : []).map((p) => String(p).trim()).filter(Boolean);
    const bad = list.find((p) => !cleanPattern(p));
    if (bad) return { ok: false, error: `"${bad}" geçerli bir desen değil: proje köküne göre bir yol olmalı, yalnız son parçada * ya da ? olabilir (ör. docs/kararlar/K*.md).` };
    if (list.length > IMPORT_MAX_PATTERNS) return { ok: false, error: `En çok ${IMPORT_MAX_PATTERNS} desen.` };
    octopus.setSettings(octoId, { import: [...new Set(list.map(cleanPattern))] });
    importCache.delete(octoId);
    send('defter:changed', octoId);
    return { ok: true, imports: rec.settings.import, count: imported(rec).length };
  });
  // Arayüzün yazmaları (Defter sekmesi, sohbetteki "Geri al"): yazan her zaman kullanıcı; kaynak yok
  ipcMain.handle('defter:apply', (_e, octoId, op, args) => {
    if (!known(octoId)) return { ok: false, error: 'Ahtapot bulunamadı.' };
    try { return apply(octoId, op, args || {}, 'kullanici', null); } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
  // Satırın kaynağı: hafıza dizininden kayıt ve komşuları (hatirla_oku ile aynı okuma). uuid yoksa o andan önceki son kullanıcı mesajı.
  ipcMain.handle('defter:source', async (_e, octoId, id) => {
    const rec = known(octoId);
    const r = rec && view(octoId).find((x) => x.id === id);
    if (!r?.source?.sessionId) return { ok: false, error: 'Bu satırın kaynağı yok (arayüzden eklenmiş olabilir).' };
    try {
      return await hafiza.readRecord({ accountId: rec.accountId, session: r.source.sessionId, uuid: r.source.uuid, at: r.source.ts, around: 2 });
    } catch (err) { return { ok: false, error: 'Hafıza okunamadı: ' + (err?.message || err) }; }
  });
}

module.exports = { setup, createTool, apply, view, line, cleanPattern, previewImport, HEAD_PROMPT, TYPES, ORDER, STOP, armNote, stripArmNote, headDigest, noteCompacted, noteMissed, markTabled, forget };
