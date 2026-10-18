// Yerel ortam profilleri: ad + ortam değişkenleri + isteğe bağlı kurulum betiği.
// Profiller panel genelindedir (config.json → environments); hangisinin kullanılacağı hesap başına seçilir (chatPrefs[hesap].env).
// Sohbet (chat-main.js) ve terminal (main.js) seçili profilin değişkenleriyle açılır; kurulum betiği oturum başında klasörde çalışır.
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

// Panelin kendisinin ayarladığı değişkenler: ezilirse hesap ayrımı bozulur
const PROTECTED = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_AGENT_SDK_CLIENT_APP', 'CLAUDE_PANEL_SETUP']);
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SETUP_TIMEOUT = 10 * 60 * 1000;

// .env biçimi: ANAHTAR=değer, # ile yorum, başta isteğe bağlı "export".
// Tek tırnaklı değer olduğu gibi alınır; çift tırnaklı ve tırnaksız değerde $AD / ${AD} açılır (\$ açılmaz),
// tırnaksız değerde baştaki ya da ":" sonrasındaki ~ ev klasörü olur.
function parseVars(text) {
  const vars = [];
  const errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.replace(/^export\s+/, '').match(/^([^=\s]+)\s*=\s*(.*)$/);
    if (!m || !KEY.test(m[1])) return errors.push(`${i + 1}. satır ANAHTAR=değer biçiminde değil`);
    if (PROTECTED.has(m[1])) return errors.push(`${i + 1}. satır: ${m[1]} panel tarafından ayarlanır, değiştirilemez`);
    let value = m[2];
    let mode = 'plain';
    if (value.length >= 2 && value[0] === "'" && value.endsWith("'")) { value = value.slice(1, -1); mode = 'literal'; }
    else if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) { value = value.slice(1, -1); mode = 'quoted'; }
    vars.push({ key: m[1], value, mode });
  });
  return { vars, errors };
}

function expand(value, env) {
  return value.replace(/\\\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (all, a, b) => (all === '\\$' ? '$' : env[a || b] ?? ''));
}

// Değişkenleri sırayla env'e yazar (sonraki satır öncekini $AD ile kullanabilir). Hatalı satırlar atlanır.
function applyVars(env, text) {
  for (const { key, value, mode } of parseVars(text).vars) {
    if (mode === 'literal') { env[key] = value; continue; }
    let v = mode === 'plain' ? value.replace(/(^|:)~(?=\/|:|$)/g, `$1${os.homedir()}`) : value;
    env[key] = expand(v, env);
  }
  return env;
}

// Kurulum betiğini klasörde kullanıcının kabuğuyla çalıştırır; betiğin export ettikleri sonraki ortama geçer.
// Betik bir fonksiyonun gövdesine konur: "return" erken bitirir, hata kodu korunur; "exit 0" ortamı değiştirmeden bitirir.
function runSetup(script, { cwd, env, timeoutMs = SETUP_TIMEOUT }) {
  return new Promise((resolve) => {
    const marker = '__CLAUDE_PANEL_ENV_' + crypto.randomBytes(6).toString('hex') + '__';
    const wrapped = `__panel_kurulum() {\n${script}\n}\n__panel_kurulum || exit $?\nprintf '%s' '${marker}'; env -0`;
    const shell = env.SHELL || process.env.SHELL || '/bin/zsh';
    const p = spawn(shell, ['-c', wrapped], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let tail = '';
    const keep = (d) => { tail = (tail + d).slice(-4000); };
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, code: -1, output: err.message }); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const i = out.indexOf(marker);
      keep(i < 0 ? out : out.slice(0, i));
      const output = tail.trim().split('\n').slice(-12).join('\n');
      if (timedOut) return resolve({ ok: false, code, output: `Zaman aşımı (${Math.round(timeoutMs / 60000)} dk).` + (output ? '\n' + output : '') });
      if (code !== 0) return resolve({ ok: false, code, output });
      if (i < 0) return resolve({ ok: true, env, output });
      const next = {};
      for (const pair of out.slice(i + marker.length).split('\0')) {
        const eq = pair.indexOf('=');
        if (eq > 0) next[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      for (const k of PROTECTED) { if (k in env) next[k] = env[k]; else delete next[k]; }
      resolve({ ok: true, env: next, output });
    });
  });
}

// Ayardan gelen listeyi temizler (arayüzden ne gelirse gelsin dosyaya bu biçimde yazılır)
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .filter((e) => e && typeof e.id === 'string' && /^[\w-]{1,40}$/.test(e.id) && !seen.has(e.id) && seen.add(e.id))
    .map((e) => ({
      id: e.id,
      name: String(e.name || '').trim().slice(0, 60) || 'Ortam',
      vars: String(e.vars || ''),
      setup: String(e.setup || ''),
    }));
}

module.exports = { PROTECTED, parseVars, applyVars, runSetup, sanitize };
