// Octopus prototipi: Claude Code oturum kayıtlarını kayıpsız, aranabilir bir dizine çevirir (node:sqlite FTS5 trigram, ek bağımlılık yok).
// Kullanım:
//   node dizin.mjs kur <proje-kayıt-klasörü> <db>      örn. ~/.claude/projects/-Users-ben-Proje /tmp/proje.db
//   node dizin.mjs ara <db> "<sorgu>" [adet]            kelimeler VE ile aranır; "tırnaklı ifade" bütün aranır
// Dizin konuşmaların tam metnini içerir: dosya yalnız sahibine açık yazılır (600).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRows, textOf, norm, lineage, placeOf, PLACE } from './ortak.mjs';

const cap = (s, n) => (s.length > n ? s.slice(0, n) : s);

function kur(dir, dbPath) {
  fs.rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE m (id INTEGER PRIMARY KEY, session TEXT, uuid TEXT, ts TEXT, role TEXT, kind TEXT, place INTEGER, text TEXT);
    CREATE VIRTUAL TABLE f USING fts5(body, content='', tokenize='trigram');`);
  const insM = db.prepare('INSERT INTO m (session, uuid, ts, role, kind, place, text) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insF = db.prepare('INSERT INTO f (rowid, body) VALUES (?, ?)');
  let files = 0, rows = 0, bytes = 0;
  const t0 = performance.now();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const file = path.join(dir, f);
    bytes += fs.statSync(file).size;
    const objs = readRows(file);
    const lin = lineage(objs);
    const sid = f.replace('.jsonl', '');
    const seen = new Set(); // dallanma yüzünden aynı kayıt dosyada birden çok kez geçebilir
    db.exec('BEGIN');
    const put = (o, n, role, kind, text) => {
      text = text.trim();
      const key = o.uuid + ':' + n;
      if (!text || seen.has(key)) return;
      seen.add(key);
      const r = insM.run(sid, o.uuid || '', o.timestamp || '', role, kind, placeOf(o, lin), text);
      insF.run(r.lastInsertRowid, norm(text));
      rows++;
    };
    for (const o of objs) {
      if (o.type !== 'user' && o.type !== 'assistant') continue;
      const c = o.message?.content;
      if (o.isCompactSummary) { put(o, 0, 'sistem', 'ozet', textOf(c)); continue; }
      if (o.type === 'user') {
        if (typeof c === 'string') { if (!o.isMeta) put(o, 0, 'kullanici', 'mesaj', cap(c, 20000)); continue; }
        (c || []).forEach((x, n) => {
          if (x.type === 'text' && !o.isMeta) put(o, n, 'kullanici', 'mesaj', cap(x.text, 20000));
          if (x.type === 'tool_result') put(o, n, 'arac', 'sonuc', cap(typeof x.content === 'string' ? x.content : textOf(x.content), 3000));
        });
      } else {
        (c || []).forEach((x, n) => {
          if (x.type === 'text') put(o, n, 'claude', 'mesaj', cap(x.text, 20000));
          if (x.type === 'tool_use') {
            const i = x.input || {};
            put(o, n, 'claude', 'arac:' + x.name, cap([i.description, i.file_path, i.command, i.pattern, i.url, i.query, i.prompt].filter(Boolean).join(' · '), 2000));
          }
        });
      }
    }
    db.exec('COMMIT');
    files++;
  }
  db.close();
  console.log(JSON.stringify({ oturum: files, kayit: rows, okunan_mb: Math.round(bytes / 1048576), sure_sn: +((performance.now() - t0) / 1000).toFixed(1), db_mb: Math.round(fs.statSync(dbPath).size / 1048576) }));
}

// Sorgu: "tırnaklı ifade" bütün kalır, diğer kelimelerden 3+ harfliler ayrı ayrı; hepsi VE ile bağlanır
function parse(q) {
  const parts = [];
  q = q.replace(/"([^"]+)"/g, (_, p) => { parts.push(norm(p)); return ' '; });
  for (const w of norm(q).split(/\s+/)) if (w.length >= 3) parts.push(w);
  return parts;
}

function ara(dbPath, q, n = 6) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const parts = parse(q);
  if (!parts.length) { console.log('Sorgu en az 3 harfli bir kelime içermeli.'); return; }
  const match = parts.map((p) => '"' + p.replace(/"/g, '""') + '"').join(' AND ');
  const t0 = performance.now();
  const raw = db.prepare('SELECT m.*, bm25(f) AS skor FROM f JOIN m ON m.id = f.rowid WHERE f MATCH ? ORDER BY bm25(f) LIMIT ?').all(match, n * 4);
  const ms = performance.now() - t0;
  const seen = new Set(), hits = [];
  for (const h of raw) {
    const key = h.session + h.uuid + h.text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(h);
    if (hits.length >= n) break;
  }
  console.log(`\n«${q}» → ${hits.length} sonuç, ${ms.toFixed(1)} ms`);
  for (const h of hits) {
    const i = Math.max(0, norm(h.text).indexOf(parts[0]));
    const snip = h.text.slice(Math.max(0, i - 70), i + 150).replace(/\s+/g, ' ');
    console.log(`  ${h.ts.slice(0, 16)} ${h.session.slice(0, 8)} ${h.role}/${h.kind}${PLACE[h.place]}\n    …${snip}…`);
  }
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'kur' && a && b) kur(a, b);
else if (cmd === 'ara' && a && b) ara(a, b, Number(c) || 6);
else console.log('Kullanım: node dizin.mjs kur <proje-kayıt-klasörü> <db>  |  node dizin.mjs ara <db> "<sorgu>" [adet]');
