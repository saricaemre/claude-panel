// Octopus prototipi: bir oturumun soy zincirindeki sıkıştırmalar ve bir bilginin hangi özette yaşadığı.
// Kullanım: node soy.mjs <oturum.jsonl> ["etiket=düzenli-ifade" ...]
// Örnek:    node soy.mjs ~/.claude/projects/-Users-ben-Proje/<id>.jsonl "Witcher=witcher" "ilk görev=yerinde dön|turn[- ]in[- ]place"
import { readRows, lineage } from './ortak.mjs';

const [file, ...probes] = process.argv.slice(2);
if (!file) { console.log('Kullanım: node soy.mjs <oturum.jsonl> ["etiket=düzenli-ifade" ...]'); process.exit(1); }
const { boundaries } = lineage(readRows(file));
console.log(`soydaki sıkıştırma: ${boundaries.length}`);
boundaries.forEach((b, i) => console.log(`  ${i + 1}. ${b.ts.slice(0, 16)}  ${b.trigger}  ${b.pre} → ${b.post} token  özet ${b.summary.length} kr`));
if (probes.length && boundaries.length) {
  console.log('\nözetlerde (sırayla):');
  for (const p of probes) {
    const eq = p.indexOf('=');
    const label = eq > 0 ? p.slice(0, eq) : p, re = new RegExp(eq > 0 ? p.slice(eq + 1) : p, 'i');
    console.log('  ' + label.padEnd(28) + boundaries.map((b, i) => `ö${i + 1}:${re.test(b.summary) ? 'VAR' : ' — '}`).join('  '));
  }
}
