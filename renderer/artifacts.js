/* Claude Panel — Artifacts: galeri, görüntüleyici, sohbet içi kartlar */

const art = {
  items: [],
  loaded: false,
  query: '',
  filter: 'all',  // 'all' | 'starred' | hesap id
  openId: null,   // galeride açık olan artifact
  viewers: new Set(),
};

const KIND_LABEL = { html: 'HTML', svg: 'SVG', md: 'Belge', code: 'Kod' };
const KIND_ICON = { html: 'globe', svg: 'layers', md: 'file', code: 'code' };
const artById = (id) => art.items.find((a) => a.id === id);
const kindLabel = (a) => (a.kind === 'code' && a.lang ? a.lang.toUpperCase() : KIND_LABEL[a.kind] || 'Artifact');
const viewUrl = (a, n) => `artifact://view/${a.id}/${n || a.latest}/`;

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'şimdi';
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`;
  if (s < 172800) return 'dün';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} gün önce`;
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));
}

async function loadArtifacts() {
  art.items = (await window.panel.artifactsList()) || [];
  art.loaded = true;
  renderNav();
  // "Yeni sohbet" ekranındaki son artifact'ler (yazılırken bozmamak için odaktaysa atla)
  for (const a of accounts()) {
    const p = state.panes[a.id];
    if (p && !p.launcher.contains(document.activeElement)) renderLauncher(a.id);
  }
  for (const v of [...art.viewers]) v.refresh();
  if (state.page === 'artifacts') {
    // Açık görüntüleyici kendini yeniler (sürüm/mod seçimi korunur); galeri ise animasyonsuz yeniden çizilir
    const page = $('#artifactsPage');
    const live = art.openId && artById(art.openId) && [...art.viewers].some((v) => page.contains(v.el));
    if (!live) renderArtifactsPage();
    renderTopbar();
  }
}

// ---------- Küçük yardımcılar: açılır menü, metin ve onay pencereleri ----------

function openMenu(anchor, items, cls = '') {
  const menu = h('div', { class: 'pop-menu ' + cls, role: 'menu' },
    items.filter(Boolean).map((it) => it === '-' ? h('div', { class: 'pop-sep' }) :
      it.header ? h('div', { class: 'pop-head' }, it.header) :
      h('button', { class: 'pop-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''), role: 'menuitem',
        onclick: (e) => { e.stopPropagation(); closeMenu(); it.onclick(); } },
      it.icon ? icon(it.icon, 15) : null,
      h('span', { class: 'pop-label' }, h('span', {}, it.label), it.desc ? h('small', {}, it.desc) : null),
      it.checked ? icon('check', 15, 'pop-check') : null)));
  openPopover(anchor, menu);
}

// Bir öğeyi düğmenin altında (sığmazsa üstünde) açar; dışarı tıklanınca ya da Esc ile kapanır
function openPopover(anchor, el) {
  closeMenu();
  document.body.append(el);
  el.place = () => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, r.bottom + 6 + hgt > window.innerHeight ? r.top - hgt - 6 : r.bottom + 6) + 'px';
  };
  el.place();
  openMenu.el = el;
  openMenu.anchor = anchor;
  setTimeout(() => document.addEventListener('mousedown', openMenu.outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); }), 0);
}

function closeMenu() {
  openMenu.el?.remove();
  openMenu.el = null;
  openMenu.anchor = null;
  if (openMenu.outside) document.removeEventListener('mousedown', openMenu.outside);
}

function dialogModal({ title, body, input, okLabel = 'Tamam', danger }) {
  return new Promise((resolve) => {
    const field = input != null ? h('input', { type: 'text', class: 'dlg-input', value: input, spellcheck: 'false' }) : null;
    const done = (v) => { modal.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const ok = () => done(field ? field.value.trim() || null : true);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(field ? null : false); }
      else if (e.key === 'Enter') { e.preventDefault(); ok(); }
    };
    const modal = h('div', { class: 'modal dlg' },
      h('div', { class: 'modal-card dlg-card' },
        h('h2', {}, title),
        body ? h('p', { class: 'dlg-body' }, body) : null,
        field,
        h('div', { class: 'modal-actions' },
          h('span', { class: 'spacer' }),
          h('button', { class: 'ghost-btn', onclick: () => done(field ? null : false) }, 'Vazgeç'),
          h('button', { class: 'primary-btn' + (danger ? ' danger-btn' : ''), onclick: ok }, okLabel))));
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) done(field ? null : false); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(modal);
    if (field) { field.focus(); field.select(); }
  });
}

// ---------- Ortak işlemler ----------

async function renameArtifact(a) {
  const title = await dialogModal({ title: 'Yeniden adlandır', input: a.title, okLabel: 'Kaydet' });
  if (!title || title === a.title) return;
  const r = await window.panel.artifactsUpdate(a.id, { title });
  if (!r.ok) toast('Adlandırılamadı: ' + r.error);
}

async function toggleStar(a) {
  await window.panel.artifactsUpdate(a.id, { starred: !a.starred });
}

async function deleteArtifact(a) {
  const ok = await dialogModal({
    title: 'Artifact silinsin mi?',
    body: `"${a.title}" ve ${a.versions.length > 1 ? `${a.versions.length} sürümü` : 'içeriği'} galeriden kalıcı olarak silinir. Kaynak dosyaya dokunulmaz.`,
    okLabel: 'Sil', danger: true,
  });
  if (!ok) return;
  const r = await window.panel.artifactsRemove(a.id);
  if (!r.ok) return toast('Silinemedi: ' + r.error);
  if (art.openId === a.id) art.openId = null;
  toast('Artifact silindi.');
}

async function downloadArtifact(a, n) {
  const r = await window.panel.artifactsDownload(a.id, n);
  if (!r.ok) toast('Kaydedilemedi: ' + r.error);
  else if (r.path) toast('Kaydedildi: ' + tilde(r.path));
}

async function copyArtifact(a, n) {
  const text = await window.panel.artifactsRead(a.id, n);
  if (text == null) return toast('Okunamadı.');
  await navigator.clipboard.writeText(text);
  toast('İçerik panoya kopyalandı.');
}

async function openArtifactExternal(a, n) {
  const r = await window.panel.artifactsOpenExternal(a.id, n);
  if (!r.ok) toast('Açılamadı: ' + r.error);
}

async function revealArtifact(a) {
  const r = await window.panel.artifactsReveal(a.id);
  if (!r.ok) toast(r.error);
}

// Kaynak sohbete (ya da kaynak klasörde yeni bir sohbete) düzenleme isteğiyle dön
function editWithClaude(a) {
  const src = a.source || {};
  const acctId = acct(src.accountId) ? src.accountId : state.active;
  const cwd = src.cwd || state.cfg.recents?.[acctId]?.[0];
  if (!cwd) return toast('Bu artifact\'in klasörü bilinmiyor; önce bir klasörde sohbet açın.');
  const draft = a.filePath
    ? `${a.filePath} dosyasındaki "${a.title}" artifact'inde şunu değiştir: `
    : `"${a.title}" artifact'ini (id: ${a.id}) publish_artifact ile güncelle: `;
  const open = src.sessionId && (state.tabs[acctId] || []).find((t) => t.kind === 'chat' && t.sessionId === src.sessionId && !t.exited);
  if (open) {
    selectAccount(acctId, 'code');
    activateTab(acctId, open);
    setDraft(open, draft);
  } else if (src.sessionId) createChatTab(acctId, cwd, 'resume', src.sessionId, { draft });
  else createChatTab(acctId, cwd, 'new', null, { draft });
}

function artifactMenuItems(a, n, extra = {}) {
  return [
    { icon: 'pencil', label: 'Yeniden adlandır', onclick: () => renameArtifact(a) },
    { icon: 'star', label: a.starred ? 'Yıldızı kaldır' : 'Yıldızla', onclick: () => toggleStar(a) },
    '-',
    { icon: 'chat', label: 'Claude ile düzenle', onclick: () => editWithClaude(a) },
    { icon: 'copy', label: 'İçeriği kopyala', onclick: () => copyArtifact(a, n) },
    { icon: 'download', label: 'İndir', onclick: () => downloadArtifact(a, n) },
    { icon: 'external', label: 'Tarayıcıda aç', onclick: () => openArtifactExternal(a, n) },
    a.filePath ? { icon: 'folder', label: 'Kaynak dosyayı Finder\'da göster', onclick: () => revealArtifact(a) } : null,
    extra.full ? { icon: 'artifacts', label: 'Galeride aç', onclick: () => openArtifact(a.id) } : null,
    '-',
    { icon: 'trash', label: 'Sil', danger: true, onclick: () => deleteArtifact(a) },
  ];
}

function sourceLine(a) {
  const src = a.source || {};
  const ac = acct(src.accountId);
  const folder = src.cwd ? tilde(src.cwd).split('/').pop() : '';
  return [ac ? h('span', { class: 'src-acct', style: `--c:${ac.color}` }, ac.name) : null, folder].filter(Boolean);
}

// ---------- Galeri ----------

function showArtifacts(id) {
  state.page = 'artifacts';
  if (id !== undefined) art.openId = id;
  document.body.dataset.page = 'artifacts';
  renderNav();
  renderSidebar();
  renderTopbar();
  renderArtifactsPage({ animate: true });
  if (!art.loaded) loadArtifacts();
}

function openArtifact(id) {
  showArtifacts(id);
}

function filteredArtifacts() {
  const q = art.query.trim().toLocaleLowerCase('tr');
  return art.items.filter((a) => {
    if (art.filter === 'starred' && !a.starred) return false;
    if (art.filter !== 'all' && art.filter !== 'starred' && a.source?.accountId !== art.filter) return false;
    if (q && !`${a.title} ${a.filePath || ''} ${a.lang || ''}`.toLocaleLowerCase('tr').includes(q)) return false;
    return true;
  });
}

function renderArtifactsPage({ animate } = {}) {
  const page = $('#artifactsPage');
  page.classList.toggle('animate', !!animate);
  const hadFocus = document.activeElement?.classList.contains('art-search-input');
  const caret = hadFocus ? document.activeElement.selectionStart : 0;
  for (const v of [...art.viewers]) if (page.contains(v.el)) v.destroy();

  const open = art.openId && artById(art.openId);
  if (art.openId && art.loaded && !open) art.openId = null;
  page.innerHTML = '';
  if (open) {
    const v = artifactViewer(open, { onBack: () => { art.openId = null; renderArtifactsPage({ animate: true }); renderTopbar(); } });
    page.append(v.el);
    page.classList.add('viewing');
    renderTopbar();
    return;
  }
  page.classList.remove('viewing');

  const search = h('input', {
    type: 'search', class: 'art-search-input', placeholder: 'Artifact ara…', value: art.query, spellcheck: 'false',
    oninput: (e) => { art.query = e.target.value; renderGrid(); },
  });
  const counts = { all: art.items.length, starred: art.items.filter((a) => a.starred).length };
  const chip = (key, label, color) => h('button', {
    class: 'art-chip' + (art.filter === key ? ' on' : ''), style: color ? `--c:${color}` : null,
    onclick: () => { art.filter = key; renderArtifactsPage({ animate: true }); },
  }, color ? h('span', { class: 'chip-dot' }) : null, label);

  const grid = h('div', { class: 'art-grid' });
  const renderGrid = () => {
    grid.innerHTML = '';
    const list = filteredArtifacts();
    if (!list.length) {
      grid.append(art.items.length
        ? h('div', { class: 'art-empty small-empty' }, 'Bu aramayla eşleşen artifact yok.')
        : emptyArtifacts());
      return;
    }
    for (const a of list) grid.append(artifactCard(a));
  };
  renderGrid();

  page.append(
    h('div', { class: 'art-page-inner' },
      h('div', { class: 'art-head' },
        h('div', {},
          h('h1', { class: 'art-h1' }, 'Artifacts'),
          h('div', { class: 'art-sub' }, 'Claude\'un bu panelde ürettiği sayfalar, görseller ve belgeler')),
        h('label', { class: 'art-search' }, icon('search', 16), search)),
      h('div', { class: 'art-filters' },
        chip('all', `Tümü · ${counts.all}`),
        chip('starred', `Yıldızlı · ${counts.starred}`),
        accounts().map((a) => chip(a.id, a.name, a.color))),
      grid));
  if (hadFocus) { search.focus(); search.setSelectionRange(caret, caret); }
}

function emptyArtifacts() {
  return h('div', { class: 'art-empty' },
    h('div', { class: 'art-empty-art' }, icon('artifacts', 40)),
    h('div', { class: 'art-empty-title' }, 'Henüz artifact yok'),
    h('div', { class: 'art-empty-text' },
      'Sohbette Claude bir HTML sayfası ya da SVG yazdığında burada kendiliğinden toplanır. ',
      'Claude\'dan "bunu artifact olarak yayımla" diye de isteyebilir, kod bloklarındaki ',
      h('b', {}, 'Artifact'), ' düğmesiyle kendiniz ekleyebilirsiniz.'),
    h('button', { class: 'primary-btn', onclick: () => newChat() }, 'Yeni sohbet başlat'));
}

function thumbEl(a, cls = 'art-thumb') {
  const v = a.versions[a.versions.length - 1];
  const ph = h('div', { class: 'thumb-ph' }, icon(KIND_ICON[a.kind] || 'file', 26), h('span', {}, kindLabel(a)));
  const box = h('div', { class: cls + ' kind-' + a.kind }, ph);
  if (v?.thumb) {
    const img = h('img', { src: `artifact://thumb/${a.id}/${v.n}/?t=${v.at}`, alt: '', draggable: 'false' });
    img.addEventListener('load', () => ph.remove());
    img.addEventListener('error', () => img.remove());
    box.prepend(img);
  }
  return box;
}

function artifactCard(a) {
  const more = h('button', { class: 'card-btn', title: 'Seçenekler', onclick: (e) => { e.stopPropagation(); openMenu(more, artifactMenuItems(a, a.latest)); } }, icon('more', 16));
  const star = h('button', { class: 'card-btn star' + (a.starred ? ' on' : ''), title: a.starred ? 'Yıldızı kaldır' : 'Yıldızla',
    onclick: (e) => { e.stopPropagation(); toggleStar(a); } }, icon('star', 15));
  return h('div', { class: 'art-card', tabindex: '0', 'data-id': a.id,
    onclick: () => openArtifact(a.id),
    onkeydown: (e) => { if (e.key === 'Enter') openArtifact(a.id); } },
    h('div', { class: 'art-thumb-wrap' },
      thumbEl(a),
      h('span', { class: 'kind-badge' }, kindLabel(a)),
      h('div', { class: 'card-actions' }, star, more)),
    h('div', { class: 'art-info' },
      h('div', { class: 'art-title', title: a.title }, a.title),
      h('div', { class: 'art-meta' },
        sourceLine(a).flatMap((x, i) => (i ? [h('span', { class: 'sep' }, '·'), x] : [x])),
        sourceLine(a).length ? h('span', { class: 'sep' }, '·') : null,
        h('span', {}, timeAgo(a.updatedAt)),
        a.versions.length > 1 ? h('span', { class: 'ver-pill' }, `v${a.latest}`) : null)));
}

// ---------- Görüntüleyici (galeride tam sayfa, sohbette yan bölme) ----------

function artifactViewer(item, { compact, onBack, onClose }) {
  let a = item;
  let n = a.latest;
  let followLatest = true;
  let mode = 'preview';
  const titleEl = h('button', { class: 'av-title', title: 'Yeniden adlandır', onclick: () => renameArtifact(a) });
  const verSel = h('select', { class: 'av-ver', title: 'Sürüm', onchange: (e) => { n = Number(e.target.value); followLatest = n === a.latest; renderBody(); } });
  const segBtn = (m, ic, label) => h('button', { 'data-m': m, title: label, onclick: () => { mode = m; renderBody(); } }, icon(ic, 15), h('span', {}, label));
  const seg = h('div', { class: 'av-seg' }, segBtn('preview', 'eye', 'Önizleme'), segBtn('code', 'code', 'Kod'));
  const starBtn = h('button', { class: 'icon-btn', onclick: () => toggleStar(a) }, icon('star', 16));
  const moreBtn = h('button', { class: 'icon-btn', title: 'Diğer', onclick: () => openMenu(moreBtn, artifactMenuItems(a, n, { full: compact })) }, icon('more', 16));
  const body = h('div', { class: 'av-body' });
  const foot = h('div', { class: 'av-foot' });

  const head = h('div', { class: 'av-head' },
    onBack ? h('button', { class: 'icon-btn', title: 'Galeriye dön (Esc)', onclick: onBack }, icon('back', 17)) : null,
    h('div', { class: 'av-title-wrap' }, titleEl, h('span', { class: 'kind-badge inline' })),
    verSel,
    h('span', { class: 'spacer' }),
    seg,
    h('span', { class: 'av-div' }),
    h('button', { class: 'icon-btn', title: 'İçeriği kopyala', onclick: () => copyArtifact(a, n) }, icon('copy', 16)),
    h('button', { class: 'icon-btn', title: 'İndir', onclick: () => downloadArtifact(a, n) }, icon('download', 16)),
    h('button', { class: 'icon-btn', title: 'Tarayıcıda aç', onclick: () => openArtifactExternal(a, n) }, icon('external', 16)),
    starBtn, moreBtn,
    onClose ? h('button', { class: 'icon-btn', title: 'Kapat', onclick: onClose }, icon('close', 16)) : null);

  const el = h('div', { class: 'art-viewer' + (compact ? ' compact' : ''), 'data-id': a.id }, head, body, foot);

  function renderHead() {
    titleEl.textContent = a.title;
    head.querySelector('.kind-badge').textContent = kindLabel(a);
    verSel.innerHTML = '';
    for (const v of [...a.versions].reverse()) {
      verSel.append(h('option', { value: v.n }, `Sürüm ${v.n}${v.n === a.latest ? ' · son' : ''} — ${timeAgo(v.at)}`));
    }
    verSel.value = n;
    verSel.hidden = a.versions.length < 2;
    seg.hidden = a.kind === 'code';
    starBtn.classList.toggle('on', !!a.starred);
    starBtn.title = a.starred ? 'Yıldızı kaldır' : 'Yıldızla';
    foot.innerHTML = '';
    foot.append(
      h('div', { class: 'av-src' },
        sourceLine(a).flatMap((x, i) => (i ? [h('span', { class: 'sep' }, '·'), x] : [x])),
        a.filePath ? h('span', { class: 'av-path', title: a.filePath }, tilde(a.filePath)) : null,
        h('span', { class: 'muted' }, `${timeAgo(a.updatedAt)} güncellendi`)),
      h('button', { class: 'ghost-btn small', onclick: () => editWithClaude(a) }, icon('chat', 14), 'Claude ile düzenle'));
  }

  let token = 0;
  async function renderBody() {
    for (const b of seg.children) b.classList.toggle('on', b.dataset.m === mode);
    const my = ++token;
    body.innerHTML = '';
    if (mode === 'code' && a.kind !== 'code') {
      const text = await window.panel.artifactsRead(a.id, n);
      if (my !== token) return;
      body.append(codeView(text ?? 'Okunamadı.'));
      return;
    }
    const frame = h('iframe', {
      class: 'av-frame kind-' + a.kind,
      src: viewUrl(a, n),
      // allow-same-origin yok: sayfa artifact:// adreslerini fetch ile okuyamaz (yalnız <img>, <link>, <script> yükler)
      sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads',
      title: a.title,
    });
    body.append(h('div', { class: 'av-frame-wrap' }, frame));
  }

  const viewer = {
    el,
    refresh() {
      const fresh = artById(a.id);
      if (!fresh) { viewer.destroy(); (onClose || onBack)?.(); return; }
      const grew = fresh.latest !== a.latest;
      a = fresh;
      if (grew && followLatest) { n = a.latest; renderHead(); renderBody(); }
      else renderHead();
    },
    destroy() { art.viewers.delete(viewer); el.remove(); },
  };
  art.viewers.add(viewer);
  renderHead();
  renderBody();
  return viewer;
}

function codeView(text) {
  const lines = String(text).replace(/\n$/, '').split('\n');
  const nums = h('div', { class: 'cv-nums' }, lines.map((_, i) => h('div', {}, i + 1)));
  const code = h('pre', { class: 'cv-code' }, text);
  return h('div', { class: 'code-view' }, nums, code);
}

// ---------- Sohbet içi kartlar ve yan bölme ----------

function chatArtifactCard(tab, info) {
  const sub = h('div', { class: 'ac-sub' });
  const title = h('div', { class: 'ac-title' });
  const tile = h('div', { class: 'ac-tile' });
  const card = h('div', { class: 'artifact-card', 'data-id': info.id, onclick: () => openArtifactInChat(tab, info.id) },
    tile,
    h('div', { class: 'ac-text' }, title, sub),
    h('span', { class: 'ac-open' }, 'Aç', icon('forward', 14)));
  card.update = (i) => {
    title.textContent = i.title;
    tile.innerHTML = '';
    tile.append(icon(KIND_ICON[i.kind] || 'file', 20));
    sub.textContent = `${KIND_LABEL[i.kind] || 'Artifact'} · ${i.created ? 'Artifacts\'e eklendi' : `Sürüm ${i.version}`}`;
  };
  card.update(info);
  return card;
}

function handleChatArtifact(chatId, info) {
  const tab = chatsById.get(chatId);
  loadArtifacts();
  if (!tab) return;
  tab.artCards = tab.artCards || new Map();
  const existing = tab.artCards.get(info.id);
  if (existing?.isConnected) {
    existing.update({ ...info, created: false });
    existing.classList.remove('flash');
    void existing.offsetWidth;
    existing.classList.add('flash');
  } else {
    markStarted(tab);
    endGroup(tab);
    const card = chatArtifactCard(tab, info);
    tab.artCards.set(info.id, card);
    append(tab, card);
  }
}

async function openArtifactInChat(tab, id) {
  if (!artById(id)) await loadArtifacts();
  const a = artById(id);
  if (!a) return toast('Artifact bulunamadı.');
  tab.artViewer?.destroy();
  const v = artifactViewer(a, { compact: true, onClose: () => closeArtifactInChat(tab) });
  tab.artViewer = v;
  tab.artPane.innerHTML = '';
  tab.artPane.append(v.el);
  tab.host.classList.add('art-open');
}

function closeArtifactInChat(tab) {
  tab.artViewer?.destroy();
  tab.artViewer = null;
  tab.host.classList.remove('art-open');
}

// Kod bloğunu artifact olarak kaydet (sohbet içi)
async function saveCodeAsArtifact(tab, code, lang) {
  const l = (lang || '').toLowerCase();
  const kind = ['html', 'htm'].includes(l) ? 'html' : l === 'svg' || (l === 'xml' && /<svg[\s>]/i.test(code)) ? 'svg' : ['md', 'markdown'].includes(l) ? 'md' : 'code';
  const title = await dialogModal({ title: 'Artifact olarak kaydet', input: defaultTitle(code, kind, l), okLabel: 'Kaydet' });
  if (!title) return;
  const r = await window.panel.artifactsAddContent({
    title, content: code, kind, lang: kind === 'code' ? l || 'txt' : '',
    source: tab ? { accountId: tab.acctId, cwd: tab.cwd, sessionId: tab.sessionId } : {},
  });
  if (!r.ok) return toast('Kaydedilemedi: ' + r.error);
  await loadArtifacts();
  if (tab) handleChatArtifact(tab.chatId, { id: r.id, title, kind, version: r.version, created: r.created });
  toast('Artifacts\'e eklendi.');
}

function defaultTitle(code, kind, lang) {
  const m = code.match(/<title[^>]*>([^<]+)<\/title>/i) || code.match(/^#{1,2}\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 80);
  return kind === 'code' ? `${(lang || 'Kod').toUpperCase()} parçası` : `${KIND_LABEL[kind]} artifact`;
}

async function addFileAsArtifact(tab, filePath) {
  const r = await window.panel.artifactsAddFile(filePath, { accountId: tab.acctId, cwd: tab.cwd, sessionId: tab.sessionId });
  if (!r.ok) return toast('Eklenemedi: ' + r.error);
  await loadArtifacts();
  const a = artById(r.id);
  handleChatArtifact(tab.chatId, { id: r.id, title: a?.title || filePath, kind: a?.kind, version: r.version, created: r.created });
}

window.panel.onArtifactsChanged(() => {
  clearTimeout(loadArtifacts._t);
  loadArtifacts._t = setTimeout(loadArtifacts, 60);
});
window.panel.onChatArtifact(handleChatArtifact);
