/* Claude Panel — bağlam göstergesi ve sıkıştırma izni (ana süreç: compaction.js; docs/octopus/OCTOPUS-PLANI.md İ1, P2.2).
   Yazma kutusunun çubuğunda bir halka ve yüzde (her tur sonunda getContextUsage); %80'de halka uyarı rengine döner, kart açılmaz.
   Claude Code otomatik sıkıştırmak isteyince ana süreç sessizce bloklar; sıkıştırma yalnız kullanıcı isteyince.
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
// Yazma kutusunun çubuğunda, model seçicinin solunda: ince halka ve yanında hep yüzde ("%12"). Plan kullanımı ise
// modelin sağında, sayısız bir dilimdir (renderer/usage.js → usageButton); ikisi böylece birbirinden ve yükleme simgesinden ayrılır.

function contextRing(tab) {
  const { svg, bar } = ringSvg(); // renderer/usage.js
  const label = h('span', { class: 'ctx-pct' });
  const btn = h('button', { class: 'ctx-ring', hidden: true, 'aria-label': 'Bağlam doluluğu', onclick: () => contextMenu(tab, btn) }, svg, label);
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
  btn.label.textContent = `%${pct}`;
  btn.title = `Bağlam penceresi: %${pct} dolu` + (u.totalTokens && u.maxTokens ? ` (${fmtTokens(u.totalTokens)} / ${fmtTokens(u.maxTokens)} token)` : '')
    + '\nTıklayın: talimatla sıkıştır' + (tab.octopusId ? ' ya da yeniden doğ' : '');
}

// Uyarı ya da onay kartı yok (Emre, 2026-10-26: "ben istersem sıkıştırırım"). Sıkıştırma yalnız kullanıcı isteyince: halkanın menüsündeki
// "Talimatla sıkıştır" ya da /compact. Claude Code'un kendi otomatik sıkıştırması ana süreçte sessizce engellenir (compaction.js, İ1);
// eşiğin üstünde Claude Code her istekten önce yeniden dener, eskiden her denemede kart açılıyordu.

function compactNow(tab) {
  if (!tab.chatId) return toast('Sohbet açık değil.');
  sendMessage(tab, '/compact ' + COMPACT_TEMPLATE); // renderer/chat.js
}

function showCompactBlocked(tab) {
  tab.compactBlocked = true; // ardından gelen compact_result: 'failed' ayrıca not yazmaz
  tab.autoBlockedAt = Date.now(); // Claude Code'un "Compaction blocked…" metni de sohbete çizilmez (renderer/chat.js → blockedCompactText)
}
// Engellenen otomatik sıkıştırmanın Claude Code'un yazdığı metni (status'la aynı metin, bir asistan mesajı olarak)
function blockedCompactText(tab, msg) {
  if (!tab.autoBlockedAt || Date.now() - tab.autoBlockedAt > 10000) return false;
  const text = (msg.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return /^Compaction blocked by PreCompact hook/.test(text);
}

// status mesajları: "özetleniyor" notu sıkıştırma bitince ya da atlanınca kalkar (eskiden atlanan sıkıştırmada kalıyordu).
// Not yalnız kullanıcının istediği sıkıştırmada (tab.compactRequested: /compact gönderildi) ya da otomatik sıkıştırmaya izin verildiyse:
// engellenen her otomatik denemede de "compacting" geliyor, not bir an düşüp kalkıyordu.
function compactStatus(tab, msg) {
  if (msg.status === 'compacting') {
    if (!tab.compactRequested && state.cfg.autoCompact !== 'allow') return;
    tab.compactNote?.remove();
    tab.compactNote = note(tab, 'Sohbet özetleniyor…', 'muted');
    tab.compactBlocked = false;
    return;
  }
  if (!msg.compact_result) return;
  tab.compactRequested = false;
  tab.compactNote?.remove();
  tab.compactNote = null;
  // Kancanın atlattığı sıkıştırmayı Claude Code ayrıca bir mesajla bildirir; panelin bloku sessiz
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

window.panel.onChatContext((id, u) => { const tab = chatsById.get(id); if (tab && u) { setContextUsage(tab, u); updateContext(tab); tab.octoView?.refresh(); } });
window.panel.onCompactBlocked((id, info) => { const tab = chatsById.get(id); if (tab) showCompactBlocked(tab, info); });
