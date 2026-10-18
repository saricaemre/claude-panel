/* Claude Panel — bağlam göstergesi ve sıkıştırma izni (ana süreç: compaction.js; docs/octopus/OCTOPUS-PLANI.md İ1, P2.2).
   Yazma alanının altında bir halka (her tur sonunda getContextUsage), %80'de uyarı kartı.
   Claude Code otomatik sıkıştırmak isteyince ana süreç bloklar, burada onay kartı açılır.
   Ahtapotun başında bir kez: oturum kayıtlarının saklama süresi önerisi (cleanupPeriodDays). */

// "Talimatla sıkıştır"ın /compact talimatı. Üst üste sıkıştırmada düşen bilgilere göre seçildi (OCTOPUS-PLANI.md §6.2).
const COMPACT_TEMPLATE = 'Retleri gerekçeleriyle, kullanıcının zevk ve kalite çıtası alıntılarını, oturumun ilk görevini, açık işleri ve karar kimliklerini koru.';
const CONTEXT_WARN = 80;

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' milyon';
  if (n >= 1e3) return Math.round(n / 1e3) + ' bin';
  return String(n);
}

// ---------- Halka ----------

function contextRing(tab) {
  const { svg, bar } = ringSvg(); // renderer/usage.js
  const label = h('span', { class: 'ctx-pct' });
  const btn = h('button', { class: 'ctx-ring', hidden: true, onclick: () => contextMenu(tab, btn) }, svg, label);
  btn.bar = bar;
  btn.label = label;
  return btn;
}

function contextMenu(tab, anchor) {
  if (openMenu.anchor === anchor) return closeMenu();
  const u = tab.context;
  openMenu(anchor, [
    u && { header: `Bağlam %${u.percentage} dolu` + (u.totalTokens && u.maxTokens ? ` · ${fmtTokens(u.totalTokens)} / ${fmtTokens(u.maxTokens)} token` : '') },
    { icon: 'layers', label: 'Talimatla sıkıştır', desc: 'Retler, zevk ve kalite çıtası, ilk görev, açık işler ve kararlar korunur', onclick: () => compactNow(tab) },
    tab.octopusId && { icon: 'octopus', label: 'Yeniden doğ', desc: 'Yeni beden devir notuyla açılır; eski oturum fosil olur', onclick: () => offerRebirth(tab) }, // renderer/dogus.js
  ]);
}

function setContextUsage(tab, u) {
  tab.context = u;
  const btn = tab.ctxRing;
  const pct = u.percentage;
  btn.hidden = false;
  btn.dataset.level = pct >= 90 ? 'high' : pct >= CONTEXT_WARN ? 'warn' : 'low';
  btn.bar.setPct(pct);
  btn.label.textContent = pct >= CONTEXT_WARN ? `%${pct}` : '';
  btn.title = `Bağlam: %${pct} dolu` + (u.totalTokens && u.maxTokens ? ` (${fmtTokens(u.totalTokens)} / ${fmtTokens(u.maxTokens)} token)` : '');
  if (pct < CONTEXT_WARN) { tab.ctxWarned = false; return; }
  if (tab.ctxWarned) return;
  tab.ctxWarned = true; // eşik her aşılışında bir kez
  const ask = state.cfg.autoCompact !== 'allow';
  compactCard(tab, 'warn', `Bağlam %${pct} doldu`,
    !u.autoCompact ? 'Otomatik sıkıştırma kapalı; pencere dolarsa Claude Code devam edemeyebilir.'
      : ask ? 'Claude Code yakında kendiliğinden sıkıştırmak isteyecek; onayınız olmadan sıkıştırılmaz. Şimdi talimatla sıkıştırırsanız neyin korunacağını siz belirlersiniz.'
        : 'Claude Code yakında kendiliğinden sıkıştıracak (Hesap ayarları: İzin ver). Şimdi talimatla sıkıştırırsanız neyin korunacağını siz belirlersiniz.');
}

// ---------- Kartlar ----------

// Açık kartlardan yalnız sonuncusu yanıt bekler; yenisi gelince ya da kullanıcı sıkıştırınca eskiler kapanır
function retireCompactCards(tab) {
  for (const c of tab.list.querySelectorAll('.compact-card.ctx:not(.answered)')) {
    c.classList.add('answered');
    for (const b of c.querySelectorAll('button')) b.disabled = true;
  }
}

function compactCard(tab, kind, title, text) {
  retireCompactCards(tab);
  markStarted(tab);
  endGroup(tab);
  const card = h('div', { class: `compact-card ctx ${kind}` },
    h('div', { class: 'perm-title' }, title),
    h('div', { class: 'compact-text' }, text),
    h('div', { class: 'compact-keep' }, 'Talimatla sıkıştırmada korunacaklar: retler ve gerekçeleri, zevk ve kalite çıtası alıntıları, oturumun ilk görevi, açık işler, karar kimlikleri.'),
    h('div', { class: 'perm-actions' },
      h('button', { class: 'primary-btn', onclick: () => compactNow(tab) }, 'Talimatla sıkıştır'),
      // Ahtapotun başında: sıkıştırma yerine yeniden doğuş (renderer/dogus.js; önce bedeli gösterip onay ister)
      tab.octopusId ? h('button', { class: 'ghost-btn rebirth-btn', onclick: () => offerRebirth(tab) }, 'Yeniden doğsun') : null,
      h('button', { class: 'ghost-btn', onclick: () => {
        retireCompactCards(tab);
        if (kind === 'blocked') note(tab, 'Sıkıştırılmadı. Bağlam dolmaya devam ederse Claude Code yeniden sorar.', 'muted');
      } }, 'Şimdilik devam')));
  append(tab, card);
  scrollDown(tab, true);
  return card;
}

function compactNow(tab) {
  if (!tab.chatId) return toast('Sohbet açık değil.');
  retireCompactCards(tab);
  sendMessage(tab, '/compact ' + COMPACT_TEMPLATE); // renderer/chat.js
}

function showCompactBlocked(tab, info) {
  tab.compactBlocked = true; // ardından gelen compact_result: 'failed' ayrıca not yazmaz
  if (tab.reborning) return note(tab, 'Otomatik sıkıştırma atlandı: yeniden doğuş sürüyor.', 'muted'); // renderer/dogus.js
  compactCard(tab, 'blocked', info?.percentage != null ? `Bağlam %${info.percentage} doldu` : 'Bağlam doldu',
    'Claude Code şimdi kendiliğinden sıkıştıracaktı; onayınız olmadan sıkıştırılmaz.');
  if (!isVisible(tab) || !document.hasFocus()) flagAttention(tab, 'Bağlam doldu: sıkıştırma onayınızı bekliyor');
}

// status mesajları: "özetleniyor" notu sıkıştırma bitince ya da atlanınca kalkar (eskiden atlanan sıkıştırmada kalıyordu)
function compactStatus(tab, msg) {
  if (msg.status === 'compacting') {
    tab.compactNote?.remove();
    tab.compactNote = note(tab, 'Sohbet özetleniyor…', 'muted');
    tab.compactBlocked = false;
    return;
  }
  if (!msg.compact_result) return;
  tab.compactNote?.remove();
  tab.compactNote = null;
  // Kancanın atlattığı sıkıştırmayı Claude Code ayrıca bir mesajla bildirir; panelin bloku zaten kartta
  if (msg.compact_result === 'failed' && !tab.compactBlocked && !/^skipped/i.test(msg.compact_error || '')) {
    note(tab, 'Özetlenemedi: ' + (msg.compact_error || 'bilinmeyen hata'), 'error');
  }
  tab.compactBlocked = false;
}

// ---------- Kayıt saklama süresi ----------
// Claude Code kayıtları varsayılan 30 günde siler; ahtapotun hafızası bu kayıtlara dayanır (OCTOPUS-PLANI.md §6.6).
// Hesap başına bir kez, yalnız ahtapotun başında sorulur; ayar yalnız onayla yazılır (İ1).
async function offerRetention(tab) {
  if (!tab.octopusId || tab.retentionChecked) return;
  tab.retentionChecked = true;
  if (state.cfg.chatPrefs?.[tab.acctId]?.retentionAsked) return;
  const r = await window.panel.retention(tab.acctId);
  if (!r?.ok || (r.days != null && r.days >= r.want)) return;
  const asked = () => saveAcctPrefs(tab.acctId, { retentionAsked: true }); // renderer/chat.js
  const card = h('div', { class: 'compact-card retention-card' },
    h('div', { class: 'perm-title' }, `Oturum kayıtları ${r.days ?? 30} gün sonra silinebilir`),
    h('div', { class: 'compact-text' }, `Claude Code eski oturum kayıtlarını ${r.days ?? 30} günde siler (cleanupPeriodDays). Ahtapotun hafızası bu kayıtlara dayanır. Süre ${r.want} gün (10 yıl) yapılsın mı?`),
    r.shared ? h('div', { class: 'compact-keep' }, `Bu ayar dosyası ortak (${tilde(r.file)}): değişiklik onu kullanan bütün hesaplarda ve panel dışındaki Claude Code'da da geçerli olur.`) : null,
    h('div', { class: 'perm-actions' },
      h('button', { class: 'primary-btn', onclick: async () => {
        const w = await window.panel.setRetention(tab.acctId);
        if (!w?.ok) return toast('Yazılamadı: ' + (w?.error || 'bilinmeyen hata'));
        asked();
        done(`Kayıtlar ${w.days} gün saklanacak.`);
      } }, `${r.want} gün sakla`),
      h('button', { class: 'ghost-btn', onclick: () => { asked(); done('Ayar değiştirilmedi.'); } }, 'Şimdi değil')));
  const done = (text) => {
    card.classList.add('answered');
    for (const b of card.querySelectorAll('button')) b.disabled = true;
    card.append(h('div', { class: 'compact-keep' }, text));
  };
  append(tab, card);
}

// ---------- Olaylar ----------

window.panel.onChatContext((id, u) => { const tab = chatsById.get(id); if (tab && u) { setContextUsage(tab, u); tab.octoView?.refresh(); } });
window.panel.onCompactBlocked((id, info) => { const tab = chatsById.get(id); if (tab) showCompactBlocked(tab, info); });
