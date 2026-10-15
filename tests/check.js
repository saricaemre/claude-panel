// Hızlı kontrol: tüm JS dosyalarının sözdizimi (node --check). Çalıştırma: npm run check
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '.claude', 'out'].includes(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(c|m)?js$/.test(name)) files.push(p);
  }
})(ROOT);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error('✗', path.relative(ROOT, f), '\n' + e.stderr.toString());
  }
}
console.log(failed ? `✗ ${failed} dosyada hata` : `✓ ${files.length} dosya temiz`);
process.exitCode = failed ? 1 : 0;
