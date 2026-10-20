/* Claude Panel — arayüz */
const $ = (s, el = document) => el.querySelector(s);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const state = {
  page: 'account', // 'account' | 'artifacts'
  info: { home: '', ptyOk: true },
  cfg: { accounts: [], recents: {} },
  active: null,
  newFolder: {},   // acctId -> "Yeni sohbet" ekranında seçili klasör
  newDraft: {},    // acctId -> yazılmış ama gönderilmemiş ilk mesaj
  newAttach: {},   // acctId -> ilk mesajın ekleri (dosya ve fotoğraflar)
  newWorktree: {}, // acctId -> yeni sohbet ayrı çalışma kopyasında mı (git worktree)
  view: {},        // acctId -> 'code' | 'chat'
  tabs: {},        // acctId -> [tab]
  activeTab: {},   // acctId -> tab | null  (null = başlatıcı)
  lastTerm: {},    // acctId -> kullanıcının en son baktığı terminal sekmesi (Claude'un terminal aracı varsayılan olarak bunu okur)
  panes: {},       // acctId -> DOM refs
  fontSize: 13,
  settingsTab: 'accounts', // Ayarlar penceresinde son açılan sekme (openSettings)
};
const tabsById = new Map();
const pendingData = new Map();

// Terminal renkleri temaya göre (zemin stillerdeki --canvas). Açıkta "white" gridir: açık zeminde beyaz yazı görünmezdi.
const TERM_THEMES = {
  dark: {
    background: '#100f0d', foreground: '#f2ecdf', cursor: '#cdb07a', cursorAccent: '#100f0d',
    selectionBackground: '#3d3527',
    black: '#2a2824', red: '#e5645a', green: '#8fbf7f', yellow: '#e2b86b', blue: '#7aa2f7',
    magenta: '#c49be0', cyan: '#6fc1c1', white: '#d8d3ca',
    brightBlack: '#6b665d', brightRed: '#f07f75', brightGreen: '#a6d494', brightYellow: '#f0cd8a',
    brightBlue: '#97b8ff', brightMagenta: '#d7b3ef', brightCyan: '#8ad6d6', brightWhite: '#ffffff',
  },
  light: {
    background: '#efeadf', foreground: '#1f1b15', cursor: '#9c7a3c', cursorAccent: '#efeadf',
    selectionBackground: '#ddd1b8',
    black: '#1f1b15', red: '#b8322a', green: '#3f7a2e', yellow: '#8a6512', blue: '#2f5fbf',
    magenta: '#8a4fae', cyan: '#1f7a7a', white: '#7a7264',
    brightBlack: '#8a8272', brightRed: '#d0463d', brightGreen: '#4f8f3a', brightYellow: '#a87c1c',
    brightBlue: '#4a78d4', brightMagenta: '#a066c4', brightCyan: '#2f9393', brightWhite: '#3f392f',
  },
};
// Tema ana süreçte seçilir (nativeTheme); arayüz yalnız prefers-color-scheme'i izler
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const termTheme = () => TERM_THEMES[darkQuery.matches ? 'dark' : 'light'];
darkQuery.addEventListener('change', () => {
  for (const list of Object.values(state.tabs)) {
    for (const t of list) if (t.kind === 'term') t.term.options.theme = termTheme();
  }
});

const accounts = () => state.cfg.accounts;
const acct = (id) => accounts().find((a) => a.id === id);
const tilde = (p) => (state.info.home && p.startsWith(state.info.home) ? '~' + p.slice(state.info.home.length) : p);

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Kenar çubuğu ve üst bar ----------

// Hesaplar bir ağaç gibi: etkin hesabın altında iki görünümü (Yerel Code, Web) açılır.
// Hesabın rengi etkin satırda "yanar"; aynı renk çalışma alanının üstündeki ışıkta da var.
function renderSidebar() {
  const nav = $('#accounts');
  nav.innerHTML = '';
  accounts().forEach((a, i) => {
    const tabs = state.tabs[a.id] || [];
    const running = tabs.filter((t) => !t.exited).length;
    const attention = tabs.some((t) => t.attention);
    const view = state.view[a.id] || 'code';
    const isActive = state.page === 'account' && state.active === a.id;

    const viewRow = (v, ic, label, count) =>
      h('button', {
        class: `acct-view ${isActive && view === v ? 'on' : ''}`,
        title: v === 'code' ? 'Claude Code bu Mac\'te çalışır (⌘K ile geç)' : 'claude.ai: sohbet ve bulut oturumları (⌘K ile geç)',
        onclick: (e) => { e.stopPropagation(); selectAccount(a.id, v); },
      }, icon(ic, 14), h('span', {}, label), count ? h('span', { class: 'acct-view-count' }, count) : null);

    nav.append(
      h('div', {
        class: `acct ${isActive ? 'active' : ''}`, style: `--c:${a.color}`, onclick: () => selectAccount(a.id),
        title: [a.note, tilde(a.configDir || '~/.claude')].filter(Boolean).join('\n'),
      },
        h('div', { class: 'acct-row' },
          h('span', { class: 'avatar' }, (a.name || '?').trim().charAt(0).toLocaleUpperCase('tr')),
          h('span', { class: 'acct-name' }, a.name),
          attention ? h('span', { class: 'pulse', title: 'Claude sizi bekliyor' }) : null,
          running && !isActive ? h('span', { class: 'badge', title: `${running} açık oturum` }, running) : null,
          i < 9 ? h('span', { class: 'acct-kbd' }, `⌘${i + 1}`) : null),
        isActive
          ? h('div', { class: 'acct-views' }, viewRow('code', 'terminal', 'Yerel Code', running), viewRow('chat', 'globe', 'Web'))
          : null,
        isActive ? octopusSidebar(a.id) : null) // renderer/octopus.js
    );
  });
  refreshOctopusPanes(); // sekmeler ya da kayıt değişti: başın "Ahtapot" düğmesi ve açık ahtapot bölmeleri
}

function renderNav() {
  const onArtifacts = state.page === 'artifacts';
  const onNew = !onArtifacts && state.view[state.active] === 'code' && !state.activeTab[state.active];
  $('#navArtifacts').classList.toggle('on', onArtifacts);
  $('#navNew').classList.toggle('on', onNew);
  $('#artCount').textContent = art.items.length || '';
}

// Statik HTML'deki data-icon yer tutucularını ikonlarla doldur
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (!el.firstChild) el.append(icon(el.dataset.icon, el.classList.contains('nav-ic') ? 18 : 15));
  }
}

// ---------- Hesap panelleri ----------

function ensurePane(a) {
  if (state.panes[a.id]) return state.panes[a.id];

  const tabsEl = h('div', { class: 'tabs' });
  // Yeni sohbet ekranı açıkken bu düğme kendisi bir sekme gibi görünür (etiketiyle)
  const addBtn = h('button', { class: 'tab-add', title: 'Yeni sohbet (⌘N)', onclick: () => showLauncher(a.id) },
    icon('plus', 15), h('span', { class: 'tab-add-label' }, 'Yeni sohbet'));
  const launcher = h('div', { class: 'launcher' });
  const termArea = h('div', { class: 'term-area' }, launcher);
  const code = h('div', { class: 'code-pane' }, h('div', { class: 'tabbar' }, tabsEl, addBtn), termArea);
  const chat = h('div', { class: 'chat-pane' });
  // .aura: hesabın renginde, alanın üstünden yayılan yumuşak ışık (hangi hesaptasınız, bir bakışta)
  const root = h('div', { class: 'acct-pane', 'data-acct': a.id, 'data-view': 'code' }, h('div', { class: 'aura' }), code, chat);
  $('#stage').append(root);

  const pane = { root, code, tabsEl, addBtn, termArea, launcher, chat, webview: null };
  state.panes[a.id] = pane;
  state.tabs[a.id] = state.tabs[a.id] || [];
  state.view[a.id] = state.view[a.id] || 'code';
  state.activeTab[a.id] = null;

  new ResizeObserver(() => fitActive(a.id)).observe(termArea);
  renderLauncher(a.id);
  renderTabs(a.id);
  return pane;
}

function selectAccount(id, view) {
  if (!acct(id)) return;
  const changed = state.active !== id;
  state.page = 'account';
  document.body.dataset.page = 'account';
  state.active = id;
  if (view) state.view[id] = view;
  for (const [aid, p] of Object.entries(state.panes)) {
    p.root.classList.toggle('active', aid === id);
    p.root.dataset.view = state.view[aid];
  }
  if (state.view[id] === 'chat') ensureWebview(id);
  if (!acctInfo[id]?.at && !acctInfo[id]?.loading) loadAccountInfo(id); // model listesi + kullanım
  renderSidebar();
  renderNav();
  focusCurrent();
  if (changed) window.panel.saveConfig({ lastAccount: id });
}

function newChat() {
  showLauncher(state.active);
  requestAnimationFrame(() => state.panes[state.active]?.launcher.querySelector('.new-input')?.focus());
}

function setView(view) {
  selectAccount(state.active, view);
}

function focusCurrent() {
  const id = state.active;
  requestAnimationFrame(() => {
    if (state.page !== 'account') return;
    if (state.view[id] === 'code') {
      const t = state.activeTab[id];
      if (t) {
        clearFlags(t);
        if (t.kind === 'chat') t.input?.focus();
        else { fitTab(t); t.term.focus(); }
      }
    } else {
      state.panes[id]?.webview?.focus();
    }
  });
}

// ---------- Yeni sohbet ekranı (başlatıcı) ----------

function greeting() {
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 12) return 'Günaydın';
  if (hr >= 12 && hr < 18) return 'İyi günler';
  if (hr >= 18 && hr < 23) return 'İyi akşamlar';
  return 'İyi geceler';
}

function newFolderOf(acctId) {
  const recents = state.cfg.recents?.[acctId] || [];
  const f = state.newFolder[acctId];
  return f && recents.includes(f) ? f : recents[0] || null;
}

function renderLauncher(acctId) {
  const a = acct(acctId);
  const pane = state.panes[acctId];
  if (!a || !pane) return;
  const recents = state.cfg.recents?.[acctId] || [];
  const folder = newFolderOf(acctId);

  const pathLabel = (p) => {
    const t = tilde(p);
    const i = t.lastIndexOf('/');
    return [h('span', {}, t.slice(0, i + 1)), h('b', {}, t.slice(i + 1) || t)];
  };

  // --- Yazma kutusu: ilk mesajı yazıp Enter'a basınca sohbet o klasörde başlar
  const input = h('textarea', {
    class: 'new-input', rows: 2, spellcheck: 'false',
    placeholder: folder ? 'Claude\'a bir görev verin… (Enter ile başlar)' : 'Önce aşağıdan bir klasör seçin',
    oninput: (e) => { state.newDraft[acctId] = e.target.value; autosize(); },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); startNew(); } },
    onpaste: (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); addAttachments(attachments, attachEl, files); }
    },
  });
  input.value = state.newDraft[acctId] || '';
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 240) + 'px'; };
  requestAnimationFrame(autosize);

  // Ayrı çalışma kopyası (git worktree) ve "Octopus olarak başlat" klasör menüsünde durur; açıkken düğmede küçük bir işaret görünür
  const wtOn = !!state.newWorktree[acctId];
  const oc = octoState(acctId, folder, wtOn); // renderer/octopus.js
  const folderBtn = h('button', {
    class: 'pill-btn folder-btn' + (wtOn ? ' wt-on' : ''),
    title: (folder || 'Klasör seç') + (wtOn ? ' · ayrı çalışma kopyasında açılır' : ''),
    onclick: () => openMenu(folderBtn, [
      ...recents.map((d) => ({ icon: d === folder ? 'check' : 'folder', label: tilde(d), onclick: () => { state.newFolder[acctId] = d; renderLauncher(acctId); input.focus(); } })),
      recents.length ? '-' : null,
      { icon: 'plus', label: 'Başka klasör seç…', onclick: () => pickFolderForNew(acctId) },
      '-',
      { icon: 'layers', label: 'Ayrı kopyada çalış', desc: 'Sohbet kendi git dalında, ana klasöre dokunmadan', checked: wtOn,
        onclick: () => { state.newWorktree[acctId] = !wtOn; renderLauncher(acctId); input.focus(); } },
      { icon: 'octopus', label: 'Octopus olarak başlat', desc: oc.desc, checked: oc.on,
        onclick: () => { toggleOctopus(acctId, folder, oc); state.panes[acctId].launcher.querySelector('.new-input')?.focus(); } },
      // Geçmişi olan klasör: var olan oturumlardan biri beyin olur (renderer/kurulum.js; yalnız okunur)
      oc.canImport ? { icon: 'octopus', label: 'Projeyi Octopus\'a al…', desc: 'Geçmiş oturumlardan biri beyin olur; panel yalnız okur',
        onclick: () => openImportProject(acctId, folder) } : null,
      { icon: 'book', label: 'Octopus nasıl çalışır?', onclick: openOctopusIntro }, // renderer/kurulum.js
    ]),
  }, icon('folder', 15), h('span', {}, folder ? tilde(folder).split('/').pop() || folder : 'Klasör seç'),
  wtOn ? icon('layers', 13, 'wt-mark') : null, oc.on ? icon('octopus', 13, 'wt-mark octo-mark') : null, icon('chevronDown', 13));

  // Ekler: "+" ile seçilen, yapıştırılan ya da ekrana bırakılan dosya ve fotoğraflar (renderer/chat.js → readAttachment)
  const attachments = (state.newAttach[acctId] ||= []);
  const attachEl = h('div', { class: 'composer-attach' });
  renderAttachments(attachments, attachEl);
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true,
    onchange: (e) => { addAttachments(attachments, attachEl, [...e.target.files]); e.target.value = ''; input.focus(); } });
  pane.launcher.ondragover = (e) => e.preventDefault();
  pane.launcher.ondrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addAttachments(attachments, attachEl, files);
    input.focus();
  };

  const startNew = async () => {
    const dir = newFolderOf(acctId) || (await pickFolderForNew(acctId));
    if (!dir) return;
    const text = input.value.trim();
    const atts = attachments.splice(0);
    state.newDraft[acctId] = '';
    input.value = '';
    await rememberFolder(acctId, dir);
    const worktree = !!state.newWorktree[acctId];
    createChatTab(acctId, dir, 'new', null, { ...(text || atts.length ? { send: text, attachments: atts } : {}), worktree, octopus: octopusForNew(acctId, dir, worktree) });
  };

  // Yeni sohbetin modeli ve eforu: hesabın kayıtlı tercihi (sohbet başlarken SDK'ya verilir)
  const prefs = () => state.cfg.chatPrefs?.[acctId] || {};
  const picker = modelPicker(acctId,
    () => ({ model: prefs().model || '', effort: prefs().effort || '' }),
    (patch) => { saveAcctPrefs(acctId, patch); picker.refresh(); });

  const composer = h('div', { class: 'new-composer' },
    attachEl,
    input,
    h('div', { class: 'composer-bar' },
      h('button', { class: 'pill-btn icon-only attach-btn', title: 'Dosya veya fotoğraf ekle', onclick: () => fileInput.click() }, icon('plus', 16)),
      fileInput,
      folderBtn,
      envButton(acctId),
      h('button', { class: 'pill-btn ghost icon-only', title: 'Claude Code\'u bu klasörde terminalde aç', disabled: !folder,
        onclick: () => folder && launch(acctId, folder, 'new') }, icon('terminal', 15)),
      connectorsButton(acctId, () => newFolderOf(acctId)),
      skillsButton(acctId, () => newFolderOf(acctId), () => input),
      h('span', { class: 'spacer' }),
      picker,
      usageButton(acctId),
      h('button', { class: 'send-btn', title: 'Başlat (Enter)', onclick: startNew }, icon('arrowUp', 17))));

  const rows = recents.length
    ? recents.map((dir) =>
        h('div', { class: 'recent-row' + (dir === folder ? ' sel' : '') },
          h('span', { class: 'recent-ic' }, icon('folder', 15)),
          h('div', { class: 'recent-path', title: dir }, pathLabel(dir)),
          h('div', { class: 'recent-actions' },
            h('button', { class: 'mini main', title: 'Yeni Claude oturumu (sohbet görünümü)', onclick: () => createChatTab(acctId, dir, 'new') }, 'Yeni'),
            h('button', { class: 'mini', title: 'Bu klasördeki son oturuma devam et', onclick: () => createChatTab(acctId, dir, 'continue') }, 'Devam et'),
            h('button', { class: 'mini', title: 'Geçmiş oturumlardan seç', onclick: () => showSessionPicker(acctId, dir) }, 'Geçmiş'),
            h('button', { class: 'mini', title: 'Claude Code\'u terminalde aç', onclick: () => launch(acctId, dir, 'new') }, 'Terminal'),
            h('button', { class: 'icon-btn', title: 'Listeden kaldır', onclick: () => removeRecent(acctId, dir) }, icon('close', 13)))))
    : [h('div', { class: 'empty-recent' }, 'Henüz klasör yok. ', h('button', { class: 'link-btn', onclick: () => pickFolderForNew(acctId) }, 'Bir klasör seçin'), '; burada listelenir.')];

  // Son artifact'ler (bu hesabın ürettikleri)
  const recentArts = art.items.filter((x) => x.source?.accountId === acctId).slice(0, 4);

  pane.launcher.innerHTML = '';
  pane.root.style.setProperty('--c', a.color);
  pane.launcher.append(
    h('div', { class: 'launcher-inner' },
      !state.info.ptyOk
        ? h('div', { class: 'error-banner' },
            'Terminal modülü (node-pty) yüklenemedi. Panel klasöründe terminalden ',
            h('code', {}, 'npm install'), ' çalıştırıp paneli yeniden açın.')
        : null,
      h('div', { class: 'new-hero' },
        h('span', { class: 'new-mark' }, '✳'),
        // Selam üstte altın italik, soru altında (styles.css → .new-title em)
        h('h1', { class: 'new-title' }, h('em', {}, `${greeting()},`), ' ne üzerinde çalışalım?')),
      composer,
      // Kimlik satırı: hangi hesap, hangi ayar klasörü (klasör zaten yazma kutusunda)
      h('div', { class: 'new-hint' },
        h('span', { class: 'dot' }), h('b', {}, a.name),
        a.note ? [h('span', { class: 'sep' }, '·'), a.note] : null,
        h('span', { class: 'sep' }, '·'), h('code', {}, tilde(a.configDir || '~/.claude')),
        oc.short ? [h('span', { class: 'sep' }, '·'), h('span', { class: 'octo-hint' + (oc.on ? ' on' : ''), title: oc.desc }, icon('octopus', 13), 'Octopus ' + oc.short)] : null),
      h('div', { class: 'recent-title' }, 'Son klasörler'),
      h('div', { class: 'recent' }, rows),
      recentArts.length
        ? [h('div', { class: 'recent-title with-link' }, 'Son artifact\'ler',
            h('button', { class: 'link-btn', onclick: () => showArtifacts(null) }, 'Tümünü gör')),
           h('div', { class: 'mini-arts' }, recentArts.map((x) =>
             h('button', { class: 'mini-art', onclick: () => openArtifact(x.id) },
               thumbEl(x, 'mini-thumb'),
               h('span', { class: 'mini-art-title' }, x.title))))]
        : null,
      h('div', { class: 'tip' },
        'Sohbet bu hesabın Claude Code girişini kullanır. Giriş yapılmadıysa bir kez ',
        h('b', {}, 'Terminal'), '\'de açıp ', h('code', {}, '/login'), ' yazın.'))
  );
}

// ---------- Ortamlar (ana süreçte environments.js) ----------
// Ortamlar panel genelindedir (config.json → environments); hangisinin kullanılacağı hesap başına seçilir (chatPrefs[hesap].env).

const environmentsList = () => state.cfg.environments || [];

// Hesabın seçili ortamı; silinmişse yok sayılır
function envOf(acctId) {
  const id = state.cfg.chatPrefs?.[acctId]?.env;
  return (id && environmentsList().find((e) => e.id === id)) || null;
}

function selectEnv(acctId, id) {
  saveAcctPrefs(acctId, { env: id || '' });
  renderLauncher(acctId);
}

function envSummary(e) {
  const n = e.vars.split('\n').filter((l) => /^\s*(export\s+)?[A-Za-z_]\w*\s*=/.test(l)).length;
  return [n ? `${n} değişken` : 'Değişken yok', e.setup.trim() ? 'kurulum betiği' : null].filter(Boolean).join(' · ');
}

function envButton(acctId) {
  const env = envOf(acctId);
  const btn = h('button', {
    class: 'pill-btn env-btn' + (env ? ' on' : ''),
    title: env ? `Ortam: ${env.name} (${envSummary(env)})` : 'Ortam seç: değişkenler ve kurulum betiği',
    onclick: () => openMenu(btn, [
      { header: 'Ortam' },
      { label: 'Ortam yok', desc: 'Yalnız giriş kabuğunun değişkenleri', checked: !env, onclick: () => selectEnv(acctId, '') },
      ...environmentsList().map((e) => ({ icon: 'box', label: e.name, desc: envSummary(e), checked: e.id === env?.id, onclick: () => selectEnv(acctId, e.id) })),
      '-',
      env ? { icon: 'pencil', label: `"${env.name}" ortamını düzenle…`, onclick: () => editEnvironment(env.id, acctId) } : null,
      { icon: 'plus', label: 'Ortam ekle…', onclick: () => editEnvironment(null, acctId) },
    ], 'env-menu'),
  }, icon('box', 15), h('span', {}, env ? env.name : 'Ortam'), icon('chevronDown', 13));
  return btn;
}

// Ortam ekleme/düzenleme penceresi. Yeni ortam, açıldığı hesapta seçili olur.
function editEnvironment(id, acctId) {
  const list = environmentsList();
  const cur = list.find((e) => e.id === id) || null;
  const field = (tag, attrs, value) => { const el = h(tag, { class: 'dlg-input', spellcheck: 'false', ...attrs }); el.value = value || ''; return el; };
  const nameEl = field('input', { type: 'text', placeholder: 'örn. Node 22 · staging' }, cur?.name);
  const varsEl = field('textarea', { class: 'dlg-input env-code env-vars', rows: 7,
    placeholder: 'ANAHTAR=değer\nPATH=$HOME/.local/bin:$PATH\n# yorum satırı' }, cur?.vars);
  const setupEl = field('textarea', { class: 'dlg-input env-code env-setup', rows: 5,
    placeholder: '# Her oturum başında seçili klasörde çalışır\nnpm install --silent\nexport API_URL=https://staging.ornek.com' }, cur?.setup);
  const errEl = h('div', { class: 'env-error', hidden: true });
  for (const el of [nameEl, varsEl]) el.addEventListener('input', () => { errEl.hidden = true; });

  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); focusCurrent(); };
  const onKey = (e) => {
    if (document.querySelector('.modal.dlg')) return; // üstte silme onayı açık
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && (e.metaKey || e.target === nameEl)) { e.preventDefault(); save(); }
  };
  const refresh = () => accounts().forEach((a) => renderLauncher(a.id));

  const save = async () => {
    const name = nameEl.value.trim();
    const errors = name ? await window.panel.envCheck(varsEl.value) : ['Ortama bir ad verin.'];
    if (environmentsList().some((e) => e.id !== cur?.id && e.name.toLowerCase() === name.toLowerCase())) errors.push(`"${name}" adında bir ortam zaten var.`);
    if (errors.length) { errEl.textContent = errors.join('\n'); errEl.hidden = false; return; }
    const next = { id: cur?.id || 'env' + Date.now().toString(36), name, vars: varsEl.value, setup: setupEl.value };
    const all = environmentsList();
    state.cfg = await window.panel.saveConfig({ environments: cur ? all.map((e) => (e.id === cur.id ? next : e)) : [...all, next] });
    close();
    if (!cur && acctId) saveAcctPrefs(acctId, { env: next.id });
    refresh();
    toast(cur ? 'Ortam kaydedildi. Açık oturumlar eski değerlerle sürer; yeni oturumlarda geçerli.' : `"${name}" ortamı eklendi ve seçildi.`);
  };

  const remove = async () => {
    const ok = await dialogModal({
      title: 'Ortam silinsin mi?',
      body: `"${cur.name}" bütün hesaplardan kaldırılır. Bu ortamla açık oturumlar etkilenmez.`,
      okLabel: 'Sil', danger: true,
    });
    if (!ok) return;
    state.cfg = await window.panel.saveConfig({ environments: environmentsList().filter((e) => e.id !== cur.id) });
    close();
    refresh();
    toast('Ortam silindi.');
  };

  const label = (text, hint) => h('label', { class: 'env-label' }, text, hint ? h('small', {}, hint) : null);
  const modal = h('div', { class: 'modal env-modal' },
    h('div', { class: 'modal-card dlg-card env-card' },
      h('h2', {}, cur ? 'Ortamı düzenle' : 'Ortam ekle'),
      h('p', { class: 'dlg-body' }, 'Bu ortamla açılan sohbetler ve terminaller aşağıdaki değişkenleri alır. Ortamlar bütün hesaplarda ortaktır; hangisinin kullanılacağı hesap başına seçilir.'),
      label('Ad'), nameEl,
      label('Ortam değişkenleri', '.env biçimi · $PATH gibi değişkenler açılır, tek tırnak açılmaz'), varsEl,
      label('Kurulum betiği', 'isteğe bağlı · export ettikleri oturuma geçer · hata verirse oturum başlamaz'), setupEl,
      errEl,
      h('p', { class: 'env-note' }, icon('lock', 13), 'Değerler bu Mac\'te panelin config.json dosyasında düz metin olarak saklanır.'),
      h('div', { class: 'modal-actions' },
        cur ? h('button', { class: 'ghost-btn danger env-del', onclick: remove }, icon('trash', 14), 'Sil') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost-btn', onclick: close }, 'Vazgeç'),
        h('button', { class: 'primary-btn env-save', onclick: save }, cur ? 'Kaydet' : 'Ekle'))));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(modal);
  nameEl.focus();
}

async function pickFolderForNew(acctId) {
  const recents = state.cfg.recents?.[acctId] || [];
  const dir = await window.panel.pickFolder(recents[0] || '~');
  if (!dir) return null;
  state.newFolder[acctId] = dir;
  await rememberFolder(acctId, dir);
  return dir;
}

async function rememberFolder(acctId, dir) {
  const list = (state.cfg.recents?.[acctId] || []).filter((d) => d !== dir);
  list.unshift(dir);
  state.cfg.recents = { ...(state.cfg.recents || {}), [acctId]: list.slice(0, 8) };
  state.cfg = await window.panel.saveConfig({ recents: state.cfg.recents });
  renderLauncher(acctId);
}

async function removeRecent(acctId, dir) {
  state.cfg.recents[acctId] = (state.cfg.recents[acctId] || []).filter((d) => d !== dir);
  state.cfg = await window.panel.saveConfig({ recents: state.cfg.recents });
  renderLauncher(acctId);
}

function showLauncher(acctId) {
  if (state.page !== 'account' || state.active !== acctId || state.view[acctId] !== 'code') selectAccount(acctId, 'code');
  state.activeTab[acctId] = null;
  renderLauncher(acctId);
  renderTabs(acctId);
  renderNav();
}

// ---------- Terminaller ----------

// background: Claude'un açtığı sekme; kullanıcının baktığı sekme ve hesap değişmez
async function launch(acctId, cwd, mode, resumeId, envId = envOf(acctId)?.id, { background = false } = {}) {
  const a = acct(acctId);
  const pane = state.panes[acctId];
  if (!a || !pane) return;
  if (!background && (state.active !== acctId || state.view[acctId] !== 'code')) selectAccount(acctId, 'code');

  const host = h('div', { class: 'term-host' + (background ? '' : ' active') });
  pane.termArea.append(host);
  if (!background) {
    pane.launcher.classList.remove('active');
    for (const t of state.tabs[acctId]) t.host.classList.remove('active');
  }

  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
    fontSize: state.fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    macOptionIsMeta: false, // Türkçe klavyede @, #, { gibi karakterler Option ile yazılıyor
    allowProposedApi: true,
    theme: termTheme(),
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => window.panel.openExternal(uri)));
  term.open(host);
  try { fit.fit(); } catch {}

  // Shift+Enter = yeni satır (Claude Code'da çok satırlı mesaj)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (tab.ptyId) window.panel.ptyWrite(tab.ptyId, '\x1b\r');
      return false;
    }
    return true;
  });

  const tab = {
    kind: 'term', ptyId: null, acctId, title: '…', cwd, mode, term, fit, host,
    exited: false, activity: false, attention: false, termTitle: '',
  };

  const res = await window.panel.ptyCreate({ accountId: acctId, cwd, mode, resumeId, envId, cols: term.cols, rows: term.rows });
  if (!res.ok) {
    term.dispose();
    host.remove();
    toast('Terminal açılamadı: ' + res.error, 6000);
    renderTabs(acctId);
    if (background) throw new Error(res.error);
    return;
  }

  tab.ptyId = res.id;
  tab.title = res.title;
  tab.cwd = res.cwd;
  tabsById.set(res.id, tab);
  if (pendingData.has(res.id)) {
    term.write(pendingData.get(res.id));
    pendingData.delete(res.id);
  }

  term.onData((d) => window.panel.ptyWrite(tab.ptyId, d));
  term.onResize(({ cols, rows }) => window.panel.ptyResize(tab.ptyId, cols, rows));
  term.onBell(() => onBell(tab));
  term.onTitleChange((t) => {
    tab.termTitle = t;
    const el = tab.el?.querySelector('.tab-label');
    if (el) el.title = `${tilde(tab.cwd)}\n${t}`;
  });

  state.tabs[acctId].push(tab);
  if (!background) {
    state.activeTab[acctId] = tab;
    state.lastTerm[acctId] = tab;
  }

  // Son klasörleri ana süreç güncelledi; yeniden oku
  state.cfg = await window.panel.getConfig();
  renderLauncher(acctId);
  renderTabs(acctId);
  renderSidebar();
  if (!background) focusCurrent();
  return tab;
}

function renderTabs(acctId) {
  const pane = state.panes[acctId];
  if (!pane) return;
  const active = state.activeTab[acctId];
  pane.tabsEl.innerHTML = '';

  for (const t of state.tabs[acctId]) {
    const modeTag = t.kind === 'chat' ? '' : ({ continue: ' ↻', resume: ' ⟲', 'resume-id': ' ⟲', shell: ' $' }[t.mode] || '');
    t.el = h('div', {
      class: `tab ${t === active ? 'active' : ''} ${t.activity ? 'activity' : ''} ${t.attention ? 'attention' : ''} ${t.exited ? 'exited' : ''} ${t.busy ? 'busy' : ''}`,
      onclick: () => activateTab(acctId, t),
      onauxclick: (e) => { if (e.button === 1) closeTab(t); },
    },
      h('span', { class: 'state' }),
      h('span', { class: 'tab-kind' }, icon(t.kind === 'chat' ? 'chat' : 'terminal', 14)),
      h('span', { class: 'tab-label', title: `${tilde(t.cwd)}${t.termTitle ? '\n' + t.termTitle : ''}` }, t.title + modeTag),
      h('button', { class: 'tab-close', title: 'Kapat (⌘W)', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, icon('close', 12)));
    pane.tabsEl.append(t.el);
  }

  for (const t of state.tabs[acctId]) t.host.classList.toggle('active', t === active);
  pane.launcher.classList.toggle('active', !active);
  pane.addBtn.classList.toggle('on', !active);
  if (active) active.el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (acctId === state.active) renderNav();
}

function activateTab(acctId, tab) {
  state.activeTab[acctId] = tab;
  if (tab?.kind === 'term') state.lastTerm[acctId] = tab;
  clearFlags(tab);
  renderTabs(acctId);
  renderSidebar();
  focusCurrent();
}

function closeTab(tab, force) {
  if (!tab) return;
  if (tab.kind === 'chat') {
    if (!force && tab.busy && !confirm(`"${tab.title}" sohbetinde Claude hâlâ çalışıyor. Kapatılsın mı? (Sonra "Devam et" ile dönebilirsiniz.)`)) return;
    stopActivity(tab); // canlı göstergenin sayacı (renderer/activity.js)
    if (tab.chatId) { window.panel.chatClose(tab.chatId); chatsById.delete(tab.chatId); }
    closeArtifactInChat(tab);
    closeOctopusInChat(tab);
  } else {
    if (!force && !tab.exited && !confirm(`"${tab.title}" terminali kapatılsın mı? İçindeki Claude oturumu sonlanır (sonra "Devam et" ile dönebilirsiniz).`)) return;
    window.panel.ptyKill(tab.ptyId);
    tabsById.delete(tab.ptyId);
    tab.term.dispose();
  }
  tab.host.remove();
  const list = state.tabs[tab.acctId];
  const idx = list.indexOf(tab);
  list.splice(idx, 1);
  if (state.activeTab[tab.acctId] === tab) state.activeTab[tab.acctId] = list[idx] || list[idx - 1] || null;
  renderTabs(tab.acctId);
  renderSidebar();
  focusCurrent();
}

function cycleTab(dir) {
  const id = state.active;
  const list = state.tabs[id];
  if (!list.length) return;
  const cur = list.indexOf(state.activeTab[id]);
  const next = list[(cur + dir + list.length) % list.length];
  activateTab(id, next);
}

function isVisible(tab) {
  return state.active === tab.acctId && state.view[tab.acctId] === 'code' && state.activeTab[tab.acctId] === tab;
}

function clearFlags(tab) {
  if (tab.activity || tab.attention) {
    tab.activity = false;
    tab.attention = false;
    renderTabs(tab.acctId);
    renderSidebar();
  }
}

function onBell(tab) {
  if (isVisible(tab) && document.hasFocus()) return;
  const a = acct(tab.acctId);
  if (!tab.attention) {
    tab.attention = true;
    renderTabs(tab.acctId);
    renderSidebar();
  }
  window.panel.notify(`${a?.name || ''} · ${tab.title}`, 'Claude Code sizi bekliyor');
}

function fitTab(t) {
  if (!t || t.kind !== 'term' || !t.host.isConnected || t.host.offsetParent === null) return;
  try { t.fit.fit(); } catch {}
}

function fitActive(acctId) {
  const t = state.activeTab[acctId];
  if (t && isVisible(t)) fitTab(t);
}

window.panel.onPtyData((id, data) => {
  const tab = tabsById.get(id);
  if (!tab) {
    pendingData.set(id, (pendingData.get(id) || '') + data);
    return;
  }
  tab.term.write(data);
  if (!isVisible(tab) && !tab.activity) {
    tab.activity = true;
    renderTabs(tab.acctId);
  }
});

window.panel.onPtyExit((id, code) => {
  const tab = tabsById.get(id);
  if (!tab) return;
  tab.exited = true;
  tab.term.write(`\r\n\x1b[90m[Terminal kapandı (kod ${code}). Sekmeyi kapatmak için ⌘W.]\x1b[0m\r\n`);
  renderTabs(tab.acctId);
  renderSidebar();
});

// Ayrı çalışma kopyası değişiklik içerdiği için silinmedi (chat-main.js → closeChat)
window.panel.onWorktreeKept((w) => {
  const why = w.error ? 'silinemedi: ' + w.error : [w.dirty ? 'kaydedilmemiş değişiklik' : null, w.ahead ? `${w.ahead} yeni commit` : null].filter(Boolean).join(', ');
  toast(`Ayrı kopya korunuyor (${why}). Dal: ${w.branch} · ${tilde(w.path)}`, 9000);
});

// ---------- Claude'un terminal aracı (terminals.js) ----------
// Ana süreç sorar; yanıt xterm arabelleğinden. Yalnız sohbetin hesabının sekmeleri.
function termTabs(acctId) { return (state.tabs[acctId] || []).filter((t) => t.kind === 'term' && t.ptyId); }
function defaultTerm(acctId) {
  const list = termTabs(acctId);
  const last = state.lastTerm[acctId];
  return list.includes(last) ? last : list.at(-1) || null;
}
function ownTerm(acctId, tabId) {
  const tab = tabId == null ? defaultTerm(acctId) : tabsById.get(tabId);
  if (!tab || tab.acctId !== acctId) throw new Error(tabId == null ? 'Bu hesapta açık terminal sekmesi yok' : `Sekme ${tabId} bu hesabın terminali değil`);
  return tab;
}
function termText(tab, lines) {
  const buf = tab.term.buffer.active;
  const out = [];
  for (let i = Math.max(0, buf.length - lines); i < buf.length; i++) out.push(buf.getLine(i)?.translateToString(true) ?? '');
  while (out.length && !out.at(-1).trim()) out.pop();
  return out.join('\n');
}
const TERM_QUERIES = {
  list({ acctId }) {
    const def = defaultTerm(acctId);
    return {
      default: def?.ptyId ?? null,
      tabs: termTabs(acctId).map((t) => ({ id: t.ptyId, title: t.title, cwd: tilde(t.cwd), exited: t.exited, last: t === def, visible: isVisible(t) })),
    };
  },
  read({ acctId, tabId, lines }) {
    const tab = ownTerm(acctId, tabId);
    return { id: tab.ptyId, title: tab.title, cwd: tilde(tab.cwd), exited: tab.exited, text: termText(tab, lines) };
  },
  async open({ acctId, cwd, envId, command }) {
    const tab = await launch(acctId, cwd, 'shell', null, envId || null, { background: true });
    if (!tab) throw new Error('Terminal açılamadı');
    window.panel.ptyWrite(tab.ptyId, command + '\r');
    return { id: tab.ptyId, title: tab.title };
  },
  write({ acctId, tabId, data }) {
    const tab = ownTerm(acctId, tabId);
    if (tab.exited) throw new Error(`Sekme ${tab.ptyId} kapanmış`);
    window.panel.ptyWrite(tab.ptyId, data);
    return { title: tab.title };
  },
};
window.panel.onTermQuery(async (id, op, args) => {
  try {
    if (!TERM_QUERIES[op]) throw new Error('Bilinmeyen istek: ' + op);
    window.panel.termReply(id, { ok: true, ...(await TERM_QUERIES[op](args || {})) });
  } catch (err) {
    window.panel.termReply(id, { ok: false, error: err?.message || String(err) });
  }
});

// ---------- Chat ----------

// Hesabın Web görünümünü bir claude.ai sayfasında aç (bağlayıcı dizini, bağlayıcı ayarları…)
function openWeb(acctId, url) {
  const pane = state.panes[acctId];
  if (!pane) return;
  if (pane.webview) pane.webview.src = url;
  else ensureWebview(acctId, url);
  selectAccount(acctId, 'chat');
}

function ensureWebview(acctId, startUrl = 'https://claude.ai/new') {
  const pane = state.panes[acctId];
  if (!pane || pane.webview) return;

  const btn = (ic, title, fn) => h('button', { class: 'icon-btn', title, onclick: fn }, icon(ic, 16));
  const back = btn('back', 'Geri', () => wv.canGoBack() && wv.goBack());
  const fwd = btn('forward', 'İleri', () => wv.canGoForward() && wv.goForward());
  const reload = btn('refresh', 'Yenile', () => wv.reload());
  // Adres alanı: e-postadaki giriş linkini buraya yapıştırıp Enter'a basabilirsiniz.
  const url = h('input', {
    class: 'chat-url', type: 'text', spellcheck: 'false', value: 'claude.ai/new',
    title: 'Adres — giriş linkini buraya yapıştırıp Enter’a basabilirsiniz',
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        let v = e.target.value.trim();
        if (!/^https?:\/\//.test(v)) v = 'https://' + v;
        wv.loadURL(v);
        wv.focus();
      } else if (e.key === 'Escape') {
        update();
        wv.focus();
      }
    },
    onfocus: (e) => { e.target.value = wv.getURL(); e.target.select(); },
  });
  const newWeb = h('button', { class: 'mini', onclick: () => wv.loadURL('https://claude.ai/new') }, icon('plus', 13), 'Yeni sohbet');
  const ext = btn('external', 'Varsayılan tarayıcıda aç', () => window.panel.openExternal(wv.getURL()));

  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:chat-${acctId}`);
  wv.setAttribute('src', startUrl);
  wv.setAttribute('allowpopups', '');

  // claude.ai/code'daki "Local" seçeneği sadece resmi masaüstü uygulamasında çalışıyor.
  // Bu sayfaya gelindiğinde paneldeki yerel Code bölümüne yönlendiren bir uyarı göster.
  let bannerDismissed = false;
  const banner = h('div', { class: 'code-banner', hidden: true },
    h('span', { class: 'code-banner-icon' }, icon('terminal', 18)),
    h('div', { class: 'code-banner-text' },
      h('b', {}, 'Bu sayfa web sürümü; "Local" burada çalışmaz. '),
      'Mac\'inizde, bu hesapla çalışan Claude Code için panelin ', h('b', {}, 'Yerel Code'), ' bölümünü kullanın.'),
    h('button', { class: 'primary-btn', onclick: () => showLauncher(acctId) }, 'Yerel Code’a geç  ⌘K'),
    h('button', { class: 'icon-btn', title: 'Gizle', onclick: () => { bannerDismissed = true; banner.hidden = true; } }, '✕'));

  const update = () => {
    try {
      const current = wv.getURL();
      if (document.activeElement !== url) url.value = current.replace(/^https:\/\//, '');
      back.disabled = !wv.canGoBack();
      fwd.disabled = !wv.canGoForward();
      banner.hidden = bannerDismissed || !/^https:\/\/claude\.ai\/code(\/|\?|$)/.test(current);
    } catch {}
  };
  wv.addEventListener('did-navigate', update);
  wv.addEventListener('did-navigate-in-page', update);
  wv.addEventListener('did-start-loading', () => pane.chat.classList.add('loading'));
  wv.addEventListener('did-stop-loading', () => { pane.chat.classList.remove('loading'); update(); });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3 && e.isMainFrame) toast(`Sohbet yüklenemedi (${e.errorDescription}). ↻ ile yenileyin.`, 5000);
  });

  pane.chat.append(
    h('div', { class: 'chat-toolbar' }, back, fwd, reload, url, newWeb, ext),
    h('div', { class: 'chat-loading' }),
    banner,
    wv
  );
  pane.webview = wv;
  back.disabled = fwd.disabled = true;
}

// ---------- Ayarlar ----------

// Yeni hesaplara sırayla verilen renkler: zümrüt, kil, safir, şampanya, ametist, turkuaz
const COLORS = ['#4c9f86', '#d97757', '#6a86d8', '#cdb07a', '#a585d4', '#5fb3b3'];

// Ayarlar penceresi: solda sekmeler. Hesap listesi "Kaydet" ile, diğer ayarlar değişince kaydedilir.
// Son açılan sekme panel açık kaldıkça hatırlanır. Alanların id'leri (#themeChoice, #keepAwake, #editorChoice, #autoCompact…) e2e'de kullanılır.
const SETTINGS_TABS = ['accounts', 'look', 'general', 'octopus'];

function settingsTab(name) {
  state.settingsTab = SETTINGS_TABS.includes(name) ? name : 'accounts';
  for (const b of document.querySelectorAll('#modal .set-tab')) {
    const on = b.dataset.tab === state.settingsTab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const p of document.querySelectorAll('#modal .set-pane')) p.hidden = p.dataset.pane !== state.settingsTab;
}

function openSettings(tab) {
  const form = $('#acctForm');
  const draft = accounts().map((a) => ({ ...a }));

  const render = () => {
    form.innerHTML = '';
    form.append(
      h('div', { class: 'acct-form-row acct-form-head' },
        h('span', {}, 'Renk'), h('span', {}, 'Ad'), h('span', {}, 'Açıklama'), h('span', {}, 'Ayar klasörü'), h('span', {})));
    draft.forEach((a, i) => {
      const inp = (key, ph) => h('input', {
        type: 'text', value: a[key] || '', placeholder: ph,
        oninput: (e) => (a[key] = e.target.value),
      });
      const isOpen = (state.tabs[a.id] || []).length > 0;
      form.append(
        h('div', { class: 'acct-form-row' },
          h('input', { type: 'color', value: a.color, oninput: (e) => (a.color = e.target.value) }),
          inp('name', 'Ad'),
          inp('note', 'örn. Max üyelik'),
          inp('configDir', '~/.claude (varsayılan)'),
          h('button', {
            class: 'icon-btn', title: isOpen ? 'Açık terminali olan hesap silinemez' : 'Hesabı kaldır',
            disabled: isOpen || draft.length <= 1,
            onclick: () => { draft.splice(i, 1); render(); },
          }, '✕')));
    });
  };

  $('#addAcct').onclick = () => {
    const n = draft.length + 1;
    draft.push({
      id: 'hesap' + Date.now().toString(36),
      name: `Hesap ${n}`,
      note: '',
      color: COLORS[(n - 1) % COLORS.length],
      configDir: `~/.claude-hesap${n}`,
    });
    render();
  };

  $('#modalSave').onclick = async () => {
    const clean = draft
      .map((a) => ({ ...a, name: a.name.trim() || 'Hesap', note: (a.note || '').trim(), configDir: (a.configDir || '').trim() }));
    state.cfg = await window.panel.saveConfig({ accounts: clean });
    // Kaldırılan hesapların panellerini temizle
    for (const id of Object.keys(state.panes)) {
      if (!acct(id)) {
        state.panes[id].root.remove();
        delete state.panes[id];
        delete state.tabs[id];
      }
    }
    accounts().forEach((a) => { ensurePane(a); renderLauncher(a.id); });
    window.panel.rebuildMenu();
    closeSettings();
    selectAccount(acct(state.active) ? state.active : accounts()[0].id);
    toast('Kaydedildi. Ayar klasörü değişen hesaplarda yeni terminaller yeni klasörle açılır.');
  };

  render();
  const save = (patch) => window.panel.saveConfig(patch).then((c) => { state.cfg = c; });

  // Görünüm → Tema: ana süreç nativeTheme'i değiştirir, stiller ve terminaller prefers-color-scheme'i izler
  const themeSel = h('select', { id: 'themeChoice', onchange: (e) => save({ theme: e.target.value }) },
    h('option', { value: 'system' }, 'Sistem (macOS\'u izler)'), h('option', { value: 'dark' }, 'Koyu'), h('option', { value: 'light' }, 'Açık'));
  themeSel.value = state.cfg.theme || 'system';
  $('#setLook').replaceChildren(h('label', { class: 'acct-form-opt acct-form-select' }, h('span', {}, 'Tema'), themeSel,
    h('small', {}, 'Görünüm menüsünden de değişir. Web görünümü (claude.ai) ve artifact sayfaları da temaya uyar.')));

  // Genel: uyanık tutma ve editör (Claude'un "editörde aç" aracı ve Değişiklikler bölmesindeki düğme, opener.js)
  const awake = h('input', { type: 'checkbox', id: 'keepAwake', onchange: (e) => save({ keepAwake: e.target.checked }) });
  awake.checked = state.cfg.keepAwake !== false;
  const editorSel = h('select', { id: 'editorChoice', onchange: (e) => save({ editor: e.target.value }) });
  $('#setGeneral').replaceChildren(
    h('label', { class: 'acct-form-opt' }, awake, h('span', {}, 'Claude çalışırken Mac uyumasın'),
      h('small', {}, 'Bir sohbette tur sürerken sistem uykusu engellenir; ekran yine kararabilir.')),
    h('label', { class: 'acct-form-opt acct-form-select' }, h('span', {}, 'Editör'), editorSel,
      h('small', {}, 'Claude bir dosyayı "editörde aç" dediğinde ve Değişiklikler bölmesinde kullanılır.')));
  window.panel.editorList().then((r) => {
    const auto = r.editors[0]?.name || 'varsayılan metin düzenleyici';
    editorSel.replaceChildren(h('option', { value: '' }, `Otomatik (${auto})`),
      ...r.editors.map((e) => h('option', { value: e.id }, e.name)),
      h('option', { value: 'default' }, 'Varsayılan metin düzenleyici'));
    editorSel.value = [...editorSel.options].some((o) => o.value === r.choice) ? r.choice : '';
  });

  // Octopus: otomatik sıkıştırma, maliyet eşikleri, hafıza kapsamı, kol sınırı, "Hafızayı sil" (renderer/kurulum.js)
  $('#setOctopus').replaceChildren(octopusSettings());
  settingsTab(tab || state.settingsTab);
  $('#modal').hidden = false;
}

function closeSettings() {
  $('#modal').hidden = true;
  focusCurrent();
}

// ---------- Menü kısayolları ----------

function setFont(delta) {
  state.fontSize = delta === 0 ? 13 : Math.min(24, Math.max(9, state.fontSize + delta));
  for (const list of Object.values(state.tabs)) {
    for (const t of list) if (t.kind === 'term') t.term.options.fontSize = state.fontSize;
  }
  document.documentElement.style.setProperty('--chat-font', state.fontSize + 3.5 + 'px');
  fitActive(state.active);
  window.panel.saveConfig({ fontSize: state.fontSize });
}

// Kenar çubuğu: kapalıyken ana alan pencereyi kaplar, üst şeritler trafik ışıklarına ve düğmeye yer açar (styles.css)
function setSidebar(open, save = true) {
  state.sidebarHidden = !open;
  document.body.classList.toggle('sidebar-off', !open);
  const btn = $('#sidebarToggle');
  btn.title = open ? 'Kenar çubuğunu gizle (⌘B)' : 'Kenar çubuğunu göster (⌘B)';
  btn.setAttribute('aria-pressed', String(open));
  if (save) window.panel.saveConfig({ sidebarHidden: !open });
}

window.panel.onMenu((cmd, arg) => {
  // Menüden tema (ana süreç uyguladı ve kaydetti): yalnız ayarın kopyası ve açık ayar penceresi güncellenir
  if (cmd === 'theme') {
    state.cfg.theme = arg;
    const sel = document.getElementById('themeChoice');
    if (sel) sel.value = arg;
    return;
  }
  if (!$('#modal').hidden && cmd !== 'settings') return;
  closeMenu();
  if (state.page === 'artifacts' && ['toggle', 'view', 'closeTab', 'nextTab', 'font'].includes(cmd)) {
    if (cmd === 'toggle' || cmd === 'view') selectAccount(state.active, cmd === 'view' ? arg : undefined);
    return;
  }
  switch (cmd) {
    case 'sidebar': setSidebar(state.sidebarHidden); break;
    case 'newChat': newChat(); break;
    case 'artifacts': state.page === 'artifacts' && !art.openId ? selectAccount(state.active) : showArtifacts(null); break;
    case 'account': selectAccount(arg); break;
    case 'simulator': {
      const t = state.page === 'account' && state.view[state.active] === 'code' && state.activeTab[state.active];
      if (t?.kind === 'chat') toggleSimulatorInChat(t);
      else toast('Simülatör bir sohbetin yanında açılır. Önce bir sohbet açın.');
      break;
    }
    case 'changes': {
      const t = state.page === 'account' && state.view[state.active] === 'code' && state.activeTab[state.active];
      if (t?.kind === 'chat') toggleChangesInChat(t);
      else toast('Değişiklikler bir sohbetin yanında açılır. Önce bir sohbet açın.');
      break;
    }
    case 'browser': {
      const t = state.page === 'account' && state.view[state.active] === 'code' && state.activeTab[state.active];
      if (t?.kind === 'chat') toggleBrowserInChat(t);
      else toast('Tarayıcı bir sohbetin yanında açılır. Önce bir sohbet açın.');
      break;
    }
    case 'toggle': setView(state.view[state.active] === 'code' ? 'chat' : 'code'); break;
    case 'view': setView(arg); break;
    case 'newTab': newChat(); break;
    case 'closeTab':
      if (state.view[state.active] === 'code') closeTab(state.activeTab[state.active]);
      break;
    case 'nextTab': if (state.view[state.active] === 'code') cycleTab(arg); break;
    case 'settings': $('#modal').hidden ? openSettings(arg) : closeSettings(); break;
    case 'octopusIntro': openOctopusIntro(); break;
    case 'font':
      if (state.view[state.active] === 'chat') {
        const wv = state.panes[state.active]?.webview;
        if (wv) wv.setZoomLevel(arg === 0 ? 0 : wv.getZoomLevel() + arg * 0.5);
      } else setFont(arg);
      break;
  }
});

// ---------- Başlangıç ----------

async function init() {
  state.info = await window.panel.info();
  state.cfg = await window.panel.getConfig();
  state.fontSize = state.cfg.fontSize || 13;
  document.documentElement.style.setProperty('--chat-font', state.fontSize + 3.5 + 'px');

  accounts().forEach(ensurePane);
  accounts().forEach((a) => loadOctopi(a.id)); // renderer/octopus.js

  hydrateIcons();
  setSidebar(!state.cfg.sidebarHidden, false);
  $('#sidebarToggle').onclick = () => setSidebar(state.sidebarHidden);
  $('#navNew').onclick = newChat;
  $('#navArtifacts').onclick = () => showArtifacts(null);
  $('#settingsBtn').onclick = () => openSettings();
  for (const b of document.querySelectorAll('#modal .set-tab')) b.onclick = () => settingsTab(b.dataset.tab);
  $('#modalClose').onclick = closeSettings;
  $('#modalCancel').onclick = closeSettings;
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeSettings(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openMenu.el) closeMenu();
    else if (!$('#modal').hidden) closeSettings();
    else if (state.page === 'artifacts' && art.openId && !document.querySelector('.modal:not([hidden])')) { art.openId = null; renderArtifactsPage({ animate: true }); }
  });
  window.addEventListener('focus', () => {
    const t = state.activeTab[state.active];
    if (t && isVisible(t)) clearFlags(t);
  });

  const start = acct(state.cfg.lastAccount) ? state.cfg.lastAccount : accounts()[0].id;
  selectAccount(start);
  loadArtifacts();
  if (state.cfg.firstRun) openWelcome(); // ilk açılış sihirbazı (renderer/kurulum.js)
}

init();
