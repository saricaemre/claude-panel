// Yazma kutusunun kolaylıkları (Claude Code'daki gibi; docs/claude-code-eksikleri/PLAN.md madde 10):
// - İstem geçmişi: boş kutuda ↑ / ↓ bu sekmenin önceki mesajları (kabuk komutları dahil, kipiyle); Ctrl+R ile arama (kutu "/" önerileriyle
//   ortak: tab.slashBox, `.history`). Kuyrukta alınmamış mesaj varsa boş kutuda ↑ önce onu geri alır (Claude Code'un "↑ ile sıradakini düzenle"si).
// - Önerilen istem: Claude Code'un prompt_suggestion'ı (ayar: config.json → promptSuggestions) boş kutuda soluk yazı olarak, Tab ile alınır.
//   Öneri tur bittikten sonra gelir; bu arada yeni mesaj gittiyse eskimiştir, atılır (ölçüldü: olcum/kolayliklar.mjs oneri).

const HISTORY_MAX = 300;
const HISTORY_SHOW = 8;

// Geçmişe ekleme (gönderilen mesaj, çalıştırılan komut, yüklenen geçmişin kullanıcı mesajları). Art arda aynısı bir kez.
function rememberPrompt(tab, text, shell = false) {
  text = String(text || '').trim();
  if (!text) return;
  const list = (tab.promptHistory ||= []);
  const last = list[list.length - 1];
  if (last && last.text === text && last.shell === shell) return;
  list.push({ text, shell });
  if (list.length > HISTORY_MAX) list.shift();
}

const caretOnFirstLine = (input) => input.selectionStart === input.selectionEnd && !input.value.slice(0, input.selectionStart).includes('\n');
const caretOnLastLine = (input) => input.selectionStart === input.selectionEnd && !input.value.slice(input.selectionEnd).includes('\n');

function showHistoryEntry(tab, entry) {
  setShellMode(tab, !!entry?.shell); // renderer/kabuk.js
  tab.input.value = entry ? entry.text : '';
  const end = tab.input.value.length;
  tab.input.setSelectionRange(end, end);
  tab.autosize?.();
}

// wireComposer'ın keydown'ı (öneri kutusu kapalıyken) çağırır; işlediyse true
function promptKeys(tab, e) {
  const input = tab.input;
  if (e.isComposing || e.altKey || e.metaKey) return false;
  if (e.key === 'r' && e.ctrlKey && !e.shiftKey) { e.preventDefault(); openHistorySearch(tab); return true; }
  if (e.ctrlKey) return false;
  // Önerilen istem: boş kutuda Tab
  if (e.key === 'Tab' && !e.shiftKey && tab.suggestion && !input.value) {
    e.preventDefault();
    const s = tab.suggestion;
    clearSuggestion(tab);
    input.value = s;
    input.setSelectionRange(s.length, s.length);
    tab.autosize?.();
    if (tab.busy) tab.sendBtn.hidden = false;
    return true;
  }
  if (e.shiftKey) return false;
  const list = tab.promptHistory || [];
  if (e.key === 'ArrowUp' && caretOnFirstLine(input) && (!input.value || tab.histIdx != null)) {
    // Sıradaki (alınmamış) mesaj varsa önce o geri gelir
    if (!input.value && tab.histIdx == null) {
      const queued = [...tab.list.querySelectorAll(':scope > .msg-user.queued:not(.sending)')].pop();
      if (queued) { e.preventDefault(); withdrawQueued(tab, queued); return true; }
    }
    if (!list.length) return false;
    e.preventDefault();
    if (tab.histIdx == null) { tab.histIdx = list.length; tab.histDraftShell = !!tab.shellMode; }
    if (tab.histIdx > 0) tab.histIdx--;
    showHistoryEntry(tab, list[tab.histIdx]); // değer kodla değişince input olayı gelmez: gezinme sürer
    return true;
  }
  if (e.key === 'ArrowDown' && tab.histIdx != null && caretOnLastLine(input)) {
    e.preventDefault();
    tab.histIdx++;
    if (tab.histIdx >= list.length) {
      tab.histIdx = null;
      showHistoryEntry(tab, { text: '', shell: tab.histDraftShell });
    } else showHistoryEntry(tab, list[tab.histIdx]);
    return true;
  }
  return false;
}

// Yazınca (input olayı) gezinme biter; öneri kalkar
function promptTyped(tab) {
  tab.histIdx = null;
  if (tab.suggestion) clearSuggestion(tab);
}

// ---------- Ctrl+R: geçmişte arama ----------
function openHistorySearch(tab) {
  if (!(tab.promptHistory || []).length) { toast('Bu sohbette henüz geçmiş yok.'); return; }
  tab.histSearch = true;
  updateHistorySearch(tab);
}
function closeHistorySearch(tab) {
  if (!tab.histSearch) return;
  tab.histSearch = false;
  tab.slashBox.classList.remove('history');
  tab.slashBox.hidden = true;
}
function updateHistorySearch(tab) {
  const box = tab.slashBox;
  const q = mentionNorm(tab.input.value.trim()); // renderer/mentions.js
  const seen = new Set();
  const items = [];
  for (const e of [...(tab.promptHistory || [])].reverse()) {
    const k = (e.shell ? '!' : '') + e.text;
    if (seen.has(k)) continue;
    seen.add(k);
    if (q && !mentionNorm(e.text).includes(q)) continue;
    items.push(e);
    if (items.length >= HISTORY_SHOW) break;
  }
  box.classList.remove('mention');
  box.classList.add('history');
  box.innerHTML = '';
  box.append(h('div', { class: 'mention-note hist-head' }, 'Geçmişte ara · ↑↓ seç, Enter al, Esc kapat'));
  items.forEach((e, i) => {
    const el = h('div', {
      class: 'slash-item hist-item' + (i === 0 ? ' on' : ''), title: e.text,
      onmousedown: (ev) => { ev.preventDefault(); el.__pick(); },
    }, e.shell ? h('span', { class: 'hist-shell' }, '!') : null, h('span', { class: 'hist-text' }, e.text.replace(/\s+/g, ' ')));
    el.__pick = () => { closeHistorySearch(tab); showHistoryEntry(tab, e); tab.input.focus(); };
    box.append(el);
  });
  if (!items.length) box.append(h('div', { class: 'mention-note' }, 'Eşleşen yok.'));
  box.hidden = false;
}

// ---------- Önerilen istem ----------
function clearSuggestion(tab) {
  if (!tab.suggestion) return;
  tab.suggestion = null;
  tab.composerBox?.classList.remove('has-suggestion');
  if (tab.input) tab.input.placeholder = tab.shellMode ? SHELL_PLACEHOLDER : DEFAULT_PLACEHOLDER;
}
function handleSuggestion(tab, msg) {
  const s = String(msg.suggestion || '').trim().replace(/\s+/g, ' ');
  // Tur bittikten sonra mesaj gittiyse, son tur hatayla bittiyse ya da Claude yeniden çalışıyorsa öneri eskidir
  if (!s || tab.busy || !tab.suggestOk || tab.input.value || tab.shellMode || tab.reborning || tab.rewinding) return;
  tab.suggestion = s.slice(0, 300);
  tab.input.placeholder = tab.suggestion;
  tab.composerBox?.classList.add('has-suggestion');
}
