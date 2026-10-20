/* Claude Panel — Claude çalışırken canlı gösterge: sohbetin altında dönen ✳, o an ne yaptığı (düşünüyor, yazıyor,
   komut çalıştırıyor…) parıltılı yazıyla ve turun ne kadar sürdüğü. İzin kartı açıkken "Onayınızı bekliyor" der.
   Yazma alanının kenarındaki dönen ışık CSS'te (.composer-box.working). Tur bitince ikisi de kaybolur. */

const LIVE_VERBS = {
  bash: 'Komut çalıştırıyor', read: 'Dosya okuyor', edit: 'Düzenliyor', search: 'Arıyor', todo: 'Planlıyor',
  agent: 'Alt ajan çalışıyor', web: 'Web\'e bakıyor', mcp: 'Araç kullanıyor', artifact: 'Artifact hazırlıyor',
  sim: 'Simülatörde çalışıyor', browser: 'Tarayıcıda çalışıyor', terminal: 'Terminalde çalışıyor',
  widget: 'Görsel çiziyor', session: 'Yan oturumla çalışıyor',
};

function activityEl() {
  return h('div', { class: 'live-act', hidden: true, 'aria-live': 'polite' },
    h('span', { class: 'la-spark' }, '✳'),
    h('span', { class: 'la-text' }),
    h('span', { class: 'la-time' }));
}

function elapsedText(ms) {
  const s = Math.floor(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} dk ${s % 60} sn` : `${s} sn`;
}

function renderActivity(tab) {
  const el = tab.actEl;
  if (!el || el.hidden) return;
  const waiting = !!tab.list.querySelector('.perm-card:not(.answered)');
  el.classList.toggle('waiting', waiting);
  el.querySelector('.la-text').textContent = waiting ? 'Onayınızı bekliyor' : tab.actWhat || 'Düşünüyor';
  el.querySelector('.la-time').textContent = elapsedText(Date.now() - tab.actStart);
}

// O an ne yapıldığı: akışın başı (yazıyor/düşünüyor), araç çağrısı (kategori fiili), araçlar bitince yine "Düşünüyor"
function setActivity(tab, what) {
  tab.actWhat = what;
  renderActivity(tab);
}
function activityForTool(tab, name) {
  setActivity(tab, LIVE_VERBS[toolCategory(name)] || 'Çalışıyor');
}

function startActivity(tab) {
  const el = tab.actEl;
  if (!el) return;
  if (el.hidden) {
    tab.actStart = Date.now();
    tab.actWhat = 'Düşünüyor';
    el.hidden = false;
    tab.composerBox?.classList.add('working');
    clearInterval(tab.actTimer);
    tab.actTimer = setInterval(() => renderActivity(tab), 1000);
  }
  renderActivity(tab);
  if (nearBottom(tab)) scrollDown(tab, true);
}

function stopActivity(tab) {
  clearInterval(tab.actTimer);
  tab.actTimer = null;
  if (tab.actEl) tab.actEl.hidden = true;
  tab.composerBox?.classList.remove('working');
}
