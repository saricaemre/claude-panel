/* Claude Panel — gömülü tarayıcı bölmesi: sohbetin yanında bir webview.
   Kullanıcı adres çubuğuyla gezinir; Claude aynı sayfayı `browser` aracıyla (ana süreç, browser.js) sürer.
   Her sohbetin kendi sayfası var; çerezler hesap başına (persist:browser-<hesap>). */

// Şemasız yerel adres http, gerisi https (ana süreçteki normalizeUrl ile aynı kural)
function browserAddress(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(localhost|[\w.-]+):\d+/i.test(s)) u = new URL(s);
    else u = new URL((/^(localhost|127\.|\[::1\]|[\w-]+\.(localhost|test))/i.test(s) ? 'http://' : 'https://') + s);
  } catch { return null; }
  return /^https?:$/.test(u.protocol) ? u.href : null;
}

function browserView(tab) {
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } }; // dom-ready'den önce webview yöntemleri hata verir
  const btn = (ic, title, onclick) => h('button', { class: 'icon-btn', title, onclick }, icon(ic, 16));
  const back = btn('back', 'Geri', () => safe(() => cur.wv.canGoBack() && cur.wv.goBack()));
  const fwd = btn('forward', 'İleri', () => safe(() => cur.wv.canGoForward() && cur.wv.goForward()));
  const reload = btn('refresh', 'Yenile', () => safe(() => (cur.wv.isLoading() ? cur.wv.stop() : cur.wv.reload())));
  const addr = h('input', { class: 'br-addr', spellcheck: 'false', placeholder: 'Adres yazın (ör. localhost:3000)', 'aria-label': 'Adres' });
  const head = h('div', { class: 'br-head' },
    back, fwd, reload, addr,
    btn('plus', 'Yeni sekme', () => { view.newTab(); addr.focus(); }),
    btn('camera', 'Ekran görüntüsünü mesaja ekle', () => browserShotToChat(tab)),
    btn('more', 'Görünüm', (e) => browserViewMenu(tab, e.currentTarget)),
    btn('close', 'Kapat', () => closeBrowserInChat(tab)),
    h('div', { class: 'br-progress' }));
  // Sekme şeridi yalnız birden çok sekme varken görünür
  const strip = h('div', { class: 'br-tabs', role: 'tablist', hidden: true });
  const empty = h('div', { class: 'br-empty' }, icon('globe', 22), h('div', {}, 'Bir adres yazın ya da Claude\'dan bir sayfayı açmasını isteyin.'));
  const stage = h('div', { class: 'br-stage' }, empty);
  const el = h('div', { class: 'br-pane' }, strip, head, stage);

  // Her sekme kendi webview'i; Claude'un aracı etkin sekmeyi sürer (sekme değişince ana sürece yeniden bildirilir)
  const tabs = [];
  let cur = null;
  const titleOf = (t) => {
    const url = safe(() => t.wv.getURL(), '') || '';
    if (!url || url === 'about:blank') return 'Yeni sekme';
    return safe(() => t.wv.getTitle(), '') || safe(() => new URL(url).host, '') || url;
  };

  function makeTab() {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', `persist:browser-${tab.acctId}`);
    wv.setAttribute('src', 'about:blank');
    // Açılır pencereler yeni pencere olmaz: ana süreç (browser.js → configureContents) onları aynı sekmede açar
    wv.setAttribute('allowpopups', '');
    const t = { wv, wcId: 0, size: null, scheme: '', frame: h('div', { class: 'br-frame' }, wv), label: h('span', { class: 'br-tab-title' }, 'Yeni sekme') };
    t.el = h('div', { class: 'br-tab', role: 'tab', onclick: () => view.select(t) }, t.label,
      h('button', { class: 'br-tab-x', title: 'Sekmeyi kapat', onclick: (e) => { e.stopPropagation(); view.closeTab(t); } }, icon('close', 12)));
    const refresh = () => {
      t.label.textContent = titleOf(t);
      t.el.title = t.label.textContent;
      if (t === cur) view.update();
    };
    wv.addEventListener('dom-ready', () => {
      if (!t.wcId) { t.wcId = wv.getWebContentsId(); if (t === cur) view.register(); }
      refresh();
    });
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'did-fail-load', 'page-title-updated']) {
      wv.addEventListener(ev, refresh);
    }
    tabs.push(t);
    stage.insertBefore(t.frame, empty);
    strip.append(t.el);
    strip.hidden = tabs.length < 2;
    return t;
  }

  const view = {
    el, tab,
    get wv() { return cur.wv; },
    get current() { return cur; },
    get tabs() { return tabs; },
    // Etkin sekme ana sürece bu sohbetin sayfası olarak bildirilir (Claude'un aracı ona bağlanır)
    async register() {
      if (!cur?.wcId || !tab.chatId) return;
      const r = await window.panel.browserAttach(tab.chatId, cur.wcId);
      if (!r.ok) toast('Tarayıcı bağlanamadı: ' + r.error, 6000);
    },
    update() {
      const wv = cur.wv;
      const url = safe(() => wv.getURL(), '') || '';
      const blank = !url || url === 'about:blank';
      if (document.activeElement !== addr) addr.value = blank ? '' : url;
      back.disabled = !safe(() => wv.canGoBack(), false);
      fwd.disabled = !safe(() => wv.canGoForward(), false);
      const loading = safe(() => wv.isLoading(), false);
      el.classList.toggle('loading', loading);
      reload.title = loading ? 'Durdur' : 'Yenile';
      empty.hidden = !blank || loading;
    },
    go(raw) {
      const url = browserAddress(raw);
      if (!url) return toast('Geçersiz adres. Yalnız http ve https adresleri açılır.');
      if (tab.chatId) window.panel.browserUserNav(tab.chatId, url);
      cur.wv.loadURL(url).catch(() => {});
      cur.wv.focus();
    },
    newTab() { view.select(makeTab()); },
    select(t) {
      if (!t) return;
      cur = t;
      for (const x of tabs) {
        x.frame.classList.toggle('off', x !== t);
        x.el.classList.toggle('on', x === t);
        x.el.setAttribute('aria-selected', String(x === t));
      }
      view.applySize();
      view.register();
      view.update();
    },
    // Son sekme kapanınca bölme de kapanır
    closeTab(t) {
      const i = tabs.indexOf(t);
      if (i < 0) return;
      if (tabs.length === 1) return closeBrowserInChat(tab);
      tabs.splice(i, 1);
      t.frame.remove();
      t.el.remove();
      strip.hidden = tabs.length < 2;
      if (t === cur) view.select(tabs[Math.min(i, tabs.length - 1)]);
    },
    // Claude'un resize'ı hangi sekmeye geldiyse onun boyutu değişir
    setViewport(size, wcId) {
      const t = (wcId && tabs.find((x) => x.wcId === wcId)) || cur;
      t.size = size;
      if (t === cur) view.applySize();
    },
    applySize() {
      const size = cur.size;
      el.classList.toggle('sized', !!size);
      cur.frame.style.width = size ? size.width + 'px' : '';
      cur.frame.style.height = size ? size.height + 'px' : '';
    },
    destroy() { el.remove(); },
  };

  addr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); view.go(addr.value); }
    else if (e.key === 'Escape') { e.stopPropagation(); addr.value = ''; view.update(); addr.blur(); }
  });
  addr.addEventListener('focus', () => addr.select());
  addr.addEventListener('blur', () => view.update());
  view.select(makeTab());
  return view;
}

function browserViewMenu(tab, anchor) {
  const v = tab.browserView?.current;
  if (!v) return;
  const set = async (opts) => {
    if (!tab.chatId) return toast('Sohbet başlayınca kullanılabilir.');
    const r = await window.panel.browserViewport(tab.chatId, opts);
    if (!r.ok) toast('Görünüm değiştirilemedi: ' + r.error);
    else if (opts.colorScheme) v.scheme = opts.colorScheme;
  };
  const w = v.size?.width;
  openMenu(anchor, [
    { header: 'Boyut' },
    { label: 'Masaüstü', desc: 'Bölmenin boyutu', checked: !w, onclick: () => set({ preset: 'desktop' }) },
    { label: 'Telefon', desc: '375 × 812', checked: w === 375, onclick: () => set({ preset: 'mobile' }) },
    { label: 'Tablet', desc: '768 × 1024', checked: w === 768, onclick: () => set({ preset: 'tablet' }) },
    '-',
    { header: 'Tema (prefers-color-scheme)' },
    ...[['auto', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']].map(([s, label]) =>
      ({ label, checked: (v.scheme || 'auto') === s, onclick: () => set({ colorScheme: s }) })),
  ]);
}

// Ekran görüntüsü yazma alanına ek olarak düşer; kullanıcı mesajıyla birlikte gönderir
async function browserShotToChat(tab) {
  if (!tab.chatId) return toast('Sohbet başlayınca kullanılabilir.');
  const r = await window.panel.browserScreenshot(tab.chatId);
  if (!r.ok) return toast('Ekran görüntüsü alınamadı: ' + r.error);
  let host = 'sayfa';
  try { host = new URL(tab.browserView.wv.getURL()).host || host; } catch {}
  tab.attachments.push({ kind: 'image', name: `${host.replace(/[^\w.-]+/g, '-')}.jpg`, path: '', size: r.data.length * 0.75,
    mediaType: 'image/jpeg', data: r.data, url: 'data:image/jpeg;base64,' + r.data });
  renderAttachments(tab.attachments, tab.attach);
  tab.input.focus();
}

function openBrowserInChat(tab, { focus = true } = {}) {
  if (!tab || tab.kind !== 'chat') return;
  closeArtifactInChat(tab);
  closeSimulatorInChat(tab);
  closeChangesInChat(tab);
  closeOctopusInChat(tab);
  if (!tab.browserView) {
    tab.browserView = browserView(tab);
    tab.browserPane.append(tab.browserView.el);
  }
  tab.host.classList.add('browser-open');
  if (focus) requestAnimationFrame(() => tab.browserView?.el.querySelector('.br-addr').focus());
}

function closeBrowserInChat(tab) {
  if (!tab?.browserView) return;
  tab.browserView.destroy();
  tab.browserView = null;
  tab.host.classList.remove('browser-open');
}

function toggleBrowserInChat(tab) {
  if (tab?.browserView) closeBrowserInChat(tab); else openBrowserInChat(tab);
}

// Claude tarayıcıyı kullanınca sohbetin yanında bölme açılır
window.panel.onBrowserOpen((chatId) => openBrowserInChat(chatsById.get(chatId), { focus: false }));
window.panel.onBrowserViewport((chatId, size, wcId) => chatsById.get(chatId)?.browserView?.setViewport(size, wcId));
window.panel.onBrowserDownload((_chatId, name) => toast(`İndirme engellendi: ${name || 'dosya'}`));
