// P7.1 hazırlık (token harcamaz, kayıtları yalnız okur):
//  1. 15:53 sınırına kadar soy zincirinden olay listesi: kullanıcı mesajları, ara mesajlar (queued_command), soru aracı cevapları,
//     Claude metinleri, araç çağrılarının tek satırı. Sıkıştırma özetleri girmez (canlı baş onları yazmadan önce defterini tutardı).
//  2. Defter çıkarımı için üç kesit (sıkıştırma sınırlarına göre) -> /tmp/p71/kesit-<n>.txt
//  3. Soru setindeki anahtarların kayıtta ve üç özette geçip geçmediği -> stdout
//  4. Devir notu için 15:53 anına kadar kesilmiş oturum kopyası -> /tmp/p71/kesik.jsonl
import fs from 'node:fs';
import { readRows, textOf, lineage, norm } from '/Users/emre/Claude Panel/docs/octopus/prototip/ortak.mjs';

const FILE = process.argv[2];
const SET = JSON.parse(fs.readFileSync('/Users/emre/Claude Panel/docs/octopus/olcum/p71-soru-seti.json', 'utf8'));
const END = '2026-09-30T15:53:22.418Z'; // 3. sınır
const rows = readRows(FILE);
const lin = lineage(rows);
const bounds = lin.boundaries.filter((b) => b.ts <= END);
if (bounds.length !== 3) throw new Error('3 sınır bekleniyordu: ' + bounds.length);

const one = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const ev = [];
const seen = new Set();
const askQ = new Map(); // tool_use id -> sorular
for (const o of rows) {
  if (!o.uuid || seen.has(o.uuid) || !lin.chain.has(o.uuid)) continue;
  seen.add(o.uuid);
  const ts = o.timestamp || '';
  if (ts > END || ts < '2026-09-30T08:00') continue;
  if (o.isCompactSummary) continue;
  if (o.type === 'attachment' && o.attachment?.type === 'queued_command') {
    const p = String(o.attachment.prompt || '').trim();
    if (p && !p.startsWith('<')) ev.push({ ts, k: 'Emre (çalışırken yazdı)', t: p });
    continue;
  }
  const c = o.message?.content;
  if (o.type === 'user') {
    if (o.isMeta) continue;
    if (typeof c === 'string') {
      const m = c.match(/<command-name>\/compact<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/);
      if (m) ev.push({ ts, k: 'Emre', t: '/compact ' + m[1].trim() });
      else if (!/^<(local-command|command-)/.test(c.trim())) ev.push({ ts, k: 'Emre', t: c });
      continue;
    }
    for (const b of c || []) {
      if (b.type === 'text' && b.text.trim() && !/^\[Request interrupted/.test(b.text)) ev.push({ ts, k: 'Emre', t: b.text });
      if (b.type === 'tool_result' && askQ.has(b.tool_use_id)) {
        ev.push({ ts, k: 'Emre (soru aracına cevap)', t: askQ.get(b.tool_use_id) + '\nCevap: ' + (typeof b.content === 'string' ? b.content : textOf(b.content)) });
      }
    }
  } else if (o.type === 'assistant') {
    for (const b of c || []) {
      if (b.type === 'text' && b.text.trim()) ev.push({ ts, k: 'Claude', t: b.text });
      if (b.type === 'tool_use') {
        const i = b.input || {};
        if (b.name === 'AskUserQuestion') {
          askQ.set(b.id, (i.questions || []).map((q) => 'Soru: ' + q.question + ' Seçenekler: ' + (q.options || []).map((x) => x.label).join(' / ')).join('\n'));
          continue;
        }
        ev.push({ ts, k: 'araç', t: b.name + ': ' + one([i.description, i.file_path, i.command, i.pattern, i.url, i.query, i.prompt?.slice?.(0, 120)].filter(Boolean).join(' · '), 220) });
      }
    }
  }
}
ev.sort((a, b) => a.ts.localeCompare(b.ts));

// Kesitler: sınırlara göre
const cuts = [bounds[0].ts, bounds[1].ts, END];
const fmt = (e) => e.k === 'araç' ? `  [araç ${e.t}]` : `\n### ${e.k} · ${e.ts.slice(11, 16)} UTC\n${e.t.trim()}`;
let from = '';
const sizes = [];
cuts.forEach((to, i) => {
  const part = ev.filter((e) => e.ts > from && e.ts <= to);
  const s = part.map(fmt).join('\n');
  fs.writeFileSync(`/tmp/p71/kesit-${i + 1}.txt`, s, { mode: 0o600 });
  sizes.push({ kesit: i + 1, olay: part.length, karakter: s.length, emre: part.filter((e) => e.k.startsWith('Emre')).length });
  from = to;
});
console.log('kesitler', JSON.stringify(sizes));

// Anahtarlar: kayıtta (kaynak doğrulaması) ve özetlerde
const fullText = norm(ev.map((e) => e.t).join('\n'));
const hit = (txt, groups) => groups.map((g) => new RegExp(g, 'i').test(txt));
console.log('\nno  kayıtta  ö1  ö2  ö3   (grup tutma: kayıt | ö1 | ö2 | ö3)');
const pres = [];
for (const q of SET.sorular) {
  const rec = hit(fullText, q.iz);
  const s = bounds.map((b) => hit(norm(b.summary), q.iz));
  const all = (h) => (h.every(Boolean) ? 'VAR' : h.some(Boolean) ? 'yrm' : ' — ');
  pres.push({ no: q.no, kayit: all(rec), o: s.map(all) });
  console.log(String(q.no).padStart(2), '  ', all(rec), '   ', s.map(all).join(' '), '  ', [rec, ...s].map((h) => h.map((x) => (x ? 1 : 0)).join('')).join(' | '));
}
fs.writeFileSync('/tmp/p71/ozetlerde.json', JSON.stringify(pres), { mode: 0o600 });

// 15:53 anına kadar kesilmiş kopya (devir notu dosyadan okur; asıl dosya 8 Ekim'e kadar sürüyor)
const lines = fs.readFileSync(FILE, 'utf8').split('\n');
const keep = [];
for (const l of lines) {
  if (!l) continue;
  let o; try { o = JSON.parse(l); } catch { continue; }
  if ((o.timestamp || '') > END) break;
  keep.push(l);
}
fs.writeFileSync('/tmp/p71/kesik.jsonl', keep.join('\n') + '\n', { mode: 0o600 });
console.log('\nkesik kopya', keep.length, 'satır', fs.statSync('/tmp/p71/kesik.jsonl').size, 'bayt');
