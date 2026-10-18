// PR / CI izleme: Claude bir PR açınca `pr` aracıyla sohbete bağlar; panel `gh` ile PR'yi aralıklarla yoklar.
// Olaylar (CI kırıldı, birleştirme çakışması, yeni yorum, CI geçti, PR kapandı) sohbete kart olarak düşer.
// Otomatik düzeltme açıksa kırılma/çakışma/yorum, sohbet boştayken Claude'a <ci-izleme-olayi> metniyle iletilir (renderer/prwatch.js).
// Sohbet başına tek PR; izleme bellekte, sohbet kapanınca biter.
const { ipcMain } = require('electron');
const { execFile } = require('child_process');

let send = () => {};
const GH = process.env.CLAUDE_PANEL_GH || 'gh';
const POLL_MS = Number(process.env.CLAUDE_PANEL_PR_POLL_MS) || 60000;
const MAX_BACKOFF = 10 * 60 * 1000;
const FIELDS = 'number,title,url,state,isDraft,headRefName,headRefOid,mergeable,statusCheckRollup,comments,reviews';
const watches = new Map(); // chatId -> izleme kaydı

function gh(w, args) {
  return new Promise((resolve) => {
    execFile(GH, args, { cwd: w.cwd, env: { ...w.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 },
    (err, stdout, stderr) => resolve(err
      ? { ok: false, error: err.code === 'ENOENT' ? 'gh (GitHub CLI) bulunamadı; `brew install gh` ve `gh auth login` gerekli' : String(stderr || err.message).trim().split('\n').slice(-2).join(' ') }
      : { ok: true, out: stdout }));
  });
}
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

// https://github.com/sahip/depo/pull/12 → { host, repo }
function parseUrl(url) {
  const m = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url || '');
  return m ? { host: m[1], repo: m[2] } : null;
}
// Dış kaynaklı adresler (CI sağlayıcısı, yorum) yalnız http/https ise geçer; arayüzde bağlantı olarak çizilir
const webUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const hostArgs = (w) => (w.host && w.host !== 'github.com' ? ['--hostname', w.host] : []);

// CheckRun ve StatusContext → { name, status: pending|success|failure|skipped|cancelled, conclusion, url }
const FAIL = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
function checksOf(pr) {
  return (pr.statusCheckRollup || []).map((c) => {
    const ctx = c.__typename === 'StatusContext' || (c.context && !c.name);
    const name = ctx ? c.context : (c.workflowName && c.workflowName !== c.name ? `${c.workflowName} / ${c.name}` : c.name);
    const result = String((ctx ? c.state : c.status === 'COMPLETED' ? c.conclusion : '') || '').toUpperCase();
    const status = FAIL.has(result) ? 'failure'
      : result === 'SUCCESS' ? 'success'
      : ['NEUTRAL', 'SKIPPED'].includes(result) ? 'skipped'
      : ['CANCELLED', 'STALE'].includes(result) ? 'cancelled'
      : 'pending';
    return { name: String(name || '?'), status, conclusion: result || String(c.status || 'PENDING').toUpperCase(), url: webUrl(c.detailsUrl || c.targetUrl) };
  });
}

function ciSummary(checks) {
  if (!checks.length) return 'none';
  if (checks.some((c) => c.status === 'failure')) return 'failure';
  if (checks.some((c) => c.status === 'pending')) return 'pending';
  return 'success';
}

// Bir PR'nin anlık hâli (izlemeden de çağrılır: `pr status`)
async function fetchPr(w, number) {
  const r = await gh(w, ['pr', 'view', ...(number ? [String(number)] : []), '--json', FIELDS]);
  if (!r.ok) throw new Error(/no pull requests found/i.test(r.error) ? 'Bu dalda açık bir PR yok' : r.error);
  const pr = json(r);
  if (!pr?.number) throw new Error('gh yanıtı okunamadı');
  return pr;
}

// Satır içi inceleme yorumları REST'ten (pr view yalnız genel yorumları ve incelemeleri verir)
async function inlineComments(w) {
  if (!w.repo) return [];
  const r = await gh(w, ['api', ...hostArgs(w), `repos/${w.repo}/pulls/${w.number}/comments?per_page=100`]);
  const list = r.ok ? json(r) : null;
  return Array.isArray(list) ? list.map((c) => ({ id: 'i' + c.id, author: c.user?.login || '', body: c.body || '', where: c.path ? `${c.path}${c.line ? ':' + c.line : ''}` : '', url: webUrl(c.html_url) })) : [];
}

function feedback(pr, inline) {
  const out = [];
  for (const c of pr.comments || []) out.push({ id: 'c' + (c.id || c.url), author: c.author?.login || '', body: c.body || '', where: '', url: webUrl(c.url) });
  for (const r of pr.reviews || []) {
    if (!r.body?.trim() && r.state !== 'CHANGES_REQUESTED') continue; // yalnız satır içi yorum taşıyan boş inceleme
    out.push({ id: 'r' + (r.id || r.submittedAt), author: r.author?.login || '', body: r.body || '', where: '', url: '', review: r.state });
  }
  return out.concat(inline);
}

function summary(w) {
  const pr = w.pr || {};
  const checks = w.checks || [];
  return {
    number: w.number, url: w.url, title: pr.title || '', state: pr.state || '', branch: pr.headRefName || '',
    autofix: w.autofix, ci: ciSummary(checks), conflict: !!w.conflict, error: w.error || '',
    checks: checks.map(({ name, status }) => ({ name, status })),
  };
}

function describe(pr, checks) {
  const n = (s) => checks.filter((c) => c.status === s);
  const parts = [['success', 'başarılı'], ['failure', 'başarısız'], ['pending', 'sürüyor'], ['skipped', 'atlandı'], ['cancelled', 'iptal']]
    .map(([s, t]) => (n(s).length ? `${n(s).length} ${t}${s === 'failure' ? ` (${n(s).map((c) => c.name).join(', ')})` : ''}` : '')).filter(Boolean);
  return [
    `PR #${pr.number} "${pr.title}" · ${pr.state}${pr.isDraft ? ' (taslak)' : ''} · ${pr.url}`,
    `Dal: ${pr.headRefName} @ ${String(pr.headRefOid || '').slice(0, 7)}`,
    `Birleştirilebilir: ${pr.mergeable || 'UNKNOWN'}`,
    `CI: ${parts.join(', ') || 'kontrol yok'}`,
  ].join('\n');
}

async function poll(chatId) {
  const w = watches.get(chatId);
  if (!w || w.polling) return;
  w.polling = true;
  clearTimeout(w.timer);
  const events = [];
  try {
    const pr = await fetchPr(w, w.number);
    if (watches.get(chatId) !== w) return;
    w.pr = pr;
    w.error = '';
    w.fails = 0;
    w.url = pr.url;
    Object.assign(w, parseUrl(pr.url) || {});
    if (w.login == null) {
      const me = await gh(w, ['api', ...hostArgs(w), 'user', '--jq', '.login']);
      w.login = me.ok ? me.out.trim() : '';
    }
    const sha = String(pr.headRefOid || '');
    const short = sha.slice(0, 7);
    const checks = (w.checks = checksOf(pr));
    // CI: bu commit'te yeni kırılan kontroller bir kez bildirilir (izlemeye başlarken kırık olanlar da)
    const failed = checks.filter((c) => c.status === 'failure' && !w.seenFail.has(sha + '|' + c.name));
    for (const c of failed) w.seenFail.add(sha + '|' + c.name);
    if (failed.length) events.push({ kind: 'ci_failed', sha: short, checks: failed });
    if (checks.length && ciSummary(checks) === 'success' && !w.passed.has(sha)) {
      w.passed.add(sha);
      events.push({ kind: 'ci_passed', sha: short });
    }
    const conflict = pr.mergeable === 'CONFLICTING';
    if (conflict && !w.conflict) events.push({ kind: 'conflict', branch: pr.headRefName });
    w.conflict = conflict;
    // Yorumlar: izlemeye başlarken var olanlar bildirilmez. gh kullanıcısının kendi yorumları (Claude da onun adıyla yazar) sayılmaz.
    const items = feedback(pr, await inlineComments(w));
    const fresh = items.filter((c) => !w.seenComments.has(c.id));
    for (const c of items) w.seenComments.add(c.id);
    const others = fresh.filter((c) => !w.login || c.author !== w.login);
    if (!w.first && others.length) events.push({ kind: 'review', comments: others.slice(0, 10).map((c) => ({ ...c, body: c.body.slice(0, 2000) })) });
    if (pr.state && pr.state !== 'OPEN') events.push({ kind: pr.state === 'MERGED' ? 'merged' : 'closed' });
    w.first = false;
  } catch (err) {
    if (watches.get(chatId) !== w) return;
    w.error = err?.message || String(err);
    w.fails++;
  } finally {
    w.polling = false;
  }
  const done = events.some((e) => e.kind === 'merged' || e.kind === 'closed');
  send('pr:state', chatId, done ? { ...summary(w), stopped: true } : summary(w));
  for (const ev of events) send('pr:event', chatId, { ...ev, number: w.number, url: w.url, title: w.pr?.title || '', autofix: w.autofix });
  if (done) { watches.delete(chatId); return; }
  w.timer = setTimeout(() => poll(chatId), Math.min(MAX_BACKOFF, POLL_MS * 2 ** Math.min(w.fails, 4)));
}

async function watch(chatId, { cwd, env, number, autofix }) {
  const probe = { cwd, env };
  const pr = await fetchPr(probe, number);
  if (pr.state !== 'OPEN') throw new Error(`PR #${pr.number} açık değil (${pr.state})`);
  const old = watches.get(chatId);
  if (old?.number === pr.number) {
    if (autofix != null) old.autofix = !!autofix;
    send('pr:state', chatId, summary(old));
    return { pr, w: old, again: true };
  }
  stop(chatId);
  const w = {
    cwd, env, number: pr.number, url: pr.url, autofix: !!autofix, pr, checks: [], first: true, fails: 0, error: '', login: null,
    seenFail: new Set(), passed: new Set(), seenComments: new Set(), conflict: false, timer: null, polling: false,
    ...parseUrl(pr.url),
  };
  watches.set(chatId, w);
  poll(chatId);
  return { pr, w };
}

function stop(chatId) {
  const w = watches.get(chatId);
  if (!w) return false;
  clearTimeout(w.timer);
  watches.delete(chatId);
  send('pr:state', chatId, null);
  return true;
}

// İzin: otomatik düzeltmeyi açmak kartla (Claude kendiliğinden uyanır, kullanım harcar); bakmak ve izlemek sormadan
function permission(chatId, input = {}) {
  if (input.action === 'watch' && input.autofix && !watches.get(chatId)?.autofix) {
    return { title: 'Claude PR\'yi izleyip CI kırılınca kendiliğinden düzeltmek istiyor (otomatik düzeltme)' };
  }
  return null;
}

function createTool(sdk, z, { chatId, cwd, env }) {
  return sdk.tool(
    'pr',
    'Bu klasörün GitHub PR\'sini Claude Panel\'de izler (gh CLI ile). `gh pr create` ile PR açtıktan ya da kullanıcı bir PR\'yi izlemeni ' +
      'isteyince "watch" çağır: panel CI\'ı, birleştirme çakışmasını ve yeni inceleme yorumlarını yoklar, sohbette gösterir. ' +
      'autofix: true otomatik düzeltmeyi açar (kullanıcıya izin kartı çıkar): CI kırılınca, çakışma olunca ya da yorum gelince sohbet ' +
      'boştayken sana <ci-izleme-olayi> bildirimi gelir; kullanıcı yazmamıştır. Açmadan önce kullanıcıya sor ya da kartın onayını bekle. ' +
      '"status" PR\'nin anlık hâlini verir (izlemeden), "unwatch" izlemeyi bırakır. CI\'ı kendin yoklama (sleep, döngü, gh pr checks --watch); panel yoklar. ' +
      'number verilmezse bu dalın PR\'si.',
    {
      action: z.enum(['status', 'watch', 'unwatch']).describe('Yapılacak iş'),
      number: z.number().optional().describe('PR numarası (varsayılan: bu dalın PR\'si)'),
      autofix: z.boolean().optional().describe('watch: CI kırılınca/çakışmada/yorumda Claude\'u uyandır'),
    },
    async (a) => {
      const ok = (text) => ({ content: [{ type: 'text', text }] });
      try {
        switch (a.action) {
          case 'status': {
            const w = watches.get(chatId);
            const pr = await fetchPr({ cwd, env }, a.number || w?.number);
            const watched = w?.number === pr.number;
            return ok(describe(pr, checksOf(pr)) + `\nİzleniyor: ${watched ? 'evet' : 'hayır'}${watched ? `, otomatik düzeltme ${w.autofix ? 'açık' : 'kapalı'}` : ''}`);
          }
          case 'watch': {
            const { pr, w, again } = await watch(chatId, { cwd, env, number: a.number, autofix: a.autofix });
            return ok(`${again ? 'PR zaten izleniyordu' : 'PR izleniyor'}; otomatik düzeltme ${w.autofix ? 'açık: CI kırılınca, çakışmada ya da yeni yorumda bildirim gelecek' : 'kapalı: olaylar yalnız kullanıcıya gösterilir'}.\n` +
              describe(pr, checksOf(pr)));
          }
          case 'unwatch':
            return ok(stop(chatId) ? 'İzleme bırakıldı.' : 'Bu sohbette izlenen PR yok.');
          default:
            throw new Error('Bilinmeyen işlem: ' + a.action);
        }
      } catch (err) {
        return { content: [{ type: 'text', text: 'PR: ' + (err?.message || err) }], isError: true };
      }
    }
  );
}

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  // Arayüzdeki PR düğmesi: otomatik düzeltmeyi aç/kapat, şimdi denetle, izlemeyi bırak
  ipcMain.handle('pr:autofix', (_e, chatId, on) => {
    const w = watches.get(chatId);
    if (!w) return null;
    w.autofix = !!on;
    return summary(w);
  });
  ipcMain.handle('pr:refresh', (_e, chatId) => { poll(chatId); return !!watches.get(chatId); });
  ipcMain.handle('pr:unwatch', (_e, chatId) => stop(chatId));
}

module.exports = { setup, createTool, permission, forget: (chatId) => { const w = watches.get(chatId); if (w) { clearTimeout(w.timer); watches.delete(chatId); } } };
