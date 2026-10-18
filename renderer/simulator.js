/* Claude Panel — gömülü iOS simülatörü: sohbetin yanında canlı görüntü, fareyle dokunma, klavye.
   Simülatör makineye aittir: tek bağlı cihaz vardır, açık bütün bölmeler aynı görüntüyü gösterir. */

const sim = {
  status: { state: 'idle' },
  views: new Set(),
  bitmap: null,      // son çözülen kare (yeni açılan bölme hemen çizsin)
  decoding: false,
  pending: null,     // çözülmeyi bekleyen en yeni kare
  starting: false,
};

// Klavye: tuş adı → HID kodu (yazılabilir karakterler metin olarak gider). Bunlar basılı tutulur: keydown → basma,
// keyup → bırakma; tekrarı iOS yapar (simulator.js → holdKey)
const SIM_KEYS = {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Delete: 76,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
};

const SIM_DEFAULT_POINTS = { w: 402, h: 874 };

function simView(tab) {
  const nameBtn = h('button', { class: 'sim-name', title: 'Cihaz seç' }, h('span', {}, 'Simülatör'), icon('chevronDown', 13));
  const stateEl = h('span', { class: 'sim-state' });
  const canvas = h('canvas', { class: 'sim-screen', tabindex: 0, 'aria-label': 'iPhone ekranı' });
  const dot = h('div', { class: 'sim-touch', hidden: true });
  const dot2 = h('div', { class: 'sim-touch', hidden: true });
  const overlay = h('div', { class: 'sim-overlay' });
  const device = h('div', { class: 'sim-device' }, canvas, dot, dot2, overlay);
  const stage = h('div', { class: 'sim-stage' }, device);
  // live: yalnız bağlıyken çalışan düğmeler
  const btn = (ic, title, onclick, live) => h('button', { class: 'icon-btn' + (live ? ' needs-live' : ''), title, onclick }, icon(ic, 16));
  const head = h('div', { class: 'sim-head' },
    nameBtn, stateEl, h('span', { class: 'spacer' }),
    btn('home', 'Ana ekran', () => simInput({ cmd: 'button', name: 'home' }), true),
    btn('rotate', 'Döndür (yatay/dikey)', () => simInput({ cmd: 'rotate', name: sim.status.orientation === 'portrait' ? 'landscapeLeft' : 'portrait' }), true),
    btn('camera', 'Ekran görüntüsünü mesaja ekle', () => simShotToChat(tab), true),
    btn('more', 'Diğer', (e) => simMore(e.currentTarget)),
    btn('close', 'Kapat', () => closeSimulatorInChat(tab)));
  const el = h('div', { class: 'sim-pane' }, head, stage);
  nameBtn.addEventListener('click', () => simDeviceMenu(nameBtn));

  // Ekranın görünen (dik) boyutu: yatayda en ve boy yer değiştirir
  const disp = () => sim.status.display || sim.status.points || SIM_DEFAULT_POINTS;

  // Cihaz çerçevesi bölmeye sığdırılır (en-boy oranı korunur)
  const fit = () => {
    const p = disp();
    const r = stage.getBoundingClientRect();
    const pad = 56; // kasa gölgesi ve kenar boşluğu
    const w = Math.max(0, Math.min(r.width - pad, (r.height - pad) * p.w / p.h));
    device.style.width = w + 'px';
    device.style.height = (w * p.h / p.w) + 'px';
    device.style.borderRadius = (Math.min(w, w * p.h / p.w) * 0.137) + 'px';
  };
  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  // --- Dokunma: fare, görünen ekranın nokta (point) koordinatına çevrilir; ana süreç fiziksel düzleme çevirir
  const r1 = (v) => Math.round(v * 10) / 10;
  const toPoint = (e) => {
    const p = disp();
    const r = canvas.getBoundingClientRect();
    return {
      x: r1(Math.max(0, Math.min(p.w, (e.clientX - r.left) / r.width * p.w))),
      y: r1(Math.max(0, Math.min(p.h, (e.clientY - r.top) / r.height * p.h))),
    };
  };
  const place = (d, pt) => {
    const p = disp();
    const r = canvas.getBoundingClientRect();
    d.style.left = (pt.x / p.w * r.width) + 'px';
    d.style.top = (pt.y / p.h * r.height) + 'px';
    d.hidden = false;
  };
  // İki parmak (Simulator.app gibi): ⌥ basılıyken ikinci parmak ekranın ortasına göre aynada (sıkıştırma, döndürme);
  // ⌥⇧ ile ikisi birlikte kayar (iki parmakla kaydırma)
  const center = () => { const p = disp(); return { x: p.w / 2, y: p.h / 2 }; };
  const clampPt = (pt) => { const p = disp(); return { x: r1(Math.max(0, Math.min(p.w, pt.x))), y: r1(Math.max(0, Math.min(p.h, pt.y))) }; };
  let gesture = null; // { two, offset } basılıyken
  let last = null;
  let moveRaf = 0;
  const fingers = (pt, e, g) => {
    if (!(g ? g.two : e.altKey)) return [pt];
    const c = center();
    const off = g ? g.offset : e.shiftKey ? { x: 2 * (c.x - pt.x), y: 2 * (c.y - pt.y) } : null;
    return [pt, clampPt(off ? { x: pt.x + off.x, y: pt.y + off.y } : { x: 2 * c.x - pt.x, y: 2 * c.y - pt.y })];
  };
  const show = (fs) => { place(dot, fs[0]); if (fs[1]) place(dot2, fs[1]); else dot2.hidden = true; };
  const hideDots = () => { dot.hidden = true; dot2.hidden = true; };
  const sendFingers = (phase, fs) => {
    if (fs.length === 2) simInput({ cmd: 'touch2', phase, x1: fs[0].x, y1: fs[0].y, x2: fs[1].x, y2: fs[1].y });
    else simInput({ cmd: 'touch', phase, ...fs[0] });
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (sim.status.state !== 'attached' || e.button !== 0) return;
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    endWheel();
    const pt = toPoint(e);
    const c = center();
    gesture = { two: e.altKey, offset: e.altKey && e.shiftKey ? { x: 2 * (c.x - pt.x), y: 2 * (c.y - pt.y) } : null };
    last = fingers(pt, e, gesture);
    show(last);
    sendFingers('down', last);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!gesture) {
      // ⌥ basılıyken iki parmağın nereye değeceği önceden görünür
      if (e.altKey && sim.status.state === 'attached') show(fingers(toPoint(e), e)); else hideDots();
      return;
    }
    last = fingers(toPoint(e), e, gesture);
    show(last);
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => { moveRaf = 0; if (gesture) sendFingers('down', last); });
  });
  const up = (e) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    cancelAnimationFrame(moveRaf);
    moveRaf = 0;
    last = fingers(toPoint(e), e, g);
    hideDots();
    sendFingers('up', last);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!gesture) hideDots(); });

  // --- Tekerlek / iz paneli: parmakla sürüklemeye çevrilir (parmak imleçte basar, kaydırma yönünün tersine gider).
  // Kenara yaklaşan parmak kaldırılıp başlangıca geri konur; 120 ms tekerlek gelmezse kalkar.
  let wheel = null; // { start, pos, timer }
  const WHEEL_MARGIN = 24;
  function endWheel() {
    if (!wheel) return;
    clearTimeout(wheel.timer);
    simInput({ cmd: 'touch', phase: 'up', ...wheel.pos });
    wheel = null;
  }
  canvas.addEventListener('wheel', (e) => {
    if (sim.status.state !== 'attached' || gesture) return;
    e.preventDefault();
    const p = disp();
    const r = canvas.getBoundingClientRect();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
    const dx = e.deltaX * k / r.width * p.w;
    const dy = e.deltaY * k / r.height * p.h;
    if (!wheel) {
      const at = toPoint(e);
      const start = { x: Math.max(WHEEL_MARGIN, Math.min(p.w - WHEEL_MARGIN, at.x)), y: Math.max(WHEEL_MARGIN, Math.min(p.h - WHEEL_MARGIN, at.y)) };
      wheel = { start, pos: start };
      simInput({ cmd: 'touch', phase: 'down', ...start });
    }
    let next = { x: r1(wheel.pos.x - dx), y: r1(wheel.pos.y - dy) };
    const out = next.x < WHEEL_MARGIN || next.x > p.w - WHEEL_MARGIN || next.y < WHEEL_MARGIN || next.y > p.h - WHEEL_MARGIN;
    if (out) {
      // parmağı kaldır, başlangıca koy, kalan hareketi oradan sürdür
      const { start } = wheel;
      simInput({ cmd: 'touch', phase: 'up', ...wheel.pos });
      simInput({ cmd: 'touch', phase: 'down', ...start });
      next = { x: r1(start.x - dx), y: r1(start.y - dy) };
    }
    wheel.pos = next;
    simInput({ cmd: 'touch', phase: 'down', ...next });
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(endWheel, 120);
  }, { passive: false });

  // --- Klavye: odak ekrandayken yazılanlar simülatöre gider. Karakter (Mac'in düzeninde ne yazıldıysa) gider,
  // ana süreç onu simülatörün klavye düzenindeki tuşa çevirir (simulator.js → typeText). ⌘V ile Mac'in panosu da
  // tuşlarla yazılır: iOS'ta yapıştırmak her seferinde "yapıştırmaya izin ver" sorar.
  const held = new Map(); // e.code → HID kodu: bölmede basılı tutulan özel tuşlar
  const releaseAll = () => {
    if (!held.size) return;
    held.clear();
    simInput({ cmd: 'releaseKeys' });
  };
  canvas.addEventListener('keydown', async (e) => {
    if (e.key === 'Meta') releaseAll(); // ⌘ basılıyken Mac öbür tuşların keyup'ını göndermez
    if (sim.status.state !== 'attached' || e.isComposing) return;
    if (SIM_KEYS[e.key] && e.repeat) { e.preventDefault(); return; } // Mac'in tekrarı değil, iOS'unki
    if (e.metaKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      const text = await navigator.clipboard.readText().catch(() => '');
      if (text) simInput({ cmd: 'text', text });
      return;
    }
    if (e.metaKey || e.ctrlKey) return; // panelin kısayolları çalışsın
    if (SIM_KEYS[e.key]) {
      e.preventDefault();
      if (held.has(e.code)) return;
      held.set(e.code, SIM_KEYS[e.key]);
      // ⇧ (ok tuşlarıyla seçim) ve ⌥ (⌥⌫ kelime siler) de gider
      simInput({ cmd: 'key', phase: 'down', code: SIM_KEYS[e.key], mods: [e.shiftKey && 225, e.altKey && 226].filter(Boolean) });
      return;
    }
    if ([...e.key].length === 1) { e.preventDefault(); simInput({ cmd: 'text', text: e.key }); }
  });
  canvas.addEventListener('keyup', (e) => {
    const code = held.get(e.code);
    if (code == null) return;
    e.preventDefault();
    held.delete(e.code);
    simInput({ cmd: 'key', phase: 'up', code });
  });
  // Odak kayınca (başka alan, başka pencere) basılı kalan tuşlar bırakılır
  canvas.addEventListener('blur', releaseAll);

  const view = {
    el, canvas, tab,
    // Kare hep fiziksel (dikey) gelir; yatayda tuvale döndürülerek çizilir
    draw(bmp) {
      const turn = sim.status.state === 'attached' ? sim.status.turn : '';
      const [w, hgt] = turn ? [bmp.height, bmp.width] : [bmp.width, bmp.height];
      if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (turn === 'cw') ctx.setTransform(0, 1, -1, 0, w, 0);
      else if (turn === 'ccw') ctx.setTransform(0, -1, 1, 0, 0, hgt);
      ctx.drawImage(bmp, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    update() {
      const st = sim.status;
      nameBtn.firstChild.textContent = st.name || 'Simülatör';
      stateEl.textContent = st.state === 'starting' ? 'Açılıyor…' : st.state === 'attached' ? '' : 'Bağlı değil';
      el.classList.toggle('live', st.state === 'attached');
      el.classList.toggle('landscape', !!st.turn);
      if (st.state !== 'attached') held.clear(); // bağlantı kesilirken ana süreç bırakır
      head.querySelectorAll('.needs-live').forEach((b) => { b.disabled = st.state !== 'attached'; });
      overlay.innerHTML = '';
      overlay.hidden = st.state === 'attached';
      if (st.state === 'starting') {
        overlay.append(h('div', { class: 'sim-spin' }), h('div', { class: 'sim-msg' }, (st.name ? st.name + ' açılıyor' : 'Açılıyor') + '…'));
      } else if (st.state !== 'attached') {
        if (st.error) overlay.append(h('div', { class: 'sim-msg err' }, st.error));
        overlay.append(h('button', { class: 'primary-btn sim-start', onclick: () => simAttach() }, icon('phone', 15), 'Simülatörü başlat'));
      }
      fit();
      if (sim.bitmap) view.draw(sim.bitmap);
    },
    destroy() { endWheel(); releaseAll(); ro.disconnect(); sim.views.delete(view); el.remove(); },
  };
  sim.views.add(view);
  view.update();
  return view;
}

function simInput(obj) {
  if (sim.status.state === 'attached') window.panel.simInput(obj);
}

async function simAttach(choice) {
  const r = await window.panel.simAttach(choice);
  if (!r.ok) toast('Simülatör açılamadı: ' + r.error, 6000);
}

async function simDeviceMenu(anchor) {
  const r = await window.panel.simDevices();
  if (!r.ok) return toast('Cihazlar okunamadı: ' + r.error, 6000);
  const cur = sim.status.udid;
  const items = [];
  if (r.devices.length) items.push({ header: 'Cihazlar' });
  for (const d of r.devices) {
    items.push({ label: d.name, desc: `${d.runtime}${d.state === 'Booted' ? ' · açık' : ''}`, checked: d.udid === cur, onclick: () => simAttach(d.udid) });
  }
  if (r.creatable.length) {
    items.push('-', { header: `Oluştur · ${r.runtime?.name || 'iOS'}` });
    for (const t of r.creatable) items.push({ label: t.name, icon: 'plus', onclick: () => simAttach('type:' + t.typeId) });
  }
  if (!items.length) items.push({ header: 'iPhone 14 ve üstü simülatör yok' });
  openMenu(anchor, items, 'sim-menu');
}

function simMore(anchor) {
  const st = sim.status;
  openMenu(anchor, [
    ...(st.state === 'attached' ? [
      { header: 'Yön' },
      ...[['portrait', 'Dikey'], ['landscapeLeft', 'Yatay (sola yatık)'], ['landscapeRight', 'Yatay (sağa yatık)']].map(([name, label]) =>
        ({ label, checked: st.orientation === name, onclick: () => simInput({ cmd: 'rotate', name }) })),
      '-',
      { label: 'Kilit düğmesi', icon: 'lock', onclick: () => simInput({ cmd: 'button', name: 'lock' }) },
      { label: 'Bağlantıyı kes', desc: 'Cihaz açık kalır', icon: 'close', onclick: () => window.panel.simDetach() },
    ] : []),
    st.udid ? { label: 'Cihazı kapat', icon: 'power', danger: true, onclick: async () => {
      const r = await window.panel.simShutdown(st.udid);
      if (!r.ok) toast('Kapatılamadı: ' + r.error);
    } } : null,
    { label: 'Yeniden bağlan', icon: 'refresh', onclick: () => simAttach(st.udid) },
  ]);
}

// Ekran görüntüsü yazma alanına ek olarak düşer; kullanıcı mesajıyla birlikte gönderir
async function simShotToChat(tab) {
  const r = await window.panel.simScreenshot();
  if (!r.ok) return toast('Ekran görüntüsü alınamadı: ' + r.error);
  const name = `${(sim.status.name || 'simulator').replace(/\s+/g, '-')}.png`;
  tab.attachments.push({ kind: 'image', name, path: '', size: r.data.length * 0.75, mediaType: 'image/png', data: r.data, url: 'data:image/png;base64,' + r.data });
  renderAttachments(tab.attachments, tab.attach);
  tab.input.focus();
}

function openSimulatorInChat(tab, { start = true } = {}) {
  if (!tab || tab.kind !== 'chat') return;
  closeArtifactInChat(tab);
  closeBrowserInChat(tab);
  closeChangesInChat(tab);
  closeOctopusInChat(tab);
  if (!tab.simView) {
    tab.simView = simView(tab);
    tab.simPane.append(tab.simView.el);
  }
  tab.host.classList.add('sim-open');
  if (start && sim.status.state === 'idle' && !sim.status.error) simAttach();
}

function closeSimulatorInChat(tab) {
  if (!tab?.simView) return;
  tab.simView.destroy();
  tab.simView = null;
  tab.host.classList.remove('sim-open');
  // Bakan kalmadıysa görüntü akışı durur (cihaz açık kalır; Claude gerekirse yeniden bağlanır)
  if (!sim.views.size && sim.status.state === 'attached') window.panel.simDetach();
}

function toggleSimulatorInChat(tab) {
  if (tab?.simView) closeSimulatorInChat(tab); else openSimulatorInChat(tab);
}

async function drawSimFrame(jpeg) {
  if (sim.decoding) { sim.pending = jpeg; return; }
  sim.decoding = true;
  try {
    const bmp = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
    sim.bitmap?.close();
    sim.bitmap = bmp;
    for (const v of sim.views) v.draw(bmp);
  } catch {}
  sim.decoding = false;
  if (sim.pending) { const next = sim.pending; sim.pending = null; drawSimFrame(next); }
}

window.panel.onSimFrame((jpeg) => { if (sim.views.size) drawSimFrame(jpeg); });
window.panel.onSimState((st) => {
  sim.status = st;
  if (st.state !== 'attached') { sim.bitmap?.close(); sim.bitmap = null; }
  for (const v of sim.views) v.update();
});
// Claude simülatörü açınca sohbetin yanında görüntü bölmesi açılır
window.panel.onSimOpen((chatId) => openSimulatorInChat(chatsById.get(chatId), { start: false }));
window.panel.simStatus().then((st) => { sim.status = st; for (const v of sim.views) v.update(); });
