/* Claude Panel — yan oturumlar (sessions.js): Claude'un başlattığı sohbet sekmeleri ve tur sonu bildirimleri.
   Bildirim başlatan sohbette bir kart olarak görünür ve sohbet boştayken Claude'a iletilir. Kullanıcı yazmadan
   art arda en çok SESSION_AUTO_MAX kez iletilir; sonrası bekler, kullanıcı yazınca sıradaki turda gider. */

const SESSION_AUTO_MAX = 5;

const SESSION_QUERIES = {
  async start({ parentId, title, prompt, cwd, worktree }) {
    const parent = chatsById.get(parentId);
    if (!parent) throw new Error('Başlatan sohbet bulunamadı');
    const tab = await createChatTab(parent.acctId, cwd || parent.cwd, 'new', null,
      { background: true, parentId, title, send: prompt, envId: parent.envId || '', worktree });
    if (!tab?.chatId) {
      const err = tab?.startError;
      if (tab) closeTab(tab, true);
      throw new Error(err || 'Yan oturum başlatılamadı');
    }
    return { id: tab.chatId };
  },
  info({ childId }) {
    const tab = chatsById.get(childId);
    if (!tab) throw new Error(`Yan oturum ${childId} açık değil`);
    return { cwd: tilde(tab.cwd), branch: tab.worktree?.branch || '' };
  },
  // Kullanıcının o sekmede yazdığı taslağa dokunmadan mesajı gönderir
  send({ childId, text }) {
    const tab = chatsById.get(childId);
    if (!tab || !tab.chatId) throw new Error(`Yan oturum ${childId} açık değil`);
    const content = messageContent(text, []);
    markStarted(tab);
    userBubble(tab, content, tab.busy);
    window.panel.chatSend(tab.chatId, content);
    chatsById.get(tab.parentId)?.octoView?.pulse(childId, 'down'); // ahtapotta baştan kola atım
    if (!tab.busy) setBusy(tab, true);
    return {};
  },
};

window.panel.onSessionQuery(async (id, op, args) => {
  try {
    if (!SESSION_QUERIES[op]) throw new Error('Bilinmeyen istek: ' + op);
    window.panel.sessionReply(id, { ok: true, ...(await SESSION_QUERIES[op](args || {})) });
  } catch (err) {
    window.panel.sessionReply(id, { ok: false, error: err?.message || String(err) });
  }
});

// Yan oturumun tur sonu ya da izin beklemesi. Beklerken Claude'a iletilmez: kartı yalnız kullanıcı yanıtlayabilir.
function sessionNote(tab, ev) {
  const waiting = ev.state === 'waiting';
  const who = tab.octopusId ? 'kolu' : 'yan oturumu';
  const what = waiting ? 'seni bekliyor' : ev.state === 'stopped' ? `${who} durdu` : `${who} turunu bitirdi`;
  const status = h('span', { class: 'sn-status' }, waiting ? '' : 'iletilecek');
  const el = h('div', { class: 'session-note' + (waiting ? ' waiting' : ''), 'data-state': ev.state },
    h('div', { class: 'sn-head' }, icon(tab.octopusId ? 'octopus' : 'sparkle', 14),
      h('b', {}, ev.title), h('span', {}, what),
      h('span', { class: 'spacer' }), status,
      h('button', { class: 'mini', onclick: () => {
        const child = chatsById.get(ev.childId);
        if (child) activateTab(child.acctId, child); else toast('Yan oturum kapanmış.');
      } }, 'Oturumu aç')),
    ev.text ? h('div', { class: 'sn-text' }, ev.text.length > 300 ? ev.text.slice(0, 300) + '…' : ev.text) : null);
  el.__status = status;
  endGroup(tab);
  append(tab, el);
  scrollDown(tab);
  return el;
}

const attr = (s) => String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

const SESSION_FOOTER = 'Bu, başlattığın yan oturumdan otomatik bir tur sonu bildirimidir; kullanıcı yazmadı. Sonucu doğrulamadan bitti deme.';

// Sıradaki bildirimler (yan oturum ve PR izleme: renderer/prwatch.js) tek mesajda iletilir: { text, footer, card }
function deliverSessionEvents(tab) {
  if (!tab?.chatId || tab.busy || tab.reborning || !tab.pendingEvents?.length) return; // yeniden doğuş sürerken bekler (renderer/dogus.js)
  if (tab.autoTurns >= SESSION_AUTO_MAX) {
    for (const { card } of tab.pendingEvents) card.__status.textContent = 'bekliyor: siz yazınca iletilecek';
    return;
  }
  const items = tab.pendingEvents.splice(0);
  tab.autoTurns++;
  const text = items.map((x) => x.text).join('\n') + '\n\n' + [...new Set(items.map((x) => x.footer))].join('\n\n');
  for (const { card } of items) { card.__status.textContent = 'Claude\'a iletildi'; card.classList.add('delivered'); }
  window.panel.chatSend(tab.chatId, text);
  setBusy(tab, true);
}

window.panel.onSessionEvent((parentId, ev) => {
  const tab = chatsById.get(parentId);
  if (!tab) return;
  if (ev.state === 'waiting') return void sessionNote(tab, ev);
  tab.octoView?.pulse(ev.childId, 'up'); // ahtapotta tur sonu raporu koldan başa
  const text = `<yan-oturum-olayi oturum="${ev.childId}" baslik="${attr(ev.title)}" durum="${attr(ev.label || ev.state)}">\n${ev.text || '(yanıt metni yok)'}\n</yan-oturum-olayi>`;
  tab.pendingEvents.push({ text, footer: SESSION_FOOTER, card: sessionNote(tab, ev) });
  deliverSessionEvents(tab);
});
