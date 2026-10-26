// "!" kabuk kipi (Claude Code'un bash kipi; ana süreç: kabuk.js, chat-main.js → chat:shell). Boş yazma kutusuna "!" yazılınca kip açılır
// (yapıştırılan ya da kodla konan metin açmaz: tur özeti düğmeleri, görsellerin sendPrompt taslakları komut çalıştıramaz). Enter komutu
// sohbetin klasöründe ve ortamında çalıştırır; çıktı sohbette bir blokta akar, bitince Claude'a bağlam olarak gider (tur açmadan, sonraki
// mesajla okunur). Boş kutuda ⌫ ya da Esc kipten çıkar. Geçmiş yüklenince Claude Code'un kaydındaki <bash-input>/<bash-stdout> de blok olur.

const DEFAULT_PLACEHOLDER = 'Claude\'a yazın…';
const SHELL_PLACEHOLDER = 'Kabuk komutu (sohbetin klasöründe çalışır)';
const SHELL_SHOW_MAX = 200000; // blokta gösterilen karakter
let shellSeq = 0;

function setShellMode(tab, on) {
  on = !!on;
  if (!!tab.shellMode === on) return;
  clearSuggestion(tab); // renderer/istem.js
  tab.shellMode = on;
  tab.composerBox.classList.toggle('shell-mode', on);
  tab.shellChip.hidden = !on;
  tab.input.placeholder = on ? SHELL_PLACEHOLDER : DEFAULT_PLACEHOLDER;
}

function shellChip() {
  return h('div', { class: 'shell-chip', hidden: true },
    h('span', { class: 'sc-bang' }, '!'), h('span', { class: 'sc-name' }, 'Kabuk'),
    h('span', { class: 'sc-hint' }, 'Komut sohbetin klasöründe çalışır, çıktısı Claude\'a bağlam olarak gider · boşken ⌫ ya da Esc ile çık'));
}

// beforeinput: yalnız klavyeden yazılan "!" (insertText) kipi açar
function shellBeforeInput(tab, e) {
  if (tab.shellMode || e.inputType !== 'insertText' || e.data !== '!' || tab.input.value) return;
  e.preventDefault();
  setShellMode(tab, true);
}
function shellKeys(tab, e) {
  if (!tab.shellMode || e.isComposing) return false;
  if ((e.key === 'Backspace' && !tab.input.value) || (e.key === 'Escape' && tab.slashBox.hidden)) {
    e.preventDefault();
    setShellMode(tab, false);
    return true;
  }
  return false;
}

function shellBlock(tab, cmd, live) {
  markStarted(tab);
  endGroup(tab);
  const out = h('pre', { class: 'ms-out', hidden: true });
  const foot = h('div', { class: 'ms-foot' }, live ? 'Çalışıyor…' : '');
  const stop = h('button', { class: 'ms-stop', hidden: !live, title: 'Komutu durdur (süreç grubuna Ctrl-C)' }, 'Durdur');
  const el = h('div', { class: 'msg-shell' + (live ? ' running' : '') },
    h('div', { class: 'ms-head' }, h('span', { class: 'ms-bang' }, '!'), h('code', { class: 'ms-cmd' }, cmd), h('span', { class: 'spacer' }), stop),
    out, foot);
  Object.assign(el, { __out: out, __foot: foot, __stop: stop, __shown: 0 });
  append(tab, el);
  return el;
}
function shellWrite(el, stream, text) {
  if (!text || el.__shown >= SHELL_SHOW_MAX) return;
  const part = text.slice(0, SHELL_SHOW_MAX - el.__shown);
  el.__shown += part.length;
  el.__out.hidden = false;
  el.__out.append(stream === 'err' ? h('span', { class: 'ms-err' }, part) : document.createTextNode(part));
  if (el.__shown >= SHELL_SHOW_MAX) el.__out.append(h('span', { class: 'ms-more' }, '\n… (görünüm kısaltıldı; Claude\'a baştan ve sondan 30 bin karakter gider)'));
}

async function runShell(tab, cmd) {
  if (!tab.chatId) return;
  if (tab.reborning) return toast('Yeniden doğuş sürüyor; bitince çalıştırabilirsiniz.');
  if (tab.rewinding) return toast('Geri sarma sürüyor; bitince çalıştırabilirsiniz.');
  rememberPrompt(tab, cmd, true); // renderer/istem.js
  tab.input.value = '';
  tab.autosize?.();
  setShellMode(tab, false);
  const runId = 'k' + (++shellSeq);
  const el = shellBlock(tab, cmd, true);
  el.dataset.run = runId;
  el.__stop.onclick = () => { el.__stop.disabled = true; window.panel.chatShellStop(tab.chatId, runId); };
  (tab.shellRuns ||= new Map()).set(runId, el);
  tab.stick = true;
  scrollDown(tab, true);
  const busyAtStart = tab.busy;
  const r = await window.panel.chatShell(tab.chatId, runId, cmd);
  tab.shellRuns.delete(runId);
  el.classList.remove('running');
  el.__stop.hidden = true;
  if (!r?.ok) { el.classList.add('failed'); el.__foot.textContent = 'Çalıştırılamadı: ' + (r?.error || 'bilinmeyen hata'); return; }
  const secs = r.ms < 10000 ? (r.ms / 1000).toFixed(1).replace('.', ',') : String(Math.round(r.ms / 1000));
  const how = r.error ? 'başlatılamadı: ' + r.error : r.timedOut ? '10 dk zaman aşımı, durduruldu' : r.stopped ? 'durduruldu' : `çıkış ${r.code ?? r.signal}`;
  const to = !r.sent ? 'Claude\'a gitmedi (oturum kapandı)'
    : busyAtStart || tab.busy ? 'Claude\'a gitti; çalışırken sonraki adımda okur' : 'Claude\'a bağlam olarak gitti; sonraki mesajınızla okur';
  el.classList.toggle('failed', !!r.error || r.timedOut || (r.code != null && r.code !== 0));
  el.__foot.textContent = `${how} · ${secs} sn · ${to}`;
  el.dataset.code = String(r.code ?? '');
}

window.panel.onChatShellData((chatId, runId, stream, text) => {
  const el = chatsById.get(chatId)?.shellRuns?.get(runId);
  if (!el) return;
  const tab = chatsById.get(chatId);
  const stick = nearBottom(tab);
  shellWrite(el, stream, text);
  if (stick) scrollDown(tab, true);
});

// Geçmişteki kabuk mesajları (Claude Code'un kaydı: panelin tek mesajı ya da terminaldeki Claude Code'un iki ayrı mesajı)
const unq = (s) => s.replace(/‹(\/?bash-)/g, '<$1');
function shellFromHistory(tab, text) {
  if (typeof text !== 'string') return false;
  const cmd = /^\s*<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
  const so = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/.exec(text);
  const se = /<bash-stderr>([\s\S]*?)<\/bash-stderr>/.exec(text);
  if (!cmd && !so && !se) return false;
  let el = null;
  if (cmd) {
    el = shellBlock(tab, unq(cmd[1]), false);
    rememberPrompt(tab, unq(cmd[1]), true);
    tab.lastShellBlock = el;
  } else if (tab.lastShellBlock && !tab.lastShellBlock.__shown && tab.list.lastElementChild === tab.lastShellBlock) el = tab.lastShellBlock;
  else el = shellBlock(tab, '…', false);
  if (so) shellWrite(el, 'out', unq(so[1]));
  if (se) shellWrite(el, 'err', unq(se[1]));
  return true;
}
