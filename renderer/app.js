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
  info: { home: '', ptyOk: true },
  cfg: { accounts: [], recents: {} },
  active: null,
  view: {},        // acctId -> 'code' | 'chat'
  tabs: {},        // acctId -> [tab]
  activeTab: {},   // acctId -> tab | null  (null = başlatıcı)
  panes: {},       // acctId -> DOM refs
  fontSize: 13,
};
const tabsById = new Map();
const pendingData = new Map();

const TERM_THEME = {
  background: '#262624', foreground: '#f0eee6', cursor: '#d97757', cursorAccent: '#262624',
  selectionBackground: '#4a453d',
  black: '#2a2824', red: '#e5645a', green: '#8fbf7f', yellow: '#e2b86b', blue: '#7aa2f7',
  magenta: '#c49be0', cyan: '#6fc1c1', white: '#d8d3ca',
  brightBlack: '#6b665d', brightRed: '#f07f75', brightGreen: '#a6d494', brightYellow: '#f0cd8a',
  brightBlue: '#97b8ff', brightMagenta: '#d7b3ef', brightCyan: '#8ad6d6', brightWhite: '#ffffff',
};

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

function renderSidebar() {
  const nav = $('#accounts');
  nav.innerHTML = '';
  accounts().forEach((a, i) => {
    const tabs = state.tabs[a.id] || [];
    const running = tabs.filter((t) => !t.exited).length;
    const attention = tabs.some((t) => t.attention);
    const view = state.view[a.id] || 'code';
    const isActive = state.active === a.id;

    const chip = (v, label) =>
      h('button', {
        class: `chip ${isActive && view === v ? 'on' : ''}`,
        onclick: (e) => { e.stopPropagation(); selectAccount(a.id, v); },
      }, label);

    nav.append(
      h('div', { class: `acct ${isActive ? 'active' : ''}`, style: `--c:${a.color}`, onclick: () => selectAccount(a.id) },
        h('div', { class: 'acct-row' },
          h('div', { class: 'avatar' }, (a.name || '?').trim().charAt(0).toLocaleUpperCase('tr')),
          h('div', { class: 'acct-meta' },
            h('div', { class: 'acct-name' }, a.name),
            h('div', { class: 'acct-note' }, a.note || tilde(a.configDir || '~/.claude'))),
          attention ? h('span', { class: 'pulse', title: 'Claude sizi bekliyor' }) : null,
          running ? h('span', { class: 'badge', title: `${running} açık terminal` }, running) : null,
          i < 9 ? h('span', { class: 'acct-kbd' }, `⌘${i + 1}`) : null),
        h('div', { class: 'acct-views' }, chip('code', 'Yerel Code'), chip('chat', 'Web')))
    );
  });
}

function renderTopbar() {
  const a = acct(state.active);
  if (!a) return;
  $('#topDot').style.background = a.color;
  $('#topName').textContent = a.name;
  const view = state.view[a.id];
  $('#topNote').textContent = view === 'code'
    ? `Yerel Claude Code (bu Mac) · ${tilde(a.configDir || '~/.claude')}`
    : 'claude.ai web (sohbet + bulut)';
  for (const b of $('#viewSeg').children) b.classList.toggle('on', b.dataset.view === view);
}

// ---------- Hesap panelleri ----------

function ensurePane(a) {
  if (state.panes[a.id]) return state.panes[a.id];

  const tabsEl = h('div', { class: 'tabs' });
  const addBtn = h('button', { class: 'tab-add', title: 'Yeni terminal (⌘T)', onclick: () => showLauncher(a.id) }, '+');
  const launcher = h('div', { class: 'launcher' });
  const termArea = h('div', { class: 'term-area' }, launcher);
  const code = h('div', { class: 'code-pane' }, h('div', { class: 'tabbar' }, tabsEl, addBtn), termArea);
  const chat = h('div', { class: 'chat-pane' });
  const root = h('div', { class: 'acct-pane', 'data-acct': a.id, 'data-view': 'code' }, code, chat);
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
  state.active = id;
  if (view) state.view[id] = view;
  for (const [aid, p] of Object.entries(state.panes)) {
    p.root.classList.toggle('active', aid === id);
    p.root.dataset.view = state.view[aid];
  }
  if (state.view[id] === 'chat') ensureWebview(id);
  renderSidebar();
  renderTopbar();
  focusCurrent();
  window.panel.saveConfig({ lastAccount: id });
}

function setView(view) {
  selectAccount(state.active, view);
}

function focusCurrent() {
  const id = state.active;
  requestAnimationFrame(() => {
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

// ---------- Başlatıcı ----------

function renderLauncher(acctId) {
  const a = acct(acctId);
  const pane = state.panes[acctId];
  if (!a || !pane) return;
  const recents = state.cfg.recents?.[acctId] || [];

  const pathLabel = (p) => {
    const t = tilde(p);
    const i = t.lastIndexOf('/');
    return [h('span', {}, t.slice(0, i + 1)), h('b', {}, t.slice(i + 1) || t)];
  };

  const rows = recents.length
    ? recents.map((dir) =>
        h('div', { class: 'recent-row' },
          h('div', { class: 'recent-path', title: dir }, pathLabel(dir)),
          h('button', { class: 'mini main', title: 'Yeni Claude oturumu (sohbet görünümü)', onclick: () => createChatTab(acctId, dir, 'new') }, 'Yeni'),
          h('button', { class: 'mini', title: 'Bu klasördeki son oturuma devam et', onclick: () => createChatTab(acctId, dir, 'continue') }, 'Devam et'),
          h('button', { class: 'mini', title: 'Geçmiş oturumlardan seç', onclick: () => showSessionPicker(acctId, dir) }, 'Geçmiş'),
          h('button', { class: 'mini', title: 'Claude Code\'u terminalde aç', onclick: () => launch(acctId, dir, 'new') }, 'Terminal'),
          h('button', { class: 'icon-btn', title: 'Listeden kaldır', onclick: () => removeRecent(acctId, dir) }, '✕')))
    : [h('div', { class: 'empty-recent' }, 'Henüz klasör yok. Bir klasör seçtiğinizde burada listelenir.')];

  pane.launcher.innerHTML = '';
  pane.launcher.style.setProperty('--c', a.color);
  pane.launcher.append(
    h('div', { class: 'launcher-inner' },
      !state.info.ptyOk
        ? h('div', { class: 'error-banner' },
            'Terminal modülü (node-pty) yüklenemedi. Panel klasöründe terminalden ',
            h('code', {}, 'npm install'), ' çalıştırıp paneli yeniden açın.')
        : null,
      h('h1', {}, `${a.name} · Claude Code`),
      h('p', { class: 'lead' },
        'Claude Code bu Mac\'te, ', h('b', {}, a.name), ' hesabıyla çalışır (ayar klasörü ',
        h('code', {}, tilde(a.configDir || '~/.claude')), '). Bir proje klasörü seçin; sohbet penceresinde başlasın.'),
      h('div', { class: 'launch-actions' },
        h('button', { class: 'primary-btn', onclick: () => pickAndLaunch(acctId, 'new') }, 'Klasör seç ve başlat'),
        h('button', { class: 'ghost-btn', onclick: () => pickAndLaunch(acctId, 'continue') }, 'Klasör seç ve devam et'),
        h('button', { class: 'ghost-btn', onclick: () => pickAndLaunch(acctId, 'terminal') }, 'Terminalde aç')),
      h('div', { class: 'recent-title' }, 'Son klasörler'),
      h('div', { class: 'recent' }, rows),
      h('div', { class: 'tip' },
        h('b', {}, 'Giriş: '), 'Sohbet görünümü, bu hesabın Claude Code girişini kullanır. Henüz giriş yapmadıysanız bir kez ',
        h('b', {}, 'Terminalde aç'), ' ile açıp ', h('code', {}, '/login'), ' yapın; sonra hep sohbet görünümünü kullanabilirsiniz.'))
  );
}

async function pickAndLaunch(acctId, mode) {
  const recents = state.cfg.recents?.[acctId] || [];
  const dir = await window.panel.pickFolder(recents[0] || '~');
  if (!dir) return;
  if (mode === 'terminal') launch(acctId, dir, 'new');
  else {
    await rememberFolder(acctId, dir);
    createChatTab(acctId, dir, mode);
  }
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
  if (state.active !== acctId || state.view[acctId] !== 'code') selectAccount(acctId, 'code');
  state.activeTab[acctId] = null;
  renderTabs(acctId);
}

// ---------- Terminaller ----------

async function launch(acctId, cwd, mode, resumeId) {
  const a = acct(acctId);
  const pane = state.panes[acctId];
  if (!a || !pane) return;
  if (state.active !== acctId || state.view[acctId] !== 'code') selectAccount(acctId, 'code');

  const host = h('div', { class: 'term-host active' });
  pane.termArea.append(host);
  pane.launcher.classList.remove('active');
  for (const t of state.tabs[acctId]) t.host.classList.remove('active');

  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
    fontSize: state.fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    macOptionIsMeta: false, // Türkçe klavyede @, #, { gibi karakterler Option ile yazılıyor
    allowProposedApi: true,
    theme: TERM_THEME,
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

  const res = await window.panel.ptyCreate({ accountId: acctId, cwd, mode, resumeId, cols: term.cols, rows: term.rows });
  if (!res.ok) {
    term.dispose();
    host.remove();
    toast('Terminal açılamadı: ' + res.error, 6000);
    renderTabs(acctId);
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
  state.activeTab[acctId] = tab;

  // Son klasörleri ana süreç güncelledi; yeniden oku
  state.cfg = await window.panel.getConfig();
  renderLauncher(acctId);
  renderTabs(acctId);
  renderSidebar();
  focusCurrent();
}

function renderTabs(acctId) {
  const pane = state.panes[acctId];
  if (!pane) return;
  const active = state.activeTab[acctId];
  pane.tabsEl.innerHTML = '';

  for (const t of state.tabs[acctId]) {
    const modeTag = t.kind === 'chat' ? '' : ({ continue: ' ↻', resume: ' ⟲', 'resume-id': ' ⟲', shell: ' $' }[t.mode] || '');
    const kindIcon = t.kind === 'chat' ? '💬 ' : '⌨ ';
    t.el = h('div', {
      class: `tab ${t === active ? 'active' : ''} ${t.activity ? 'activity' : ''} ${t.attention ? 'attention' : ''} ${t.exited ? 'exited' : ''} ${t.busy ? 'busy' : ''}`,
      onclick: () => activateTab(acctId, t),
      onauxclick: (e) => { if (e.button === 1) closeTab(t); },
    },
      h('span', { class: 'state' }),
      h('span', { class: 'tab-label', title: `${tilde(t.cwd)}${t.termTitle ? '\n' + t.termTitle : ''}` }, kindIcon + t.title + modeTag),
      h('button', { class: 'tab-close', title: 'Kapat (⌘W)', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, '×'));
    pane.tabsEl.append(t.el);
  }

  for (const t of state.tabs[acctId]) t.host.classList.toggle('active', t === active);
  pane.launcher.classList.toggle('active', !active);
  pane.addBtn.classList.toggle('on', !active);
  if (active) active.el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function activateTab(acctId, tab) {
  state.activeTab[acctId] = tab;
  clearFlags(tab);
  renderTabs(acctId);
  renderSidebar();
  focusCurrent();
}

function closeTab(tab, force) {
  if (!tab) return;
  if (tab.kind === 'chat') {
    if (!force && tab.busy && !confirm(`"${tab.title}" sohbetinde Claude hâlâ çalışıyor. Kapatılsın mı? (Sonra "Devam et" ile dönebilirsiniz.)`)) return;
    if (tab.chatId) { window.panel.chatClose(tab.chatId); chatsById.delete(tab.chatId); }
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

// ---------- Chat ----------

function ensureWebview(acctId) {
  const pane = state.panes[acctId];
  if (!pane || pane.webview) return;

  const btn = (label, title, fn) => h('button', { class: 'icon-btn', title, onclick: fn }, label);
  const back = btn('←', 'Geri', () => wv.canGoBack() && wv.goBack());
  const fwd = btn('→', 'İleri', () => wv.canGoForward() && wv.goForward());
  const reload = btn('↻', 'Yenile', () => wv.reload());
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
  const newChat = h('button', { class: 'mini', onclick: () => wv.loadURL('https://claude.ai/new') }, '+ Yeni sohbet');
  const ext = btn('↗', 'Varsayılan tarayıcıda aç', () => window.panel.openExternal(wv.getURL()));

  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:chat-${acctId}`);
  wv.setAttribute('src', 'https://claude.ai/new');
  wv.setAttribute('allowpopups', '');

  // claude.ai/code'daki "Local" seçeneği sadece resmi masaüstü uygulamasında çalışıyor.
  // Bu sayfaya gelindiğinde paneldeki yerel Code bölümüne yönlendiren bir uyarı göster.
  let bannerDismissed = false;
  const banner = h('div', { class: 'code-banner', hidden: true },
    h('span', { class: 'code-banner-icon' }, '⌨'),
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
    h('div', { class: 'chat-toolbar' }, back, fwd, reload, url, newChat, ext),
    h('div', { class: 'chat-loading' }),
    banner,
    wv
  );
  pane.webview = wv;
  back.disabled = fwd.disabled = true;
}

// ---------- Ayarlar ----------

const COLORS = ['#3f9b84', '#d97757', '#7c7ce0', '#e2b86b', '#c49be0', '#6fc1c1'];

function openSettings() {
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

window.panel.onMenu((cmd, arg) => {
  if (!$('#modal').hidden && cmd !== 'settings') return;
  switch (cmd) {
    case 'account': selectAccount(arg); break;
    case 'toggle': setView(state.view[state.active] === 'code' ? 'chat' : 'code'); break;
    case 'view': setView(arg); break;
    case 'newTab': showLauncher(state.active); break;
    case 'closeTab':
      if (state.view[state.active] === 'code') closeTab(state.activeTab[state.active]);
      break;
    case 'nextTab': if (state.view[state.active] === 'code') cycleTab(arg); break;
    case 'settings': $('#modal').hidden ? openSettings() : closeSettings(); break;
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

  $('#viewSeg').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.view;
    if (v) setView(v);
  });
  $('#settingsBtn').onclick = openSettings;
  $('#modalClose').onclick = closeSettings;
  $('#modalCancel').onclick = closeSettings;
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeSettings(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeSettings(); });
  window.addEventListener('focus', () => {
    const t = state.activeTab[state.active];
    if (t && isVisible(t)) clearFlags(t);
  });

  const start = acct(state.cfg.lastAccount) ? state.cfg.lastAccount : accounts()[0].id;
  selectAccount(start);
}

init();
