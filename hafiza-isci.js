// Hafıza dizini (docs/octopus/OCTOPUS-PLANI.md §7.5, P3.1): Claude Code oturum kayıtlarını (JSONL) Türkçeye uyumlu,
// kayıpsız bir tam metin dizinine (<userData>/octopus/hafiza.db, node:sqlite + FTS5 trigram) alır ve arar.
// İşçi iş parçacığında çalışır (hafiza.js açar): node:sqlite eşzamanlıdır, ana süreçte arayüzü dondururdu.
// Kayıtlar yalnız okunur (İ1); SDK kullanılmaz (SDK ayar klasörünü süreç başına bir kez okur, CLAUDE.md §5).
// İşçi olmadan da yüklenebilir (openIndex): ölçüm betikleri aynı çekirdeği kullanır.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const SCHEMA = 1;
const CHUNK = 4 * 1024 * 1024; // artımlı okuma parçası; parçalar arasında aramalara sıra verilir
const CAP = { mesaj: 20000, arac: 2000, sonuc: 3000 };
const IDLE_MS = 60 * 1000; // arşiv: bu kadar süre değişmeyen kayıt "boşta" sayılır (Claude Code o an yazmıyor)

// Arama biçimi: harf harf Türkçe küçük harf + aksan katlama (İSTANBUL → istanbul, ışık → isik).
// Uzunluk korunur: küçük harfe çevrilince uzunluğu değişen harf olduğu gibi kalır; bu yüzden norm(metin)'deki
// konum özgün metinde de aynı yerdir (alıntı kesmek için). toLowerCase() "İ"yi "i̇" yapar, eşleşme kaçar.
const FOLD = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
function norm(s) {
  let o = '';
  for (const ch of s) {
    const lc = ch.toLocaleLowerCase('tr');
    const c = lc.length === ch.length ? lc : ch;
    o += FOLD[c] || c;
  }
  return o;
}

// Bilinen gizli anahtar biçimleri dizine girmeden maskelenir (İ7)
const SECRETS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
];
const mask = (s) => SECRETS.reduce((t, re) => t.replace(re, '[gizli]'), s);

const textOf = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '');

// Claude Code'un proje klasörü adı: harf ve rakam dışı her karakter '-', 200 karakteri aşan ad kırpılıp karma eklenir
const sanitize = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');

// Kaydın ilk cwd'si (ilk 256 KB): projeye ait mi (projectDirs), danışma dalı hangi klasörde açılır (danis.js)
function firstCwd(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      try { const o = JSON.parse(line); if (typeof o.cwd === 'string') return o.cwd; } catch {}
    }
  } catch {} finally { if (fd != null) fs.closeSync(fd); }
  return null;
}

// Bir hesabın (projects klasörü) bir projeye ait kayıt klasörleri: projenin kendisi, alt klasörleri ve ayrı kopyaları
// (<kök>/.claude/worktrees/…). Ad öneki benzer başka bir proje ("Proje" / "Proje 2") kayıtlardaki cwd ile ayıklanır.
// macOS yolları NFC ya da NFD gelebilir ("ö" NFD'de iki karakter, klasör adında iki '-'): iki biçim de denenir.
function projectDirs(projectsDir, key) {
  let names = [];
  try { names = fs.readdirSync(projectsDir); } catch { return []; }
  const out = new Set();
  for (const s of new Set([sanitize(key.normalize('NFC')), sanitize(key.normalize('NFD'))])) {
    const head = s.length > 200 ? s.slice(0, 200) : null;
    for (const name of names) {
      const exact = name === s && !head;
      if (!exact && !name.startsWith(s + '-') && !(head && name.startsWith(head))) continue;
      const dir = path.join(projectsDir, name);
      if (exact || belongs(dir, key)) out.add(dir);
    }
  }
  return [...out];
}

function belongs(dir, key) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')); } catch { return false; }
  for (const x of files.slice(0, 5)) {
    const cwd = firstCwd(path.join(dir, x));
    if (cwd) { const c = cwd.normalize('NFC'), k = key.normalize('NFC'); return c === k || c.startsWith(k + '/'); }
  }
  return false;
}

function openIndex(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
  // Dizin kayıtlardan türetilir; şema değişince baştan kurulur (kayıtların kendisine dokunulmaz)
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
  const ver = db.prepare("SELECT v FROM meta WHERE k = 'schema'").get()?.v;
  if (ver != null && +ver !== SCHEMA) {
    db.exec('DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS nodes; DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS boundaries; DROP TABLE IF EXISTS fts;');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, account TEXT, project TEXT, session TEXT,
      size INTEGER, mtime REAL, offset INTEGER, tip TEXT);
    CREATE TABLE IF NOT EXISTS nodes (session TEXT, uuid TEXT, parent_uuid TEXT, logical_parent TEXT,
      PRIMARY KEY (session, uuid)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, account TEXT, project TEXT, session TEXT, uuid TEXT,
      parent_uuid TEXT, ts TEXT, role TEXT, kind TEXT, seq INTEGER, text TEXT, UNIQUE (session, uuid, seq));
    CREATE INDEX IF NOT EXISTS entries_project ON entries (project);
    CREATE TABLE IF NOT EXISTS boundaries (session TEXT, uuid TEXT, ts TEXT, trigger TEXT, pre_tokens INTEGER,
      post_tokens INTEGER, kept TEXT, logical_parent TEXT, summary_uuid TEXT, PRIMARY KEY (session, uuid));
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(body, content='', tokenize='trigram');
    CREATE TABLE IF NOT EXISTS archives (path TEXT PRIMARY KEY, dest TEXT, size INTEGER, mtime REAL, at TEXT);
  `);
  db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)").run(String(SCHEMA));
  // Dizin konuşmaların tam metnini içerir: yalnız sahibine açık (İ7); WAL dosyaları da
  for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) { try { fs.chmodSync(f, 0o600); } catch {} }

  const st = {
    file: db.prepare('SELECT * FROM files WHERE path = ?'),
    putFile: db.prepare(`INSERT INTO files (path, account, project, session, size, mtime, offset, tip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, offset = excluded.offset, tip = excluded.tip`),
    node: db.prepare('INSERT OR IGNORE INTO nodes (session, uuid, parent_uuid, logical_parent) VALUES (?, ?, ?, ?)'),
    entry: db.prepare(`INSERT OR IGNORE INTO entries (account, project, session, uuid, parent_uuid, ts, role, kind, seq, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    fts: db.prepare('INSERT INTO fts (rowid, body) VALUES (?, ?)'),
    boundary: db.prepare(`INSERT OR IGNORE INTO boundaries (session, uuid, ts, trigger, pre_tokens, post_tokens, kept, logical_parent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    summary: db.prepare('UPDATE boundaries SET summary_uuid = ? WHERE session = ? AND uuid = ? AND summary_uuid IS NULL'),
    arch: db.prepare('SELECT * FROM archives WHERE path = ?'),
    putArch: db.prepare(`INSERT INTO archives (path, dest, size, mtime, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET dest = excluded.dest, size = excluded.size, mtime = excluded.mtime, at = excluded.at`),
  };

  // ---------- Alım ----------

  // Bir kaydı (JSONL satırı) dizine yazar. Aynı kayıt dosyada birden çok kez geçebilir (dallanma): (oturum, uuid, sıra) tekildir.
  function ingest(o, f) {
    if (!o || typeof o !== 'object') return 0;
    const { session } = f;
    if (o.uuid) st.node.run(session, o.uuid, o.parentUuid || null, o.logicalParentUuid || null);
    if (o.type === 'system' && o.subtype === 'compact_boundary' && o.uuid) {
      const m = o.compactMetadata || {};
      st.boundary.run(session, o.uuid, o.timestamp || '', m.trigger || null, m.preTokens ?? null, m.postTokens ?? null,
        JSON.stringify(m.preservedMessages?.allUuids || []), o.logicalParentUuid || null);
      return 0;
    }
    if (o.type !== 'user' && o.type !== 'assistant') return 0;
    if (o.uuid && !o.isSidechain) f.tip = o.uuid;
    let added = 0;
    const put = (seq, role, kind, text, cap) => {
      text = mask(String(text || '')).trim();
      if (!text) return;
      if (text.length > cap) text = text.slice(0, cap);
      const r = st.entry.run(f.account, f.project, session, o.uuid || '', o.parentUuid || null, o.timestamp || '', role, kind, seq, text);
      if (!r.changes) return;
      st.fts.run(r.lastInsertRowid, norm(text));
      added++;
    };
    const c = o.message?.content;
    if (o.isCompactSummary) {
      st.summary.run(o.uuid, session, o.parentUuid);
      put(0, 'sistem', 'ozet', textOf(c), Infinity);
      return added;
    }
    if (o.type === 'user') {
      if (typeof c === 'string') { if (!o.isMeta) put(0, 'kullanici', 'mesaj', c, CAP.mesaj); return added; }
      (Array.isArray(c) ? c : []).forEach((x, n) => {
        if (x?.type === 'text' && !o.isMeta) put(n, 'kullanici', 'mesaj', x.text, CAP.mesaj);
        if (x?.type === 'tool_result') put(n, 'arac', 'sonuc', typeof x.content === 'string' ? x.content : textOf(x.content), CAP.sonuc);
      });
    } else {
      (Array.isArray(c) ? c : []).forEach((x, n) => {
        if (x?.type === 'text') put(n, 'claude', 'mesaj', x.text, CAP.mesaj);
        if (x?.type === 'tool_use') {
          const i = x.input || {};
          put(n, 'claude', 'arac:' + x.name, [i.description, i.file_path, i.command, i.pattern, i.url, i.query, i.prompt]
            .filter((v) => typeof v === 'string' && v).join(' · '), CAP.arac);
        }
      });
    }
    return added;
  }

  // Dosyanın yeni kısmını bayt ofsetinden okur. Yarım kalan son satır (Claude Code o an yazıyor) bir sonraki taramayı bekler.
  // Dosya küçülmüşse (yeniden yazılmış) baştan okunur; tekil anahtarlar aynı kaydı ikinci kez yazdırmaz.
  async function indexFile(file, { account, project, session }, yieldFn) {
    const real = fs.realpathSync(file);
    const stat = fs.statSync(real);
    const prev = st.file.get(real);
    // Ortak "projects" klasöründe (symlink) aynı dosya birden çok hesaptan görünür; ilk alan hesap kalır
    const f = { account: prev?.account || account, project: prev?.project || project, session: prev?.session || session, tip: prev?.tip || null };
    let offset = prev && stat.size >= prev.offset ? prev.offset : 0;
    if (prev && prev.offset === stat.size && prev.mtime === stat.mtimeMs) return 0;
    let added = 0;
    const fd = fs.openSync(real, 'r');
    try {
      let carry = Buffer.alloc(0);
      let pos = offset;
      while (pos < stat.size) {
        const buf = Buffer.alloc(Math.min(CHUNK, stat.size - pos));
        const n = fs.readSync(fd, buf, 0, buf.length, pos);
        if (!n) break;
        pos += n;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
        const end = data.lastIndexOf(0x0a);
        if (end < 0) { carry = data; continue; }
        carry = Buffer.from(data.subarray(end + 1));
        db.exec('BEGIN');
        try {
          for (const line of data.subarray(0, end).toString('utf8').split('\n')) {
            if (!line) continue;
            let o;
            try { o = JSON.parse(line); } catch { continue; }
            added += ingest(o, f);
          }
          offset = pos - carry.length;
          st.putFile.run(real, f.account, f.project, f.session, stat.size, stat.mtimeMs, offset, f.tip);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        if (yieldFn) await yieldFn();
      }
      if (!prev || offset !== prev.offset || stat.mtimeMs !== prev.mtime) {
        st.putFile.run(real, f.account, f.project, f.session, stat.size, stat.mtimeMs, offset, f.tip);
      }
    } finally {
      fs.closeSync(fd);
    }
    soy.delete(f.session);
    return added;
  }

  // Hedef: { account, projectsDir, project }. Yalnız üst düzeydeki <oturum>.jsonl dosyaları (alt ajan kayıtları alınmaz).
  async function scan(targets, yieldFn) {
    const t0 = Date.now();
    let files = 0, added = 0;
    const errors = [];
    for (const t of targets) {
      for (const dir of projectDirs(t.projectsDir, t.project)) {
        let names = [];
        try { names = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')); } catch { continue; }
        for (const name of names) {
          try {
            added += await indexFile(path.join(dir, name), { account: t.account, project: t.project, session: name.slice(0, -6) }, yieldFn);
            files++;
          } catch (err) {
            errors.push(`${name}: ${err?.message || err}`);
          }
        }
      }
    }
    for (const f of [dbPath + '-wal', dbPath + '-shm']) { try { fs.chmodSync(f, 0o600); } catch {} }
    return { files, added, ms: Date.now() - t0, errors: errors.slice(0, 5) };
  }

  // ---------- Kalıcı arşiv (P3.2) ----------
  // Claude Code eski kayıtları silebilir (cleanupPeriodDays, varsayılan 30 gün). Hedefi archive: true olan projelerin
  // (ahtapotlar) kayıtları boşta kalınca <kök>/<hesap>/<proje klasörü>/<oturum>.jsonl.gz'ye kopyalanır, dosya değiştikçe
  // kopya yenilenir. Kaynak silinse de kopya kalır; kaynak küçülmüşse (yeniden yazılmış) önceki kopya ayrı adla korunur (İ2).
  // Kopya kaynağın o anki boyutuna kadar alınır; okunurken büyüyen kısım bir sonraki geçişte gelir.
  async function archive(targets, root, now = Date.now()) {
    const t0 = Date.now();
    let copied = 0;
    const errors = [], seen = new Set();
    const dirOk = (d) => { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); };
    for (const t of targets) {
      if (!t.archive) continue;
      for (const dir of projectDirs(t.projectsDir, t.project)) {
        let names = [];
        try { names = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')); } catch { continue; }
        for (const name of names) {
          try {
            const real = fs.realpathSync(path.join(dir, name));
            if (seen.has(real)) continue;
            seen.add(real);
            const stat = fs.statSync(real);
            if (!stat.size || now - stat.mtimeMs < IDLE_MS) continue;
            const prev = st.arch.get(real);
            // Ortak "projects" klasöründe aynı dosya birden çok hesaptan görünür: ilk kopyanın yeri kalır
            const dest = prev?.dest || path.join(root, sanitize(t.account), path.basename(dir), name + '.gz');
            const have = fs.existsSync(dest);
            if (prev && have && prev.size === stat.size && prev.mtime === stat.mtimeMs) continue;
            dirOk(root); dirOk(path.dirname(path.dirname(dest))); dirOk(path.dirname(dest));
            if (prev && have && stat.size < prev.size) fs.renameSync(dest, dest.replace(/\.jsonl\.gz$/, `.${Math.round(prev.mtime)}.jsonl.gz`));
            const tmp = dest + '.yaziliyor';
            try {
              await pipeline(fs.createReadStream(real, { start: 0, end: stat.size - 1 }), zlib.createGzip(), fs.createWriteStream(tmp, { mode: 0o600 }));
              fs.chmodSync(tmp, 0o600);
              fs.renameSync(tmp, dest);
            } catch (err) {
              try { fs.unlinkSync(tmp); } catch {}
              throw err;
            }
            st.putArch.run(real, dest, stat.size, stat.mtimeMs, new Date().toISOString());
            copied++;
          } catch (err) {
            errors.push(`${name}: ${err?.message || err}`);
          }
        }
      }
    }
    return { copied, ms: Date.now() - t0, errors: errors.slice(0, 5) };
  }

  // ---------- Soy zinciri ve bağlamdaki yer ----------
  // Zincir oturumun ucundan geriye yürür (parentUuid, sınırda logicalParentUuid). Korunan son mesajlar (preservedMessages)
  // diskte eski ebeveynlerini taşır, zincir sınırın üstünden atlayabilir: bir sınır, kendisi, logicalParentUuid'si ya da
  // korunan mesajlarından biri zincirdeyse soya dahil sayılır. Sorgu anında hesaplanır, dosya değişene kadar önbellekte.
  const soy = new Map(); // oturum -> { chain, last }
  function lineage(session) {
    if (soy.has(session)) return soy.get(session);
    const tip = db.prepare('SELECT tip FROM files WHERE session = ? AND tip IS NOT NULL').get(session)?.tip;
    const by = new Map();
    for (const r of db.prepare('SELECT uuid, parent_uuid, logical_parent FROM nodes WHERE session = ?').all(session)) by.set(r.uuid, r);
    const chain = new Set();
    let cur = tip ? by.get(tip) : null;
    while (cur && !chain.has(cur.uuid)) {
      chain.add(cur.uuid);
      cur = by.get(cur.parent_uuid) || by.get(cur.logical_parent);
    }
    const included = [];
    for (const b of db.prepare('SELECT * FROM boundaries WHERE session = ? ORDER BY ts').all(session)) {
      const kept = new Set(JSON.parse(b.kept || '[]'));
      if (!(chain.has(b.uuid) || chain.has(b.logical_parent) || [...kept].some((u) => chain.has(u)))) continue;
      included.push({ uuid: b.uuid, ts: b.ts, summary: b.summary_uuid, kept });
    }
    // Zincir korunan mesajlardan eski uca atladığında sınırın kendisi ve özeti zincirde görünmez; yine de bu soyun parçasıdırlar
    for (const b of included) { chain.add(b.uuid); if (b.summary) chain.add(b.summary); }
    const last = included[included.length - 1] || null;
    const r = { chain, last };
    soy.set(session, r);
    return r;
  }

  // 'baglamda' | 'dusmus' (son sıkıştırmadan önce kaldı) | 'baska-dal'
  function placeOf(e) {
    const { chain, last } = lineage(e.session);
    if (!chain.has(e.uuid)) return 'baska-dal';
    if (!last) return 'baglamda';
    if (e.uuid === last.uuid || e.uuid === last.summary || last.kept.has(e.uuid)) return 'baglamda';
    return (e.ts || '') > last.ts ? 'baglamda' : 'dusmus';
  }

  // ---------- Arama ----------

  // "tırnaklı ifade" bütün kalır, diğer kelimelerden 3+ harfliler ayrı ayrı (trigram 3 harften kısayı arayamaz); hepsi VE ile
  function parse(q) {
    const parts = [];
    q = String(q || '').replace(/"([^"]+)"/g, (_, p) => { if (norm(p).trim().length >= 3) parts.push(norm(p).trim()); return ' '; });
    for (const w of norm(q).split(/\s+/)) if (w.length >= 3) parts.push(w);
    return parts;
  }

  // { query, project?, account?, accounts?, limit? } → { ok, hits: [{ session, uuid, ts, role, kind, place, text, snippet, at, len }], ms }
  // accounts: aynı kayıt klasörünü paylaşan hesaplar (hafiza.js → aliases); at/len: ilk terimin metindeki yeri (norm uzunluğu korur)
  function search({ query, project, account, accounts, limit = 10 } = {}) {
    const parts = parse(query);
    if (!parts.length) return { ok: false, error: 'Sorgu en az 3 harfli bir kelime içermeli.' };
    const n = Math.max(1, Math.min(50, +limit || 10));
    const where = ['fts MATCH ?'], args = [parts.map((p) => '"' + p.replace(/"/g, '""') + '"').join(' AND ')];
    if (project) { where.push('e.project = ?'); args.push(project); }
    if (account) { where.push('e.account = ?'); args.push(account); }
    if (Array.isArray(accounts) && accounts.length) { where.push(`e.account IN (${accounts.map(() => '?').join(', ')})`); args.push(...accounts); }
    const t0 = Date.now();
    const raw = db.prepare(`SELECT e.*, bm25(fts) AS score FROM fts JOIN entries e ON e.id = fts.rowid
      WHERE ${where.join(' AND ')} ORDER BY score LIMIT ?`).all(...args, n * 4);
    // Aynı kayıt devam edilen oturumun dosyasında yeniden geçebilir: uuid ve sıra ile tekilleştirilir
    const seen = new Set(), hits = [];
    for (const h of raw) {
      const k = h.uuid ? h.uuid + ':' + h.seq : h.session + ':' + h.id;
      if (seen.has(k)) continue;
      seen.add(k);
      const at = norm(h.text).indexOf(parts[0]), i = Math.max(0, at);
      hits.push({
        session: h.session, uuid: h.uuid, ts: h.ts, role: h.role, kind: h.kind, project: h.project, account: h.account,
        place: placeOf(h), text: h.text, at, len: at < 0 ? 0 : parts[0].length,
        snippet: (i > 80 ? '…' : '') + h.text.slice(Math.max(0, i - 80), i + 200).replace(/\s+/g, ' ') + (i + 200 < h.text.length ? '…' : ''),
      });
      if (hits.length >= n) break;
    }
    return { ok: true, hits, ms: Date.now() - t0 };
  }

  // Bir kaydın tamamı ve oturumdaki komşuları (hatirla_oku): { session, uuid, around?, project?, accounts? } →
  // { ok, records: [{ uuid, ts, role, place, target, parts: [{ kind, text }] }] }. Kayıtlar zamana, sonra dosyadaki sıraya göre;
  // bir kaydın birden çok parçası (metin, araç çağrısı) sırayla. Kapsam dışındaki oturum "bulunamadı" sayılır.
  // at (ISO zaman): uuid yoksa ya da bulunamazsa o andan önceki son kullanıcı mesajı (defterin kaynağı, defter.js), o da yoksa en yakın kayıt
  function read({ session, uuid, at, around = 2, project, accounts } = {}) {
    if (!session || (!uuid && !at)) return { ok: false, error: 'oturum ve uuid gerekli' };
    const where = ['session = ?'], args = [session];
    if (project) { where.push('project = ?'); args.push(project); }
    if (Array.isArray(accounts) && accounts.length) { where.push(`account IN (${accounts.map(() => '?').join(', ')})`); args.push(...accounts); }
    const rows = db.prepare(`SELECT * FROM entries WHERE ${where.join(' AND ')} ORDER BY ts, id`).all(...args);
    const order = [], by = new Map();
    for (const r of rows) {
      const k = r.uuid || 'id:' + r.id;
      if (!by.has(k)) { by.set(k, []); order.push(k); }
      by.get(k).push(r);
    }
    let i = uuid ? order.indexOf(uuid) : -1;
    if (i < 0 && at && order.length) {
      const first = (k) => by.get(k)[0];
      for (let j = 0; j < order.length; j++) if (first(order[j]).role === 'kullanici' && first(order[j]).ts <= at) i = j;
      if (i < 0) i = order.reduce((b, k, j) => (Math.abs(Date.parse(first(k).ts) - Date.parse(at)) < Math.abs(Date.parse(first(order[b]).ts) - Date.parse(at)) ? j : b), 0);
    }
    if (i < 0) return { ok: false, error: 'Kayıt bulunamadı (oturum ' + session + (uuid ? ', uuid ' + uuid : '') + ').' };
    uuid = order[i];
    const n = Math.max(0, Math.min(10, Math.round(+around) || 0));
    const records = order.slice(Math.max(0, i - n), i + n + 1).map((k) => {
      const parts = by.get(k).sort((a, b) => a.seq - b.seq);
      const r = parts[0];
      return { uuid: r.uuid, ts: r.ts, role: r.role, place: placeOf(r), target: k === uuid, parts: parts.map((p) => ({ kind: p.kind, text: p.text })) };
    });
    return { ok: true, session, project: rows[0].project, records };
  }

  // Danışmanın kaynağı (danis.js, P6.1): { session, uuid?, at?, accounts? } → { ok, file, exists, archive, uuid, ts, role, place, text }.
  // Dal bu kayda kadar açılır (forkSession upToMessageId). uuid verilmezse: at varsa o andan önceki son kayıt, yoksa oturumun son kaydı;
  // ikisinde de yalnız soydaki kayıtlar (başka dal değil). Araç çağrısıyla biten dal API'ye cevapsız tool_use götürürdü: kayıt araç
  // çağrısıysa sonraki (araç sonucu), o yoksa önceki araç olmayan kayıt alınır.
  function source({ session, uuid, at, accounts } = {}) {
    if (!session) return { ok: false, error: 'oturum gerekli' };
    const acc = Array.isArray(accounts) && accounts.length ? accounts : null;
    const inAcc = acc ? ` AND account IN (${acc.map(() => '?').join(', ')})` : '';
    const f = db.prepare('SELECT * FROM files WHERE session = ?' + inAcc).get(session, ...(acc || []));
    if (!f) return { ok: false, error: `Oturum ${session} hafızada yok (bu hesabın ahtapot projelerinde değil ya da henüz dizinlenmedi).` };
    const rows = db.prepare('SELECT * FROM entries WHERE session = ?' + inAcc + ' ORDER BY ts, id').all(session, ...(acc || []));
    const order = [], by = new Map();
    for (const r of rows) {
      const k = r.uuid || 'id:' + r.id;
      if (!by.has(k)) { by.set(k, r); order.push(k); }
    }
    const usable = order.filter((k) => by.get(k).uuid);
    if (!usable.length) return { ok: false, error: `Oturum ${session} içinde danışılacak kayıt yok.` };
    let i;
    if (uuid) {
      i = usable.indexOf(uuid);
      if (i < 0) return { ok: false, error: `Kayıt bulunamadı (oturum ${session}, uuid ${uuid}).` };
    } else {
      const t = at ? Date.parse(at) : Infinity;
      if (at && isNaN(t)) return { ok: false, error: `Zaman anlaşılmadı: ${at} (örnek: 2026-09-30T08:34).` };
      i = -1;
      for (let j = 0; j < usable.length; j++) {
        const r = by.get(usable[j]);
        if (placeOf(r) !== 'baska-dal' && Date.parse(r.ts) <= t) i = j;
      }
      if (i < 0) return { ok: false, error: `Oturum ${session} içinde ${at} anından önce kayıt yok.` };
    }
    const isTool = (k) => by.get(k).kind?.startsWith('arac:');
    if (isTool(usable[i])) {
      let j = usable.findIndex((k, n) => n > i && !isTool(k));
      if (j < 0) for (j = i - 1; j >= 0 && isTool(usable[j]); j--);
      if (j < 0) return { ok: false, error: 'Bu kayıtta bitecek bir dal açılamaz (yalnız araç çağrısı var).' };
      i = j;
    }
    const r = by.get(usable[i]);
    const arch = db.prepare('SELECT dest FROM archives WHERE path = ?').get(f.path)?.dest || null;
    return {
      ok: true, session, project: f.project, account: f.account, file: f.path, exists: fs.existsSync(f.path),
      archive: arch && fs.existsSync(arch) ? arch : null,
      uuid: r.uuid, ts: r.ts, role: r.role, place: placeOf(r), text: r.text.slice(0, 300),
    };
  }

  function status({ project } = {}) {
    const w = project ? ' WHERE project = ?' : '';
    const a = project ? [project] : [];
    let bytes = 0;
    try { bytes = fs.statSync(dbPath).size; } catch {}
    return {
      entries: db.prepare('SELECT count(*) AS n FROM entries' + w).get(...a).n,
      files: db.prepare('SELECT count(*) AS n FROM files' + w).get(...a).n,
      sessions: db.prepare('SELECT count(DISTINCT session) AS n FROM files' + w).get(...a).n,
      bytes,
    };
  }

  // Hafızası kapatılan proje dizinden düşer (P8.1, ayarlar): kayıtlar, soy düğümleri, sınırlar ve dosya ofsetleri. Arşiv kopyaları ve
  // archives tablosu kalır. FTS içeriksiz olduğu için satırlar 'delete' komutuyla, yazıldıkları gövdeyle (norm(text)) silinir.
  function drop({ project, accounts }) {
    if (!project || !Array.isArray(accounts) || !accounts.length) return { files: 0, entries: 0 };
    const q = accounts.map(() => '?').join(',');
    const files = db.prepare(`SELECT path, session FROM files WHERE project = ? AND account IN (${q})`).all(project, ...accounts);
    const rows = db.prepare(`SELECT id, text FROM entries WHERE project = ? AND account IN (${q})`).all(project, ...accounts);
    const del = db.prepare("INSERT INTO fts (fts, rowid, body) VALUES ('delete', ?, ?)");
    db.exec('BEGIN');
    try {
      for (const r of rows) del.run(r.id, norm(r.text));
      db.prepare(`DELETE FROM entries WHERE project = ? AND account IN (${q})`).run(project, ...accounts);
      for (const f of files) {
        db.prepare('DELETE FROM nodes WHERE session = ?').run(f.session);
        db.prepare('DELETE FROM boundaries WHERE session = ?').run(f.session);
        db.prepare('DELETE FROM files WHERE path = ?').run(f.path);
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return { files: files.length, entries: rows.length };
  }

  return { db, scan, archive, indexFile, search, read, source, status, drop, close: () => db.close() };
}

module.exports = { openIndex, norm, mask, sanitize, firstCwd, projectDirs };

// ---------- İşçi ----------
// İstek: { id, op: 'scan' | 'archive' | 'search' | 'read' | 'source' | 'status' | 'drop', args } → yanıt: { id, ok, result } ya da { id, ok: false, error }.
// Taramalar sırayla yapılır; parçalar arasında bekleyen aramalar yanıtlanır.
const { parentPort, workerData, isMainThread } = require('worker_threads');
if (!isMainThread && parentPort && workerData?.dbPath) {
  let index = null;
  let openError = null;
  try { index = openIndex(workerData.dbPath); } catch (err) { openError = err?.message || String(err); }
  const yieldFn = () => new Promise((r) => setImmediate(r));
  let queue = Promise.resolve();
  parentPort.on('message', ({ id, op, args = {} }) => {
    const run = async (fn) => {
      try {
        if (!index) throw new Error('Hafıza dizini açılamadı: ' + openError);
        parentPort.postMessage({ id, ok: true, result: await fn() });
      } catch (err) {
        parentPort.postMessage({ id, ok: false, error: err?.message || String(err) });
      }
    };
    if (op === 'scan') queue = queue.then(() => run(() => index.scan(args.targets || [], yieldFn)));
    else if (op === 'archive') queue = queue.then(() => run(() => index.archive(args.targets || [], args.root)));
    else if (op === 'search') run(() => index.search(args));
    else if (op === 'read') run(() => index.read(args));
    else if (op === 'source') run(() => index.source(args));
    else if (op === 'status') run(() => index.status(args));
    else if (op === 'drop') queue = queue.then(() => run(() => index.drop(args)));
    else parentPort.postMessage({ id, ok: false, error: 'bilinmeyen işlem: ' + op });
  });
}
