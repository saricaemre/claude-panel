/* Claude Panel — yeniden doğuş kartı (ana süreç: dogus.js; docs/octopus/OCTOPUS-PLANI.md §7.8 f, P7.3).
   Ahtapotun başında, sıkıştırma kartlarındaki ve bağlam halkası menüsündeki "Yeniden doğsun" ile açılır. Önce tahmini bedeli gösterip onay ister (İ1, İ6);
   onaylanınca adımlar bu kartta ilerler: eski beden defterini günceller, devir notu kurulur, eski beden notu okur, yeni beden açılır, sınav yapılır.
   Sürerken yazma alanı ve yan oturum bildirimleri bekler (turlar karışmasın). Eski beden fosil olur (ahtapot bölmesinde "Fosiller"). */

const REBIRTH_STEPS = [
  ['defter', 'Eski beden defterini günceller'],
  ['note', 'Devir notu kurulur'],
  ['audit', 'Eski beden notu okur, eksikleri söyler'],
  ['birth', 'Yeni beden devir notuyla açılır'],
  ['exam', 'Sınav yapılır'],
];

async function offerRebirth(tab) {
  if (!tab?.chatId || !tab.octopusId) return toast('Yeniden doğuş yalnız ahtapotun başında yapılır.');
  if (tab.reborning) return toast('Yeniden doğuş sürüyor.');
  const open = tab.rebirthCard;
  if (open?.isConnected && !open.classList.contains('answered') && !open.classList.contains('running')) { open.scrollIntoView({ block: 'center' }); return; }
  const r = await window.panel.rebirthPlan(tab.chatId);
  if (!r?.ok) return toast('Yeniden doğulamıyor: ' + (r?.error || 'bilinmeyen hata'));
  retireCompactCards(tab); // renderer/compaction.js
  markStarted(tab);
  endGroup(tab);
  const ctx = r.context != null ? `~${fmtTokens(r.context)} token` : 'ölçülemedi';
  const card = h('div', { class: 'compact-card rebirth-card', 'data-kind': 'plan' },
    h('div', { class: 'perm-title' }, 'Yeniden doğuş · tahmini bedel'),
    h('div', { class: 'compact-text' }, 'Bu bedenin yerine yeni bir Claude Code oturumu açılır; yeni beden konuşmayı değil, bir devir notunu alır. ' +
      'Eski oturum silinmez ve sıkıştırılmaz: fosil olur, baş ona danis ile danışabilir.'),
    h('ol', { class: 'rebirth-steps' },
      h('li', {}, `Eski beden defterini günceller: kısa bir tur, bağlam ${ctx} (önbellekten okunması beklenir).`),
      h('li', {}, `Devir notu kurulur: defter (${r.rows} açık satır), oturumun ilk görevi, son ${r.turns} tur, ${r.arms} açık kol; ~${fmtTokens(r.noteTokens)} token.`),
      h('li', {}, `Eski beden notu okur, eksikleri söyler: kısa bir tur, bağlam ${ctx} + not.`),
      h('li', {}, `Yeni beden devir notuyla açılır: ~${fmtTokens(r.noteTokens)} token ve Claude Code'un sistem istemi.`),
      h('li', {}, 'Sınav yapılır: yeni bedenin bağlamı kadar; 30 bin tokenın altındaysa kendiliğinden, üstündeyse sorulur.')),
    r.file ? null : h('div', { class: 'compact-keep' }, 'Eski bedenin oturum dosyası bulunamadı: not son turlar olmadan kurulur.'),
    h('div', { class: 'perm-actions' },
      h('button', { class: 'primary-btn', onclick: () => startRebirth(tab, card) }, 'Yeniden doğ'),
      h('button', { class: 'ghost-btn', onclick: () => closeRebirth(card, 'Yeniden doğulmadı.') }, 'Vazgeç')));
  tab.rebirthCard = card;
  append(tab, card);
  scrollDown(tab, true);
}

function closeRebirth(card, text) {
  card.classList.add('answered');
  for (const b of card.querySelectorAll('button')) b.disabled = true;
  card.append(h('div', { class: 'compact-keep' }, text));
}

async function startRebirth(tab, card) {
  for (const b of card.querySelectorAll('button')) b.disabled = true;
  tab.reborning = true;
  card.classList.add('running');
  card.dataset.kind = 'running';
  card.replaceChildren(
    h('div', { class: 'perm-title' }, 'Yeniden doğuluyor…'),
    card.stepsEl = h('ol', { class: 'rebirth-steps progress' }, REBIRTH_STEPS.map(([k, label]) => h('li', { 'data-step': k, 'data-state': 'wait' }, label))),
    card.noteEl = h('div', { class: 'rebirth-note' }),
    card.msgEl = h('div', { class: 'compact-keep' }, 'Sürerken yazma alanı bekler; yan oturum bildirimleri sonra iletilir.'));
  const r = await window.panel.rebirthStart(tab.chatId);
  if (!r?.ok && tab.reborning) rebirthEvent(tab, { kind: 'error', error: r?.error || 'bilinmeyen hata' }); // başlamadan reddedildi
}

function stepState(card, step, state) {
  const li = card?.stepsEl?.querySelector(`[data-step="${step}"]`);
  if (li) li.dataset.state = state;
}

function noteDetails(card, note, label) {
  card.noteEl.replaceChildren(h('details', { class: 'rebirth-note-d' }, h('summary', {}, `${label} (${note.length.toLocaleString('tr-TR')} karakter)`), h('pre', {}, note)));
}

function rebirthEvent(tab, ev) {
  const card = tab.rebirthCard;
  if (ev.kind === 'step') {
    const i = REBIRTH_STEPS.findIndex(([k]) => k === ev.step);
    REBIRTH_STEPS.forEach(([k], j) => { if (j < i) stepState(card, k, 'ok'); });
    stepState(card, ev.step, 'run');
    if (ev.step === 'note' && ev.changed != null) stepState(card, 'defter', 'ok');
    if (ev.step === 'defter' || ev.step === 'audit') setBusy(tab, true);
    if (ev.step === 'birth') {
      if (ev.note && card) noteDetails(card, ev.note, 'Devir notu');
      divider(tab, 'Yeni beden · devir notuyla açıldı');
      resetTasks(tab); // eski bedenin arka plan görevleri onunla kapandı (renderer/activity.js)
      setBusy(tab, true);
    }
  } else if (ev.kind === 'note') {
    if (card) noteDetails(card, ev.note, 'Devir notu taslağı');
  } else if (ev.kind === 'done') {
    tab.reborning = false;
    REBIRTH_STEPS.slice(0, 4).forEach(([k]) => stepState(card, k, 'ok'));
    // sınav kartı ayrıca gelir (renderer/sinav.js → rebirthExamDone); defterde puanlanacak satır yoksa sınav yapılmaz
    if (card) {
      card.classList.remove('running');
      card.classList.add('done');
      card.dataset.kind = 'done';
      card.querySelector('.perm-title').textContent = 'Yeniden doğdu';
      card.msgEl.textContent = `Eski beden (${ev.from.slice(0, 8)}…) fosil oldu; baş artık yeni beden (${ev.to.slice(0, 8)}…). Fosiller ahtapot bölmesinde.`;
    }
    deliverSessionEvents(tab); // renderer/sessions.js: bekleyen kol bildirimleri yeni bedene
    tab.octoView?.refresh();
  } else if (ev.kind === 'error') {
    tab.reborning = false;
    if (card) {
      card.classList.remove('running');
      card.classList.add('answered', 'failed');
      card.dataset.kind = 'error';
      card.querySelector('.perm-title').textContent = 'Yeniden doğulamadı';
      for (const li of card.stepsEl?.querySelectorAll('[data-state="run"]') || []) li.dataset.state = 'fail';
      card.msgEl.textContent = ev.error;
    } else toast('Yeniden doğulamadı: ' + ev.error);
    deliverSessionEvents(tab);
  }
  scrollDown(tab);
}

window.panel.onRebirth((id, ev) => { const tab = chatsById.get(id); if (tab && ev) rebirthEvent(tab, ev); });
