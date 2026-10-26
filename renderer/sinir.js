// Kullanım sınırı ve sınırda otomatik devam (docs/claude-code-eksikleri/PLAN.md madde 10). 2026-10-26'da gerçek CLI 2.1.310'da sahte API'yle
// ölçüldü (olcum/kolayliklar.mjs sinir): rate_limit_event yalnız claude.ai aboneliğiyle (OAuth) gelir, her istekte; 429 'rejected'da olay
// asistanın error: 'rate_limit' mesajından ("You've hit your session limit · resets …") önce gelir, tur is_error ile biter, mesaj kayıtta
// kalır (sonraki mesajla birlikte gider). API anahtarında olay yok: kart sıfırlanma zamanı olmadan çizilir, otomatik devam sunulmaz.
// Anahtar açıksa sıfırlanma anından LIMIT_MARGIN_MS sonra "Devam et." gider; kullanıcı yazarsa kapanır. Yine reddedilirse en çok LIMIT_TRIES kez.

const LIMIT_NAMES = { five_hour: '5 saatlik', seven_day: 'Haftalık', seven_day_opus: 'Haftalık (Opus)', seven_day_sonnet: 'Haftalık (Sonnet)',
  seven_day_overage_included: 'Haftalık', overage: 'Ek kullanım' };
let LIMIT_MARGIN_MS = 60 * 1000; // saat farkı ve sunucunun sıfırlaması için pay (e2e 0 yapar)
const LIMIT_TRIES = 3;
const LIMIT_CONTINUE = 'Devam et.';

function limitWhen(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' ' + time;
}
function limitLeft(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 1 ? 'birazdan' : m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`;
}

function handleRateLimit(tab, msg) {
  const info = msg.rate_limit_info || {};
  tab.rateLimit = info;
  refreshUsageSoon(tab.acctId);
  // Uyarı her istekte yinelenir: pencere (tür + sıfırlanma) başına bir not
  if (info.status === 'allowed_warning') {
    const key = `${info.rateLimitType || ''}:${info.resetsAt || ''}`;
    if (tab.limitWarned === key) return;
    tab.limitWarned = key;
    const pct = typeof info.utilization === 'number' ? ` (%${Math.round(info.utilization * 100)})` : '';
    note(tab, `${LIMIT_NAMES[info.rateLimitType] || 'Kullanım'} sınırına yaklaşıldı${pct}` + (info.resetsAt ? ` · ${limitWhen(info.resetsAt * 1000)}'de sıfırlanır` : ''), 'warn');
  }
}

// Asistanın rate_limit hatası: kart (aynı turdaki "Durdu" notu yazılmaz: tab.limitTurn)
function limitHit(tab, msg) {
  const text = (msg.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  const info = tab.rateLimit?.status === 'rejected' ? tab.rateLimit : null;
  const at = info?.resetsAt ? info.resetsAt * 1000 : null;
  tab.limitTurn = true;
  // Otomatik gönderilen "Devam et." de reddedildi: yeni kart yine kurulur (deneme sayısı sınırlı)
  const retry = tab.limitRetry && Date.now() < tab.limitRetry.until ? tab.limitRetry : null;
  tab.limitRetry = null;
  const name = LIMIT_NAMES[info?.rateLimitType] || '';
  const check = h('input', { type: 'checkbox', class: 'lc-check' });
  const state = h('div', { class: 'lc-state' });
  const card = h('div', { class: 'compact-card limit-card' },
    h('div', { class: 'perm-title' }, 'Kullanım sınırına ulaşıldı'),
    h('div', { class: 'compact-text', title: text }, (name ? name + ' sınır · ' : '') + (at ? `${limitWhen(at)}'de sıfırlanır` : 'sıfırlanma zamanı bilinmiyor')),
    at ? h('label', { class: 'lc-auto' }, check, h('span', {}, 'Sınır sıfırlanınca devam et'),
      h('small', {}, `Sıfırlanınca bu sohbete "${LIMIT_CONTINUE}" gönderilir. Siz yazarsanız kapanır.`)) : null,
    state);
  Object.assign(card, { __state: state, __check: check });
  if (tab.limitCard && tab.limitCard !== card) limitDisarm(tab, ''); // eski kart sessizce söner
  tab.limitCard = card;
  check.onchange = () => (check.checked ? limitArm(tab, at, retry?.tries || 0) : limitDisarm(tab, 'Otomatik devam kapalı.'));
  append(tab, card);
  if (at && retry && retry.tries < LIMIT_TRIES) { check.checked = true; limitArm(tab, at, retry.tries); }
  else if (retry) state.textContent = `${LIMIT_TRIES} denemede de reddedildi; otomatik devam durdu.`;
}

function limitArm(tab, at, tries) {
  clearTimeout(tab.limitAuto?.timer);
  tab.limitAuto = { at: at + LIMIT_MARGIN_MS, tries, timer: null };
  limitTick(tab);
}
function limitDisarm(tab, why, deliver = true) {
  if (!tab.limitAuto) return;
  clearTimeout(tab.limitAuto.timer);
  tab.limitAuto = null;
  const card = tab.limitCard;
  if (card) { card.__check.checked = false; card.__state.textContent = why; }
  if (deliver) deliverSessionEvents(tab); // beklettiği yan oturum / PR bildirimleri (renderer/sessions.js)
}
// Uzun tek zamanlayıcı yerine en çok 30 sn'lik adımlar: Mac uyuyup uyanınca da zamanında gönderilir, kalan süre güncellenir
function limitTick(tab) {
  const a = tab.limitAuto;
  if (!a) return;
  if (tab.exited || !tab.chatId || !chatsById.has(tab.chatId)) { tab.limitAuto = null; return; }
  const left = a.at - Date.now();
  if (left > 0) {
    tab.limitCard.__state.textContent = `${limitWhen(a.at)}'de "${LIMIT_CONTINUE}" gönderilecek (${limitLeft(left)})`;
    a.timer = setTimeout(() => limitTick(tab), Math.min(left, 30000));
    return;
  }
  if (tab.busy || tab.reborning || tab.rewinding) { a.timer = setTimeout(() => limitTick(tab), 5000); return; }
  tab.limitAuto = null;
  tab.limitRetry = { tries: a.tries + 1, until: Date.now() + 5 * 60 * 1000 };
  tab.limitCard.__check.checked = false;
  tab.limitCard.__check.disabled = true;
  tab.limitCard.__state.textContent = `${limitWhen(Date.now())}'de devam edildi.`;
  sendMessage(tab, LIMIT_CONTINUE, null, { auto: true });
}
// Kullanıcı yazdı (yazma kutusu, tur özeti düğmesi): otomatik devam kapanır
function limitUserSent(tab) {
  tab.limitRetry = null;
  limitDisarm(tab, 'Siz yazdınız; otomatik devam kapandı.', false); // bildirimler kullanıcının mesajından sonra (tur sonunda)
}
