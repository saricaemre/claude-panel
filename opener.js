// Editörde aç / Finder'da göster: Claude'un `open` aracı ve Değişiklikler bölmesinin düğmeleri.
// Editör Ayarlar → Genel'de seçilir (config.json → editor); boşsa kurulu ilk editör, hiçbiri yoksa varsayılan metin düzenleyici.
// Dosya hiçbir zaman çalıştırılmaz: editöre adres ya da `open -a` ile verilir, varsayılan yol `open -t` (metin olarak açar).
const { ipcMain, shell } = require('electron');
const { execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Sıra otomatik seçimin önceliğidir. url: satıra gidebilen adres şeması; xed: Xcode'un komutu.
const EDITORS = [
  { id: 'vscode', name: 'VS Code', app: 'Visual Studio Code', url: 'vscode' },
  { id: 'cursor', name: 'Cursor', app: 'Cursor', url: 'cursor' },
  { id: 'windsurf', name: 'Windsurf', app: 'Windsurf', url: 'windsurf' },
  { id: 'zed', name: 'Zed', app: 'Zed', url: 'zed' },
  { id: 'sublime', name: 'Sublime Text', app: 'Sublime Text' },
  { id: 'xcode', name: 'Xcode', app: 'Xcode', xed: true },
];
const DEFAULT = { id: 'default', name: 'Varsayılan metin düzenleyici' };

let getChoice = () => '';
let installedCache = null;

// Kurulu editörler (LaunchServices'e sorulur, süreç boyunca önbellekte). CLAUDE_PANEL_EDITORS yalnız testler için.
function installed() {
  if (installedCache) return installedCache;
  if (process.env.CLAUDE_PANEL_EDITORS != null) {
    const ids = process.env.CLAUDE_PANEL_EDITORS.split(',');
    return (installedCache = EDITORS.filter((e) => ids.includes(e.id)));
  }
  installedCache = EDITORS.filter((e) => {
    try { execFileSync('open', ['-Ra', e.app], { stdio: 'ignore', timeout: 3000 }); return true; } catch { return false; }
  });
  return installedCache;
}

function current() {
  const id = getChoice();
  if (id === 'default') return DEFAULT;
  return installed().find((e) => e.id === id) || installed()[0] || DEFAULT;
}

// Testte dış uygulama açılmaz; ne açılacağı CLAUDE_PANEL_OPEN_LOG dosyasına yazılır
function run(how, args) {
  if (process.env.CLAUDE_PANEL_OPEN_LOG) {
    fs.appendFileSync(process.env.CLAUDE_PANEL_OPEN_LOG, JSON.stringify({ how, args }) + '\n');
    return Promise.resolve();
  }
  if (how === 'reveal') { shell.showItemInFolder(args[0]); return Promise.resolve(); }
  return new Promise((resolve, reject) => execFile(how, args, { timeout: 15000 }, (err, _o, stderr) =>
    (err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0])) : resolve())));
}

const fileUrl = (scheme, abs, line) => `${scheme}://file${abs.split('/').map(encodeURIComponent).join('/')}${line ? `:${line}:1` : ''}`;

// Dosyayı ya da klasörü editörde açar. Dönen ad kullanıcıya/Claude'a söylenir.
async function openInEditor(abs, line) {
  const st = fs.statSync(abs);
  const ed = current();
  const ln = st.isFile() && Number.isInteger(line) && line > 0 ? line : null;
  if (ed === DEFAULT) {
    if (!st.isFile()) throw new Error('Klasörü açacak bir kod editörü bulunamadı; Ayarlar → Genel\'den editör seçin');
    await run('open', ['-t', abs]);
  } else if (ed.url && st.isFile()) await run('open', [fileUrl(ed.url, abs, ln)]);
  else if (ed.xed) await run('xed', [...(ln ? ['--line', String(ln)] : []), abs]);
  else await run('open', ['-a', ed.app, abs]);
  return { editor: ed.name, line: ln };
}

async function reveal(abs) {
  fs.statSync(abs); // yoksa hata
  await run('reveal', [abs]);
}

function createTool(sdk, z, { cwd }) {
  return sdk.tool(
    'open',
    'Bu Mac\'te kullanıcı için bir dosyayı ya da klasörü açar. "editor": kullanıcının kod editöründe açar (line verilirse o satıra gider); ' +
      'kullanıcı "editörde aç", "VS Code\'da göster" dediğinde ya da düzenlemesi gereken bir dosyayı ona verirken kullan. "reveal": ' +
      'Finder\'da klasörünü açıp dosyayı seçer (üretilen bir dosyanın, ekran görüntüsünün, derlemenin yerini göstermek için). ' +
      'Dosya çalıştırılmaz, içerik sana dönmez. Panelin içinde göstermek için show aracını kullan.',
    {
      action: z.enum(['editor', 'reveal']).describe('editor: kod editöründe aç; reveal: Finder\'da göster'),
      path: z.string().describe('Dosya ya da klasör yolu (mutlak ya da çalışma klasörüne göre)'),
      line: z.number().optional().describe('editor: gidilecek satır'),
    },
    async (a) => {
      try {
        if (!a.path) throw new Error('path gerekli');
        const abs = path.resolve(cwd, String(a.path).replace(/^~(?=$|\/)/, require('os').homedir()));
        if (a.action === 'reveal') {
          await reveal(abs);
          return { content: [{ type: 'text', text: `${abs} Finder'da gösterildi` }] };
        }
        const r = await openInEditor(abs, a.line);
        return { content: [{ type: 'text', text: `${abs}${r.line ? ':' + r.line : ''} ${r.editor} ile açıldı` }] };
      } catch (err) {
        const msg = err?.code === 'ENOENT' ? 'Bulunamadı: ' + a.path : err?.message || String(err);
        return { content: [{ type: 'text', text: 'Açılamadı: ' + msg }], isError: true };
      }
    }
  );
}

function setup({ getEditor }) {
  if (getEditor) getChoice = getEditor;
  const wrap = (fn) => async (_e, ...args) => {
    try { return { ok: true, ...(await fn(...args)) }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  };
  // Arayüz: ayar penceresindeki liste ve Değişiklikler bölmesinin düğmeleri
  ipcMain.handle('editor:list', () => ({ editors: installed().map(({ id, name }) => ({ id, name })), current: current().id, choice: getChoice() || '' }));
  ipcMain.handle('file:open', wrap((file, line) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Geçersiz yol');
    return openInEditor(file, line);
  }));
  ipcMain.on('file:reveal', (_e, file) => {
    if (typeof file === 'string' && path.isAbsolute(file) && fs.existsSync(file)) reveal(file).catch(() => {});
  });
}

module.exports = { setup, createTool, EDITORS };
