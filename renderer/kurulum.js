/* Claude Panel — sıfırdan kullanım (docs/octopus/OCTOPUS-PLANI.md P8.1).
   İlk açılış sihirbazı (openWelcome): hesap (varsayılan ~/.claude), giriş denetimi ve terminalde `claude /login`, ilk ahtapot.
   "Projeyi Octopus'a al" (openImportProject): var olan bir projeyi yalnız okuyarak tanır; beyin adayı, hafıza onayı, defter taslağı (alma.js).
   Hesap ayarları penceresindeki Octopus bölümü (octopusSettings): otomatik sıkıştırma, maliyet eşikleri, hafıza kapsamı, kol sınırı,
   "Hafızayı sil".
   Octopus tanıtımı (openOctopusIntro, P8.2): sihirbazın ikinci adımından, yeni sohbetin klasör menüsünden ve Yardım menüsünden açılır. */

const fmtBytes = (n) => (n >= 1e9 ? (n / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' GB'
  : n >= 1e6 ? (n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' MB'
    : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B');
const fmtDay = (ms) => new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DEFAULT_THRESHOLDS = { danis: 50000, sinav: 30000 }; // danis.js, sinav.js → THRESHOLD (K7)

// ---------- İlk açılış sihirbazı ----------

const welcome = { el: null, step: 1, login: null, resumeBar: null };

async function openWelcome() {
  const a = accounts()[0];
  // Sihirbaz yarıda kalsa da (giriş için terminale geçmek, paneli kapatmak) yeniden açılınca sürer
  state.cfg = await window.panel.saveConfig({ accounts: [a], lastAccount: a.id, welcome: 'pending' });
  welcome.step = 1;
  renderWelcome();
  checkLogin();
}

function closeWelcome() {
  welcome.el?.remove();
  welcome.el = null;
  welcome.resumeBar?.remove();
  welcome.resumeBar = null;
}

async function finishWelcome() {
  closeWelcome();
  state.cfg = await window.panel.saveConfig({ welcome: 'done' });
  focusCurrent();
}

// Hesap satırındaki değişiklik hemen kaydedilir (giriş denetimi kayıtlı hesabın ayar klasörüyle yapılır)
async function saveWelcomeAccount(patch) {
  const a = { ...accounts()[0], ...patch };
  state.cfg = await window.panel.saveConfig({ accounts: [a] });
  renderSidebar();
  renderLauncher(a.id);
  window.panel.rebuildMenu();
}

// Yalnız giriş kutusu yeniden çizilir: yazılmakta olan alanlar silinmesin
async function checkLogin() {
  const seq = (welcome.loginSeq = (welcome.loginSeq || 0) + 1);
  welcome.login = { state: 'checking' };
  renderLogin();
  const r = await window.panel.accountLogin(accounts()[0].id);
  if (seq !== welcome.loginSeq) return; // ayar klasörü değişti, yeni denetim sürüyor
  welcome.login = !r?.ok ? { state: 'error', error: r?.error || 'denetlenemedi' } : r.loggedIn ? { state: 'ok', email: r.email, plan: r.plan } : { state: 'no' };
  renderLogin();
}

function renderLogin() {
  const old = welcome.el?.querySelector('.wz-login');
  if (old) old.replaceWith(loginBox());
}

// Giriş terminalde yapılır: sihirbaz çekilir, altta "kuruluma dön" şeridi kalır
async function loginInTerminal() {
  const a = accounts()[0];
  welcome.el.hidden = true;
  welcome.resumeBar?.remove();
  welcome.resumeBar = h('div', { class: 'wz-resume' }, icon('terminal', 14),
    h('span', {}, 'Terminalde girişi tamamlayın, sonra kuruluma dönün.'),
    h('button', { class: 'primary-btn', onclick: () => { welcome.resumeBar.remove(); welcome.resumeBar = null; welcome.el.hidden = false; checkLogin(); } }, 'Kuruluma dön'));
  document.body.append(welcome.resumeBar);
  await launch(a.id, undefined, 'login');
}

function renderWelcome() {
  const a = accounts()[0];
  if (!welcome.el) {
    welcome.el = h('div', { class: 'modal wz' });
    document.body.append(welcome.el);
  }
  const steps = h('div', { class: 'wz-steps' },
    ['Hesap', 'İlk ahtapot'].map((t, i) => h('span', { class: 'wz-step' + (welcome.step === i + 1 ? ' on' : welcome.step > i + 1 ? ' done' : '') }, `${i + 1}. ${t}`)));
  const card = welcome.step === 1 ? welcomeAccount(a) : welcomeOctopus(a);
  welcome.el.replaceChildren(h('div', { class: 'modal-card wz-card' }, steps, card));
}

function loginBox() {
  const L = welcome.login || { state: 'checking' };
  const status = {
    checking: [h('span', { class: 'wz-dot' }), 'Giriş denetleniyor…'],
    ok: [h('span', { class: 'wz-dot ok' }), h('b', {}, 'Giriş yapılmış'), L.email ? ' · ' + L.email : '', L.plan ? ' · ' + L.plan : ''],
    no: [h('span', { class: 'wz-dot no' }), h('b', {}, 'Giriş yapılmamış.'), ' Claude Code bu hesapla henüz giriş yapmadı.'],
    error: [h('span', { class: 'wz-dot no' }), 'Giriş denetlenemedi: ' + (L.error || '')],
  }[L.state];
  return h('div', { class: 'wz-login', 'data-state': L.state }, h('div', { class: 'wz-login-line' }, status),
    L.state === 'no' || L.state === 'error'
      ? h('div', { class: 'wz-login-actions' },
          h('button', { class: 'ghost-btn small', onclick: loginInTerminal }, icon('terminal', 14), 'Terminalde giriş yap'),
          h('button', { class: 'ghost-btn small', onclick: checkLogin }, 'Yeniden denetle'),
          h('small', {}, 'Terminalde ', h('code', {}, 'claude /login'), ' açılır; tarayıcıda girişi onaylayıp buraya dönün.'))
      : null);
}

function welcomeAccount(a) {
  const field = (label, key, ph, small) => h('label', { class: 'wz-field' }, h('span', {}, label),
    h('input', { type: 'text', class: 'dlg-input', value: a[key] || '', placeholder: ph, spellcheck: 'false', 'data-key': key,
      onchange: async (e) => { await saveWelcomeAccount({ [key]: key === 'name' ? e.target.value.trim() || 'Claude' : e.target.value.trim() }); if (key === 'configDir') checkLogin(); } }),
    small ? h('small', {}, small) : null);
  return h('div', { class: 'wz-body' },
    h('h2', {}, 'Claude Panel\'e hoş geldiniz'),
    h('p', { class: 'dlg-body' }, 'Panel Claude Code\'u bu Mac\'te çalıştırır: sohbet görünümü, terminal, projelerin ahtapotları. Başlamak için tek hesap yeter.'),
    field('Hesabın adı', 'name', 'Claude'),
    field('Ayar klasörü', 'configDir', '~/.claude (varsayılan)',
      'Boş bırakılırsa Claude Code\'un varsayılan klasörü (~/.claude) kullanılır. Başka hesapları sonra Hesap ayarlarından ekleyebilirsiniz.'),
    loginBox(),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'ghost-btn', onclick: finishWelcome }, 'Kurulumu atla'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'primary-btn', onclick: () => { welcome.step = 2; renderWelcome(); } }, 'Devam')));
}

function welcomeOctopus(a) {
  const s = welcome.survey;
  let result = null;
  if (s === 'loading') result = h('p', { class: 'dlg-body' }, 'Klasörün geçmişine bakılıyor…');
  else if (s?.error) result = h('p', { class: 'dlg-body wz-err' }, s.error);
  else if (s) {
    const name = h('b', {}, s.project.name);
    const startNew = h('button', { class: s.sessions?.length ? 'ghost-btn' : 'primary-btn', onclick: () => startOctopusIn(a.id, s.project.cwd) },
      icon('octopus', 14), 'Octopus olarak başlat');
    result = s.octopusId
      ? h('div', { class: 'wz-result' }, h('p', { class: 'dlg-body' }, name, ' projesinin zaten bir ahtapotu var; kenar çubuğundaki "Ahtapotlar" listesinde.'),
          h('button', { class: 'primary-btn', onclick: finishWelcome }, 'Bitir'))
      : !s.sessions.length
        ? h('div', { class: 'wz-result' }, h('p', { class: 'dlg-body' }, name, ' yeni bir proje. İlk mesajınızla başlayan oturum projenin beyni olur.'), startNew)
        : h('div', { class: 'wz-result' },
            h('p', { class: 'dlg-body' }, name, ` klasöründe ${s.sessions.length} geçmiş oturum var. Var olan proje sormadan beyne çevrilmez: alırsanız panel yalnız okur, hiçbir oturum sıkıştırılmaz.`),
            h('div', { class: 'wz-result-actions' },
              h('button', { class: 'primary-btn', onclick: async () => {
                // Alma penceresi açıkken sihirbaz görünmez (iki pencere üst üste binmesin)
                welcome.el.hidden = true;
                const id = await openImportProject(a.id, s.project.cwd, s);
                if (id) finishWelcome(); else if (welcome.el) welcome.el.hidden = false;
              } },
                icon('octopus', 14), 'Projeyi Octopus\'a al'),
              startNew));
  }
  return h('div', { class: 'wz-body' },
    h('h2', {}, 'İlk ahtapotunuz'),
    h('p', { class: 'dlg-body' }, 'Bir projede ilk oturum projenin beyni (başı) olur, açtığı yan oturumlar kolları. Beynin hafızası sıkıştırmaya dayanıklıdır: ',
      'geçmiş oturumlar kelimesi kelimesine aranır, kararlar ve retler defterde durur. Bütün veri bu Mac\'te kalır.'),
    h('button', { class: 'link-btn wz-intro', onclick: openOctopusIntro }, icon('book', 13), 'Octopus nasıl çalışır?'),
    h('button', { class: 'ghost-btn wz-pick', onclick: () => pickWelcomeFolder(a.id) }, icon('folder', 15),
      s && s !== 'loading' && s.project ? tilde(s.project.cwd) : 'Proje klasörü seç…'),
    result,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'ghost-btn', onclick: () => { welcome.step = 1; renderWelcome(); } }, 'Geri'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'ghost-btn', onclick: finishWelcome }, 'Şimdilik geç')));
}

async function pickWelcomeFolder(acctId) {
  const dir = await window.panel.pickFolder(state.info.home);
  if (!dir) return;
  welcome.survey = 'loading';
  renderWelcome();
  const r = await window.panel.octopusSurvey(acctId, dir);
  welcome.survey = r?.ok ? r : { error: r?.error || 'Klasör okunamadı.' };
  renderWelcome();
}

// Yeni baş: sihirbaz kapanır, yeni sohbet ekranında klasör seçili ve "Octopus olarak başlat" açık; ilk mesajı kullanıcı yazar
async function startOctopusIn(acctId, dir) {
  await finishWelcome();
  await rememberFolder(acctId, dir);
  state.newFolder[acctId] = dir;
  state.newWorktree[acctId] = false;
  octo.choice[octoKey(acctId, dir)] = true; // renderer/octopus.js
  selectAccount(acctId, 'code');
  showLauncher(acctId);
  renderLauncher(acctId);
  state.panes[acctId]?.launcher.querySelector('.new-input')?.focus();
}

// ---------- Octopus tanıtımı (P8.2) ----------
// Kısa, düz bir anlatım: kavramlar, sıkıştırma kuralı, verinin yeri. Ayrıntısı README'de.

const INTRO_CARDS = [
  ['octopus', 'Baş ve kollar', 'Projenin ilk oturumu baş (beyin) olur: yönü tutar, işi böler, sonuçları denetler. Başın açtığı yan oturumlar kollardır. ' +
    'Her kolun durumu başın yanındaki ahtapot bölmesinde görünür; kola tıklayınca o sohbet açılır. Kolları yalnız baş açar, aynı anda en çok 8 kol çalışır.'],
  ['book', 'Defter', 'Kurallar, retler, zevkiniz, kararlar ve açık işler defterde durur. Baş yazar; siz Defter sekmesinde düzenler, sabitler ya da geri alırsınız. ' +
    'Defterin özeti oturum açılırken ve her sıkıştırmadan sonra başın önüne konur; kollar işleriyle ilgili kuralları ilk mesajlarında alır.'],
  ['search', 'Hafıza', 'Projenin geçmiş oturumları bu Mac\'te dizinlenir ve kalıcı bir arşive kopyalanır. Baş, bağlamından düşen bir şeyi "hatırla" aracıyla ' +
    'kelimesi kelimesine arar; gerekirse geçmiş bir ana ya da kapanmış bir kola tek bir soru sorar (danış).'],
  ['layers', 'Sıkıştırma sizin onayınızla', 'Bağlam dolunca Claude Code konuşmayı özetler; özet retleri ve ilk görevi kaybedebilir. Panel bunu sormadan yapmaz: ' +
    'bir kart açılır, talimatla sıkıştırırsınız ya da başı yeniden doğurursunuz (devir notuyla temiz bir oturum). Ardından kısa bir sınav neyin hatırlandığını ölçer, ' +
    'unutulanlar sonraki mesajda masaya konur. Token harcayan her işin önce tahmini bedeli görünür.'],
  ['lock', 'Veri bu Mac\'te', 'Ahtapot kayıtları, defter, dizin ve arşiv panelin klasöründe, yalnız sizin okuyabileceğiniz dosyalarda durur. Panel bunları hiçbir yere göndermez; ' +
    'Claude\'a giden yalnız sohbetin kendisi ve Claude\'un aradığı parçalardır. Bilinen gizli anahtar biçimleri dizine girmeden maskelenir. ' +
    'Hesap ayarları → Octopus\'tan hafızayı kapatabilir ya da silebilirsiniz.'],
];

function openOctopusIntro() {
  document.querySelector('.modal.intro')?.remove();
  const modal = h('div', { class: 'modal intro' });
  const done = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) done(); });
  document.addEventListener('keydown', onKey, true);
  modal.append(h('div', { class: 'modal-card intro-card' },
    h('div', { class: 'modal-head' }, h('h2', {}, 'Octopus nasıl çalışır?'), h('button', { class: 'icon-btn', title: 'Kapat', onclick: done }, '✕')),
    h('p', { class: 'dlg-body' }, 'Octopus bir projenin ana oturumunu uzun ömürlü yapar. Claude ne kadar çalışırsa çalışsın, sizinle vardığı kararları ve reddettiklerinizi unutmasın diye.'),
    h('div', { class: 'intro-list' }, ...INTRO_CARDS.map(([ic, title, text]) =>
      h('div', { class: 'intro-item' }, h('span', { class: 'intro-ic' }, icon(ic, 16)), h('div', {}, h('h3', {}, title), h('p', {}, text))))),
    h('p', { class: 'intro-start' }, h('b', {}, 'Başlamak için: '), 'Yeni sohbet ekranında klasör menüsünden "Octopus olarak başlat"ı açın; ilk mesajınızla başlayan oturum beyin olur. ',
      'Geçmişi olan bir projede "Projeyi Octopus\'a al" var olan oturumlardan birini beyin yapar; panel yalnız okur.'),
    h('div', { class: 'modal-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'primary-btn', onclick: done }, 'Anladım'))));
  document.body.append(modal);
  return modal;
}

// ---------- Projeyi Octopus'a al (alma.js) ----------
// Panel yalnız okur. Onaylanınca yalnız panelin kaydı açılır: baş seçilen oturum, hafıza onayı, içe aktarma desenleri.
// Ahtapotun kimliğini döner (vazgeçilirse null).

function openImportProject(acctId, dir, known) {
  return new Promise((resolve) => {
    let createdId = null;
    const modal = h('div', { class: 'modal alma' });
    const card = h('div', { class: 'modal-card alma-card' });
    modal.append(card);
    const done = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); resolve(createdId); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) done(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(modal);

    const head = (s) => h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Projeyi Octopus\'a al'), s?.project ? h('div', { class: 'alma-path' }, h('b', {}, s.project.name), ' · ', tilde(s.project.key)) : null),
      h('button', { class: 'icon-btn', title: 'Kapat', onclick: done }, '✕'));
    const closeOnly = (s, text) => card.replaceChildren(head(s), h('p', { class: 'dlg-body' }, text),
      h('div', { class: 'modal-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'primary-btn', onclick: done }, 'Kapat')));

    const render = (s) => {
      if (!s.ok) return closeOnly(null, s.error || 'Klasör okunamadı.');
      if (s.octopusId) return closeOnly(s, 'Bu projenin zaten bir ahtapotu var; kenar çubuğundaki "Ahtapotlar" listesinden açın.');
      if (!s.sessions.length) return closeOnly(s, 'Bu klasörde geçmiş oturum yok. Yeni sohbet ekranında "Octopus olarak başlat" ile başlayın; ilk oturum beyin olur.');
      const pick = h('select', { class: 'alma-session' }, s.sessions.map((x, i) =>
        h('option', { value: x.sessionId }, `${fmtDay(x.at)} · ${x.title || 'adsız oturum'}${i === 0 ? ' (en son)' : ''}`)));
      const mem = h('input', { type: 'checkbox', class: 'alma-memory', checked: true });
      const imps = s.imports.map((p) => ({ p, box: h('input', { type: 'checkbox', checked: true, 'data-pattern': p.pattern }) }));
      const err = h('p', { class: 'dlg-body wz-err', hidden: true });
      const go = h('button', { class: 'primary-btn alma-go', onclick: async () => {
        go.disabled = true;
        const r = await window.panel.octopusImport(acctId, {
          cwd: s.project.cwd, sessionId: pick.value, memory: mem.checked, imports: imps.filter((x) => x.box.checked).map((x) => x.p.pattern),
        });
        if (!r?.ok) { go.disabled = false; err.hidden = false; err.textContent = r?.error || 'Kurulamadı.'; return; }
        createdId = r.id;
        await loadOctopi(acctId);
        const rec = (octo.lists[acctId] || []).find((x) => x.id === r.id);
        card.replaceChildren(head(s),
          h('p', { class: 'dlg-body alma-done' }, icon('octopus', 15), h('span', {}, h('b', {}, s.project.name), ' ahtapotu kuruldu. Baş, seçtiğiniz oturumdan "Devam et" ile sürer; kenar çubuğundaki "Ahtapotlar" listesinde.')),
          h('div', { class: 'modal-actions' }, h('span', { class: 'spacer' }),
            h('button', { class: 'ghost-btn', onclick: done }, 'Kapat'),
            h('button', { class: 'primary-btn', onclick: () => { done(); if (rec) openOctopus(acctId, rec); } }, 'Başı aç')));
      } }, 'Ahtapotu kur');
      card.replaceChildren(head(s),
        h('p', { class: 'alma-note' }, icon('lock', 14), h('span', {}, 'Panel yalnız okur: hiçbir oturum sıkıştırılmaz, projeye ve Claude Code ayarlarına hiçbir şey yazılmaz. Yalnız panelin ahtapot kaydı açılır.')),
        h('div', { class: 'alma-sec' }, h('h3', {}, 'Beyin'),
          pick,
          h('small', {}, `Ahtapot bu oturumdan devam eder (${s.sessions.length} geçmiş oturumdan en sonuncusu önerildi). Açmak token harcamaz; ilk mesajınızla sürer.`)),
        h('div', { class: 'alma-sec' }, h('h3', {}, 'Hafıza'),
          h('label', { class: 'alma-check' }, mem, h('span', {}, 'Geçmişi hafızaya al')),
          h('small', {}, `${s.memory.files} oturum dosyası (${fmtBytes(s.memory.bytes)}) dizinlenir ve kalıcı arşive kopyalanır; beyin "hatırla" aracıyla kelimesi kelimesine arar. `,
            'Dizin ve arşiv yalnız bu Mac\'te, panelin klasöründe durur, gizli anahtarlar maskelenir. Ayarlardan kapatıp silebilirsiniz.')),
        h('div', { class: 'alma-sec' }, h('h3', {}, 'Defter taslağı'),
          imps.length
            ? [h('small', {}, 'Projedeki karar dosyaları defterde satır olarak görünür; dosyalar yalnız okunur. Sonra Defter sekmesindeki "Dosyalardan al" ile değiştirebilirsiniz.'),
               ...imps.map(({ p, box }) => h('div', { class: 'alma-imp' },
                 h('label', { class: 'alma-check' }, box, h('code', {}, p.pattern), h('span', { class: 'muted' }, ` · ${p.count} dosya, ${p.open} açık`)),
                 h('ul', { class: 'alma-sample' }, p.sample.map((r) => h('li', { 'data-status': r.status }, h('b', {}, r.id), ' ', r.text)),
                   p.count > p.sample.length ? h('li', { class: 'muted' }, `… ${p.count - p.sample.length} satır daha`) : null)))]
            : h('small', {}, 'Projede karar dosyası klasörü bulunamadı (docs/kararlar, docs/adr, decisions…). Defter boş başlar, beyin çalıştıkça dolar. ',
                'Kendi deseninizi sonra Defter sekmesindeki "Dosyalardan al" ile ekleyebilirsiniz.')),
        err,
        h('div', { class: 'modal-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'ghost-btn', onclick: done }, 'Vazgeç'), go));
    };

    if (known?.ok && known.project?.cwd === dir) render(known);
    else {
      card.replaceChildren(head(null), h('p', { class: 'dlg-body' }, 'Klasörün geçmişine bakılıyor…'));
      window.panel.octopusSurvey(acctId, dir).then((s) => (modal.isConnected ? render(s || { ok: false }) : null));
    }
  });
}

// ---------- Hesap ayarları: Octopus bölümü ----------

function octopusSettings() {
  const save = (patch) => window.panel.saveConfig(patch).then((c) => { state.cfg = c; });
  const sec = h('div', { class: 'set-sec', id: 'octoSettings' }, h('h3', { class: 'set-title' }, icon('octopus', 15), 'Octopus'));

  // Otomatik sıkıştırma (compaction.js): "Her zaman sor"da Claude Code'un kendi sıkıştırması bloklanır, sohbette onay kartı açılır
  const compactSel = h('select', { id: 'autoCompact', onchange: (e) => save({ autoCompact: e.target.value }) },
    h('option', { value: 'ask' }, 'Her zaman sor'), h('option', { value: 'allow' }, 'İzin ver'));
  compactSel.value = state.cfg.autoCompact === 'allow' ? 'allow' : 'ask';
  sec.append(h('label', { class: 'acct-form-opt acct-form-select' }, h('span', {}, 'Otomatik sıkıştırma'), compactSel,
    h('small', {}, 'Bağlam dolunca Claude Code sohbeti kendiliğinden özetler. "Her zaman sor"da sizin onayınız olmadan özetlenmez; kartta talimatla sıkıştırabilirsiniz.')));

  // Maliyet eşikleri (K7): boş = varsayılan
  const th = state.cfg.thresholds || {};
  const num = (key, label, small) => {
    const inp = h('input', { type: 'number', min: 0, step: 1000, class: 'set-input set-num', id: 'threshold-' + key, value: th[key] ?? '',
      placeholder: DEFAULT_THRESHOLDS[key].toLocaleString('tr-TR'),
      onchange: (e) => save({ thresholds: { [key]: e.target.value } }).then(() => { e.target.value = state.cfg.thresholds?.[key] ?? ''; }) });
    return h('label', { class: 'acct-form-opt acct-form-select' }, h('span', {}, label), inp, h('small', {}, small));
  };
  sec.append(
    num('danis', 'Danışma onayı (token)', 'Geçmiş beyne danışmanın tahmini bu sayıyı aşarsa önce sorulur. Boş: 50.000.'),
    num('sinav', 'Sınav onayı (token)', 'Sıkıştırmadan sonraki sınavın tahmini bu sayıyı aşarsa önce sorulur; altındaysa kendiliğinden yapılır. Boş: 30.000.'));

  // Hafıza kapsamı ve kol sınırı: ahtapotlar ve hafızaya alınan diğer projeler
  const list = h('div', { class: 'set-mem', id: 'memScope' }, h('p', { class: 'muted small' }, 'Yükleniyor…'));
  sec.append(h('div', { class: 'acct-form-opt set-block' }, h('span', {}, 'Hafıza ve kollar'),
    h('small', {}, 'Hafızası açık projelerin oturumları dizinlenir (ahtapotlarda ayrıca kalıcı arşive kopyalanır). Kapatılan proje dizinden düşer; arşiv kopyası kalır. Kol sınırı aynı anda çalışan kol sayısıdır (1–8).'),
    list));
  const refresh = async () => {
    const r = await window.panel.hafizaKapsam();
    const rows = (r?.rows || []).map((x) => {
      const memBox = h('input', { type: 'checkbox', checked: x.memory, title: 'Hafıza', 'data-key': x.key,
        onchange: async (e) => {
          e.target.disabled = true;
          const res = await window.panel.octopusSettings(x.octoId, { memory: e.target.checked });
          if (!res?.ok) toast(res?.error || 'Kaydedilemedi.');
          refresh();
        } });
      const arms = x.kind === 'octopus'
        ? h('input', { type: 'number', min: 1, max: 8, value: x.maxArms, class: 'set-input set-arms', title: 'Kol sınırı',
            onchange: async (e) => {
              const res = await window.panel.octopusSettings(x.octoId, { maxArms: +e.target.value });
              if (!res?.ok) { toast(res?.error || 'Kaydedilemedi.'); e.target.value = x.maxArms; } else x.maxArms = res.settings.maxArms;
            } })
        : h('span', { class: 'muted small' }, '—');
      return h('div', { class: 'set-mem-row', 'data-kind': x.kind },
        h('div', { class: 'set-mem-name' }, x.kind === 'octopus' ? icon('octopus', 13) : icon('folder', 13), h('b', {}, x.name),
          h('span', { class: 'muted' }, ` · ${x.account}`), h('small', { title: x.key }, tilde(x.key))),
        h('span', { class: 'set-mem-count muted small' }, x.memory ? (x.sessions == null ? '…' : `${x.sessions} oturum`) : 'kapalı'),
        x.kind === 'octopus' ? h('label', { class: 'set-mem-toggle' }, memBox, 'Hafıza') : h('span', { class: 'muted small' }, 'Hafıza'),
        h('label', { class: 'set-mem-arms' }, arms, x.kind === 'octopus' ? 'kol' : ''),
        x.kind === 'extra'
          ? h('button', { class: 'icon-btn', title: 'Hafızadan çıkar', onclick: async () => { await window.panel.memoryRemove(x.accountId, x.key); refresh(); } }, '✕')
          : h('span', {}));
    });
    list.replaceChildren(
      ...(rows.length ? rows : [h('p', { class: 'muted small' }, 'Henüz ahtapot ya da hafızaya alınan proje yok.')]),
      h('div', { class: 'set-mem-foot' },
        h('button', { class: 'ghost-btn small', onclick: async () => {
          const dir = await window.panel.pickFolder(state.info.home);
          if (!dir) return;
          const res = await window.panel.memoryAdd(state.active, dir);
          if (!res?.ok) toast(res?.error || 'Eklenemedi.');
          refresh();
        } }, icon('plus', 13), `Proje ekle (${acct(state.active)?.name || ''})`),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small set-sizes' }, `Dizin ${fmtBytes(r?.dbBytes || 0)} · Arşiv ${fmtBytes(r?.archiveBytes || 0)}`),
        h('button', { class: 'ghost-btn small danger', id: 'memWipe', onclick: async () => {
          const ok = await dialogModal({
            title: 'Hafıza silinsin mi?',
            body: 'Hafıza dizini ve kalıcı arşiv bu Mac\'ten silinir. Ahtapot kayıtları, defterler ve Claude Code\'un kendi oturum dosyaları kalır. ' +
              'Hafızası açık projeler bir sonraki taramada yeniden dizinlenir; kaynağı silinmiş oturumların arşivi geri gelmez. Hiçbir projeyi yeniden dizinlemek istemiyorsanız önce hafızalarını kapatın.',
            okLabel: 'Hafızayı sil', danger: true,
          });
          if (!ok) return;
          const res = await window.panel.hafizaSil();
          toast(res?.ok ? 'Hafıza silindi.' : 'Silinemedi: ' + (res?.error || ''));
          refresh();
        } }, 'Hafızayı sil')));
  };
  refresh();
  return sec;
}
