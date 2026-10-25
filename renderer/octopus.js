/* Claude Panel — Octopus (octopus.js): kenar çubuğundaki "Ahtapotlar" listesi, yeni sohbet ekranındaki "Octopus olarak başlat" anahtarı
   ve sohbet menüsündeki "Bu sohbeti beyin yap".
   Ahtapot: bir projenin başı (ana oturum) ve başın açtığı kollar (yan oturumlar). Kayıt ana süreçte; burada gösterilir.
   Ahtapota tıklayınca baş "Devam et" ile açılır. Kollar listelenir ama kendiliğinden açılmaz (token harcamasın). */

const ARM_STATES = { working: 'çalışıyor', waiting: 'seni bekliyor', reported: 'rapor verdi', done: 'bitti', stopped: 'durdu', cut: 'kesildi' };

const octo = {
  lists: {},  // acctId -> hesabın ahtapot kayıtları
  folder: {}, // `${acctId}\n${klasör}` -> { octopusId, history } | 'loading'
  choice: {}, // aynı anahtar -> kullanıcının anahtarı elle açıp kapaması (yoksa varsayılan)
};
const octoKey = (acctId, dir) => acctId + '\n' + dir;

async function loadOctopi(acctId) {
  try { octo.lists[acctId] = (await window.panel.octopusList(acctId)) || []; } catch { octo.lists[acctId] = []; }
  renderSidebar();
}

window.panel.onOctopusChanged((acctId) => {
  for (const k of Object.keys(octo.folder)) if (k.startsWith(acctId + '\n')) delete octo.folder[k];
  loadOctopi(acctId);
});

// Klasörün ahtapotu ve geçmiş oturum sayısı (ana süreçte yalnız okunur); gelince başlatıcı yeniden çizilir
async function fetchOctoFolder(acctId, dir) {
  const key = octoKey(acctId, dir);
  octo.folder[key] = 'loading';
  let info;
  try { info = await window.panel.octopusFolder(acctId, dir); } catch { info = null; }
  octo.folder[key] = info || { octopusId: null, history: null };
  if (newFolderOf(acctId) !== dir) return;
  const input = state.panes[acctId]?.launcher.querySelector('.new-input');
  const focused = input && document.activeElement === input;
  renderLauncher(acctId);
  if (focused) state.panes[acctId].launcher.querySelector('.new-input')?.focus();
}

// "Octopus olarak başlat" anahtarının hâli. Geçmişi olmayan klasörde açık, geçmişi olanda kapalı gelir (İ1, K8);
// klasörün zaten ahtapotu varsa ya da ayrı kopya seçiliyse açılamaz.
function octoState(acctId, dir, wtOn) {
  if (!dir) return { on: false, desc: 'Önce bir klasör seçin' };
  const key = octoKey(acctId, dir);
  const info = octo.folder[key];
  if (info === undefined) fetchOctoFolder(acctId, dir);
  if (!info || info === 'loading') return { on: false, locked: true, desc: 'Klasörün geçmişine bakılıyor…' };
  if (info.octopusId) return { on: false, locked: true, short: 'bu klasörün ahtapotu var', desc: 'Bu klasörün zaten bir ahtapotu var; kenar çubuğundaki "Ahtapotlar" listesinden açın.' };
  if (wtOn) return { on: false, locked: true, short: 'ayrı kopyada başlamaz', desc: 'Ayrı kopyada başlatılamaz: kopya kapanınca silinir, baş oraya geri dönemez.' };
  const on = octo.choice[key] ?? info.history === 0;
  const desc = info.history
    ? `Bu klasörde ${info.history} geçmiş oturum var. Var olan proje sormadan beyne çevrilmez; açarsanız yeni bir baş başlar, eski oturumlara dokunulmaz. Eski bir oturumu beyin yapmak için "Projeyi Octopus'a al".`
    : info.history == null
      ? 'Klasörün geçmişi okunamadı; kendiliğinden açılmaz.'
      : 'İlk oturum projenin beyni (başı) olur, açtığı yan oturumlar kolları.';
  const short = on ? 'açık' : info.history ? `kapalı: klasörde ${info.history} geçmiş oturum var` : 'kapalı';
  return { on, short, desc, canImport: info.history > 0 };
}

function toggleOctopus(acctId, dir, st) {
  if (st.locked || !dir) return toast(st.desc, 4500);
  octo.choice[octoKey(acctId, dir)] = !st.on;
  renderLauncher(acctId);
}

// Başlatıcıdan sohbet başlarken: anahtar açıksa 'new'. Klasörün bilgisi eskir (yeni oturum, belki yeni ahtapot).
function octopusForNew(acctId, dir, wtOn) {
  const on = octoState(acctId, dir, wtOn).on;
  delete octo.folder[octoKey(acctId, dir)];
  delete octo.choice[octoKey(acctId, dir)];
  return on ? 'new' : undefined;
}

const openChatTabs = (acctId) => (state.tabs[acctId] || []).filter((t) => t.kind === 'chat' && !t.exited);
function showTab(acctId, t) {
  if (state.page !== 'account' || state.active !== acctId || state.view[acctId] !== 'code') selectAccount(acctId, 'code');
  activateTab(acctId, t);
}

function openOctopus(acctId, rec) {
  const t = openChatTabs(acctId).find((x) => x.octopusId === rec.id);
  if (t) return showTab(acctId, t);
  if (!rec.head?.sessionId) return toast('Ahtapotun başının oturumu yok.');
  createChatTab(acctId, rec.project.cwd, 'resume', rec.head.sessionId, { octopus: rec.id });
}

// Kol yalnız tıklanınca açılır ("Devam et"); açık sekmesi varsa ona geçilir
function openArm(acctId, rec, arm) {
  const t = openChatTabs(acctId).find((x) => x.sessionId && x.sessionId === arm.sessionId);
  if (t) return showTab(acctId, t);
  if (!arm.sessionId) return toast('Kolun oturumu henüz başlamadı.');
  createChatTab(acctId, arm.cwd || rec.project.cwd, 'resume', arm.sessionId, { title: arm.title });
}

// Kolu kapatmak (sağ tık "Kolu kapat"): açık sekmesi kapanır (çalışıyorsa sorulur), kol "kesildi" olur, bitmişse "bitti" kalır;
// ikisi de ahtapotta artık çizilmez. Sekmesi açık değilse yalnız kayıt (octopus:closeArm).
async function closeArm(acctId, rec, arm) {
  const t = armTab(acctId, arm);
  if (t) return closeTab(t);
  const r = await window.panel.octopusCloseArm(rec.id, arm.id);
  if (!r?.ok) toast(r?.error || 'Kol kapatılamadı.');
}

// Kapanmış kol: kendisi ya da başı kapattı, sekmesi kapandı (kayıtta closed) ya da kesildi (bayraktan önceki kayıtlar).
// Kenar çubuğunda yalnız sekmesi açıkken görünür; bölmenin "Diğer kollar"ında hep durur.
const armClosed = (arm) => !!arm.closed || arm.state === 'cut';

// Kenar çubuğunda, bölmedeki kolda ve "Diğer kollar"da sağ tık menüsü
function armMenu(e, acctId, rec, arm) {
  const t = armTab(acctId, arm);
  const closable = !!t || !armClosed(arm);
  openMenuAt(e, [
    { header: arm.title || arm.id },
    { icon: 'chat', label: t ? 'Sekmeye geç' : 'Devam et', desc: t ? null : 'Kol olarak yeniden açılır', onclick: () => openArm(acctId, rec, arm) },
    closable ? { icon: 'close', label: 'Kolu kapat', danger: true,
      desc: t ? 'Sekmesi kapanır; ahtapottan ve listeden kalkar' : 'Ahtapottan ve listeden kalkar', onclick: () => closeArm(acctId, rec, arm) } : null,
  ], 'octo-arm-menu');
}

// Ahtapotun açık sekmeleri: baş ve kollar
const octoTabs = (acctId, rec) => openChatTabs(acctId).filter((t) => t.octopusId === rec.id || rec.arms.some((a) => a.sessionId && a.sessionId === t.sessionId));

// Kenar çubuğunda ahtapot satırına sağ tık
function octopusMenu(e, acctId, rec) {
  const head = openChatTabs(acctId).some((t) => t.octopusId === rec.id);
  openMenuAt(e, [
    { header: rec.project.name },
    { icon: 'chat', label: head ? 'Başa geç' : 'Başı aç', onclick: () => openOctopus(acctId, rec) },
    { icon: 'trash', label: 'Ahtapotu sil', danger: true, desc: 'Kayıt, defter ve kol listesi silinir; oturumlar kalır', onclick: () => deleteOctopus(acctId, rec) },
  ], 'octo-menu');
}

// Ahtapotu silmek: onaydan sonra açık sekmeleri kapanır (çalışan varsa sorulur), panelin kaydı silinir (octopus:delete).
// Claude Code'un oturumları ve proje dosyaları kalır; baş ve kollar geçmişten düz sohbet olarak açılabilir.
async function deleteOctopus(acctId, rec) {
  const open = octoTabs(acctId, rec);
  const ok = await dialogModal({
    title: `"${rec.project.name}" ahtapotu silinsin mi?`,
    body: 'Panelin bu ahtapot için tuttuğu kayıt silinir: kol listesi, defter, sınavlar ve devir notları. Bu geri alınamaz. ' +
      'Claude Code\'un oturumları ve proje dosyaları kalır; baş ve kollar geçmişten düz sohbet olarak açılabilir.' +
      (open.length ? ` Açık olan ${open.length} sekmesi de kapanır.` : ''),
    okLabel: 'Sil', danger: true,
  });
  if (!ok) return;
  for (const t of open) closeTab(t);
  if (octoTabs(acctId, rec).length) return toast('Sekmeler kapanmadığı için ahtapot silinmedi.');
  const r = await window.panel.octopusDelete(rec.id);
  if (!r?.ok) return toast(r?.error || 'Ahtapot silinemedi.', 4500);
  toast(`"${rec.project.name}" ahtapotu silindi.`);
}

// Fosil: başın önceki bedeni (yeniden doğuşla ya da yeni kimlikle "Devam et"le geride kalan oturum; dogus.js). Açılınca düz bir sohbet olur
// (ahtapota bağlanmaz); baş ona danis ile danışır.
function openFossil(acctId, rec, body) {
  const t = openChatTabs(acctId).find((x) => x.sessionId === body.sessionId);
  if (t) return showTab(acctId, t);
  createChatTab(acctId, rec.project.cwd, 'resume', body.sessionId, { title: 'Fosil · ' + rec.project.name });
}
const BODY_REASONS = { first: 'ilk beden', resume: 'devam (yeni kimlik)', adopted: 'beyin yapıldı', rebirth: 'yeniden doğuş' };

// Etkin hesabın altında: ahtapotlar (proje adı, kol sayısı) ve kolları
function octopusSidebar(acctId) {
  const list = octo.lists[acctId] || [];
  if (!list.length) return null;
  const tabs = openChatTabs(acctId);
  const active = state.activeTab[acctId];
  return h('div', { class: 'octo-list' },
    h('div', { class: 'octo-title' }, 'Ahtapotlar'),
    list.map((rec) => {
      const headTab = tabs.find((t) => t.octopusId === rec.id);
      const arms = rec.arms.filter((a) => !armClosed(a) || tabs.some((x) => x.sessionId && x.sessionId === a.sessionId));
      const closed = rec.arms.length - arms.length;
      return h('div', { class: 'octo', 'data-id': rec.id },
        h('button', {
          class: 'octo-row' + (headTab && headTab === active ? ' on' : ''),
          title: `${tilde(rec.project.cwd)}\n${rec.arms.length} kol${closed ? ` (${closed} kapandı; ahtapot bölmesinde "Diğer kollar")` : ''}\n${headTab ? 'Baş açık' : 'Tıklayınca baş "Devam et" ile açılır'}`,
          onclick: (e) => { e.stopPropagation(); openOctopus(acctId, rec); },
          oncontextmenu: (e) => octopusMenu(e, acctId, rec),
        }, icon('octopus', 14), h('span', { class: 'octo-name' }, rec.project.name),
        headTab ? h('span', { class: 'octo-live', title: 'Baş açık' }) : null,
        arms.length ? h('span', { class: 'octo-count', title: `${arms.length} açık kol` }, arms.length) : null),
        arms.length
          ? h('div', { class: 'octo-arms' }, arms.map((arm) => {
              const t = tabs.find((x) => x.sessionId && x.sessionId === arm.sessionId);
              // Sekmesi açık olmayan kol çalışamaz ve bekleyemez (panel kapanırken kayıt olduğu gibi kalır)
              const label = !t && (arm.state === 'working' || arm.state === 'waiting') ? 'açık değil' : ARM_STATES[arm.state] || arm.state;
              const todos = arm.todos?.total ? ` · ${arm.todos.done}/${arm.todos.total} iş` : '';
              return h('button', {
                class: 'octo-arm' + (t && t === active ? ' on' : ''), 'data-state': arm.state, 'data-live': t ? '1' : null,
                title: `${arm.title} · ${label}${todos}${arm.worktree ? '\nDal: ' + arm.worktree.branch : ''}${arm.brief ? '\n\n' + arm.brief.slice(0, 300) : ''}`,
                onclick: (e) => { e.stopPropagation(); openArm(acctId, rec, arm); },
                oncontextmenu: (e) => armMenu(e, acctId, rec, arm),
              }, h('span', { class: 'octo-dot' }), h('span', { class: 'octo-arm-title' }, arm.title || arm.id), h('span', { class: 'octo-arm-state' }, label));
            }))
          : null);
    }));
}

// Sohbet menüsündeki öğe (renderer/chat.js → chatMenu). Var olan bir projenin sohbeti beyin olur: yalnız panelin kaydı açılır,
// geçmiş oturumlara ve proje dosyalarına dokunulmaz (OCTOPUS-PLANI.md İ1). Yan oturum ve ayrı kopya beyin olamaz (ana süreç de reddeder).
function octopusMenuItem(tab) {
  if (tab.octopusId) return { icon: 'octopus', label: 'Bu sohbet projenin beyni', desc: 'Açtığı yan oturumlar ahtapotun kolları', checked: true, onclick: () => {} };
  const why = tab.parentId ? 'Yan oturum beyin olamaz' : tab.worktree ? 'Ayrı kopyadaki sohbet beyin olamaz' : '';
  return {
    icon: 'octopus', label: 'Bu sohbeti beyin yap',
    desc: why || 'Projenin ahtapotu bu sohbetten kurulur; eski oturumlara ve dosyalara dokunulmaz',
    onclick: () => (why ? toast(why + '.') : adoptChat(tab)),
  };
}

async function adoptChat(tab) {
  if (!tab.chatId) return toast('Sohbet henüz başlamadı.');
  const r = await window.panel.octopusAdopt(tab.chatId);
  if (!r?.ok) return toast(r?.error || 'Beyin yapılamadı.', 4500);
  tab.octopusId = r.id;
  renderSidebar();
  toast('Bu sohbet artık projenin beyni. Açtığı yan oturumlar kol olarak kaydedilir.', 4000);
}

// ---------- Ahtapot bölmesi (başın sohbetinin sağında; OCTOPUS-PLANI.md P4.1, P4.2, K1) ----------
// Geometri docs/octopus/prototip/octopus-taslak.html'den. Her kol kayıttaki durumunun pozunu alır (kıvrım, kalkış, renk).
// Hareket yalnız bir durumu gösterir (İ4): çalışan kol dalgalanır, bekleyen kolun ucu kalkıp çağırır; rapor veren,
// duran ve biten kollar durağandır. Geçişler: onaylanan kol büyür, kesilen kolun kopan parçası düşer, tur sonu raporu
// koldan başa, baştan kola giden mesaj baştan kola bir atım olarak akar, sıkıştırmada mürekkep. Başta bağlamın doluluğu,
// bekleyen `sessions start` kartı için bir tomurcuk. Azaltılmış hareket tercihinde ve bölme görünmezken döngü durur,
// çizim durağan pozlarla bir kez yapılır; döngü kıpırdayan bir şey kalmayınca da kendiliğinden durur (en çok 30 kare/sn).
// Aynı anda en çok 8 kol çizilir: önce bekleyen ve çalışanlar, sonra rapor verenler, sonra bitenler (yenisi önce);
// kesilen kollar ve sekmesi kapanmış biten kollar çizilmez (kapatılan kol ahtapottan kalkar). Çizilmeyenler bölmenin altındaki "Diğer kollar" listesinde.

const OC_NS = 'http://www.w3.org/2000/svg';
const OC_W = 700, OC_H = 468, OC_HX = 350, OC_N = 48, OC_DRAWN = 8, OC_SUCKERS = 12, OC_FPS = 30;
const OC_MANTLE = 'M350 24C398 24 421 60 419 104C417 140 400 160 396 176C380 190 320 190 304 176C300 160 283 140 281 104C279 60 302 24 350 24Z';
// Durumun duruşu: dalga genliği, sıklığı (Hz; 0 = durağan) ve sayısı, uçtaki kıvrım, ucun kalkması (taslaktaki MOTION)
const OC_MOTION = {
  working: { amp: 8, freq: 0.55, k: 1.25, curl: 0.5, lift: 0 },
  waiting: { amp: 4, freq: 0.3, k: 0.9, curl: 1.6, lift: 1 },
  reported: { amp: 6, freq: 0, k: 1.1, curl: 0.8, lift: 0 },
  stopped: { amp: 3, freq: 0, k: 0.9, curl: 1.2, lift: 0 },
  done: { amp: 3, freq: 0, k: 0.8, curl: 2.5, lift: 0 },
  bud: { amp: 2, freq: 0, k: 0.8, curl: 0.2, lift: 0 },
};
const OC_STOPS = { base: ['#a14f36', '#d97757', '#efa98d'], rest: ['#8b4531', '#bf6a4e', '#d99b82'], wait: ['#a14f36', '#e39a60', '#f3cd82'] };
const OC_STATE_COL = { working: 'var(--clay)', waiting: 'var(--warn)', reported: 'var(--soft)', done: 'var(--ok)', stopped: 'var(--danger-text)', cut: 'var(--faint)' };
const OC_ORDER = { waiting: 0, working: 1, stopped: 2, reported: 3, done: 4 };
const OC_WARN = '#e2b86b', OC_CLAY = '#d97757';
const OC_BUD_WAIT = 10000; // onaylanan tomurcuk kolu kayda düşene kadar en çok bu kadar bekler

let ocSeq = 0; // bölme başına SVG kimlik öneki (iki başın bölmesi aynı belgede)
const ocClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ocF = (v) => Math.round(v * 10) / 10;
const ocOp = (v) => Math.round(ocClamp(v, 0, 1) * 100) / 100;
const ocLerp = (a, b, k) => a + (b - a) * k;
const ocEase = (k) => 1 - Math.pow(1 - ocClamp(k, 0, 1), 3);
const ocBack = (k) => { k = ocClamp(k, 0, 1); return 1 + 2.5 * Math.pow(k - 1, 3) + 1.5 * Math.pow(k - 1, 2); };
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(OC_NS, tag);
  for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

const octoRecord = (tab) => (octo.lists[tab.acctId] || []).find((r) => r.id === tab.octopusId) || null;
const armTab = (acctId, arm) => (arm.sessionId && openChatTabs(acctId).find((t) => t.sessionId === arm.sessionId)) || null;

// Kenar çubuğuyla aynı: sekmesi açık olmayan kol çalışamaz ve bekleyemez
function armStatus(arm, t) {
  const label = !t && (arm.state === 'working' || arm.state === 'waiting') ? 'açık değil' : ARM_STATES[arm.state] || arm.state;
  return { label, todos: arm.todos?.total ? `${arm.todos.done}/${arm.todos.total} iş` : '' };
}

function drawnArms(rec, acctId) {
  const live = rec.arms.filter((a) => a.state !== 'cut' && (a.state !== 'done' || armTab(acctId, a)));
  const chosen = new Set([...live]
    .sort((a, b) => (OC_ORDER[a.state] ?? 5) - (OC_ORDER[b.state] ?? 5) || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, OC_DRAWN));
  return rec.arms.filter((a) => chosen.has(a)); // kayıttaki sırayla, soldan sağa
}

// Başın bekleyen "yeni kol" kartları (renderer/chat.js → handlePermission bunları data-start ile işaretler)
function pendingStarts(tab) {
  const out = [];
  for (const [rid, card] of tab.pendingPerms || []) {
    if (card.dataset.start == null || (card.classList.contains('answered') && card.dataset.reply !== 'allow')) continue;
    out.push({ key: 'bud:' + rid, title: card.dataset.start, card, approved: card.dataset.reply === 'allow' });
  }
  return out;
}

// Kollar başın altından yelpaze gibi açılır (taslaktaki layout)
function ocLayout(i, n) {
  const spread = Math.min(70, 18 * n);
  const f = n === 1 ? 0.5 : i / (n - 1);
  const phi = (90 + spread - 2 * spread * f) * Math.PI / 180;
  return {
    T: { x: OC_HX + 285 * Math.cos(phi), y: 172 + 236 * Math.sin(phi) },
    B: { x: OC_HX + (n === 1 ? 0 : (f - 0.5) * 2 * Math.min(34, 7 * n)), y: 176 + 6 * (1 - Math.abs(f - 0.5) * 2) },
  };
}

function ocNormals(pts) {
  for (let j = 0; j < pts.length; j++) {
    const p = pts[Math.max(0, j - 1)], q = pts[Math.min(pts.length - 1, j + 1)];
    const tx = q.x - p.x, ty = q.y - p.y, l = Math.hypot(tx, ty) || 1;
    pts[j].nx = -ty / l; pts[j].ny = tx / l;
  }
}

// Kolun orta çizgisi: kübik eğri + uca doğru büyüyen dalga + uçta kıvrım; g büyüme payı (0..1)
function ocGeom(B, T0, pose, ph, fallbackSide, g = 1) {
  const T = { x: T0.x, y: T0.y - 32 * pose.lift };
  const dx = T.x - B.x;
  const w = ocClamp(Math.abs(T0.x - OC_HX) / 285, 0, 1);
  const side = Math.sign(T0.x - OC_HX) || fallbackSide;
  const c1x = B.x + dx * 0.1 + side * 14 * (1 - w), c1y = B.y + 70 + 30 * (1 - w);
  const c2x = T.x - dx * 0.35 * w - 25 * side * (1 - w), c2y = T.y + 45 * w - 70 * (1 - w);
  let pts = [];
  for (let j = 0; j <= OC_N; j++) {
    const s = g * j / OC_N, u = 1 - s;
    const b0 = u * u * u, b1 = 3 * u * u * s, b2 = 3 * u * s * s, b3 = s * s * s;
    pts.push({ x: b0 * B.x + b1 * c1x + b2 * c2x + b3 * T.x, y: b0 * B.y + b1 * c1y + b2 * c2y + b3 * T.y, s });
  }
  ocNormals(pts);
  for (const p of pts) {
    const off = pose.amp * Math.pow(p.s, 1.25) * Math.sin(2 * Math.PI * pose.k * p.s - ph);
    p.x += p.nx * off; p.y += p.ny * off;
  }
  const cAmt = pose.curl * -side;
  const m = Math.round(OC_N * 0.6);
  const out = pts.slice(0, m + 1).map((p) => ({ x: p.x, y: p.y, s: p.s }));
  let px = pts[m].x, py = pts[m].y;
  for (let j = m + 1; j <= OC_N; j++) {
    const k = (j - m) / (OC_N - m), th = cAmt * k * k;
    const vx = pts[j].x - pts[j - 1].x, vy = pts[j].y - pts[j - 1].y;
    const c = Math.cos(th), sn = Math.sin(th);
    px += vx * c - vy * sn; py += vx * sn + vy * c;
    out.push({ x: px, y: py, s: pts[j].s });
  }
  pts = out;
  ocNormals(pts);
  pts.curlSign = Math.sign(cAmt) || 1;
  return pts;
}

// Kolun dış çizgisi; genişlik her noktaya yazılır (vantuzlar kullanır)
function ocOutline(pts, g = 1) {
  const sc = 0.45 + 0.55 * ocClamp(g, 0, 1);
  const L = [], R = [];
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j], w = (0.7 + 13.5 * Math.pow(1 - j / (pts.length - 1), 1.15)) * sc;
    p.w = w;
    L.push(ocF(p.x + p.nx * w / 2) + ' ' + ocF(p.y + p.ny * w / 2));
    R.push(ocF(p.x - p.nx * w / 2) + ' ' + ocF(p.y - p.ny * w / 2));
  }
  return 'M' + L.join('L') + 'L' + R.reverse().join('L') + 'Z';
}
const ocLine = (pts) => 'M' + pts.map((p) => ocF(p.x) + ' ' + ocF(p.y)).join('L');
const ocShort = (s, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function octopusView(tab) {
  const nameEl = h('span', { class: 'oc-sub' });
  // İki sayfa: ahtapotun çizimi ve defter (renderer/defter.js; ilk açılışta kurulur). Çizim gizliyken döngü kendiliğinden durur (visible).
  let page = 'octo', defter = null;
  const pageBtn = (p, label, ic) => h('button', { class: 'oc-tab', role: 'tab', 'data-page': p, 'aria-selected': p === page ? 'true' : 'false', onclick: () => showPage(p) }, icon(ic, 14), label);
  const tabs = h('div', { class: 'oc-tabs', role: 'tablist' }, pageBtn('octo', 'Ahtapot', 'octopus'), pageBtn('defter', 'Defter', 'book'));
  const head = h('div', { class: 'oc-head' },
    tabs, nameEl, h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Kapat', onclick: () => closeOctopusInChat(tab) }, icon('close', 16)));
  const svg = svgEl('svg', { class: 'oc-svg', viewBox: `0 0 ${OC_W} ${OC_H}`, role: 'group' });
  const info = h('div', { class: 'oc-info' });
  const more = h('div', { class: 'oc-more' });
  const fossils = h('div', { class: 'oc-more oc-fossils' }); // başın önceki bedenleri (yeniden doğuş, P7.3)
  const empty = h('div', { class: 'oc-empty', hidden: true });
  const body = h('div', { class: 'oc-body' }, svg, empty, info, more, fossils);
  const el = h('div', { class: 'oc-pane' }, head, body);

  function showPage(p) {
    page = p === 'defter' ? 'defter' : 'octo';
    for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.page === page ? 'true' : 'false');
    if (page === 'defter' && !defter) { defter = defterView(tab); el.append(defter.el); }
    body.hidden = page !== 'octo';
    if (defter) defter.el.hidden = page !== 'defter';
    if (page === 'defter') defter.refresh();
    else if (built) { placeLabels(true); kick(); }
  }
  const uid = 'oc' + ++ocSeq + '-';
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');

  let sig = '', rec = null, focus = null, built = false, drawnOnce = false, armSeq = 0;
  const M = new Map(); // kol kimliği ya da 'bud:<rid>' -> çizim modeli
  let order = [];      // yelpazedeki sıra (kesilmekte olanlar hariç)
  let L = null;        // katmanlar ve başın parçaları
  let raf = 0, last = 0, clock = 0;
  let pulses = [], debris = [], inkP = [];
  const ctx = { now: null, target: null, from: 0, t: null };
  let headFlash = 0, hoverId = null;
  const stats = { frames: 0, pulses: 0, inks: 0, cuts: 0, grows: 0 };

  const visible = () => el.isConnected && !document.hidden && svg.clientWidth > 0 && svg.checkVisibility();
  const canAnimate = () => !reduceMq.matches && visible();

  // ---------- Kurulum ----------

  function build() {
    svg.replaceChildren();
    const defs = svgEl('defs', null, svg);
    const grad = (tag, id, at, stops) => {
      const g = svgEl(tag, { id, ...at }, defs);
      for (const [o, c, o2] of stops) svgEl('stop', { offset: o, 'stop-color': c, 'stop-opacity': o2 ?? 1 }, g);
    };
    grad('radialGradient', uid + 'mantle', { cx: '40%', cy: '28%', r: '80%' }, [[0, '#f2b297'], [0.5, OC_CLAY], [1, '#7c3b27']]);
    grad('radialGradient', uid + 'bg', { cx: '50%', cy: '24%', r: '60%' }, [[0, OC_CLAY, 0.14], [1, OC_CLAY, 0]]);
    for (const [n, sd] of [['b4', 4], ['b6', 6], ['b12', 12]]) {
      const f = svgEl('filter', { id: uid + n, x: '-80%', y: '-80%', width: '260%', height: '260%' }, defs);
      svgEl('feGaussianBlur', { stdDeviation: sd }, f);
    }
    svgEl('path', { d: OC_MANTLE }, svgEl('clipPath', { id: uid + 'clip' }, defs));
    svgEl('rect', { x: 0, y: 0, width: OC_W, height: 2000, fill: `url(#${uid}bg)` }, svg);
    L = { defs };
    L.gDebris = svgEl('g', null, svg);
    L.gArms = svgEl('g', null, svg);
    L.gPulse = svgEl('g', null, svg);
    L.gHead = svgEl('g', { class: 'oc-headg', tabindex: 0, role: 'button' }, svg);
    L.gExam = svgEl('g', { class: 'oc-exam' }, svg); // son sınavın puanı (sinav.js), başın üstünde
    L.gInk = svgEl('g', { class: 'oc-ink', filter: `url(#${uid}b6)` }, svg);
    L.gLbl = svgEl('g', null, svg);
    buildHead(L.gHead);
    const goHead = () => { showTab(tab.acctId, tab); tab.input?.focus(); };
    L.gHead.addEventListener('click', goHead);
    L.gHead.addEventListener('mouseenter', () => infoFor(null));
    L.gHead.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHead(); } });
    built = true;
  }

  function buildHead(g) {
    L.halo = svgEl('ellipse', { cx: OC_HX, cy: 104, rx: 96, ry: 100, fill: OC_CLAY, opacity: 0.12, filter: `url(#${uid}b12)` }, g);
    svgEl('path', { d: OC_MANTLE, fill: `url(#${uid}mantle)` }, g);
    // Doluluk: bağlamın yüzdesi kadar manto dolar (son tur sonundaki ölçüm, renderer/compaction.js)
    const gFill = svgEl('g', { 'clip-path': `url(#${uid}clip)` }, g);
    L.fillP = svgEl('path', { class: 'oc-fill', fill: '#ffe4d6', opacity: 0.2 }, gFill);
    L.fillL = svgEl('path', { fill: 'none', stroke: '#fff2ea', 'stroke-width': 1.2, opacity: 0.5 }, gFill);
    L.tint = svgEl('path', { d: OC_MANTLE, fill: OC_WARN, opacity: 0 }, g);
    svgEl('ellipse', { cx: 323, cy: 60, rx: 22, ry: 11, fill: '#fff', opacity: 0.11, transform: 'rotate(-30 323 60)' }, g);
    for (const [x, y, r] of [[373, 54, 3], [393, 88, 2.4], [308, 102, 2.1], [366, 122, 2.2], [338, 40, 1.7], [399, 130, 1.8], [300, 134, 1.6]])
      svgEl('ellipse', { cx: x, cy: y, rx: r, ry: r * 0.8, fill: '#7c3b27', opacity: 0.4 }, g);
    svgEl('path', { class: 'oc-ring', d: OC_MANTLE, fill: 'none', stroke: 'var(--text)', 'stroke-width': 1.2 }, g);
    L.tBrain = svgEl('text', { 'text-anchor': 'middle', fill: '#fff4ec', 'font-weight': 600, opacity: 0.85 }, g);
    L.tBrain.textContent = 'BEYİN';
    L.tMid = svgEl('text', { 'text-anchor': 'middle', fill: '#fff6f0' }, g);
    L.tLow = svgEl('text', { x: OC_HX, y: 115, 'text-anchor': 'middle', fill: '#fff4ec', 'font-size': 9.5, opacity: 0.75 }, g);
    L.eyes = [326, 374].map((x) => {
      svgEl('ellipse', { cx: x, cy: 151, rx: 13.5, ry: 11.5, fill: '#7c3b27', opacity: 0.4 }, g);
      svgEl('ellipse', { cx: x, cy: 150, rx: 9.5, ry: 7.6, fill: '#f5ebdf', stroke: '#6a3020', 'stroke-width': 1.1 }, g);
      const pupil = svgEl('rect', { class: 'oc-pupil', x: x - 4.6, y: 148.4, width: 9.2, height: 3.2, rx: 1.6, fill: '#1b1917' }, g);
      return { x, y: 150, pupil, px: 0, py: 0 };
    });
  }

  // ---------- Kol modelleri ----------

  function motionKey(m) {
    if (m.kind === 'bud') return 'bud';
    const s = m.arm.state;
    if (s === 'cut') return m.prev || 'done';
    if (!m.live && (s === 'working' || s === 'waiting')) return 'stopped'; // sekmesi açık değil: kıpırdamaz
    return OC_MOTION[s] ? s : 'done';
  }

  function makeModel(id, kind) {
    const m = { id, kind, ph0: 1.1 + (armSeq % 8) * 2.3, g: 1, growT: null, growFrom: 0, cutting: false, glowOp: 0, tipFlash: 0, lop: 1, sc: [], lit: 0 };
    m.ph = m.ph0;
    const gid = uid + 'ag' + ++armSeq;
    m.grad = svgEl('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse' }, L.defs);
    m.stops = [0, 0.55, 1].map((o) => svgEl('stop', { offset: o }, m.grad));
    m.el = svgEl('g', { class: kind === 'bud' ? 'oc-bud' : 'oc-arm', 'data-id': kind === 'bud' ? null : id, tabindex: 0, role: 'button' }, L.gArms);
    if (kind === 'bud') m.ghost = svgEl('path', { class: 'oc-ghost', fill: 'none', stroke: OC_CLAY, 'stroke-width': 1.4, 'stroke-dasharray': '2 6', 'stroke-linecap': 'round' }, m.el);
    m.glow = svgEl('circle', { r: 11, opacity: 0, filter: `url(#${uid}b6)` }, m.el);
    m.body = svgEl('path', { class: 'oc-body-p', fill: `url(#${gid})` }, m.el);
    m.edge = svgEl('path', { class: 'oc-edge', fill: 'none', stroke: 'var(--text)', 'stroke-width': 1 }, m.el);
    m.gSuck = svgEl('g', null, m.el);
    m.ring = svgEl('circle', { fill: 'none', stroke: '#fff3ea', 'stroke-width': 1, opacity: 0 }, m.gSuck);
    m.hit = svgEl('path', { fill: 'none', stroke: 'transparent', 'stroke-width': 20, 'stroke-linecap': 'round', 'pointer-events': 'stroke' }, m.el);
    m.lbl = svgEl('g', { class: 'oc-lbl' + (kind === 'bud' ? ' oc-bud-lbl' : ''), 'data-id': kind === 'bud' ? null : id }, L.gLbl);
    m.bg = svgEl('rect', { class: 'oc-lbl-bg', rx: 7 }, m.lbl);
    m.nEl = svgEl('text', { class: 'n', 'text-anchor': 'middle', y: 0 }, m.lbl);
    m.sEl = svgEl('text', { class: 's', 'text-anchor': 'middle', y: 14 }, m.lbl);
    const open = () => {
      if (m.cutting) return;
      if (m.kind === 'bud') { showTab(tab.acctId, tab); m.card?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      openArm(tab.acctId, rec, m.arm);
    };
    const enter = () => { hoverId = m.id; infoFor(m); m.el.classList.add('hover'); m.lbl.classList.add('on'); kick(); };
    const leave = () => { if (hoverId === m.id) hoverId = null; m.el.classList.remove('hover'); m.lbl.classList.remove('on'); kick(); };
    const menu = (e) => {
      if (m.kind === 'bud' || m.cutting) return;
      armMenu(e, tab.acctId, rec, m.arm);
    };
    for (const x of [m.el, m.lbl]) {
      x.addEventListener('click', open);
      x.addEventListener('contextmenu', menu);
      x.addEventListener('mouseenter', enter);
      x.addEventListener('mouseleave', leave);
    }
    m.el.addEventListener('focus', enter);
    m.el.addEventListener('blur', leave);
    m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    M.set(id, m);
    return m;
  }

  function dropModel(m) {
    m.el.remove(); m.lbl.remove(); m.grad.remove();
    M.delete(m.id);
    if (hoverId === m.id) hoverId = null;
  }

  // Kayıttaki kolun bilgisi modele (renk, etiket, vantuz sayısı)
  function dress(m) {
    if (m.kind === 'bud') {
      m.stops.forEach((s, k) => s.setAttribute('stop-color', OC_STOPS.base[k]));
      m.nEl.textContent = 'Öneri · ' + ocShort(m.title || 'Yeni kol', 18);
      m.nEl.setAttribute('fill', 'var(--muted)');
      m.sEl.textContent = m.approved ? 'başlıyor' : 'onayını bekliyor';
      m.sEl.setAttribute('fill', m.approved ? 'var(--clay)' : 'var(--warn)');
      m.el.setAttribute('aria-label', `Öneri: ${m.title}. ${m.approved ? 'Başlıyor' : 'Sohbetteki kart onayınızı bekliyor'}`);
      m.glow.setAttribute('fill', OC_CLAY);
      return;
    }
    const arm = m.arm, t = armTab(tab.acctId, arm), st = armStatus(arm, t);
    m.live = !!t;
    m.el.setAttribute('data-state', arm.state);
    if (t) m.el.setAttribute('data-live', '1'); else m.el.removeAttribute('data-live');
    m.el.setAttribute('aria-label', `${arm.title || arm.id}: ${st.label}${st.todos ? ', ' + st.todos : ''}. Sekmesini aç`);
    const stops = arm.state === 'done' || arm.state === 'cut' || (!t && arm.state !== 'reported') ? OC_STOPS.rest : arm.state === 'waiting' && t ? OC_STOPS.wait : OC_STOPS.base;
    m.stops.forEach((s, k) => s.setAttribute('stop-color', stops[k]));
    m.glow.setAttribute('fill', arm.state === 'waiting' ? OC_WARN : OC_CLAY);
    m.nEl.textContent = ocShort(arm.title || arm.id);
    m.sEl.textContent = st.label + (st.todos ? ' · ' + st.todos : '');
    m.sEl.setAttribute('fill', OC_STATE_COL[arm.state] || 'var(--muted)');
    // Vantuzlar kolun görevleridir (son TodoWrite); çoksa OC_SUCKERS'a ölçeklenir
    const total = arm.todos?.total || 0, done = arm.todos?.done || 0;
    const n = Math.min(total, OC_SUCKERS);
    m.lit = total > OC_SUCKERS ? Math.round(done / total * OC_SUCKERS) : done;
    while (m.sc.length > n) m.sc.pop().remove();
    while (m.sc.length < n) m.sc.push(svgEl('circle', { class: 'oc-suck', r: 1.5 }, m.gSuck));
    m.sc.forEach((c, k) => { if (k < m.lit) c.setAttribute('data-lit', '1'); else c.removeAttribute('data-lit'); });
  }

  // Kayıt, sekmeler, tomurcuklar ya da bağlam değişince: modelleri kayda uydur, geçişleri başlat
  function sync() {
    const animate = canAnimate();
    const first = !drawnOnce; // bölme açılırken var olan kollar büyümeden görünür
    const now = Date.now();
    const arms = drawnArms(rec, tab.acctId);
    const ids = new Set(arms.map((a) => a.id));

    // Tomurcuklar: bekleyen ya da yeni onaylanmış "yeni kol" kartları
    const starts = pendingStarts(tab);
    const startKeys = new Set(starts.map((s) => s.key));
    for (const s of starts) {
      let m = M.get(s.key);
      if (!m) {
        m = makeModel(s.key, 'bud');
        m.g = animate ? 0 : 0.18; m.growFrom = 0; m.growT = animate ? 0 : null;
      }
      m.title = s.title; m.card = s.card;
      if (s.approved && !m.approved) { m.approved = now; if (animate) { m.growFrom = m.g; m.growT = 0; } }
      dress(m);
    }

    // Kollar
    for (const arm of arms) {
      let m = M.get(arm.id);
      if (m && m.cutting) { dropModel(m); m = null; } // kesilirken geri gelen kol (yeni mesaj): baştan çizilir
      if (!m) {
        const bud = [...M.values()].find((b) => b.kind === 'bud' && !b.cutting && b.title === arm.title && (b.approved || !startKeys.has(b.id)));
        m = makeModel(arm.id, 'arm');
        if (animate && !first) {
          if (bud) { m.B = { ...bud.B }; m.T = { ...bud.T }; m.growFrom = bud.g; }
          m.g = m.growFrom; m.growT = 0;
          m.el.setAttribute('data-grow', '1');
          stats.grows++;
          m.pendingPulse = true; // baştan kola: görev tanımı
        }
        if (bud) dropModel(bud);
      }
      m.arm = arm;
      dress(m);
    }

    // Çizimden düşenler: kesilen kol kopar ve düşer, öteki çekilir; tomurcuk reddedilince ya da süresi dolunca çekilir
    for (const m of [...M.values()]) {
      if (m.cutting) continue;
      const gone = m.kind === 'bud'
        ? !startKeys.has(m.id) && !(m.approved && now - m.approved < OC_BUD_WAIT)
        : !ids.has(m.id);
      if (!gone) continue;
      if (m.kind === 'arm') {
        const arm = rec.arms.find((a) => a.id === m.id);
        if (arm) { m.prev = motionKey(m); m.arm = arm; dress(m); }
        if (arm?.state === 'cut') stats.cuts++;
        if (animate && arm?.state === 'cut') { cut(m); continue; }
      }
      if (animate) { m.prev = motionKey(m); m.cutting = true; m.growT = null; } else dropModel(m);
    }
    const budWait = [...M.values()].filter((m) => m.kind === 'bud' && m.approved && !startKeys.has(m.id));
    if (budWait.length) setTimeout(() => { sig = ''; view.refresh(); }, OC_BUD_WAIT + 50);

    // Yelpaze: kollar kayıttaki sırayla, tomurcuklar sonda
    order = [...arms.map((a) => M.get(a.id)), ...[...M.values()].filter((m) => m.kind === 'bud' && !m.cutting)];
    order.forEach((m, i) => {
      const { B, T } = ocLayout(i, order.length);
      m.Bt = B; m.Tt = T; m.side = i % 2 ? 1 : -1;
      if (!m.B) { m.B = { ...B }; m.T = { ...T }; }
      if (L.gArms.children[i] !== m.el) L.gArms.insertBefore(m.el, L.gArms.children[i] || null);
    });
    const waitingArm = order.find((m) => m.kind === 'arm' && m.arm.state === 'waiting' && m.live);
    if (waitingArm) L.gHead.setAttribute('data-waiting', waitingArm.id); else L.gHead.removeAttribute('data-waiting');
    svg.setAttribute('aria-label', `Ahtapot: beyin ve ${arms.length} kol`);
    drawnOnce = true;
    syncHead(animate);
    placeLabels(!animate || first);
    if (animate) kick(); else renderStatic();
  }

  function syncHead(animate) {
    const pct = tab.context?.percentage;
    const target = typeof pct === 'number' ? ocClamp(pct / 100, 0, 1) : null;
    L.gHead.setAttribute('data-ctx', target == null ? '' : String(pct));
    L.gHead.setAttribute('aria-label', `Beyin: ${rec.project.name}${target == null ? '' : `, bağlam %${pct} dolu`}. Sohbetine git`);
    if (target !== ctx.target) {
      if (animate && ctx.now != null && target != null) { ctx.from = ctx.now; ctx.t = 0; } else { ctx.now = target; ctx.t = null; }
      ctx.target = target;
    }
    if (target == null) {
      L.tBrain.setAttribute('x', OC_HX); L.tBrain.setAttribute('y', 96); L.tBrain.setAttribute('font-size', 11); L.tBrain.setAttribute('letter-spacing', 2.4);
      L.tMid.setAttribute('x', OC_HX); L.tMid.setAttribute('y', 114); L.tMid.setAttribute('font-size', 10); L.tMid.setAttribute('font-weight', 400); L.tMid.setAttribute('opacity', 0.75);
      L.tMid.textContent = ocShort(rec.project.name, 18);
      L.tLow.textContent = '';
    } else {
      L.tBrain.setAttribute('x', OC_HX); L.tBrain.setAttribute('y', 74); L.tBrain.setAttribute('font-size', 9.5); L.tBrain.setAttribute('letter-spacing', 2);
      L.tMid.setAttribute('x', OC_HX); L.tMid.setAttribute('y', 100); L.tMid.setAttribute('font-size', 19); L.tMid.setAttribute('font-weight', 600); L.tMid.setAttribute('opacity', 1);
      L.tLow.textContent = 'bağlam dolu';
    }
  }

  // ---------- Geçişler ----------

  function cut(m) {
    if (m.pts && m.g > 0.5) {
      const k0 = Math.round(OC_N * 0.22);
      const pts = m.pts.slice(k0).map((p) => ({ x: p.x, y: p.y, nx: p.nx, ny: p.ny, w: p.w }));
      debris.push({ pts, age: 0, rot: (m.T.x < OC_HX ? -1 : 1) * 0.42, ox: pts[0].x, oy: pts[0].y,
        el: svgEl('path', { class: 'oc-debris', fill: m.prev === 'done' ? '#b36248' : '#cf7354' }, L.gDebris) });
      const sp = svgEl('circle', { class: 'oc-spark', fill: 'none', stroke: '#fff', 'stroke-width': 1.5 }, L.gDebris);
      debris.push({ spark: true, x: m.pts[k0].x, y: m.pts[k0].y, age: 0, el: sp });
      m.g = 0.22;
    }
    m.cutting = true;
    m.growT = null;
    m.el.removeAttribute('data-grow');
  }

  function spawnPulse(m, dir) {
    if (!m || m.cutting || !m.pts) return;
    const up = dir === 'up';
    const gl = svgEl('circle', { r: 7, fill: up ? OC_CLAY : '#eeece5', opacity: 0.55, filter: `url(#${uid}b4)` }, L.gPulse);
    const c = svgEl('circle', { class: 'oc-pulse', 'data-dir': dir, 'data-arm': m.id, r: 2.6, fill: up ? '#fff0e6' : '#ffffff' }, L.gPulse);
    pulses.push({ m, up, p: up ? 1 : 0, c, gl });
    stats.pulses++;
  }

  function ink() {
    if (!built || !canAnimate()) return;
    stats.inks++;
    for (let i = 0; i < 34; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 75;
      inkP.push({ x: OC_HX + (Math.random() - 0.5) * 60, y: 118 + (Math.random() - 0.5) * 70, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.75 - 12,
        r0: 4 + Math.random() * 7, r1: 20 + Math.random() * 30, life: 1.3 + Math.random(), age: 0, el: svgEl('circle', { fill: '#0c0a09' }, L.gInk) });
    }
    kick();
  }

  // ---------- Çizim ----------

  function gTarget(m) { return m.kind === 'bud' ? (m.approved ? 0.32 : 0.18) : 1; }

  function paintArm(m) {
    const pose = { amp: m.amp, k: m.k, curl: m.curl, lift: m.lift };
    const P = ocGeom(m.B, m.T, pose, m.ph, m.side, m.g);
    m.pts = P;
    const d = ocOutline(P, m.g);
    m.body.setAttribute('d', d);
    m.body.setAttribute('opacity', m.kind === 'bud' ? 0.55 : 1);
    m.edge.setAttribute('d', d);
    m.hit.setAttribute('d', m.g > 0.15 && !m.cutting ? ocLine(P) : 'M0 0');
    m.grad.setAttribute('x1', ocF(P[0].x)); m.grad.setAttribute('y1', ocF(P[0].y));
    m.grad.setAttribute('x2', ocF(m.T.x)); m.grad.setAttribute('y2', ocF(m.T.y));
    if (m.ghost) {
      const gp = ocGeom(m.Bt || m.B, m.Tt || m.T, OC_MOTION.bud, m.ph0, m.side, 1);
      m.ghost.setAttribute('d', ocLine(gp.slice(Math.round(OC_N * 0.16))));
      m.ghost.setAttribute('opacity', ocOp((m.ghostOp ?? 0.45) * m.lop));
    }
    // Vantuzlar: kolun uç yarısında, kıvrımın iç yanında; yananlar bitmiş görevler
    const showS = m.kind === 'arm' && m.g > 0.6 && !m.cutting && m.sc.length;
    m.gSuck.setAttribute('opacity', showS ? ocOp((m.g - 0.6) / 0.4) : 0);
    let ringOn = false;
    if (showS) {
      const n = m.sc.length, finished = m.arm.state === 'done';
      for (let k = 0; k < n; k++) {
        const u = 0.3 + 0.6 * (n === 1 ? 0.5 : k / (n - 1));
        const p = P[Math.round(u * (P.length - 1))];
        const x = p.x + P.curlSign * p.nx * p.w * 0.2, y = p.y + P.curlSign * p.ny * p.w * 0.2;
        const rr = Math.max(1.2, p.w * 0.19), c = m.sc[k], lit = k < m.lit;
        c.setAttribute('cx', ocF(x)); c.setAttribute('cy', ocF(y)); c.setAttribute('r', ocF(rr));
        c.setAttribute('fill', lit ? (finished ? '#e3efd6' : '#fde9db') : '#4d2014');
        c.setAttribute('opacity', lit ? 0.92 : 0.4);
        if (k === m.lit && m.arm.state === 'working' && m.live) {
          ringOn = true;
          m.ring.setAttribute('cx', ocF(x)); m.ring.setAttribute('cy', ocF(y));
          m.ring.setAttribute('r', ocF(rr + 1.8 + (m.ringWave || 0)));
        }
      }
    }
    m.ring.setAttribute('opacity', ringOn ? 0.8 : 0);
    const tip = P[P.length - 1];
    m.glow.setAttribute('cx', ocF(tip.x)); m.glow.setAttribute('cy', ocF(tip.y));
    m.glow.setAttribute('opacity', ocOp(m.glowOp));
    m.lbl.setAttribute('transform', `translate(${ocF(m.lx ?? 0)} ${ocF(m.ly ?? 0)}) scale(${ocF((m.lk || 1) * 100) / 100})`);
    m.lbl.setAttribute('opacity', ocOp(m.lop));
  }

  function paintHead() {
    const c = ctx.now;
    if (c == null) {
      L.fillP.setAttribute('d', ''); L.fillL.setAttribute('d', '');
    } else {
      const lvl = 24 + (187 - 24) * (1 - c);
      let top = '';
      for (let x = 276; x <= 424; x += 8) top += (x === 276 ? 'M' : 'L') + x + ' ' + ocF(lvl + 2.2 * Math.sin(x * 0.07));
      L.fillP.setAttribute('d', top + 'L424 200L276 200Z');
      L.fillL.setAttribute('d', top);
      L.fillP.setAttribute('fill', c >= CONTEXT_WARN / 100 ? '#ffd9a8' : '#ffe4d6');
      L.tMid.textContent = '%' + Math.round(c * 100);
    }
    const waiting = L.gHead.hasAttribute('data-waiting');
    const call = L.waitWave || 0;
    L.halo.setAttribute('fill', waiting ? OC_WARN : OC_CLAY);
    L.halo.setAttribute('opacity', ocOp(0.12 + 0.3 * headFlash + (waiting ? 0.1 + 0.06 * call : 0)));
    L.tint.setAttribute('opacity', ocOp(waiting ? 0.22 + 0.1 * call : 0));
    for (const e of L.eyes) e.pupil.setAttribute('transform', `translate(${ocF(e.px)} ${ocF(e.py)})`);
  }

  // Gözler: seni bekleyen kola, yoksa üstüne gelinen ya da çalışan kola bakar
  function gaze() {
    const live = order.filter((m) => m.pts && !m.cutting);
    const tg = live.find((m) => m.kind === 'arm' && m.arm.state === 'waiting' && m.live)
      || live.find((m) => m.id === hoverId)
      || live.find((m) => m.kind === 'arm' && m.arm.state === 'working' && m.live);
    L.gHead.setAttribute('data-look', tg ? tg.id : '');
    const tp = tg ? tg.pts[tg.pts.length - 1] : { x: OC_HX, y: 320 };
    return L.eyes.map((e) => {
      const dx = tp.x - e.x, dy = tp.y - e.y, l = Math.hypot(dx, dy) || 1;
      return { x: (dx / l) * 2.6, y: (dy / l) * 1.7 };
    });
  }

  // Durağan çizim: geçişler sonlanır, her kol durumunun pozunu alır (azaltılmış hareket, görünmeyen bölme)
  function renderStatic() {
    stop();
    for (const q of pulses) { q.c.remove(); q.gl.remove(); }
    for (const d of debris) d.el.remove();
    for (const p of inkP) p.el.remove();
    pulses = []; debris = []; inkP = [];
    headFlash = 0; L.waitWave = 0;
    ctx.now = ctx.target; ctx.t = null;
    for (const m of [...M.values()]) {
      if (m.cutting) { dropModel(m); continue; }
      const mo = OC_MOTION[motionKey(m)];
      Object.assign(m, { amp: mo.amp, k: mo.k, curl: mo.curl, lift: mo.lift, B: { ...m.Bt }, T: { ...m.Tt }, g: gTarget(m), growT: null, tipFlash: 0, lop: 1, ringWave: 0, ghostOp: 0.45 });
      m.pendingPulse = false;
      m.el.removeAttribute('data-grow');
      m.glowOp = glowTarget(m, false);
      if (m.ltx != null) { m.lx = m.ltx; m.ly = m.lty; }
      paintArm(m);
    }
    const look = gaze();
    L.eyes.forEach((e, i) => { e.px = look[i].x; e.py = look[i].y; });
    paintHead();
  }

  function glowTarget(m, moving) {
    if (m.cutting || m.kind === 'bud') return m.kind === 'bud' && m.approved ? 0.4 : 0;
    const s = m.arm.state;
    if (!m.live) return 0;
    if (s === 'working') return 0.42 + (moving ? 0.18 * Math.sin(clock * 4) : 0);
    if (s === 'waiting') return 0.62 + (moving ? 0.3 * Math.sin(clock * 6) : 0);
    return 0;
  }

  // Bir kare; kıpırdayan bir şey kaldıysa true
  function step(dt) {
    let busy = false;
    const near = (a, b, e) => Math.abs(a - b) < e;
    for (const m of [...M.values()]) {
      const key = motionKey(m), mo = OC_MOTION[key];
      const waiting = key === 'waiting';
      const r = Math.min(1, dt * 2.5);
      m.amp = ocLerp(m.amp ?? mo.amp, mo.amp, r);
      m.k = ocLerp(m.k ?? mo.k, mo.k, r);
      const ct = mo.curl + (waiting ? 1.1 * Math.sin(clock * 3.4) : 0); // seni çağırıyor
      m.curl = ocLerp(m.curl ?? mo.curl, ct, Math.min(1, dt * (waiting ? 7 : 2)));
      m.lift = ocLerp(m.lift ?? mo.lift, mo.lift, Math.min(1, dt * 3));
      m.ph += dt * mo.freq * 2 * Math.PI;
      if (!m.cutting && m.Bt) {
        const q = Math.min(1, dt * 4);
        m.T.x = ocLerp(m.T.x, m.Tt.x, q); m.T.y = ocLerp(m.T.y, m.Tt.y, q);
        m.B.x = ocLerp(m.B.x, m.Bt.x, q); m.B.y = ocLerp(m.B.y, m.Bt.y, q);
        busy ||= !near(m.T.x, m.Tt.x, 0.2) || !near(m.T.y, m.Tt.y, 0.2) || !near(m.B.x, m.Bt.x, 0.2) || !near(m.B.y, m.Bt.y, 0.2);
      }
      if (m.growT != null) {
        m.growT += dt / 1.15;
        m.g = ocLerp(m.growFrom, gTarget(m), ocBack(m.growT));
        if (m.pendingPulse && m.growT > 0.15) { m.pendingPulse = false; m.pulseLater = true; }
        if (m.growT >= 1) { m.g = gTarget(m); m.growT = null; m.el.removeAttribute('data-grow'); }
        busy = true;
      }
      if (m.cutting) {
        m.g = Math.max(0, m.g - dt * 0.6);
        m.lop = Math.max(0, m.lop - dt * 4);
        if (m.g <= 0.002) { dropModel(m); continue; }
        busy = true;
      } else {
        const lt = m.kind === 'bud' || m.growT == null ? 1 : ocClamp((m.g - 0.6) / 0.4, 0, 1);
        m.lop = ocLerp(m.lop, lt, Math.min(1, dt * 5));
        busy ||= !near(m.lop, lt, 0.01);
      }
      m.tipFlash = Math.max(0, m.tipFlash - dt * 1.5);
      const gt = glowTarget(m, true) + m.tipFlash * 0.7;
      m.glowOp = ocLerp(m.glowOp, gt, Math.min(1, dt * 5));
      m.ringWave = 1.2 * Math.sin(clock * 5);
      if (m.kind === 'bud') m.ghostOp = m.approved ? 0.25 : 0.4 + 0.14 * Math.sin(clock * 2);
      if (m.ltx != null) {
        const q2 = Math.min(1, dt * 3);
        m.lx = ocLerp(m.lx, m.ltx, q2); m.ly = ocLerp(m.ly, m.lty, q2);
        busy ||= !near(m.lx, m.ltx, 0.2) || !near(m.ly, m.lty, 0.2);
      }
      busy ||= mo.freq > 0 || waiting || (m.kind === 'bud' && !m.approved) || m.tipFlash > 0 || !near(m.glowOp, gt, 0.01)
        || !near(m.amp, mo.amp, 0.02) || !near(m.curl, ct, 0.005) || !near(m.lift, mo.lift, 0.003) || !near(m.k, mo.k, 0.005);
      paintArm(m);
      if (m.pulseLater) { m.pulseLater = false; spawnPulse(m, 'down'); }
    }

    // Atımlar: tur sonu raporu koldan başa (yukarı), baştan kola giden mesaj aşağı
    pulses = pulses.filter((q) => {
      if (!M.has(q.m.id) || q.m.cutting || !q.m.pts) { q.c.remove(); q.gl.remove(); return false; }
      q.p += (q.up ? -1 : 1) * dt / (q.up ? 1.5 : 1.1);
      if (q.p <= 0 || q.p >= 1) {
        q.c.remove(); q.gl.remove();
        if (q.up) headFlash = Math.max(headFlash, 0.5); else q.m.tipFlash = 1;
        return false;
      }
      const P = q.m.pts, fi = q.p * (P.length - 1), i0 = Math.floor(fi), i1 = Math.min(P.length - 1, i0 + 1), fr = fi - i0;
      const x = ocF(ocLerp(P[i0].x, P[i1].x, fr)), y = ocF(ocLerp(P[i0].y, P[i1].y, fr));
      q.c.setAttribute('cx', x); q.c.setAttribute('cy', y); q.gl.setAttribute('cx', x); q.gl.setAttribute('cy', y);
      return true;
    });

    // Kopan parça düşer, kesik yerinde bir halka açılır
    debris = debris.filter((d) => {
      d.age += dt;
      if (d.spark) {
        const k = d.age / 0.45;
        if (k >= 1) { d.el.remove(); return false; }
        d.el.setAttribute('cx', ocF(d.x)); d.el.setAttribute('cy', ocF(d.y));
        d.el.setAttribute('r', ocF(3 + 18 * ocEase(k))); d.el.setAttribute('opacity', ocOp(1 - k));
        return true;
      }
      const k = d.age / 1.7;
      if (k >= 1) { d.el.remove(); return false; }
      const dy = 90 * k * k + 12 * k, rot = d.rot * k, c = Math.cos(rot), s = Math.sin(rot);
      const Lp = [], R = [];
      d.pts.forEach((p, j) => {
        const wig = 4 * Math.sin(16 * d.age + j * 0.45) * (j / d.pts.length) * (1 - k);
        const x = p.x + p.nx * wig - d.ox, y = p.y + p.ny * wig - d.oy;
        const rx = x * c - y * s + d.ox, ry = x * s + y * c + d.oy + dy;
        const nx = p.nx * c - p.ny * s, ny = p.nx * s + p.ny * c;
        Lp.push(ocF(rx + nx * p.w / 2) + ' ' + ocF(ry + ny * p.w / 2));
        R.push(ocF(rx - nx * p.w / 2) + ' ' + ocF(ry - ny * p.w / 2));
      });
      d.el.setAttribute('d', 'M' + Lp.join('L') + 'L' + R.reverse().join('L') + 'Z');
      d.el.setAttribute('opacity', ocOp(1 - k * k));
      return true;
    });

    // Mürekkep: sıkıştırma anı
    inkP = inkP.filter((p) => {
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { p.el.remove(); return false; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 0.9; p.vy *= 1 - dt * 0.9;
      p.el.setAttribute('cx', ocF(p.x)); p.el.setAttribute('cy', ocF(p.y));
      p.el.setAttribute('r', ocF(ocLerp(p.r0, p.r1, ocEase(k))));
      p.el.setAttribute('opacity', ocOp(0.88 * Math.pow(1 - k, 1.3)));
      return true;
    });
    busy ||= pulses.length > 0 || debris.length > 0 || inkP.length > 0;

    // Baş: doluluk yeni ölçüme akar, atım gelince parlar, bekleyen kol varken sarıya döner, gözler hedefe döner
    if (ctx.t != null) {
      ctx.t += dt / 1.2;
      ctx.now = ocLerp(ctx.from, ctx.target, ocEase(ctx.t));
      if (ctx.t >= 1) { ctx.now = ctx.target; ctx.t = null; }
      busy = true;
    }
    headFlash = Math.max(0, headFlash - dt * 1.4);
    busy ||= headFlash > 0;
    const waiting = L.gHead.hasAttribute('data-waiting');
    L.waitWave = waiting ? Math.sin(clock * 3.2) : 0;
    busy ||= waiting;
    const look = gaze();
    L.eyes.forEach((e, i) => {
      e.px = ocLerp(e.px, look[i].x, Math.min(1, dt * 4));
      e.py = ocLerp(e.py, look[i].y, Math.min(1, dt * 4));
      busy ||= !near(e.px, look[i].x, 0.02) || !near(e.py, look[i].y, 0.02);
    });
    paintHead();
    return busy;
  }

  function frame(now) {
    raf = 0;
    if (!canAnimate()) { renderStatic(); return; }
    if (now - last < 1000 / OC_FPS - 2) { raf = requestAnimationFrame(frame); return; } // kare sınırı
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    stats.frames++;
    if (step(dt)) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!built || raf) return;
    if (!canAnimate()) return renderStatic();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  // ---------- Etiketler ----------
  // Etiketler bölme genişliğinden bağımsız aynı boyutta görünür (ölçek = viewBox / ekran genişliği). Yer, kolun yelpazedeki
  // ucunun (Tt) hizasında, durağan pozdaki uç bölgesinin altıdır (dalga etiketi oynatmaz). Kıvrılmış ucun ortası alınmaz:
  // iç kolların uçları merkeze kıvrılıp birbirine yaklaşıyor, etiketler sıralarını kaybediyordu. Değen etiket aşağı kayar;
  // uçları yukarıda kalan dış kollar önce yerleşir, böylece yelpazenin soldan sağa sırası korunur.
  function placeLabels(snap) {
    const wpx = svg.clientWidth;
    if (!wpx || !built) return;
    const k = OC_W / wpx;
    const items = order.filter((m) => !m.cutting).map((m) => {
      const mo = OC_MOTION[motionKey(m)];
      const P = ocGeom(m.Bt, m.Tt, mo, m.ph0, m.side, m.kind === 'bud' ? gTarget(m) : 1);
      const from = Math.round(P.length * 0.6);
      let my = -1e9;
      for (let j = from; j < P.length; j++) my = Math.max(my, P[j].y);
      return { m, ax: m.Tt.x, ay: my + 20 };
    });
    const placed = [];
    let bottom = OC_H;
    for (const it of items.sort((a, b) => a.ay - b.ay)) {
      const m = it.m;
      // Yalnız metinler ölçülür (arka plan dikdörtgeni ölçüye girerse her yerleşimde büyür)
      const [b1, b2] = [m.nEl, m.sEl].map((t) => t.getBBox());
      const bx = Math.min(b1.x, b2.x), by = b1.y;
      const bb = { x: bx, y: by, width: Math.max(b1.x + b1.width, b2.x + b2.width) - bx, height: b2.y + b2.height - by };
      const hw = (bb.width / 2 + 8) * k, top = (bb.y - 4) * k, hh = (bb.height + 8) * k;
      const x = ocClamp(it.ax, hw + 4, OC_W - hw - 4);
      let y = it.ay;
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((p) => Math.abs(p.x - x) < p.hw + hw && y + top < p.y + p.top + p.hh && p.y + p.top < y + top + hh);
        if (!hit) break;
        y = hit.y + hit.top + hit.hh - top + 2 * k;
      }
      const best = { x, y };
      placed.push({ x: best.x, y: best.y, hw, top, hh });
      m.ltx = best.x; m.lty = best.y; m.lk = k;
      if (snap || m.lx == null) { m.lx = best.x; m.ly = best.y; }
      m.bg.setAttribute('x', ocF(bb.x - 8)); m.bg.setAttribute('y', ocF(bb.y - 4));
      m.bg.setAttribute('width', ocF(bb.width + 16)); m.bg.setAttribute('height', ocF(bb.height + 8));
      m.lbl.setAttribute('transform', `translate(${ocF(m.lx)} ${ocF(m.ly)}) scale(${ocF(k * 100) / 100})`);
      bottom = Math.max(bottom, best.y + top + hh + 8);
    }
    svg.setAttribute('viewBox', `0 0 ${OC_W} ${Math.ceil(bottom)}`);
  }

  // Son sınavın puanı başın üstünde (kayıttaki exam; sinav.js). Genişlik yazıdan tahmin edilir: bölme gizliyken ölçülemez.
  function drawExam() {
    const ex = rec?.exam;
    L.gExam.replaceChildren();
    L.gExam.style.display = ex ? '' : 'none';
    if (!ex) return;
    const label = `Sınav ${ex.hit}/${ex.total}`;
    const w = label.length * 6.6 + 18;
    const low = ex.total && ex.hit / ex.total < 0.5;
    L.gExam.dataset.score = `${ex.hit}/${ex.total}`;
    svgEl('title', null, L.gExam).textContent = `Son sınav ${new Date(ex.at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: ` +
      `defterin ${ex.total} satırından ${ex.hit} tanesi hatırlandı` + (ex.missed?.length ? `. Hatırlanmayan: ${ex.missed.slice(0, 12).join(', ')}${ex.missed.length > 12 ? '…' : ''}` : '');
    svgEl('rect', { class: 'oc-exam-bg' + (low ? ' low' : ''), x: OC_HX - w / 2, y: 2, width: w, height: 19, rx: 9.5 }, L.gExam);
    svgEl('text', { class: 'oc-exam-t', x: OC_HX, y: 15.5, 'text-anchor': 'middle' }, L.gExam).textContent = label;
  }

  // ---------- Alt bilgi kutusu ve "Diğer kollar" ----------

  function infoFor(m) {
    focus = m ? m.id : null;
    info.replaceChildren();
    if (!rec) return;
    if (m?.kind === 'bud') {
      info.append(h('span', { class: 'oc-dot', style: 'background: var(--warn)' }),
        h('div', { class: 'oc-tx' },
          h('div', { class: 't' }, 'Öneri · ' + (m.title || 'Yeni kol')),
          h('div', { class: 'd' }, m.approved ? 'Onaylandı; kol açılıyor.' : 'Baş yeni bir kol açmak istiyor. Sohbetteki kartı onaylarsanız kol büyür.'),
          h('div', { class: 'm' }, m.approved ? 'başlıyor' : 'onayını bekliyor')),
        m.approved ? null : h('button', { class: 'mini', onclick: () => { showTab(tab.acctId, tab); m.card?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 'Karta git'));
      return;
    }
    const arm = m?.arm;
    if (!arm) {
      const n = (s) => rec.arms.filter((a) => a.state === s).length;
      const active = rec.arms.filter((a) => a.state !== 'cut' && a.state !== 'done').length;
      const parts = [['working', 'çalışıyor'], ['waiting', 'seni bekliyor'], ['reported', 'rapor verdi'], ['stopped', 'durdu']]
        .map(([s, l]) => (n(s) ? `${n(s)} ${l}` : '')).filter(Boolean);
      const pct = tab.context?.percentage;
      info.append(h('span', { class: 'oc-dot', style: 'background: var(--clay)' }),
        h('div', { class: 'oc-tx' },
          h('div', { class: 't' }, 'Beyin · ' + rec.project.name),
          h('div', { class: 'd' }, rec.arms.length
            ? 'Projenin ana oturumu. Kola tıklayınca o kolun sekmesi açılır; açık değilse "Devam et" ile açılır. Sağ tıklayınca kapatılır.'
            : 'Henüz kol yok. Baş bir yan oturum açınca kol burada belirir.'),
          h('div', { class: 'm' }, `${typeof pct === 'number' ? `bağlam %${pct} · ` : ''}${rec.exam ? `sınav ${rec.exam.hit}/${rec.exam.total} · ` : ''}${active} kol${parts.length ? ` (${parts.join(', ')})` : ''} · bitti ${n('done')} · kesilen ${n('cut')}`)));
      return;
    }
    const t = armTab(tab.acctId, arm);
    const st = armStatus(arm, t);
    info.append(h('span', { class: 'oc-dot', style: `background: ${OC_STATE_COL[arm.state] || 'var(--muted)'}` }),
      h('div', { class: 'oc-tx' },
        h('div', { class: 't' }, arm.title || arm.id),
        h('div', { class: 'd' }, (arm.lastReport || arm.brief || 'Henüz rapor yok.').slice(0, 400)),
        h('div', { class: 'm' }, [st.label, st.todos, arm.worktree ? 'dal ' + arm.worktree.branch : ''].filter(Boolean).join(' · '))),
      h('button', { class: 'mini', onclick: () => openArm(tab.acctId, rec, arm) }, t ? 'Sekmeye geç' : 'Devam et'));
  }

  function drawMore() {
    const shown = new Set(drawnArms(rec, tab.acctId));
    const rest = rec.arms.filter((a) => !shown.has(a));
    more.replaceChildren();
    if (!rest.length) return;
    more.append(h('div', { class: 'oc-more-title' }, `Diğer kollar (${rest.length})`),
      ...rest.slice().reverse().map((arm) => {
        const t = armTab(tab.acctId, arm);
        const st = armStatus(arm, t);
        return h('button', {
          class: 'octo-arm oc-more-arm', 'data-id': arm.id, 'data-state': arm.state, 'data-live': t ? '1' : null,
          title: arm.title, onclick: () => openArm(tab.acctId, rec, arm), oncontextmenu: (e) => armMenu(e, tab.acctId, rec, arm),
        }, h('span', { class: 'octo-dot' }), h('span', { class: 'octo-arm-title' }, arm.title || arm.id), h('span', { class: 'octo-arm-state' }, st.label));
      }));
  }

  // Önceki bedenler, yeniden yeniye: nasıl doğduğu ve hangi aralıkta baş olduğu
  function drawFossils() {
    const old = (rec.head.bodies || []).filter((b) => b.to && b.sessionId !== rec.head.sessionId).reverse();
    fossils.replaceChildren();
    if (!old.length) return;
    const day = (ts) => new Date(ts).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    fossils.append(h('div', { class: 'oc-more-title' }, `Fosiller (${old.length})`),
      ...old.map((b) => h('button', {
        class: 'octo-arm oc-fossil', 'data-session': b.sessionId, 'data-reason': b.reason,
        title: `Önceki beden · oturum ${b.sessionId}\nBaş bu oturuma danis ile danışabilir. Tıklayınca geçmişiyle düz bir sohbet olarak açılır.`,
        onclick: () => openFossil(tab.acctId, rec, b),
      }, h('span', { class: 'octo-dot' }), h('span', { class: 'octo-arm-title' }, `${day(b.from)} – ${day(b.to)}`),
      h('span', { class: 'octo-arm-state' }, BODY_REASONS[b.reason] || b.reason))));
  }

  // ---------- Görünürlük ----------

  const ro = new ResizeObserver(() => { placeLabels(true); if (built && !raf) renderStatic(); });
  ro.observe(svg);
  const io = new IntersectionObserver(() => { if (built) kick(); });
  io.observe(svg);
  const onVis = () => { if (built) kick(); };
  document.addEventListener('visibilitychange', onVis);
  reduceMq.addEventListener('change', onVis);

  const view = {
    el,
    stats,
    get running() { return !!raf; },
    // Kayıt, sekmeler, bekleyen kartlar ya da bağlam değişince; çizilecek bir şey değişmediyse dokunulmaz
    refresh() {
      rec = octoRecord(tab);
      const live = rec ? rec.arms.map((a) => (armTab(tab.acctId, a) ? 1 : 0)).join('') : '';
      const buds = pendingStarts(tab).map((s) => s.key + (s.approved ? '+' : '')).join();
      const s = JSON.stringify([rec, live, buds, tab.context?.percentage ?? null]);
      if (s === sig) return;
      sig = s;
      nameEl.textContent = rec ? rec.project.name : '';
      empty.hidden = !!rec;
      svg.style.display = rec ? '' : 'none';
      if (!rec) {
        empty.textContent = tab.octopusId ? 'Ahtapot ilk mesajla kurulur. Baş yan oturum açtıkça kollar burada görünür.' : 'Bu sohbet bir ahtapotun başı değil.';
        info.replaceChildren(); more.replaceChildren(); fossils.replaceChildren();
        return;
      }
      if (!built) build();
      sync();
      drawExam();
      drawMore();
      drawFossils();
      infoFor(M.get(focus) || null);
    },
    // Kolun tur sonu (yukarı) ya da başın kola yazdığı mesaj (aşağı); childId kolun sohbet kimliği
    pulse(childId, dir) {
      const sid = chatsById.get(childId)?.sessionId;
      const arm = sid && rec?.arms.find((a) => a.sessionId === sid);
      if (!arm || !canAnimate()) return;
      spawnPulse(M.get(arm.id), dir);
      kick();
    },
    ink,
    showPage,
    get page() { return page; },
    get defter() { return defter; },
    destroy() { defter?.destroy(); stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); reduceMq.removeEventListener('change', onVis); },
  };
  return view;
}

function openOctopusInChat(tab) {
  if (!tab || tab.kind !== 'chat' || !tab.octopusId) return;
  closeArtifactInChat(tab);
  closeSimulatorInChat(tab);
  closeBrowserInChat(tab);
  closeChangesInChat(tab);
  if (!tab.octoView) {
    tab.octoView = octopusView(tab);
    tab.octoPane.append(tab.octoView.el);
  }
  tab.host.classList.add('octo-open');
  tab.octoView.refresh();
}

function closeOctopusInChat(tab) {
  if (!tab?.octoView) return;
  tab.octoView.destroy();
  tab.octoView.el.remove();
  tab.octoView = null;
  tab.host.classList.remove('octo-open');
}

function toggleOctopusInChat(tab) {
  if (tab?.octoView) closeOctopusInChat(tab); else openOctopusInChat(tab);
}

// renderSidebar'ın sonunda: başın üst çubuğundaki "Ahtapot" düğmesi ve açık bölmeler (kayıt ya da sekmeler değişmiş olabilir)
function refreshOctopusPanes() {
  for (const list of Object.values(state.tabs)) {
    for (const t of list) {
      if (t.kind !== 'chat') continue;
      if (t.octoBtn) t.octoBtn.hidden = !t.octopusId;
      t.octoView?.refresh();
    }
  }
}
