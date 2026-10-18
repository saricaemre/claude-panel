/* Claude Panel — sınav kartı (ana süreç: sinav.js; docs/octopus/OCTOPUS-PLANI.md P7.2).
   Başın sıkıştırmasından sonra, tur sonunda: tahmin eşiğin (30 bin token) altındaysa sınav kendiliğinden yapılır ve kart sonucu gösterir;
   üstündeyse ya da tahmin yoksa kart önce sorar ("Sınavı yap" / "Atla"). Puan ayrıca ahtapot bölmesinde başın üstünde (renderer/octopus.js). */

function examCard(tab) {
  if (tab.examCard?.isConnected && !tab.examCard.classList.contains('answered')) return tab.examCard;
  markStarted(tab);
  endGroup(tab);
  const card = h('div', { class: 'compact-card exam-card' });
  tab.examCard = card;
  append(tab, card);
  scrollDown(tab, true);
  return card;
}

function showExam(tab, ev) {
  const card = examCard(tab);
  card.dataset.kind = ev.kind;
  const size = ev.questions && ev.rows ? `${typeof ev.questions === 'number' ? ev.questions : ev.questions.length} soru, ${ev.rows} defter satırı` : '';
  if (ev.kind === 'ask') {
    card.replaceChildren(
      h('div', { class: 'perm-title' }, 'Sınav · ' + (ev.estimate != null ? `tahmini ~${fmtTokens(ev.estimate)} token (eşik ${fmtTokens(ev.threshold)})` : 'bedel tahmin edilemedi')),
      h('div', { class: 'compact-text' }, `${ev.reason === 'rebirth' ? 'Baş yeni bir bedenle doğdu.' : 'Bağlam sıkıştırıldı.'} Başın defterden neyi hatırladığı ölçülsün mü? ${size}. Sorular son mesajdan açılan geçici bir dala sorulur; oturuma dokunulmaz, dal sonra silinir.`),
      h('div', { class: 'perm-actions' },
        h('button', { class: 'primary-btn', onclick: () => runExam(tab) }, 'Sınavı yap'),
        h('button', { class: 'ghost-btn', onclick: () => {
          window.panel.examSkip(tab.chatId);
          closeExam(card, 'Sınav yapılmadı.');
        } }, 'Atla')));
    if (!isVisible(tab) || !document.hasFocus()) flagAttention(tab, (ev.reason === 'rebirth' ? 'Yeniden doğuştan' : 'Sıkıştırmadan') + ' sonra sınav onayınızı bekliyor');
  } else if (ev.kind === 'running') {
    card.replaceChildren(
      h('div', { class: 'perm-title' }, 'Sınav yapılıyor…'),
      h('div', { class: 'compact-keep' }, `${size}${ev.estimate != null ? ` · tahmini ~${fmtTokens(ev.estimate)} token` : ''}. Geçici dal son mesajdan açıldı.`));
  } else if (ev.kind === 'done') {
    card.dataset.score = `${ev.hit}/${ev.total}`;
    const missed = ev.missed || [];
    card.replaceChildren(...[
      h('div', { class: 'perm-title' }, `Sınav: ${ev.hit}/${ev.total} satır hatırlandı`),
      h('div', { class: 'compact-text' }, missed.length
        ? 'Hatırlanmayan satırlar, bir sonraki mesajınızla başın masasına yeniden konacak:'
        : 'Defterin masaya konan satırlarının hepsi hatırlandı.'),
      missed.length ? h('ul', { class: 'exam-missed' }, missed.map((l) => h('li', {}, l)), ev.more ? h('li', { class: 'more' }, `… ${ev.more} satır daha`) : null) : null,
      h('details', { class: 'exam-more' }, h('summary', {}, 'Sorular ve bedel'),
        h('ol', {}, (ev.questions || []).map((q) => h('li', {}, q))),
        h('div', { class: 'compact-keep' }, ev.cost || '')),
    ].filter(Boolean)); // replaceChildren null'ı "null" yazısına çevirir
    card.classList.add('done');
    card.dataset.reason = ev.reason || '';
    tab.examCard = null;
    if (ev.reason === 'rebirth') stepState(tab.rebirthCard, 'exam', 'ok'); // yeniden doğuş kartının son adımı (renderer/dogus.js)
  } else if (ev.kind === 'error') {
    closeExam(card, 'Sınav yapılamadı: ' + ev.error);
  }
  scrollDown(tab);
}

async function runExam(tab) {
  const card = tab.examCard;
  for (const b of card?.querySelectorAll('button') || []) b.disabled = true;
  const r = await window.panel.examRun(tab.chatId);
  if (!r?.ok && r?.error === 'Bekleyen sınav yok.' && card) closeExam(card, 'Bekleyen sınav yok.');
}

function closeExam(card, text) {
  card.classList.add('answered');
  for (const b of card.querySelectorAll('button')) b.disabled = true;
  card.append(h('div', { class: 'compact-keep' }, text));
}

window.panel.onExam((id, ev) => { const tab = chatsById.get(id); if (tab && ev) showExam(tab, ev); });
