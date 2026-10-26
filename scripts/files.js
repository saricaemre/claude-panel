// Yardımcı süreç: git dışı bir klasörün dosyalarını genişlik öncelikli tarar, her yolu NUL ile ayırıp stdout'a yazar
// (changes.js → `walk`, `@dosya` önerileri). Gizli klasörler ve node_modules atlanır, sembolik bağlar izlenmez.
// Ayrı süreçte koşar: bulut klasörlerinde (iCloud, ~/Library/CloudStorage) readdir çekirdekte takılabiliyor; ana süreçte
// bu, libuv iş parçacığını kalıcı kilitlerdi (2026-10-26'da ev klasöründe ölçüldü). Süreyi ve sınırı çağıran tutar, sonra öldürür.
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const SKIP = new Set(['node_modules', '.git']);

(async () => {
  const queue = [''];
  while (queue.length) {
    const rel = queue.shift();
    let ents;
    try { ents = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    let chunk = '';
    for (const e of ents) {
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !SKIP.has(e.name)) queue.push(p); }
      else chunk += p + '\0';
    }
    if (chunk && !process.stdout.write(chunk)) await new Promise((r) => process.stdout.once('drain', r));
  }
  process.stdout.write('\0\0'); // bitti işareti
})();
