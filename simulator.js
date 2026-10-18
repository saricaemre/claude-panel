// iOS simülatörü: cihaz listesi (iPhone 14 ve üstü), açma, canlı görüntü ve dokunma, Claude'un simulator aracı.
// Görüntü ve dokunma native/simhelper ile (AXe'nin FBSimulatorControl çatıları); cihaz işleri xcrun simctl ile.
// Simülatörler makineye aittir, hesaba değil: tek bir bağlı cihaz vardır, bütün sohbetler onu görür.
const { ipcMain, nativeImage } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Testlerde sahte simctl ve yardımcı verilir
const SIMCTL = process.env.CLAUDE_PANEL_SIMCTL ? [process.env.CLAUDE_PANEL_SIMCTL] : ['xcrun', 'simctl'];
const HELPER = process.env.CLAUDE_PANEL_SIMHELPER || path.join(__dirname, 'native', 'build', 'simhelper');
const BUILD_SCRIPT = path.join(__dirname, 'scripts', 'build-simhelper.sh');
// native/simhelper.swift → helperVersion ile aynı; eski ikili "ready" mesajından tanınıp yeniden derlenir
const HELPER_VERSION = 2;
const AXE_HINT = 'AXe kurulu değil. Terminalde: brew install cameroncooke/axe/axe';

// Yalnız iPhone 14 ve sonrası (iPhone Air dahil)
function supportedName(name) {
  const m = /^iPhone (\d+)/.exec(name || '');
  return m ? Number(m[1]) >= 14 : /^iPhone Air\b/.test(name || '');
}

function run(cmd, args, { timeout = 60000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || '').trim().split('\n').slice(-3).join('\n') || err.message;
        return reject(new Error(msg));
      }
      resolve(String(stdout));
    });
  });
}
const simctl = (args, opts) => run(SIMCTL[0], [...SIMCTL.slice(1), ...args], opts);
// stdin'den veri alan simctl komutu (pbcopy). Finder'dan açılan uygulamada LANG yok: UTF-8 verilmezse
// simctl metni MacRoman sanıp Türkçe harfleri bozar (ölçüldü).
function simctlInput(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(SIMCTL[0], [...SIMCTL.slice(1), ...args], { env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(new Error(err.trim() || 'simctl ' + args[0] + ' başarısız')) : resolve()));
    p.stdin.end(input);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Cihazlar ----------
// Var olan iPhone'lar (14+) ve henüz oluşturulmamış 14+ modelleri (en yeni iOS ile oluşturulabilir)
async function listDevices() {
  const [dev, rt] = await Promise.all([
    simctl(['list', '-j', 'devices', 'available']).then(JSON.parse),
    simctl(['list', '-j', 'runtimes', 'available']).then(JSON.parse),
  ]);
  const runtimes = (rt.runtimes || []).filter((r) => r.isAvailable !== false && (r.platform === 'iOS' || /iOS/.test(r.identifier)));
  const runtimeName = Object.fromEntries(runtimes.map((r) => [r.identifier, r.name || `iOS ${r.version}`]));
  const devices = [];
  for (const [runtime, list] of Object.entries(dev.devices || {})) {
    if (!runtimeName[runtime]) continue;
    for (const d of list) {
      if (d.isAvailable === false || !supportedName(d.name)) continue;
      devices.push({ udid: d.udid, name: d.name, state: d.state, runtime: runtimeName[runtime], typeId: d.deviceTypeIdentifier });
    }
  }
  const order = (n) => { const m = /^iPhone (\d+)/.exec(n); return m ? Number(m[1]) : 99; };
  devices.sort((a, b) => (a.state === 'Booted' ? -1 : 0) - (b.state === 'Booted' ? -1 : 0) || order(b.name) - order(a.name) || a.name.localeCompare(b.name));
  // En yeni iOS'un desteklediği, henüz cihazı olmayan modeller
  const newest = runtimes.sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }))[0];
  const have = new Set(devices.map((d) => d.typeId));
  const creatable = (newest?.supportedDeviceTypes || [])
    .filter((t) => supportedName(t.name) && !have.has(t.identifier))
    .map((t) => ({ typeId: t.identifier, name: t.name, runtime: newest.name }))
    .sort((a, b) => order(b.name) - order(a.name) || a.name.localeCompare(b.name));
  return { devices, creatable, runtime: newest ? { id: newest.identifier, name: newest.name } : null };
}

// choice: udid, cihaz adı ya da "type:<cihaz türü>" (yoksa oluşturulur)
async function resolveDevice(choice) {
  const { devices, creatable, runtime } = await listDevices();
  if (!choice) {
    const booted = devices.find((d) => d.state === 'Booted');
    if (booted) return booted;
    if (devices[0]) return devices[0];
    if (creatable[0]) choice = 'type:' + creatable[0].typeId;
    else throw new Error('iPhone 14 ve üstü bir simülatör bulunamadı. Xcode → Settings → Components\'tan bir iOS sürümü indirin.');
  }
  const found = devices.find((d) => d.udid === choice || d.name.toLowerCase() === String(choice).toLowerCase());
  if (found) return found;
  const type = choice.startsWith('type:')
    ? creatable.find((t) => t.typeId === choice.slice(5))
    : creatable.find((t) => t.name.toLowerCase() === String(choice).toLowerCase());
  if (!type || !runtime) throw new Error(`"${choice}" desteklenmiyor. iPhone 14 ve üstü bir model seçin.`);
  const udid = (await simctl(['create', type.name, type.typeId, runtime.id])).trim();
  return { udid, name: type.name, state: 'Shutdown', runtime: runtime.name, typeId: type.typeId };
}

async function boot(device) {
  if (device.state !== 'Booted') {
    try { await simctl(['boot', device.udid]); } catch (e) { if (!/current state: Booted/i.test(e.message)) throw e; }
  }
  await simctl(['bootstatus', device.udid, '-b'], { timeout: 240000 });
}

// ---------- Yardımcı süreç ----------
let current = null; // { udid, name, proc, info, points, pending, nextId, lastFrame }
let starting = null; // Promise (aynı anda tek bağlanma)
let lastError = '';
let send = () => {};
let getEnv = async () => process.env;

// ---------- Yön ----------
// Ekran karesi ve dokunma koordinatları her zaman fiziksel (dikey) düzlemdedir; iOS yatayda içeriği bu düzlemde
// yan çevirip çizer (ölçüldü). Panel ve Claude ekranı dik görür; koordinatlar burada fiziksel düzleme çevrilir.
// landscapeLeft: görüntü saat yönünde 90° (cw), landscapeRight: tersine (ccw).
const ORIENTATIONS = { portrait: '', landscapeLeft: 'cw', landscapeRight: 'ccw' };

function displaySize() {
  const { w, h } = current.points;
  return current.orientation === 'portrait' ? { w, h } : { w: h, h: w };
}

// Görünen (dik) noktadan fiziksel noktaya
function toPhysical(x, y) {
  const { w, h } = current.points;
  if (current.orientation === 'landscapeLeft') return { x: y, y: h - x };
  if (current.orientation === 'landscapeRight') return { x: w - y, y: x };
  return { x, y };
}

async function rotate(name) {
  if (!(name in ORIENTATIONS)) throw new Error('Bilinmeyen yön: ' + name);
  await command({ cmd: 'orientation', name });
  current.orientation = name;
  broadcast();
}

function status() {
  if (current?.info) {
    return { state: 'attached', udid: current.udid, name: current.name, points: current.points,
      orientation: current.orientation, turn: ORIENTATIONS[current.orientation], display: displaySize() };
  }
  if (starting) return { state: 'starting', name: starting.name || '' };
  return { state: 'idle', error: lastError };
}
const broadcast = () => send('sim:state', status());

async function ensureHelper({ rebuild = false } = {}) {
  if (process.env.CLAUDE_PANEL_SIMHELPER || (!rebuild && fs.existsSync(HELPER))) return;
  // İlk kullanımda (ya da ikili eskiyse) derlenir (~30 sn); paketlenmiş uygulamada kur.sh önceden derler
  send('sim:state', { state: 'starting', name: 'Simülatör yardımcısı derleniyor' });
  try {
    await run('/bin/bash', [BUILD_SCRIPT], { timeout: 300000, env: await getEnv() });
  } catch (e) {
    throw new Error(/AXe bulunamadı/.test(e.message) ? AXE_HINT : 'Simülatör yardımcısı derlenemedi: ' + e.message);
  }
}

function spawnHelper(device) {
  return new Promise((resolve, reject) => {
    const proc = spawn(HELPER, ['--udid', device.udid, '--max-width', '750', '--fps', '30'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const s = { udid: device.udid, name: device.name, proc, info: null, points: null, orientation: 'portrait', pending: new Map(), nextId: 1, lastFrame: null,
      held: new Map(), heldMods: new Map() }; // basılı tutulan tuşlar (holdKey)
    let buf = Buffer.alloc(0);
    let errTail = '';
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) { try { proc.kill(); } catch {} reject(err); } else resolve(s);
    };
    const timer = setTimeout(() => done(new Error('Simülatöre bağlanılamadı (zaman aşımı)')), 30000);
    proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-3000); });
    proc.stdout.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= 5) {
        const len = buf.readUInt32BE(1);
        if (buf.length < 5 + len) break;
        const kind = buf[0];
        const data = buf.subarray(5, 5 + len);
        buf = buf.subarray(5 + len);
        if (kind === 0x46) { // 'F'
          s.lastFrame = Buffer.from(data);
          if (s.info) send('sim:frame', s.lastFrame);
          continue;
        }
        let msg;
        try { msg = JSON.parse(data.toString('utf8')); } catch { continue; }
        if (msg.type === 'ready') {
          if ((msg.version || 1) < HELPER_VERSION) return done(Object.assign(new Error('Simülatör yardımcısı eski'), { stale: true }));
          s.info = msg;
          const scale = msg.scale || 3;
          s.points = { w: Math.round(msg.widthPixels / scale), h: Math.round(msg.heightPixels / scale), scale };
          done();
        } else if (msg.type === 'fatal') {
          done(new Error(msg.error));
        } else if (msg.type === 'reply') {
          const p = s.pending.get(msg.id);
          if (p) { s.pending.delete(msg.id); msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error || 'başarısız')); }
        }
      }
    });
    proc.on('error', (e) => done(e));
    proc.on('exit', (code) => {
      for (const p of s.pending.values()) p.reject(new Error('Simülatör bağlantısı kapandı'));
      s.pending.clear();
      if (!settled) {
        const dyld = /Library not loaded|FBSimulatorControl/.test(errTail);
        done(new Error(dyld ? AXE_HINT : `Simülatör yardımcısı kapandı (${code})` + (errTail ? ': ' + errTail.trim().split('\n').pop() : '')));
      }
      if (current === s) {
        current = null;
        lastError = code ? 'Simülatör bağlantısı koptu' : '';
        broadcast();
      }
    });
  });
}

async function attach(choice) {
  if (starting) await starting.catch(() => {});
  if (current && (!choice || choice === current.udid || choice === current.name)) return status();
  const p = (async () => {
    lastError = '';
    const device = await resolveDevice(choice);
    p.name = device.name;
    broadcast();
    detach(false);
    await ensureHelper();
    await boot(device);
    let s;
    try {
      s = await spawnHelper(device);
    } catch (e) {
      if (!e.stale) throw e;
      await ensureHelper({ rebuild: true });
      s = await spawnHelper(device);
    }
    current = s;
    keyboardLayout().catch(() => {}); // ilk tuşa kadar hazır olsun
    // Önceki oturumdan yan kalmış olabilir: bilinen bir yönle başla
    await rotate('portrait').catch(() => {});
    return status();
  })();
  starting = p;
  broadcast();
  try {
    return await p;
  } catch (e) {
    lastError = e.message;
    throw e;
  } finally {
    starting = null;
    broadcast();
    if (current?.lastFrame) send('sim:frame', current.lastFrame);
  }
}

function detach(notify = true) {
  const s = current;
  current = null;
  if (s) {
    releaseKeys(s); // basılı kalan tuş iOS'ta kendini tekrarlamasın
    try { s.proc.stdin.end(); } catch {}
    setTimeout(() => { try { s.proc.kill(); } catch {} }, 1500);
  }
  if (notify) broadcast();
}

function command(obj, timeout = 15000, s = current) {
  if (!s) return Promise.reject(new Error('Bağlı simülatör yok'));
  const id = s.nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.pending.delete(id); reject(new Error('Simülatör yanıt vermedi')); }, timeout);
    s.pending.set(id, { resolve: (r) => { clearTimeout(t); resolve(r); }, reject: (e) => { clearTimeout(t); reject(e); } });
    s.proc.stdin.write(JSON.stringify({ ...obj, id }) + '\n');
  });
}

// Ekran görüntüsü dik ve nokta (point) çözünürlüğünde: Claude'un gördüğü piksel = dokunma koordinatı
async function screenshot() {
  const r = await command({ cmd: 'screenshot', turn: ORIENTATIONS[current.orientation] });
  let img = nativeImage.createFromBuffer(Buffer.from(r.png, 'base64'));
  const size = displaySize();
  if (!img.isEmpty() && img.getSize().width > size.w) img = img.resize({ width: size.w, quality: 'best' });
  return { png: img.toPNG(), points: size };
}

// ---------- Klavye düzeni ----------
// HID klavyesi tuşun yerini gönderir, karakteri iOS kendi donanım klavye düzenine göre seçer: Türkçe Q'da
// ABD'nin "i" tuşu "ı", ";" tuşu "ş" yazar (ölçüldü). Bu yüzden her karakter, simülatörün o anki düzeninde
// o karakteri yazan tuşa (ve ⇧/⌥'e) çevrilir. Tablolar LAYOUT_CODES sırasıyla, satırlar LAYOUT_MODS sırasıyla;
// \0 = o tuş bu değiştiriciyle karakter yazmaz. Türkçe Q gerçek simülatörde her tuş tek tek basılarak ölçüldü.
const LAYOUT_CODES = [...Array(36)].map((_, i) => 4 + i).concat([44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 100]);
const LAYOUT_MODS = [[], [225], [226], [225, 226]]; // yok, ⇧, ⌥, ⇧⌥
const LAYOUTS = {
  'U.S.': {
    rows: [
      'abcdefghijklmnopqrstuvwxyz1234567890 -=[]\\\0;\'`,./\0',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*() _+{}|\0:"~<>?\0',
    ],
  },
  'Turkish-Q': {
    rows: [
      'abcdefghıjklmnopqrstuvwxyz1234567890 *-ğü,,şi<öç."',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ!\'^+%&/()= ?_ĞÜ;;Şİ>ÖÇ:é',
      'æ∫ç∂€ƒğ^i∆¨¬µ~öπ@®ß₺ü√∑≈¥Ω>£#$½§{[]} \\|¨~``´æ|≤≥÷<',
      'ÆßÇÎ‰ÏĞÓİÔ\0Ò˜ˆÖ∏ŒÂŞÊÜ◊„ÙÁÛ·€©‚˚˙‡°Øø —±”’»»ÚÆŸ¯˘¿\0',
    ],
    // Ölü tuşlar (ardından gelen harfle birleşir): işaretin kendisi için ardından boşluk basılır
    dead: ['225:32', '226:47', '226:48', '226:49', '226:50', '226:51'],
  },
};
// karakter → { code, mods, dead }; aynı karakteri yazan tuşlardan önce değiştiricisi az olan, ölü olmayan seçilir
const KEYMAPS = Object.fromEntries(Object.entries(LAYOUTS).map(([name, l]) => {
  const map = new Map();
  l.rows.forEach((row, m) => [...row].forEach((ch, i) => {
    if (ch === '\0') return;
    const dead = (l.dead || []).includes(LAYOUT_MODS[m].join('+') + ':' + LAYOUT_CODES[i]);
    if (!map.has(ch) || (map.get(ch).dead && !dead)) map.set(ch, { code: LAYOUT_CODES[i], mods: LAYOUT_MODS[m], dead });
  }));
  return [name, map];
}));

// Simülatörün donanım klavye düzeni. iOS bunu son kullanılan klavyeden ("tr_TR@sw=Turkish-Q;hw=Automatic") seçer;
// hw=Automatic ise yazılım düzeni belirler. Tablosu olmayan düzen null: yazılar pano ile gider.
function layoutOf(spec) {
  const [locale, rest = ''] = String(spec || '').trim().split('@');
  const opt = Object.fromEntries(rest.split(';').map((p) => p.split('=')));
  if (opt.hw && opt.hw !== 'Automatic') return KEYMAPS[opt.hw] ? opt.hw : null;
  if (opt.sw === 'Turkish-Q') return 'Turkish-Q';
  if (locale === 'en_US' && (!opt.sw || opt.sw === 'QWERTY')) return 'U.S.';
  return null;
}
// simctl ile okumak ~0,6 sn sürdüğü için bellekte tutulur; 5 sn'den eskiyse arka planda yenilenir
// (kullanıcı iOS'ta klavye değiştirebilir). İlk okuma bağlanınca başlar.
let layoutCache = { udid: null, name: null, at: 0, pending: null };
async function readLayout(udid) {
  const last = await simctl(['spawn', udid, 'defaults', 'read', 'com.apple.keyboard.preferences', 'KeyboardLastUsed']).catch(() => '');
  if (last.trim()) return layoutOf(last);
  // Klavye hiç kullanılmamışsa listedeki ilk klavye
  const all = await simctl(['spawn', udid, 'defaults', 'read', '-g', 'AppleKeyboards']).catch(() => '');
  return layoutOf((all.match(/"([^"]+)"/) || [])[1]);
}
function keyboardLayout() {
  const udid = current.udid;
  const c = layoutCache;
  const fresh = c.udid === udid && Date.now() - c.at < 5000;
  if (!fresh && !(c.pending && c.udid === udid)) {
    const p = readLayout(udid).then((name) => {
      if (layoutCache.pending === p) layoutCache = { udid, name, at: Date.now(), pending: null };
      return name;
    });
    layoutCache = { ...(c.udid === udid ? c : { name: null, at: 0 }), udid, pending: p };
  }
  // Eski de olsa elde bir değer varsa beklenmez (her tuşa 0,6 sn eklenmesin)
  return layoutCache.at ? Promise.resolve(layoutCache.name) : layoutCache.pending;
}

// Yazı: düzende tuşu olan karakterler tuşla, olmayanlar (emoji, düzeni bilinmeyen klavye…) simülatörün panosuna
// konup ⌘V ile yapıştırılır. Pano son çare: iOS her yapıştırmada "… CoreSimulatorBridge'den yapıştırmak istiyor"
// diye izin sorar (ölçüldü), yanıtlanana kadar ardından gelen tuşlar kaybolur. Simülatörün panosu da değişir.
let lastPasteAt = 0;
async function pasteText(text, map) {
  if (!text) return;
  // iOS panoyu ⌘V'yi işlerken okur: önceki yapıştırma okunmadan pano değişmesin
  await sleep(Math.max(0, lastPasteAt + 300 - Date.now()));
  await simctlInput(['pbcopy', current.udid], text);
  await command({ cmd: 'key', code: map?.get('v')?.code ?? 25, mods: [227] }); // ⌘V
  lastPasteAt = Date.now();
}
async function typeText(text) {
  if (!text) return;
  const map = KEYMAPS[await keyboardLayout()];
  const keys = [];
  let paste = '';
  const flushKeys = () => Promise.all(keys.splice(0).map((k) => command(k)));
  for (const ch of text) {
    const k = ch === '\n' ? { code: 40, mods: [] } : ch === '\t' ? { code: 43, mods: [] } : map?.get(ch);
    if (!k) { paste += ch; continue; }
    if (paste) { await flushKeys(); await pasteText(paste, map); paste = ''; }
    keys.push({ cmd: 'key', code: k.code, mods: k.mods });
    if (k.dead) keys.push({ cmd: 'key', code: 44, mods: [] });
  }
  await flushKeys();
  await pasteText(paste, map);
}

// Özel tuşlar (oklar, ⌫, Enter…) Mac'teki gibi basılı tutulur: bölmede keydown → basma, keyup → bırakma; tekrarı iOS
// yapar. Safari (WebKit) alanlarında hemen bırakılan ok, ileri sil ve ⌥⌫'den sonraki ~100–300 ms içinde gelen tuşlar
// düşüyordu; tuş en az KEY_MIN_HOLD basılı kalınca düşmüyor (ölçüldü). Değiştiriciler (⇧ ⌥) tuşla birlikte basılır,
// aynı değiştiriciyle basılı başka tuş varsa bırakılmaz. Uzun basışta iOS ~400 ms sonra her ~100 ms'de tuşu yineler;
// yineleme bırakmaya denk gelirse ardından ~25 ms içinde gelen tuş yine düşebiliyor (ölçüldü). Bu yüzden yinelemenin
// başlamış olabileceği (KEY_REPEAT_DELAY) basışlardan sonra sıradaki girdi KEY_MIN_HOLD daha bekler.
const KEY_MIN_HOLD = 100;
const KEY_REPEAT_DELAY = 350;
async function holdKey(code, mods) {
  const s = current;
  if (!s || s.held.has(code)) return;
  s.held.set(code, { mods, at: Infinity });
  for (const m of mods) {
    const n = s.heldMods.get(m) || 0;
    s.heldMods.set(m, n + 1);
    if (!n) await command({ cmd: 'key', phase: 'down', code: m }, 15000, s);
  }
  await command({ cmd: 'key', phase: 'down', code }, 15000, s);
  s.held.get(code).at = Date.now();
}
async function releaseKey(code, s = current, wait = true) {
  const k = s?.held.get(code);
  if (!k) return;
  s.held.delete(code);
  if (wait) await sleep(Math.max(0, Math.min(k.at, Date.now()) + KEY_MIN_HOLD - Date.now()));
  await command({ cmd: 'key', phase: 'up', code }, 15000, s);
  if (wait && Date.now() - k.at >= KEY_REPEAT_DELAY) await sleep(KEY_MIN_HOLD);
  for (const m of [...k.mods].reverse()) {
    const n = (s.heldMods.get(m) || 1) - 1;
    if (n) s.heldMods.set(m, n);
    else { s.heldMods.delete(m); await command({ cmd: 'key', phase: 'up', code: m }, 15000, s); }
  }
}
// Bölme odağı kaybedince, kapanınca ya da bağlantı kesilirken: sıra beklenmez, bırakmalar hemen yazılır
function releaseKeys(s = current) {
  for (const code of [...(s?.held.keys() || [])]) releaseKey(code, s, false).catch(() => {});
}

// Fiziksel düzleme çevrilmiş dokunma komutları
function touchCmd(phase, x, y) {
  return command({ cmd: 'touch', phase, ...toPhysical(x, y) });
}
function touch2Cmd(phase, x1, y1, x2, y2) {
  const a = toPhysical(x1, y1);
  const b = toPhysical(x2, y2);
  return command({ cmd: 'touch2', phase, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
}

// Arayüzden ve Claude'dan gelen girdiler tek sırada gider (pano + ⌘V ile tuşlar birbirini geçmesin)
let inputChain = Promise.resolve();
function enqueue(fn) {
  const p = inputChain.then(fn);
  inputChain = p.catch(() => {});
  return p;
}

async function describeUI() {
  const env = await getEnv();
  const candidates = ['/opt/homebrew/bin/axe', '/usr/local/bin/axe', ...String(env.PATH || '').split(':').map((d) => path.join(d, 'axe'))];
  const axe = candidates.find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } });
  if (!axe) throw new Error(AXE_HINT);
  return run(axe, ['describe-ui', '--udid', current.udid], { timeout: 30000, env });
}

async function bundleIdOf(appPath) {
  return (await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(appPath, 'Info.plist')])).trim();
}

// ---------- Claude'un aracı ----------
// İşlemler bu Mac'teki simülatörle sınırlı; izin sormaz (publish_artifact gibi)
const ACTIONS = ['list', 'attach', 'launch', 'screenshot', 'tap', 'swipe', 'touch_path', 'touch2_path', 'text', 'button', 'rotate', 'open_url', 'describe_ui', 'detach'];
// Bu Mac'te kod çalıştırabilen işlemler izin kartı sorar (simülatöre kurulan .app bu Mac'te kullanıcının yetkisiyle çalışır;
// adres de kurulu bir uygulamayı açabilir). Gerisi (bakmak, dokunmak, yazmak) sormadan geçer: chat-main.js → canUseTool.
const ASK_ACTIONS = new Set(['launch', 'open_url']);
const ROTATIONS = { portrait: 'portrait', landscape_left: 'landscapeLeft', landscape_right: 'landscapeRight' };

function createTool(sdk, z, { cwd, onAttach }) {
  return sdk.tool(
    'simulator',
    'Claude Panel\'e gömülü iOS Simülatörü (yalnız iPhone 14 ve üstü). Kullanıcı uygulamasını iPhone\'da görmek, denemek ya da ' +
      '"doğru görünüyor mu" diye sormak istediğinde kullan. "attach" simülatörü açar ve paneldeki canlı görüntüyü kullanıcıya gösterir: ' +
      'kullanıcı izlemek istiyorsa derlemeden ÖNCE çağır. Uygulamayı xcodebuild ile iOS Simulator için derle ' +
      '(-destination "platform=iOS Simulator,id=<udid>"), sonra "launch" ile .app yolunu ver. ' +
      'Koordinatlar nokta (point) cinsindendir, ekranın o anki (dik görünen) hâline göre sol üst (0,0); "screenshot" görüntüsü de nokta çözünürlüğündedir, ' +
      'yani görüntüdeki piksel doğrudan dokunma koordinatıdır (yatayda da). "rotate" cihazı yatay/dikey çevirir. "touch2_path" iki parmak hareketidir ' +
      '(sıkıştırarak yakınlaştırma, döndürme, iki parmakla kaydırma). "describe_ui" erişilebilirlik ağacını verir (koordinatları dikey düzlemdedir). ' +
      '"text" her karakteri yazar: simülatörün klavye düzenine (Türkçe Q, ABD) göre tuşla, tuşu olmayanları (emoji vb.) pano üzerinden yapıştırarak; ' +
      'yapıştırmada iOS "yapıştırmaya izin ver" sorabilir, ekran görüntüsüne bakıp izin düğmesine dokun. ' +
      'Kenara 4 noktadan yakın başlayan kaydırmalar sistem hareketidir (alttan yukarı = ana ekran).',
    {
      action: z.enum(ACTIONS).describe('Yapılacak iş'),
      device: z.string().optional().describe('attach için cihaz adı (ör. "iPhone 16 Pro") ya da UDID; verilmezse açık olan ya da en yenisi'),
      app_path: z.string().optional().describe('launch: derlenmiş .app klasörü'),
      bundle_id: z.string().optional().describe('launch: paket kimliği (verilmezse .app içinden okunur; app_path olmadan yalnız başlatır)'),
      x: z.number().optional(), y: z.number().optional(),
      x2: z.number().optional().describe('swipe: bitiş x'), y2: z.number().optional().describe('swipe: bitiş y'),
      duration: z.number().optional().describe('tap: >0.5 uzun basma; swipe: hareket süresi (sn, varsayılan 0.3); button: basılı tutma'),
      points: z.array(z.object({ x: z.number(), y: z.number(), dt_ms: z.number().optional() })).optional()
        .describe('touch_path: tek parmak yolu; ilk nokta dokunma, son nokta kaldırma; dt_ms o noktadan önceki bekleme'),
      points2: z.array(z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), dt_ms: z.number().optional() })).optional()
        .describe('touch2_path: iki parmağın yolu (her örnekte iki nokta); ilk örnek dokunma, son örnek kaldırma'),
      orientation: z.enum(['portrait', 'landscape_left', 'landscape_right']).optional().describe('rotate: yön'),
      text: z.string().optional().describe('text: yazılacak metin'),
      name: z.enum(['home', 'lock', 'side', 'siri']).optional().describe('button: donanım düğmesi'),
      url: z.string().optional().describe('open_url: açılacak adres ya da şema'),
    },
    async (a) => {
      const ok = (text) => ({ content: [{ type: 'text', text }] });
      try {
        if (a.action === 'list') {
          const { devices, creatable } = await listDevices();
          const lines = devices.map((d) => `${d.name} · ${d.runtime} · ${d.state === 'Booted' ? 'açık' : 'kapalı'} · ${d.udid}`);
          if (creatable.length) lines.push('Oluşturulabilir: ' + creatable.map((t) => t.name).join(', '));
          return ok(lines.join('\n') || 'Cihaz yok');
        }
        if (a.action === 'attach') {
          const st = await attach(a.device);
          onAttach();
          return ok(`${st.name} bağlı (UDID ${st.udid}). Ekran ${st.points.w}×${st.points.h} nokta. Panelde canlı görüntü açık.`);
        }
        if (a.action === 'detach') { detach(); return ok('Simülatör bağlantısı kapatıldı (cihaz açık kalır).'); }
        if (!current) { await attach(); onAttach(); }
        const { w, h } = displaySize();
        const inside = (x, y) => {
          if (typeof x !== 'number' || typeof y !== 'number') throw new Error('x ve y gerekli');
          if (x < 0 || y < 0 || x > w || y > h) throw new Error(`(${x}, ${y}) ekranın dışında; ekran ${w}×${h} nokta`);
        };
        switch (a.action) {
          case 'screenshot': {
            const { png } = await screenshot();
            return { content: [
              { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
              { type: 'text', text: `${current.name}, ${w}×${h} nokta` },
            ] };
          }
          case 'tap': {
            inside(a.x, a.y);
            const dt = a.duration > 0 ? a.duration * 1000 : 60;
            await touchPath([{ x: a.x, y: a.y }, { x: a.x, y: a.y, dt_ms: dt }]);
            return ok(`Dokunuldu: (${a.x}, ${a.y})`);
          }
          case 'swipe': {
            inside(a.x, a.y); inside(a.x2, a.y2);
            // Fiziksel düzlemde parmak yolu (yatayda da doğru yönde gitsin diye kendi örneklerimizle)
            const ms = Math.max(50, (a.duration ?? 0.3) * 1000);
            const n = Math.max(2, Math.round(ms / 16));
            const pts = Array.from({ length: n + 1 }, (_, i) => ({
              x: a.x + (a.x2 - a.x) * i / n, y: a.y + (a.y2 - a.y) * i / n, dt_ms: i ? ms / n : 0 }));
            await touchPath(pts);
            return ok(`Kaydırıldı: (${a.x}, ${a.y}) → (${a.x2}, ${a.y2})`);
          }
          case 'touch_path':
            if (!a.points?.length) throw new Error('points gerekli');
            for (const p of a.points) inside(p.x, p.y);
            await touchPath(a.points);
            return ok(`${a.points.length} noktalı hareket yapıldı`);
          case 'touch2_path': {
            const p2 = a.points2 || [];
            if (p2.length < 2) throw new Error('points2 en az iki örnek olmalı');
            for (const p of p2) { inside(p.x1, p.y1); inside(p.x2, p.y2); }
            await enqueue(async () => {
              for (const [i, p] of p2.entries()) {
                if (p.dt_ms) await sleep(Math.min(p.dt_ms, 10000));
                await touch2Cmd(i === p2.length - 1 ? 'up' : 'down', p.x1, p.y1, p.x2, p.y2);
              }
            });
            return ok(`İki parmakla ${p2.length} örnekli hareket yapıldı`);
          }
          case 'text':
            await enqueue(() => typeText(a.text || ''));
            return ok('Yazıldı');
          case 'button':
            await enqueue(() => command({ cmd: 'button', name: a.name || 'home', duration: a.duration || 0 }));
            return ok(`${a.name || 'home'} düğmesine basıldı`);
          case 'rotate': {
            const name = ROTATIONS[a.orientation || 'portrait'];
            await enqueue(() => rotate(name));
            await sleep(600); // döndürme canlandırması
            const d = displaySize();
            return ok(`Yön: ${a.orientation || 'portrait'}. Ekran şimdi ${d.w}×${d.h} nokta.`);
          }
          case 'open_url':
            if (!a.url) throw new Error('url gerekli');
            await simctl(['openurl', current.udid, a.url]);
            return ok('Açıldı: ' + a.url);
          case 'launch': {
            let bundle = a.bundle_id;
            if (a.app_path) {
              const app = path.resolve(cwd, a.app_path);
              if (!/\.app\/?$/.test(app) || !fs.existsSync(app)) throw new Error('app_path bir .app klasörü olmalı: ' + app);
              await simctl(['install', current.udid, app], { timeout: 180000 });
              bundle ||= await bundleIdOf(app);
            }
            if (!bundle) throw new Error('app_path ya da bundle_id gerekli');
            // simctl'e seçenek gibi geçmesin
            if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(bundle)) throw new Error('Geçersiz paket kimliği: ' + bundle);
            await simctl(['launch', '--terminate-running-process', current.udid, bundle], { timeout: 60000 });
            return ok(`${bundle} ${current.name} üzerinde başlatıldı`);
          }
          case 'describe_ui':
            return ok((await describeUI()).slice(0, 60000));
          default:
            throw new Error('Bilinmeyen işlem: ' + a.action);
        }
      } catch (err) {
        return { content: [{ type: 'text', text: 'Simülatör: ' + (err?.message || err) }], isError: true };
      }
    }
  );
}

// Noktalar görünen (dik) düzlemde
function touchPath(points) {
  return enqueue(async () => {
    for (const [i, p] of points.entries()) {
      if (p.dt_ms) await sleep(Math.min(p.dt_ms, 10000));
      await touchCmd(i === points.length - 1 && points.length > 1 ? 'up' : 'down', p.x, p.y);
    }
    if (points.length === 1) await touchCmd('up', points[0].x, points[0].y);
  });
}

// ---------- IPC ----------
function setup({ getWindow, loginEnv }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  getEnv = loginEnv;
  const wrap = (fn) => async (...args) => {
    try { return { ok: true, ...(await fn(...args)) }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  };
  ipcMain.handle('sim:devices', wrap(() => listDevices()));
  ipcMain.handle('sim:status', () => status());
  ipcMain.handle('sim:attach', wrap((_e, choice) => attach(choice)));
  ipcMain.handle('sim:detach', wrap(() => { detach(); return {}; }));
  ipcMain.handle('sim:shutdown', wrap(async (_e, udid) => {
    if (current?.udid === udid) detach();
    await simctl(['shutdown', udid]).catch((e) => { if (!/current state: Shutdown/i.test(e.message)) throw e; });
    return {};
  }));
  ipcMain.handle('sim:screenshot', wrap(async () => {
    const { png, points } = await screenshot();
    return { data: png.toString('base64'), points };
  }));
  // Arayüzden gelen dokunma/klavye (koordinatlar görünen düzlemde): sırayla gider, yanıt beklenmez
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  // Bölmenin basılı tutabildiği tuşlar: Enter, Esc, ⌫, Tab, ileri sil, oklar
  const SPECIAL_KEYS = new Set([40, 41, 42, 43, 76, 79, 80, 81, 82]);
  ipcMain.on('sim:input', (_e, o) => {
    if (!current || !o || typeof o.cmd !== 'string') return;
    const phase = o.phase === 'up' ? 'up' : 'down';
    let fn;
    if (o.cmd === 'touch') fn = () => touchCmd(phase, num(o.x), num(o.y));
    else if (o.cmd === 'touch2') fn = () => touch2Cmd(phase, num(o.x1), num(o.y1), num(o.x2), num(o.y2));
    else if (o.cmd === 'button' && ['home', 'lock', 'side', 'siri'].includes(o.name)) fn = () => command({ cmd: 'button', name: o.name });
    else if (o.cmd === 'key' && SPECIAL_KEYS.has(o.code) && (o.phase === 'down' || o.phase === 'up')) {
      const mods = Array.isArray(o.mods) ? [...new Set(o.mods.filter((m) => m === 225 || m === 226))] : [];
      fn = phase === 'up' ? () => releaseKey(o.code) : () => holdKey(o.code, mods);
    }
    else if (o.cmd === 'releaseKeys') fn = () => releaseKeys(); // sırada bekleyen basmalardan sonra
    else if (o.cmd === 'text' && typeof o.text === 'string') fn = () => typeText(o.text.slice(0, 10000));
    else if (o.cmd === 'rotate' && o.name in ORIENTATIONS) fn = () => rotate(o.name);
    if (fn) enqueue(fn).catch(() => {});
  });
}

module.exports = { setup, createTool, detach, supportedName, ACTIONS, ASK_ACTIONS };
