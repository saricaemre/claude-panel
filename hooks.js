// Claude Code kancaları (SDK options.hooks): her sohbete callback'ler verilir, olaylar günlüğe yazılır.
// Davranış sonraki paketlerde sağlayıcı olarak eklenir (P2.2 sıkıştırma izni, P5.2 defter): provide(olay, fn).
// Sağlayıcı (girdi, { chatId, accountId }) alır, { additionalContext?, decision?, reason? } ya da null döner.
//
// Gerçek Claude Code'da ölçüldü (2.1.300, girişsiz geçici hesapla):
// - SessionStart callback'i 'startup' ve 'resume'da hiç çağrılmıyor (kabuk kancaları süreç açılır açılmaz, callback'ler kaydedilmeden koşuyor);
//   'clear'da çağrılıyor. Açılışta bağlam vermek için callback değil, ilk UserPromptSubmit ya da systemPrompt.append kullanılır.
// - UserPromptSubmit her mesajda init'ten önce; '/compact' gibi komutlarda çağrılmıyor. decision: 'block' turu API'ye gitmeden bitirir.
// - PreCompact'ta { decision: 'block' } sıkıştırmayı atlatıyor. hookSpecificOutput yalnız bazı olaylarda geçerli;
//   PreCompact'a verilince Claude Code ZodError atıp callback'i yok sayıyor (CONTEXT_EVENTS).
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact'];
const CONTEXT_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);
const MAX_CONTEXT = 10000; // Claude Code kanca çıktısını 10.000 karakterle sınırlar
const TIMEOUT = 30; // sn; sağlayıcılar yereldir, takılan biri oturumu bekletmesin
const LOG_MAX = 100;

const providers = new Map(); // olay -> [fn]
const logs = new Map(); // chatId -> [{ at, event, detail, ms, context, decision, error }]

function provide(event, fn) {
  if (!EVENTS.includes(event)) throw new Error('Bilinmeyen kanca olayı: ' + event);
  const list = providers.get(event) || [];
  list.push(fn);
  providers.set(event, list);
  return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
}

function record(chatId, entry) {
  const list = logs.get(chatId) || [];
  list.push(entry);
  if (list.length > LOG_MAX) list.splice(0, list.length - LOG_MAX);
  logs.set(chatId, list);
}

async function run(event, input, ctx) {
  const t0 = Date.now();
  const contexts = [];
  const reasons = [];
  let block = false;
  const errors = [];
  for (const fn of providers.get(event) || []) {
    try {
      const r = await fn(input, ctx);
      if (!r) continue;
      if (r.additionalContext) contexts.push(String(r.additionalContext));
      if (r.decision === 'block') { block = true; if (r.reason) reasons.push(String(r.reason)); }
    } catch (err) {
      errors.push(err?.message || String(err));
    }
  }
  const output = {};
  const context = CONTEXT_EVENTS.has(event) ? contexts.join('\n\n').slice(0, MAX_CONTEXT) : '';
  if (context) output.hookSpecificOutput = { hookEventName: event, additionalContext: context };
  if (block) { output.decision = 'block'; if (reasons.length) output.reason = reasons.join('\n'); }
  record(ctx.chatId, {
    at: new Date().toISOString(),
    event,
    detail: input?.source || input?.trigger || '',
    ms: Date.now() - t0,
    context: context.length,
    decision: block ? 'block' : null,
    error: errors.length ? errors.join('; ') : null,
  });
  return output;
}

// query() seçeneği: her olaya tek matcher, tek callback (olay içinde ayrım sağlayıcılarda)
function create(ctx) {
  const hooks = {};
  for (const event of EVENTS) {
    hooks[event] = [{ timeout: TIMEOUT, hooks: [(input) => run(event, input, ctx)] }];
  }
  return hooks;
}

const log = (chatId) => logs.get(chatId) || [];
const forget = (chatId) => logs.delete(chatId);

// Yalnız testler için: her olaya kendini tanıtan bir bağlam satırı; talimatında "[engelle]" geçen sıkıştırmayı bloklar
if (process.env.CLAUDE_PANEL_HOOK_ECHO) {
  for (const event of EVENTS) {
    provide(event, (input) => ({
      additionalContext: `[panel-kancasi ${event}${input?.source || input?.trigger ? ':' + (input.source || input.trigger) : ''}]`,
      ...(event === 'PreCompact' && /\[engelle\]/.test(input?.custom_instructions || '') ? { decision: 'block', reason: 'test: engellendi' } : {}),
    }));
  }
}

module.exports = { EVENTS, provide, create, log, forget };
