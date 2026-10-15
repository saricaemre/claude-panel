// npm bazen node-pty'nin spawn-helper dosyasının çalıştırma iznini düşürüyor.
// Bu da "posix_spawnp failed" hatasına yol açıyor. Kurulumdan sonra izni geri veriyoruz.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'node-pty');
const candidates = [
  path.join(root, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  path.join(root, 'prebuilds', 'darwin-x64', 'spawn-helper'),
  path.join(root, 'build', 'Release', 'spawn-helper'),
];

for (const file of candidates) {
  try {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  } catch (e) {
    console.warn('spawn-helper izni ayarlanamadı:', file, e.message);
  }
}
