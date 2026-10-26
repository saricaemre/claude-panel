// "!" kabuk kipi (Claude Code'un bash kipi; docs/claude-code-eksikleri/PLAN.md madde 10): kullanıcının yazma kutusunda "!" ile yazdığı komut
// sohbetin klasöründe ve ortamında (giriş kabuğu + seçili ortam) çalışır, çıktısı arayüze akar. Bitince Claude'a shouldQuery: false
// kullanıcı mesajı olarak gider (chat-main.js → pushShell): tur açmaz, API'ye gitmez, kayda yazılır ve sonraki mesajla birlikte okunur.
// Biçim Claude Code'unki: <bash-input>komut</bash-input> + <bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>.
// Komutu kullanıcı yazdığı için izin kartı yok; Claude bu yolu kullanamaz (araç değil, yalnız yazma kutusu).
const { spawn } = require('child_process');

const KEEP_MAX = 2 * 1024 * 1024; // akış başına bellekte tutulan (sonsuz çıktıda başı kalır)
const CLAUDE_MAX = 30000; // Claude'a giden çıktı (baş ve son yarısı)
const TIMEOUT_MS = 10 * 60 * 1000;
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

const running = new Map(); // anahtar (sohbet:çalıştırma) -> { child, stopped }

// Terminal kaçışları atılır; \r ile üzerine yazılan satırlarda (ilerleme çubuğu) son hâl kalır
function plain(s) {
  return s.replace(ANSI, '').replace(/\r\n/g, '\n').split('\n').map((l) => l.split('\r').filter(Boolean).pop() || '').join('\n');
}
function clip(s, max) {
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return s.slice(0, half) + `\n… [${s.length - max} karakter kesildi] …\n` + s.slice(-half);
}
// Çıktıdaki etiketler bozulur: komutun yazdığı "</bash-stdout>" Claude'un okuduğu bloğu kapatıp sahte bir girdi açamasın
const safe = (s) => String(s).replace(/<(\/?)(bash-(?:input|stdout|stderr|exit-code))/gi, '‹$1$2');

function run({ key, cmd, cwd, env, onData }) {
  const shell = env.SHELL || process.env.SHELL || '/bin/zsh';
  const t0 = Date.now();
  const child = spawn(shell, ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { child, stopped: false, timedOut: false };
  running.set(key, entry);
  const buf = { out: '', err: '' };
  let truncated = false;
  const take = (stream) => (d) => {
    const s = d.toString('utf8');
    if (buf[stream].length < KEEP_MAX) buf[stream] += s.slice(0, KEEP_MAX - buf[stream].length);
    else truncated = true;
    onData?.(stream, s.replace(ANSI, ''));
  };
  child.stdout.on('data', take('out'));
  child.stderr.on('data', take('err'));
  const timer = setTimeout(() => { entry.timedOut = true; kill(entry); }, TIMEOUT_MS);
  const done = new Promise((resolve) => {
    let finished = false;
    const end = (code, signal, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      running.delete(key);
      resolve({ code, signal, error: error || null, out: buf.out, err: buf.err, truncated, ms: Date.now() - t0, stopped: entry.stopped, timedOut: entry.timedOut });
    };
    child.on('error', (e) => end(null, null, e.message));
    child.on('close', (code, signal) => end(code, signal));
  });
  return { done };
}

// Süreç grubu öldürülür (detached): "npm run dev" gibi alt süreç açan komutlar da kapanır
function kill(entry) {
  try { process.kill(-entry.child.pid, 'SIGINT'); } catch {}
  setTimeout(() => { try { process.kill(-entry.child.pid, 'SIGKILL'); } catch {} }, 2000).unref();
}
function stop(key) {
  const e = running.get(key);
  if (!e) return false;
  e.stopped = true;
  kill(e);
  return true;
}
// Sohbet kapanınca (ve panel kapanırken) o sohbetin komutları durur
function forget(prefix) {
  for (const [k, e] of running) if (prefix == null || k.startsWith(prefix + ':')) { e.stopped = true; kill(e); }
}

// Claude'a giden metin
function message(cmd, r) {
  const notes = [];
  if (r.error) notes.push(`(komut başlatılamadı: ${r.error})`);
  if (r.timedOut) notes.push('(10 dk zaman aşımı: durduruldu)');
  else if (r.stopped) notes.push('(kullanıcı durdurdu)');
  if (r.code != null && r.code !== 0) notes.push(`(çıkış kodu ${r.code})`);
  if (r.truncated) notes.push('(çıktının sonu alınmadı: 2 MB sınırı)');
  const out = clip(plain(r.out), CLAUDE_MAX).replace(/\n+$/, '');
  const err = [clip(plain(r.err), CLAUDE_MAX).replace(/\n+$/, ''), ...notes].filter(Boolean).join('\n');
  return `<bash-input>${safe(cmd)}</bash-input>\n<bash-stdout>${safe(out)}</bash-stdout><bash-stderr>${safe(err)}</bash-stderr>`;
}

module.exports = { run, stop, forget, message, plain };
