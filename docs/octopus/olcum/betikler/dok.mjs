// P7.1: oturumun soyundaki kullanıcı ve Claude metinlerini saatleriyle döker (yalnız okur).
import fs from 'node:fs';
import { readRows, textOf, lineage } from '/Users/emre/Claude Panel/docs/octopus/prototip/ortak.mjs';
const [file, until, out, mode] = process.argv.slice(2);
const rows = readRows(file);
const lin = lineage(rows);
const seen = new Set();
const lines = [];
for (const o of rows) {
  if (!o.uuid || seen.has(o.uuid) || !lin.chain.has(o.uuid)) continue;
  seen.add(o.uuid);
  if ((o.timestamp || '') > until) continue;
  if (o.isCompactSummary) { lines.push(`\n===== ÖZET ${o.timestamp} ${o.uuid}\n` + textOf(o.message?.content)); continue; }
  if (o.type === 'system' && o.subtype === 'compact_boundary') { lines.push(`\n===== SINIR ${o.timestamp} ${o.uuid}`); continue; }
  const c = o.message?.content;
  if (o.type === 'user' && !o.isMeta) {
    const t = typeof c === 'string' ? c : textOf(c);
    if (t.trim()) lines.push(`\n--- K ${o.timestamp} ${o.uuid}\n${t.slice(0, mode === 'full' ? 1e9 : 4000)}`);
  }
  if (o.type === 'assistant' && mode !== 'user') {
    const t = textOf(c);
    if (t.trim()) lines.push(`\n--- C ${o.timestamp} ${o.uuid}\n${t.slice(0, mode === 'full' ? 1e9 : 1500)}`);
  }
}
fs.writeFileSync(out, lines.join('\n'), { mode: 0o600 });
console.log(lines.length, fs.statSync(out).size);
