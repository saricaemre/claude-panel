// Sıkıştırma izni ve bağlam doluluğu (docs/octopus/OCTOPUS-PLANI.md İ1, P2.2).
// Claude Code'un kendi otomatik sıkıştırması PreCompact kancasında bloklanır, sohbette onay kartı açılır
// (config.json → autoCompact: 'ask' varsayılan, 'allow' ile Claude Code kendisi sıkıştırır).
// Elle sıkıştırma (/compact, kartın "Talimatla sıkıştır"ı) her zaman geçer.
// Bağlam doluluğu her tur sonunda getContextUsage({ detail: 'summary' }) ile okunur: son yanıtın
// usage alanından ve yerel tahminlerden gelir, token sayma çağrısı yapmaz.
const hooks = require('./hooks');

const usage = new Map(); // chatId -> { percentage, totalTokens, maxTokens, autoCompact, threshold }
let send = () => {};
let getPolicy = () => 'ask';

const REASON = 'Claude Panel: otomatik sıkıştırma kullanıcının onayını bekliyor.';

function setup(opts) {
  send = opts.send;
  getPolicy = opts.getPolicy;
  // block'un reason'ı Claude Code'un mesajına girmiyor (P2.1'de ölçüldü); kartı panel çizer
  hooks.provide('PreCompact', (input, { chatId }) => {
    if (input?.trigger !== 'auto' || getPolicy() === 'allow') return null;
    send('chat:compactBlocked', chatId, { percentage: usage.get(chatId)?.percentage ?? null });
    return { decision: 'block', reason: REASON };
  });
}

// SDKControlGetContextUsageResponse → arayüzün ihtiyacı. Yüzde, sıkıştırma penceresine göredir (rawMaxTokens).
function summarize(r) {
  if (!r || typeof r.percentage !== 'number') return null;
  return {
    percentage: Math.round(r.percentage),
    totalTokens: r.totalTokens ?? null,
    maxTokens: r.rawMaxTokens || r.maxTokens || null,
    autoCompact: r.isAutoCompactEnabled !== false,
    threshold: r.autoCompactThreshold ?? null,
    // Yan paneldeki Bağlam dökümü (renderer/chat.js → updateContext): pencerede yer tutan kalemler ve Claude'un skill listesi.
    // Ertelenen araçlar (kind 'deferred'), boş yer ve sıkıştırma payı bağlamda değil.
    categories: (r.categories || []).filter((c) => c.kind === 'used' && c.tokens > 0).map((c) => ({ name: String(c.name), tokens: c.tokens })),
    skills: r.skills ? { tokens: r.skills.tokens || 0, listed: (r.skills.skillFrontmatter || []).map((s) => ({ name: String(s.name), tokens: s.tokens || 0 })) } : null,
  };
}

// Son ölçüm döner (sinav.js tahmini buradan alır); ölçülemezse null
async function refresh(chatId, q) {
  if (typeof q?.getContextUsage !== 'function') return null;
  try {
    const r = await Promise.race([q.getContextUsage({ detail: 'summary' }), new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), 10000))]);
    const u = summarize(r);
    if (!u) return null;
    usage.set(chatId, u);
    send('chat:context', chatId, u);
    return u;
  } catch { return null; } // gösterge eskisi gibi kalır
}

const forget = (chatId) => usage.delete(chatId);
const last = (chatId) => usage.get(chatId) || null; // yeniden doğuşun tahmini (dogus.js)

module.exports = { setup, refresh, forget, summarize, last };
