// Ayrı çalışma kopyaları (git worktree): sohbet ya da yan oturum, deponun <kök>/.claude/worktrees/<ad> altında,
// kendi dalında (panel/<ad>) çalışır; paralel oturumlar birbirinin dosyasını ezmez. Klasör deponun yerel
// dışlama listesine (.git/info/exclude) eklenir: ana çalışma ağacında izlenmeyen dosya olarak görünmez, commit'e girmez.
// Sohbet kapanınca kopya temizse (değişiklik yok, yeni commit yok) silinir; değilse dalıyla birlikte korunur.
const { execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const git = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 60000 }, (err, stdout, stderr) =>
    (err ? reject(new Error((stderr || err.message).trim().split('\n').pop())) : resolve(stdout.trim())));
});
const gitSync = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const slug = (s) => String(s || '').toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'sohbet';

// Bir kopyanın içindeysek ana depoyu kullan (kopyanın içinde kopya açılmaz)
async function mainRoot(dir) {
  let common;
  try { common = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']); } catch { throw new Error('Klasör bir git deposu değil; ayrı kopya (worktree) açılamaz'); }
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  return { root: path.basename(common) === '.git' ? path.dirname(common) : top, common };
}

async function create(dir, title) {
  const { root, common } = await mainRoot(dir);
  let base;
  try { base = await git(root, ['rev-parse', '--verify', 'HEAD']); } catch { throw new Error('Depoda henüz commit yok; ayrı kopya için önce bir commit gerekli'); }
  // Kopyalar ana çalışma ağacında görünmesin
  const exclude = path.join(common, 'info', 'exclude');
  const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!cur.split('\n').includes('/.claude/worktrees/')) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, (cur && !cur.endsWith('\n') ? '\n' : '') + '# Claude Panel ayrı kopyaları\n/.claude/worktrees/\n');
  }
  const name = `${slug(title)}-${crypto.randomBytes(3).toString('hex')}`;
  const wtPath = path.join(root, '.claude', 'worktrees', name);
  const branch = `panel/${name}`;
  await git(root, ['worktree', 'add', '-q', '-b', branch, wtPath, base]);
  // Kullanıcının alt klasörde açtığı sohbet kopyada da aynı alt klasörde başlasın
  const rel = path.relative(await git(dir, ['rev-parse', '--show-toplevel']), dir);
  const cwd = rel && !rel.startsWith('..') && fs.existsSync(path.join(wtPath, rel)) ? path.join(wtPath, rel) : wtPath;
  return { root, path: wtPath, cwd, branch, base };
}

// Temizse siler ve true döner; değişiklik ya da yeni commit varsa dokunmaz (eşzamanlı: uygulama kapanırken de çalışır)
function cleanup(wt) {
  if (!wt || !fs.existsSync(wt.path)) return { removed: true };
  try {
    const dirty = gitSync(wt.path, ['status', '--porcelain']);
    const ahead = Number(gitSync(wt.root, ['rev-list', '--count', `${wt.base}..${wt.branch}`]));
    if (dirty || ahead) return { removed: false, dirty: !!dirty, ahead };
    gitSync(wt.root, ['worktree', 'remove', wt.path]);
    gitSync(wt.root, ['branch', '-D', wt.branch]);
    return { removed: true };
  } catch (err) {
    return { removed: false, error: err?.message || String(err) };
  }
}

module.exports = { create, cleanup };
