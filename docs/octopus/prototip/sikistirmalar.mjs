// Octopus prototipi: bir hesabın tüm projelerindeki gerçek sıkıştırmalar (yalnız sayılar; içerik yazdırmaz).
// Kullanım: node sikistirmalar.mjs [<hesap>/projects]   (varsayılan: $CLAUDE_CONFIG_DIR/projects ya da ~/.claude/projects)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.argv[2] || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const out = [];
for (const p of fs.readdirSync(root)) {
  const dir = path.join(root, p);
  try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
  const seen = new Set(), pre = [], trig = {};
  let sessions = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    sessions++;
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!l.includes('compact_boundary')) continue; // hızlı süzgeç; asıl denetim JSON üstünde
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (o.type !== 'system' || o.subtype !== 'compact_boundary' || seen.has(o.uuid)) continue;
      seen.add(o.uuid);
      const m = o.compactMetadata || {};
      pre.push(m.preTokens || 0);
      trig[m.trigger || '?'] = (trig[m.trigger || '?'] || 0) + 1;
    }
  }
  if (pre.length) out.push({ proje: p, oturum: sessions, sikistirma: pre.length, tetik: trig, en_kucuk: Math.min(...pre), en_buyuk: Math.max(...pre) });
}
out.sort((a, b) => b.sikistirma - a.sikistirma);
console.log(JSON.stringify(out, null, 1));
