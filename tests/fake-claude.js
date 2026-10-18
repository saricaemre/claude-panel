#!/usr/bin/env node
// Sahte Claude Code: Agent SDK'nın stream-json protokolünü taklit eder (yalnız testler için).
// Uygulama CLAUDE_PANEL_CLAUDE_BIN ile bu dosyayı gerçek Claude Code yerine çalıştırır.
// Gelen her satırı FAKE_CLAUDE_LOG dosyasına yazar; testler bu günlüğü denetler.
const readline = require('readline');
const fs = require('fs');
const LOG = process.env.FAKE_CLAUDE_LOG || require('path').join(require('os').tmpdir(), 'fake-claude.log');
const log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
log('ARGS', JSON.stringify(process.argv.slice(2)), 'CFG', process.env.CLAUDE_CONFIG_DIR, 'CWD', process.cwd());
// Ortam testi: seçili ortamın değişkeni ve kurulum betiğinin export ettiği değişken Claude sürecine ulaşmalı
if (process.env.PANEL_ORTAM) log('ORTAM', process.env.PANEL_ORTAM, process.env.KURULUM_DEGISKENI || '-', 'CFG', process.env.CLAUDE_CONFIG_DIR);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
// Gerçek Claude Code gibi init mesajında verilen --model/--effort değerlerini bildir
const argOf = (k) => (process.argv.find((x) => x.startsWith(`--${k}=`)) || '').split('=')[1];
// Gerçek Claude Code gibi: her yeni oturumun kimliği ayrı, --resume ile açılan oturum kendi kimliğini korur
const sid = argOf('resume') || require('crypto').randomUUID();
log('SID', sid);
// Danışma (danis.js, P6.1): panel dalı --resume ve --max-turns=1 ile açar; gerçek Claude Code gibi dal dosyasını cwd'nin proje klasöründen okur
const DANIS = !!argOf('resume') && argOf('max-turns') === '1';
// Ayar klasöründe .fake-logged-out varsa süreç girişsiz açılmış sayılır (gerçek Claude Code girişi açılışta okur)
// Ayar klasörü boşsa gerçek Claude Code gibi ~/.claude
const LOGGED_OUT = fs.existsSync(require('path').join(process.env.CLAUDE_CONFIG_DIR || require('path').join(require('os').homedir(), '.claude'), '.fake-logged-out'));
const MODEL_IDS ={ opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' };
let n = 0; const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pending = new Map();
let reqN = 0;
function ask(request) {
  const id = 'r' + (++reqN);
  out({ type: 'control_request', request_id: id, request });
  return new Promise((r) => pending.set(id, r));
}
let interrupted = false;
let turn = 0;
let ctxPct = 23;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  log('IN', line.slice(0, 300));
  if (m.type === 'control_request') {
    const sub = m.request.subtype;
    let response = {};
    if (sub === 'initialize') hookReg = m.request.hooks || {};
    // Sistem istemine ek (systemPrompt.append): SDK initialize'da appendSystemPrompt olarak verir; başta hafıza talimatı (P3.2)
    if (sub === 'initialize') log('APPEND', JSON.stringify(m.request.appendSystemPrompt ?? null));
    if (sub === 'initialize') response = { commands: [], models: [
      { value: 'opus', displayName: 'Opus 5.5', description: 'En güçlü', supportsEffort: true, supportedEffortLevels: ['low','medium','high','xhigh','max'] },
      { value: 'sonnet', displayName: 'Sonnet 5.5', description: 'Hızlı', supportsEffort: true, supportedEffortLevels: ['low','medium','high'] }],
      // accountInfo(): gerçek Claude Code 2.1.300'de ölçülen iki biçim (girişsiz / girişli)
      account: LOGGED_OUT ? { tokenSource: 'none', apiProvider: 'firstParty' }
        : { email: 'deneme@ornek.invalid', organization: 'Deneme', subscriptionType: 'Claude Max', apiProvider: 'firstParty' } };
    if (sub === 'interrupt') interrupted = true;
    // Bağlantı durumu (Bağlayıcıları yönet): panelin kendi sunucusu da listede, gerçek Claude Code gibi
    if (sub === 'mcp_status') response = { mcpServers: [
      { name: 'panel', status: 'connected', scope: 'dynamic', source: 'sdk', tools: [{ name: 'publish_artifact' }] },
      { name: 'yerel-mcp', status: 'failed', scope: 'local', error: 'spawn yerel ENOENT' },
      { name: 'blender', status: 'connected', scope: 'user', tools: Array.from({ length: 22 }, (_, i) => ({ name: 'arac' + i })) },
      { name: 'figma-console', status: 'disabled', scope: 'user' },
      { name: 'claude.ai Figma', status: 'needs-auth', scope: 'claudeai' }] };
    // Bağlam doluluğu (SDKControlGetContextUsageResponse): yüzde sıkıştırma penceresine göre; "bağlam dolsun" %84 yapar, sıkıştırma %2'ye indirir
    if (sub === 'get_context_usage') {
      log('CONTEXT', m.request.detail || '-', ctxPct);
      const max = 1000000, total = Math.round(max * ctxPct / 100);
      response = { categories: [{ name: 'Messages', tokens: total, color: 'purple', kind: 'used' }, { name: 'Free space', tokens: max - total, color: 'gray', kind: 'free' }],
        totalTokens: total, maxTokens: max, rawMaxTokens: max, percentage: ctxPct, gridRows: [], model: 'claude-opus-5-5', memoryFiles: [], mcpTools: [], agents: [],
        isAutoCompactEnabled: true, autoCompactThreshold: Math.round(max * 0.967), apiUsage: null };
    }
    if (sub === 'get_usage') {
      const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();
      response = { session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0, model_usage: {} },
        subscription_type: 'max', rate_limits_available: true, behaviors: null,
        rate_limits: { five_hour: { utilization: 7, resets_at: at(4.2) }, seven_day: { utilization: 12, resets_at: at(80) },
          seven_day_opus: { utilization: 31, resets_at: at(80) } } };
      if (LOGGED_OUT) Object.assign(response, { subscription_type: null, rate_limits_available: false, rate_limits: null });
    }
    out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
    return;
  }
  if (m.type === 'control_response') { const r = pending.get(m.response.request_id); pending.delete(m.response.request_id); r && r(m.response.response || m.response); return; }
  if (m.type === 'user') {
    turn++;
    const t = typeof m.message.content === 'string' ? m.message.content : '';
    // Gerçek Claude Code gibi: UserPromptSubmit init'ten önce; '/compact' komutunda çağrılmaz; block turu API'ye gitmeden bitirir
    const prompt = t || (Array.isArray(m.message.content) ? m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');
    const ups = t.startsWith('/compact') ? [] : await hookCallback('UserPromptSubmit', { prompt });
    if (turn === 1) {
      out({ type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'SessionStart:startup', hook_event: 'SessionStart', output: '', stdout: 'AÇILIŞ PARTİSİ — SessionStart hook\'u koştu\n\nOturum başı doğrulaması: 13/13 kapı yeşil\nsıradaki iş IS-279\nadr-araligi: K686-K688', stderr: '', outcome: 'success', uuid: uuid(), session_id: sid });
      out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sid, model: MODEL_IDS[argOf('model')] || 'claude-opus-5-5', permissionMode: 'default', effort: argOf('effort') || 'high', tools: ['Read', 'Bash'], mcp_servers: [{ name: 'figma', status: 'connected' }, { name: 'blender', status: 'connected' }], slash_commands: ['compact', 'review', 'tasarim', 'context'], skills: ['tasarim'], agents: ['gorsel-dogrulayici'], claude_code_version: '2.1.300', apiKeySource: 'none', output_style: 'default', plugins: [], uuid: uuid() });
    }
    const blocked = ups.find((r) => r?.decision === 'block');
    if (DANIS) return danisAnswer(prompt);
    if (blocked) {
      out({ type: 'system', subtype: 'informational', content: `UserPromptSubmit operation blocked by hook:\n${blocked.reason || ''}\n\nOriginal prompt: ${prompt}`, level: 'warning', prevent_continuation: true, uuid: uuid(), session_id: sid });
      return finish('success');
    }
    // Yeniden doğuş (dogus.js): adım mesajları ve devir notu, içinde başka turları seçen kelimeler geçtiği için en önce
    if (t.startsWith('[Claude Panel · yeniden doğuş 1/2]')) await rebirthDefterTurn();
    else if (t.startsWith('[Claude Panel · yeniden doğuş 2/2]')) await rebirthAuditTurn(t);
    else if (t.startsWith('[Claude Panel devir notu]')) await rebirthNoteTurn(t);
    else if (/^\/compact\b/.test(t)) await compactTurn('manual', t.replace(/^\/compact\s*/, '') || null);
    else if (/otomatik sıkıştır/i.test(t)) await compactTurn('auto', null);
    else if (/bağlam dolsun/i.test(t)) { ctxPct = 84; await streamText('Bağlam epey doldu.'); finish('success'); }
    else if (/<yan-oturum-olayi/.test(t)) await sessionEventTurn(t);
    else if (/<ci-izleme-olayi/.test(t)) await ciEventTurn(t);
    else if (/^geçmişe danış/i.test(t)) await danisTurn(t);
    else if (Array.isArray(m.message.content)) await attachTurn(m.message.content);
    else if (/rapor/i.test(t)) await artifactTurn();
    else if (/blender/i.test(t)) await mcpTurn();
    else if (/tuzak/i.test(t)) await trapTurn();
    else if (/simülatör/i.test(t)) await simTurn();
    else if (/tarayıcı/i.test(t)) await browserTurn(t);
    else if (/terminali oku/i.test(t)) await terminalTurn();
    else if (/grafik çiz/i.test(t)) await widgetTurn();
    else if (/yan oturumda/i.test(t)) await sessionStartTurn();
    else if (/iki kol aç/i.test(t)) await octopusArmsTurn();
    else if (/dokuz kol aç/i.test(t)) await octopusNineTurn();
    else if (/kol a'yı bitir/i.test(t)) await octopusDoneTurn();
    else if (/kol izin istesin/i.test(t)) await armWaitTurn();
    else if (/kol kol açsın/i.test(t)) await armStartTurn();
    else if (/kol 3'e yaz/i.test(t)) await octopusSendTurn();
    else if (/kol uzun çalışsın/i.test(t)) await armLongTurn();
    else if (/dört kol aç/i.test(t)) await octopusFourTurn();
    else if (/yan oturumu ayrı kopyada/i.test(t)) await sessionStartTurn({ worktree: true, title: 'Paralel iş', prompt: 'alt görev: paralel' });
    else if (/özetle bitir/i.test(t)) await wrapTurn();
    else if (/^tamam, bitir/i.test(t)) await todoDoneTurn();
    else if (/kopyada yaz/i.test(t)) { fs.writeFileSync(process.cwd() + '/kopya.txt', 'ayrı kopyada yazıldı\n'); log('KOPYA', process.cwd()); await streamText('Ayrı kopyaya yazdım.'); finish('success'); }
    else if (/^alt görev/i.test(t)) { await streamText('Alt görev bitti: ' + t.slice(0, 60)); finish('success'); }
    else if (/değişiklikleri göster/i.test(t)) await changesTurn();
    else if (/editörde aç/i.test(t)) await openTurn();
    else if (/pr'yi izle/i.test(t)) await prTurn();
    else if (/hafızana bak/i.test(t)) await memoryTurn();
    else if (/kol deftere baksın/i.test(t)) await armDefterTurn();
    else if (/defter kolu aç/i.test(t)) await defterArmTurn();
    else if (/deftere yaz/i.test(t)) await defterTurn();
    else await runTurn(m);
  }
});
const asst = (content, id = 'msg_' + uuid()) => out({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content }, parent_tool_use_id: null, uuid: uuid(), session_id: sid });
const toolRes = (tool_use_id, content, is_error) => out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id, content, is_error }] }, parent_tool_use_id: null, uuid: uuid(), session_id: sid });
async function streamText(text) {
  const id = 'msg_s' + uuid();
  out({ type: 'stream_event', event: { type: 'message_start', message: { id } }, parent_tool_use_id: null, uuid: uuid(), session_id: sid });
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, uuid: uuid(), session_id: sid });
  for (let i = 0; i < text.length; i += 12) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 12) } }, parent_tool_use_id: null, uuid: uuid(), session_id: sid });
    await sleep(15);
  }
  asst([{ type: 'text', text }], id);
}
// Kancalar: initialize'da SDK'nın kaydettiği callback kimlikleri (olay -> [{ matcher, hookCallbackIds, timeout }]).
// Olay gelince eşleşen her kimlik için hook_callback isteği gider; yanıtlar günlüğe 'HOOK <olay> <ayrıntı> <yanıt>' olarak yazılır.
let hookReg = {};
const matches = (matcher, value) => {
  if (!matcher || matcher === '*') return true;
  if (/^[\w|]+$/.test(matcher)) return matcher.split('|').includes(value);
  try { return new RegExp(matcher).test(value); } catch { return false; }
};
async function hookCallback(event, fields) {
  const input = { session_id: sid, transcript_path: `${process.env.CLAUDE_CONFIG_DIR || ''}/projects/fake/${sid}.jsonl`, cwd: process.cwd(), hook_event_name: event, ...fields };
  const detail = fields.source || fields.trigger || '';
  const results = [];
  for (const m of hookReg[event] || []) {
    if (!matches(m.matcher, detail)) continue;
    for (const callback_id of m.hookCallbackIds || []) {
      const r = await ask({ subtype: 'hook_callback', callback_id, input });
      log('HOOK', event, detail || '-', JSON.stringify(r));
      results.push(r);
    }
  }
  return results;
}
// Sıkıştırma: '/compact <talimat>' (manual) ya da otomatik sıkıştırma tetiği (auto).
// PreCompact block derse gerçek Claude Code gibi atlanır; demezse sınır, PostCompact ve SessionStart (compact) gelir.
async function compactTurn(trigger, instructions) {
  out({ type: 'system', subtype: 'status', status: 'compacting', session_id: sid, uuid: uuid() });
  const pre = await hookCallback('PreCompact', { trigger, custom_instructions: instructions });
  if (pre.some((r) => r?.decision === 'block')) {
    const why = 'Compaction blocked by PreCompact hook: [callback]';
    out({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'skipped: ' + why, session_id: sid, uuid: uuid() });
    log('SIKISTIRMA', trigger, 'atlandı');
    asst([{ type: 'text', text: why }]);
    // Otomatik sıkıştırma tur içinde gelir; atlanınca tur sürer (gerçek CLI'de ölçülmedi: OCTOPUS-PLANI.md P2.2)
    if (trigger === 'auto') await streamText('Sıkıştırmadan devam ediyorum.');
    return finish('success');
  }
  out({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger, pre_tokens: 858824, post_tokens: 15890 }, uuid: uuid(), session_id: sid });
  out({ type: 'system', subtype: 'status', status: null, compact_result: 'success', session_id: sid, uuid: uuid() });
  log('SIKISTIRMA', trigger, 'yapıldı', JSON.stringify(instructions));
  ctxPct = /\[büyük\]/.test(instructions || '') ? 5 : 2; // [büyük]: sıkıştırmadan sonra bağlam 50 bin (sınav eşiğinin üstü)
  await hookCallback('PostCompact', { trigger, compact_summary: 'Özet: IS-279 sürüyor. ' + (instructions || '') });
  await hookCallback('SessionStart', { source: 'compact' });
  if (trigger === 'auto') await streamText('Bağlam özetlendi, kaldığım yerden devam ediyorum.');
  finish('success');
}
async function perm(tool_name, input) {
  const r = await ask({ subtype: 'can_use_tool', tool_name, input, tool_use_id: 'x', permission_suggestions: [{ type: 'addRules', rules: [{ toolName: tool_name }], behavior: 'allow', destination: 'session' }] });
  log('PERM', JSON.stringify(r));
  return r;
}
async function runTurn(m) {
  const cwd = process.cwd();
  const text = typeof m.message.content === 'string' ? m.message.content : m.message.content.map((b) => b.text || '[görsel]').join(' ');
  await streamText(`Tamam, **${text.slice(0, 40)}** için önce projenin anlık hâline bakıyorum.`);
  asst([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: cwd + '/brain.md' } }]);
  await sleep(200); toolRes('t1', '# brain\nŞu an: IS-279 sürüyor\n...');
  for (const [i, f] of ['takip/IS-KUYRUGU.md', 'plan/03-oyun-sabitleri.yaml', 'CLAUDE.md'].entries()) {
    asst([{ type: 'tool_use', id: 'r' + i, name: 'Read', input: { file_path: cwd + '/' + f } }]); toolRes('r' + i, 'içerik');
  }
  asst([{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'IS-279', path: cwd + '/takip' } }]); toolRes('g1', '3 eşleşme');
  asst([{ type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [
    { content: 'brain.md oku', status: 'completed', activeForm: 'brain.md okunuyor' },
    { content: 'Kapıları koş', status: 'in_progress', activeForm: 'Kapılar koşuluyor' },
    { content: 'Günlüğe yaz', status: 'pending', activeForm: 'Günlüğe yazılıyor' }] } }]);
  toolRes('t2', 'ok');
  const bash = { command: 'pnpm dogrula', description: 'Kapıları koş' };
  asst([{ type: 'tool_use', id: 't3', name: 'Bash', input: bash }]);
  const r = await perm('Bash', bash);
  if (interrupted) return finish('error_during_execution');
  if (r.behavior === 'allow') { out({ type: 'tool_progress', tool_use_id: 't3', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 3, uuid: uuid(), session_id: sid }); await sleep(400); toolRes('t3', '✓ biome\n✓ tip kontrolü\n✓ 13/13 kapı yeşil'); }
  else toolRes('t3', 'Kullanıcı reddetti', true);
  asst([{ type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: cwd + '/apps/client/src/v4/kabuk.tsx', old_string: 'const renk = "#222";', new_string: 'const renk = tema.zemin;' } }]);
  toolRes('t4', 'ok');
  asst([{ type: 'tool_use', id: 't5', name: 'Task', input: { description: 'Görsel doğrulama', subagent_type: 'gorsel-dogrulayici', prompt: 'Kareyi kontrol et' } }]);
  out({ type: 'assistant', message: { id: 'sub1', role: 'assistant', content: [{ type: 'tool_use', id: 's1', name: 'Read', input: { file_path: cwd + '/kare.png' } }] }, parent_tool_use_id: 't5', uuid: uuid(), session_id: sid });
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's1', content: 'img' }] }, parent_tool_use_id: 't5', uuid: uuid(), session_id: sid });
  toolRes('t5', 'Hüküm: kare doğru, kayma yok.');
  const q = { questions: [{ question: 'Kapanışta main\'e birleştireyim mi?', header: 'Birleştirme', multiSelect: false, options: [{ label: 'Evet', description: 'Push et' }, { label: 'Hayır', description: 'Dalda bırak' }] }] };
  asst([{ type: 'tool_use', id: 't6', name: 'AskUserQuestion', input: q }]);
  const qa = await perm('AskUserQuestion', q);
  toolRes('t6', 'Cevap: ' + JSON.stringify(qa.updatedInput?.answers || {}));
  await streamText('Bitti. Özet:\n\n| Kapı | Sonuç |\n|---|---|\n| biome | ✓ |\n| tip | ✓ |\n\n```bash\npnpm dogrula\n```\n\nSıradaki iş: **IS-280**.');
  finish('success');
}
// Ekli mesaj (içerik blok dizisi): gelen blokları günlüğe yazar, sayısını bildirir
async function attachTurn(blocks) {
  log('EKLER', JSON.stringify(blocks.map((b) => (b.type === 'image'
    ? { image: b.source.media_type, bytes: Buffer.from(b.source.data, 'base64').length }
    : { text: b.text.slice(0, 1000) }))));
  const files = blocks.filter((b) => b.type === 'text' && b.text.startsWith('<attached_file')).length;
  await streamText(`Ekleri aldım: ${blocks.filter((b) => b.type === 'image').length} görsel, ${files} dosya.`);
  finish('success');
}
// Artifact turu: .html yazar, sonra düzenler (iki sürüm), ardından panelin MCP aracıyla bir belge yayımlar
async function artifactTurn() {
  const file = process.cwd() + '/rapor.html';
  const v1 = '<!doctype html><html><head><title>Haftalık rapor</title></head><body style="font-family:sans-serif;background:#fdf6ee;padding:40px"><h1>Haftalık rapor</h1><p id="durum">Sürüm 1</p></body></html>';
  fs.writeFileSync(file, v1);
  asst([{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: file, content: v1 } }]);
  toolRes('w1', 'File created successfully');
  await sleep(400);
  fs.writeFileSync(file, v1.replace('Sürüm 1', 'Sürüm 2 hazır'));
  asst([{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: file, old_string: 'Sürüm 1', new_string: 'Sürüm 2 hazır' } }]);
  toolRes('e1', 'ok');
  await sleep(200);
  const args = { title: 'Kapı özeti', content: '# Kapı özeti\n\n- biome ✓\n- tip ✓', kind: 'md' };
  asst([{ type: 'tool_use', id: 'm1', name: 'mcp__panel__publish_artifact', input: args }]);
  const r = await ask({ subtype: 'mcp_message', server_name: 'panel', message: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'publish_artifact', arguments: args } } });
  log('MCP', JSON.stringify(r));
  const result = r?.mcp_response?.result;
  toolRes('m1', result?.content?.[0]?.text || 'MCP yanıtı yok', !result || result.isError);
  await streamText('Raporu hazırladım ve **Artifacts**\'e ekledim.');
  finish('success');
}
// Simülatör turu: panelin simulator aracıyla cihazı açar, ekran görüntüsü alır, dokunur
async function simTurn() {
  // allowedTools'ta olmayan araç için gerçek Claude Code önce izin sorar (can_use_tool)
  const allowed = (process.argv.find((x) => x.startsWith('--allowedTools=')) || '').split('=')[1]?.split(',') || [];
  const call = async (id, args) => {
    asst([{ type: 'tool_use', id, name: 'mcp__panel__simulator', input: args }]);
    if (!allowed.includes('mcp__panel__simulator')) {
      const r = await perm('mcp__panel__simulator', args);
      log('SIMPERM', args.action, r.behavior);
      if (r.behavior !== 'allow') return toolRes(id, r.message || 'reddedildi', true);
    }
    const r = await ask({ subtype: 'mcp_message', server_name: 'panel', message: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'simulator', arguments: args } } });
    const result = r?.mcp_response?.result;
    log('SIMMCP', args.action, JSON.stringify((result?.content || []).map((b) => (b.type === 'image' ? { image: b.mimeType, bytes: b.data.length } : b))), result?.isError ? 'HATA' : '');
    // Gerçek Claude Code MCP görselini API biçimine çevirip tool_result'a koyar
    toolRes(id, (result?.content || []).map((b) => (b.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } } : b)), !result || result.isError);
  };
  // FAKE_SIM_ACTIONS: elle deneme için gerçek simülatörde çalıştırılacak işlem listesi (JSON)
  const actions = process.env.FAKE_SIM_ACTIONS ? JSON.parse(process.env.FAKE_SIM_ACTIONS)
    : [{ action: 'attach' }, { action: 'screenshot' }, { action: 'tap', x: 50, y: 60 }, { action: 'tap', x: 900, y: 60 },
      { action: 'text', text: 'Merhaba dünya `i` 👋' },
      { action: 'touch2_path', points2: [{ x1: 190, y1: 400, x2: 212, y2: 400 }, { x1: 120, y1: 400, x2: 282, y2: 400, dt_ms: 50 }] },
      { action: 'rotate', orientation: 'landscape_left' }, { action: 'screenshot' }, { action: 'tap', x: 100, y: 50 },
      { action: 'rotate', orientation: 'portrait' }, { action: 'launch', bundle_id: 'com.ornek.uygulama' }];
  for (const [i, args] of actions.entries()) {
    await call('sim' + (i + 1), args);
    if (args.wait_ms) await sleep(args.wait_ms);
  }
  await streamText('Simülatörde uygulamaya dokundum.');
  finish('success');
}
// Tarayıcı turu: panelin browser aracıyla mesajdaki adresi açar, okur, tıklar, yazar; konsol, ağ, indirme, dış site
async function browserTurn(text) {
  const base = (text.match(/https?:\/\/\S+/) || [])[0];
  let n = 0;
  const call = async (args) => {
    const id = 'br' + (++n);
    asst([{ type: 'tool_use', id, name: 'mcp__panel__browser', input: args }]);
    // browser allowedTools'ta değil: gerçek Claude Code her çağrıda sorar (can_use_tool); panel yerel siteleri kendisi onaylar
    const p = await perm('mcp__panel__browser', args);
    log('BRPERM', args.action, p.behavior);
    if (p.behavior !== 'allow') { toolRes(id, p.message || 'reddedildi', true); return ''; }
    const r = await ask({ subtype: 'mcp_message', server_name: 'panel', message: { jsonrpc: '2.0', id: 100 + n, method: 'tools/call', params: { name: 'browser', arguments: args } } });
    const result = r?.mcp_response?.result;
    const content = result?.content || [];
    log('BRMCP', args.action, JSON.stringify(content.map((b) => (b.type === 'image' ? { image: b.mimeType, bytes: b.data.length } : b))), result?.isError ? 'HATA' : '');
    toolRes(id, content.map((b) => (b.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } } : b)), !result || result.isError);
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  };
  const refOf = (txt, re) => ((txt.split('\n').find((l) => re.test(l)) || '').match(/\[(ref_\d+)\]/) || [])[1];
  // FAKE_BROWSER_ACTIONS: elle deneme için çalıştırılacak işlem listesi (JSON)
  if (process.env.FAKE_BROWSER_ACTIONS) {
    for (const a of JSON.parse(process.env.FAKE_BROWSER_ACTIONS)) await call(a);
  } else {
    await call({ action: 'navigate', url: base });
    const tree = await call({ action: 'read_page', filter: 'interactive' });
    await call({ action: 'click', ref: refOf(await call({ action: 'find', query: 'gönder' }), /button "Gönder"/) });
    await call({ action: 'get_text' });
    const ad = refOf(tree, /textbox "Ad"/);
    await call({ action: 'form_input', ref: ad, value: 'Ayşe' });
    await call({ action: 'eval', code: 'document.querySelector("#ad").value + "|" + typeof window.panel + "|" + typeof require' });
    await call({ action: 'click', ref: ad });
    await call({ action: 'key', text: 'cmd+a Backspace' });
    await call({ action: 'type', text: 'Çağrı' });
    await call({ action: 'key', text: 'Enter' });
    await call({ action: 'get_text' });
    await call({ action: 'screenshot' });
    await call({ action: 'console' });
    await call({ action: 'network', query: 'veri.json' });
    await call({ action: 'click', ref: refOf(tree, /button "Yeni pencere"/) });
    await call({ action: 'get_text' });
    await call({ action: 'navigate', url: 'back' });
    await call({ action: 'navigate', url: base + 'indir' });
    await call({ action: 'console', pattern: 'İndirme' });
    await call({ action: 'navigate', url: 'file:///etc/hosts' });
    await call({ action: 'resize', preset: 'mobile' });
    await call({ action: 'eval', code: 'innerWidth' });
    await call({ action: 'resize', preset: 'desktop' });
    await call({ action: 'navigate', url: 'https://ornek.invalid/' });
  }
  await streamText('Tarayıcıda sayfayı denedim.');
  finish('success');
}
// Panelin bir MCP aracını çağırır; allowedTools'ta değilse gerçek Claude Code gibi önce izin sorar (can_use_tool)
async function panelTool(tag, name, id, args) {
  const allowed = (process.argv.find((x) => x.startsWith('--allowedTools=')) || '').split('=')[1]?.split(',') || [];
  asst([{ type: 'tool_use', id, name: 'mcp__panel__' + name, input: args }]);
  if (!allowed.includes('mcp__panel__' + name)) {
    const p = await perm('mcp__panel__' + name, args);
    log(tag + 'PERM', args.action, p.behavior);
    if (p.behavior !== 'allow') { toolRes(id, p.message || 'reddedildi', true); return ''; }
  }
  const r = await ask({ subtype: 'mcp_message', server_name: 'panel', message: { jsonrpc: '2.0', id: 200 + (++reqN), method: 'tools/call', params: { name, arguments: args } } });
  const result = r?.mcp_response?.result;
  const text = (result?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  log(tag + 'MCP', args.action, JSON.stringify(text), result?.isError ? 'HATA' : '');
  toolRes(id, result?.content || 'MCP yanıtı yok', !result || result.isError);
  return text;
}
// Terminal turu: kullanıcının terminalini okur, yeni sekmede komut çalıştırır, Ctrl-C gönderir
async function terminalTurn() {
  let n = 0;
  const call = (args) => panelTool('TERM', 'terminal', 'te' + (++n), args);
  const list = await call({ action: 'list' });
  const userTab = +((list.split('\n').find((l) => /son kullanılan/.test(l)) || '').match(/^(\d+)/) || [])[1];
  await call({ action: 'read' });
  const run = await call({ action: 'run', command: 'echo TERMINAL_$((40+2))', wait_ms: 5000 });
  const claudeTab = +(run.match(/^Sekme (\d+)/) || [])[1];
  await call({ action: 'read', tab_id: claudeTab });
  await call({ action: 'list' });
  await call({ action: 'stop', tab_id: userTab });
  await call({ action: 'stop', tab_id: claudeTab });
  await call({ action: 'read', tab_id: 99999 });
  await streamText('Terminale baktım.');
  finish('success');
}
// Değişiklikler turu: bir dosyayı düzenler, yeni dosya yazar (gerçekten diske), sonra show ile bölmeyi açar
async function changesTurn() {
  const cwd = process.cwd();
  const file = cwd + '/uygulama.js';
  const old_string = "const renk = 'kirmizi';", new_string = "const renk = 'mavi';\nconst boyut = 12;";
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(old_string, new_string));
  asst([{ type: 'tool_use', id: 'd1', name: 'Edit', input: { file_path: file, old_string, new_string } }]);
  toolRes('d1', 'ok');
  const notes = '# Notlar\n\nYeni dosya\n';
  fs.writeFileSync(cwd + '/notlar.md', notes);
  asst([{ type: 'tool_use', id: 'd2', name: 'Write', input: { file_path: cwd + '/notlar.md', content: notes } }]);
  toolRes('d2', 'File created successfully');
  await panelTool('SHOW', 'show', 'd3', { action: 'changes' });
  await panelTool('SHOW', 'show', 'd4', { action: 'file', path: 'uygulama.js', line: 2, end_line: 3 });
  await panelTool('SHOW', 'show', 'd5', { action: 'file', path: 'yok.js' });
  await streamText('Değişiklikleri gösterdim.');
  finish('success');
}
// Hafıza (P3.2): hatirla ile arar, bulduğu ilk kaydı hatirla_oku ile okur; hesap kapsamı ve kısa sorgu da (allowedTools'ta, izin sormaz)
async function memoryTurn() {
  const r = await panelTool('HAFIZA', 'hatirla', 'hz1', { sorgu: 'witcher' });
  const m = r.match(/oturum=(\S+) uuid=(\S+)/);
  if (m) await panelTool('HAFIZA', 'hatirla_oku', 'hz2', { oturum: m[1], uuid: m[2], cevre: 1 });
  await panelTool('HAFIZA', 'hatirla', 'hz3', { sorgu: 'istanbul', kapsam: 'hesap' });
  await panelTool('HAFIZA', 'hatirla', 'hz4', { sorgu: 'ab' });
  await streamText('Hafızaya baktım.');
  finish('success');
}
// Defter (P5.1): baş (izin sormadan) geçmişten bulduğu reddi kaynağıyla, zevki bu anla yazar; metinsiz ekleme hata verir;
// zevki yerine koyar (eskisi silinmez) ve listeler
async function defterTurn() {
  const call = (id, args) => panelTool('DEFTER', 'defter', id, args);
  await call('df1', { islem: 'ekle', tur: 'ret', metin: 'Witcher 3 arayüz stili', neden: "Emre: 'beğenmedim, daha heroik'", kaynak: { oturum: 'hafiza-1', uuid: 'h2' } });
  await call('df2', { islem: 'ekle', tur: 'zevk', metin: 'Arayüz premium ve modern olmalı' });
  await call('df3', { islem: 'ekle', tur: 'karar' });
  await call('df4', { islem: 'yerine_koy', id: 'D-2', metin: 'Arayüz premium, modern ve heroik olmalı', neden: 'Emre: daha heroik' });
  await call('df5', { islem: 'listele' });
  await streamText('Deftere yazdım.');
  finish('success');
}
// Danışma süreci: dalın kayıtlarını sayar, son Claude mesajını cevaba koyar (dal sıkıştırma öncesinde bittiyse bağlamdan düşmüş metin).
// Kayıt yazmaz (--no-session-persistence). Bedel result.usage'da, dalın büyüklüğüne göre.
async function danisAnswer(prompt) {
  const p = require('path');
  const file = p.join(process.env.CLAUDE_CONFIG_DIR || '', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), sid + '.jsonl');
  const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const msgs = rows.filter((o) => o.type === 'user' || o.type === 'assistant');
  const textOf = (o) => (o?.message?.content || []).filter?.((b) => b.type === 'text').map((b) => b.text).join(' ') || '';
  const lastA = msgs.findLast((o) => o.type === 'assistant' && textOf(o));
  log('DANIS', sid, 'kayit=' + msgs.length, 'dosya=' + (rows.length ? 'var' : 'yok'), JSON.stringify(prompt.slice(-60)));
  // Sınav (sinav.js): bağlamda olan, yani son sıkıştırma sınırından sonraki metinler "hatırlanır" (özet dahil); öncesi hatırlanmaz
  if (prompt.includes('[Claude Panel sınavı]')) {
    const cut = rows.findLastIndex((o) => o.subtype === 'compact_boundary');
    const said = rows.slice(cut + 1).filter((o) => o.type === 'user' || o.type === 'assistant')
      .map((o) => (typeof o.message?.content === 'string' ? o.message.content : textOf(o))).filter(Boolean);
    log('SINAV', sid, 'sinir=' + (cut >= 0 ? 'var' : 'yok'), 'soru=' + (prompt.match(/^\d+\. /gm) || []).length, JSON.stringify(prompt.split('\n').slice(2).join(' | ')));
    asst([{ type: 'text', text: '1. Hatırladıklarım: ' + (said.join(' ') || 'hatırlamıyorum') }]); // akıtılmaz: devir notundan sonra cevap ~20 bin karakter
    out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 700, duration_api_ms: 600, num_turns: 1, result: 'Bitti', stop_reason: 'end_turn',
      total_cost_usd: 0.11, usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 12000, output_tokens: 60 }, modelUsage: {}, permission_denials: [], session_id: sid, uuid: uuid() });
    return;
  }
  await streamText(`Dalda ${msgs.length} kayıt var. O an son sözüm: ${textOf(lastA)}`);
  out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 900, duration_api_ms: 800, num_turns: 1, result: 'Bitti', stop_reason: 'end_turn',
    total_cost_usd: 0.42, usage: { input_tokens: 3, cache_creation_input_tokens: 1000 * msgs.length, cache_read_input_tokens: 0, output_tokens: 25 }, modelUsage: {}, permission_denials: [], session_id: sid, uuid: uuid() });
}
// Yeniden doğuş 1/2: eski beden deftere bir açık iş yazar (izinsiz)
async function rebirthDefterTurn() {
  await panelTool('DOGUS', 'defter', 'dg1', { islem: 'ekle', tur: 'acik', metin: 'Menü animasyonunun geçişi yarım kaldı', neden: 'Yeniden doğuştan önce eski beden yazdı' });
  await streamText('Deftere bir açık iş yazdım.');
  finish('success');
}
// Yeniden doğuş 2/2: eski beden devir notunu okur, eksik söyler
async function rebirthAuditTurn(t) {
  log('DENETIM', sid, JSON.stringify(t));
  await streamText('- Kullanıcı en son menü animasyonunun 300 ms olmasını istedi; ui/menu.js içindeki geçiş bitmedi.');
  finish('success');
}
// Yeni beden: ilk mesajı devir notu. Gerçek Claude Code gibi oturum kaydını yazar (sınavın dalı bundan açılır); bağlam küçüktür
async function rebirthNoteTurn(t) {
  log('DEVIR', sid, JSON.stringify(t));
  const p = require('path');
  const dir = p.join(process.env.CLAUDE_CONFIG_DIR || '', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
  const b = { sessionId: sid, cwd: process.cwd(), isSidechain: false, userType: 'external', version: '2.1.300' };
  const u = require('crypto').randomUUID(), a = require('crypto').randomUUID();
  const reply = 'Devir notunu okudum: menü animasyonunda kaldık. Seni bekliyorum.';
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(p.join(dir, sid + '.jsonl'), [
    { ...b, type: 'user', uuid: u, parentUuid: null, timestamp: new Date().toISOString(), message: { role: 'user', content: t } },
    { ...b, type: 'assistant', uuid: a, parentUuid: u, timestamp: new Date().toISOString(), message: { id: 'msg_dv', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: reply }], usage: { input_tokens: 3, cache_creation_input_tokens: 20000, cache_read_input_tokens: 0, output_tokens: 20 } } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  ctxPct = 2;
  await streamText(reply);
  finish('success');
}
// Başın danışma turu: mesajdaki JSON dizisindeki her kaynağa danis (allowedTools'ta; eşiğin üstünü panel kartla sorar)
async function danisTurn(t) {
  const calls = JSON.parse(t.slice(t.indexOf('[')));
  let i = 0;
  for (const args of calls) await panelTool('DANIS', 'danis', 'dn' + (++i), args);
  await streamText('Geçmişe danıştım.');
  finish('success');
}
// Baş deftere bakacak bir kol açar (kartla)
async function defterArmTurn() {
  octopusHead = true;
  await panelTool('OCTO', 'sessions', 'dk1', { action: 'start', title: 'Defter kolu', prompt: 'kol deftere baksın' });
  await streamText('Defter kolunu açtım.');
  finish('success');
}
// Kolun kendisi: defteri okuyabilir, yazamaz
async function armDefterTurn() {
  await panelTool('DEFTER', 'defter', 'dk2', { islem: 'listele' });
  await panelTool('DEFTER', 'defter', 'dk3', { islem: 'ekle', tur: 'karar', metin: 'Kol karar verdi' });
  await streamText('Kol deftere baktı.');
  finish('success');
}
// Editörde aç / Finder'da göster: dosya satırıyla, klasör, Finder, olmayan dosya
async function openTurn() {
  await panelTool('OPEN', 'open', 'op1', { action: 'editor', path: 'uygulama.js', line: 2 });
  await panelTool('OPEN', 'open', 'op2', { action: 'editor', path: '.' });
  await panelTool('OPEN', 'open', 'op3', { action: 'reveal', path: 'notlar.md' });
  await panelTool('OPEN', 'open', 'op4', { action: 'editor', path: 'yok.js' });
  await streamText('Dosyaları açtım.');
  finish('success');
}
// PR izleme: önce durum, sonra otomatik düzeltmeyle izle (izin kartı). CI olayları <ci-izleme-olayi> olarak döner.
let ciEvents = 0;
async function prTurn() {
  await panelTool('PR', 'pr', 'pr1', { action: 'status' });
  await panelTool('PR', 'pr', 'pr2', { action: 'watch', autofix: true });
  await streamText('PR izleniyor.');
  finish('success');
}
async function ciEventTurn(t) {
  ciEvents++;
  log('CIEVENT', ciEvents, JSON.stringify(t));
  await streamText(`CI olayına baktım (${ciEvents}).`);
  finish('success');
}
// Sohbet içi görsel: panelin dışına erişemediğini ve tema değişkenlerini kendisi yazar; düğmesi sendPrompt çağırır
async function widgetTurn() {
  const code = `<div style="padding:12px;border:1px solid var(--line);border-radius:8px">
<svg width="300" height="120"><rect x="10" y="20" width="60" height="90" fill="var(--accent)"/><rect x="90" y="50" width="60" height="60" fill="var(--ok)"/></svg>
<p id="sonuc"></p><button id="ayrinti" onclick="sendPrompt('Ayrıntı ver')">Ayrıntı</button><div style="height:260px"></div></div>
<script>let r; try { r = parent.document ? 'erisildi' : 'yok'; } catch (e) { r = 'engelli'; }
document.getElementById('sonuc').textContent = [typeof window.panel, r, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()].join('|');</script>`;
  await panelTool('WIDGET', 'show_widget', 'wg1', { title: 'satis_grafigi', widget_code: code });
  await streamText('Grafiği yukarıda gösterdim.');
  finish('success');
}
// Yan oturum: başlatır (izinle), listeler. Yan oturumun her tur sonu bu sürece <yan-oturum-olayi> olarak döner.
let childId = null, events = 0;
async function sessionStartTurn(opts = { title: 'Testleri yaz', prompt: 'alt görev: testleri yaz' }) {
  const r = await panelTool('SESS', 'sessions', 'ss1', { action: 'start', ...opts });
  childId = +((r.match(/Yan oturum (\d+) başladı/) || [])[1]) || null;
  await panelTool('SESS', 'sessions', 'ss2', { action: 'list' });
  await streamText('Yan oturumu başlattım.');
  finish('success');
}
// Octopus: baş iki kol açar (iki ayrı izin kartı); kolların bildirimlerine kısaca yanıt verir
let octopusHead = false;
const octoArms = []; // başın açtığı kolların numaraları
const armId = (r) => +((r.match(/Yan oturum (\d+) başladı/) || [])[1]) || null;
async function octopusArmsTurn() {
  octopusHead = true;
  octoArms.push(armId(await panelTool('OCTO', 'sessions', 'oc1', { action: 'start', title: 'Kol A', prompt: 'alt görev: A' })));
  octoArms.push(armId(await panelTool('OCTO', 'sessions', 'oc2', { action: 'start', title: 'Kol B', prompt: 'alt görev: B' })));
  await streamText('İki kolu açtım.');
  finish('success');
}
// Baş ilk kolu doğruladı: "done"
async function octopusDoneTurn() {
  await panelTool('OCTO', 'sessions', 'oc3', { action: 'done', id: octoArms[0] });
  await streamText('Kol A bitti.');
  finish('success');
}
// Kol sınırı: dokuz kol dener; sekizi kartla açılır, dokuzuncusu kartsız reddedilir
async function octopusNineTurn() {
  for (let i = 1; i <= 9; i++) {
    const r = await panelTool('OCTO', 'sessions', 'on' + i, { action: 'start', title: 'Kol ' + i, prompt: 'alt görev: k' + i });
    if (armId(r)) octoArms.push(armId(r));
  }
  await streamText('Dokuz kolu denedim.');
  finish('success');
}
// Kolun kendisi: görev listesi yazar ve izin ister (başlatan başa "seni bekliyor" gider)
async function armWaitTurn() {
  asst([{ type: 'tool_use', id: 'ka1', name: 'TodoWrite', input: { todos: [
    { content: 'Oku', status: 'completed', activeForm: 'Okunuyor' }, { content: 'Koş', status: 'in_progress', activeForm: 'Koşuluyor' }] } }]);
  toolRes('ka1', 'ok');
  const bash = { command: 'pnpm test', description: 'Testleri koş' };
  asst([{ type: 'tool_use', id: 'ka2', name: 'Bash', input: bash }]);
  const r = await perm('Bash', bash);
  log('ARMWAIT', r.behavior);
  toolRes('ka2', r.behavior === 'allow' ? '✓ testler geçti' : 'reddedildi', r.behavior !== 'allow');
  await streamText('Kol testleri koştu.');
  finish('success');
}
// Ahtapot bölmesi (P4.2): baş Kol 3'e yazar (baştan kola atım)
async function octopusSendTurn() {
  await panelTool('OCTO', 'sessions', 'os1', { action: 'send', id: octoArms[4], message: 'kol uzun çalışsın' });
  await streamText("Kol 3'e yazdım.");
  finish('success');
}
// Kol uzun çalışır: görev listesi yazar, test '<günlük>.devam' dosyasını yazana kadar bekler (kol "çalışıyor" kalır)
async function armLongTurn() {
  const todos = (n) => ['Oku', 'Yaz', 'Koş', 'Doğrula'].map((c, i) => ({ content: c, status: i < n ? 'completed' : i === n ? 'in_progress' : 'pending', activeForm: c }));
  asst([{ type: 'tool_use', id: 'kl1', name: 'TodoWrite', input: { todos: todos(1) } }]);
  toolRes('kl1', 'ok');
  log('ARMLONG bekliyor');
  const flag = LOG + '.devam';
  for (let i = 0; i < 600 && !fs.existsSync(flag); i++) await sleep(50);
  try { fs.unlinkSync(flag); } catch {}
  asst([{ type: 'tool_use', id: 'kl2', name: 'TodoWrite', input: { todos: todos(4) } }]);
  toolRes('kl2', 'ok');
  await streamText('Uzun iş bitti.');
  finish('success');
}
// Baş dört kol açar (her biri kartla; bölmede önce tomurcuk, onaylanınca büyüyen kol)
async function octopusFourTurn() {
  for (let i = 9; i <= 12; i++) {
    const r = await panelTool('OCTO', 'sessions', 'of' + i, { action: 'start', title: 'Kol ' + i, prompt: 'alt görev: k' + i });
    if (armId(r)) octoArms.push(armId(r));
  }
  await streamText('Dört kolu açtım.');
  finish('success');
}
// Kolun kendisi kol açmaya çalışır: kart açılmadan kuralla reddedilmeli
async function armStartTurn() {
  await panelTool('ARM', 'sessions', 'ka4', { action: 'start', title: 'Alt kol', prompt: 'alt görev: C' });
  await streamText('Kol açamadım.');
  finish('success');
}
async function sessionEventTurn(t) {
  events++;
  log('SESSEVENT', events, JSON.stringify(t.slice(0, 300)));
  if (octopusHead) await streamText('Kollar rapor verdi.');
  else if (events === 1) {
    await panelTool('SESS', 'sessions', 'ss3', { action: 'read', id: childId });
    await panelTool('SESS', 'sessions', 'ss4', { action: 'send', id: childId, message: 'alt görev: README de yaz' });
    await streamText('Yan oturuma README işini de verdim.');
  } else await streamText('İki iş de bitti.');
  finish('success');
}
// Tur sonu kutusu: yarım görev listesi bırakır, özet + soru + iki düğme
const TODOS = (n) => [['Kapıları koş', 'Kapılar koşuluyor'], ['Testleri yaz', 'Testler yazılıyor'], ['Günlüğe yaz', 'Günlüğe yazılıyor']]
  .map(([content, activeForm], i) => ({ content, activeForm, status: i < n ? 'completed' : i === n ? 'in_progress' : 'pending' }));
async function wrapTurn() {
  asst([{ type: 'tool_use', id: 'wt1', name: 'TodoWrite', input: { todos: TODOS(1) } }]);
  toolRes('wt1', 'ok');
  await panelTool('WRAP', 'wrap_up', 'wt2', { recap: 'Kapılar yeşil, iki test kaldı. Hiçbir şey commit edilmedi.', ask: 'Testleri şimdi yazayım mı?',
    actions: [{ label: 'Evet, yaz', message: 'tamam, bitir: testleri yaz' }, { label: 'Sonra' }] });
  await streamText('Kapıları koştum.');
  finish('success');
}
async function todoDoneTurn() {
  asst([{ type: 'tool_use', id: 'wt3', name: 'TodoWrite', input: { todos: TODOS(3) } }]);
  toolRes('wt3', 'ok');
  await streamText('Hepsi bitti.');
  finish('success');
}
// Üçüncü taraf MCP turu (Blender): kod çalıştırır, sonra görsel döndüren bir araç çağırır.
// Gerçek Claude Code MCP sunucusunu kendi içinde çalıştırır; panele yalnız tool_use ve görselli tool_result gelir.
async function mcpTurn() {
  const code = 'import bpy\n\n# Sahneye küp ekle\nbpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))\nbpy.context.object.name = "Kup"';
  asst([{ type: 'tool_use', id: 'b1', name: 'mcp__blender__execute_blender_code', input: { code } }]);
  toolRes('b1', [{ type: 'text', text: 'Executed code successfully' }]);
  asst([{ type: 'tool_use', id: 'b2', name: 'mcp__blender__get_viewport_screenshot', input: { max_size: 800 } }]);
  await sleep(150);
  toolRes('b2', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png(64, 40, [232, 140, 70]).toString('base64') } }]);
  await streamText('Küp hazır, sahne görüntüsü yukarıda.');
  finish('success');
}
// Ham HTML içeren yanıt (ör. Claude okuduğu bir dosyadaki talimata uymuş): dışarı gönderen form, izin kartlarını gizleyen stil
async function trapTurn() {
  await streamText('Devam etmek için onaylayın:\n\n<form action="https://saldirgan.invalid/x"><button id="tuzak">Onayla</button></form>\n\n' +
    '<style>.perm-card { display: none }</style>\n\n<a href="https://example.com/" style="position:fixed;inset:0">tam ekran link</a>\n\n' +
    '<div class="perm-card question" id="sahte-kart">Sahte izin kartı</div>\n\n```js\nconsole.log(1)\n```\n\n- [x] görev kutucuğu kalır');
  finish('success');
}
// Tek renkli, geçerli bir PNG (görselin gerçekten çözülüp çizildiğini test etmek için)
function png(w, h, [r, g, b]) {
  const zlib = require('zlib');
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
function finish(subtype) {
  interrupted = false;
  out({ type: 'result', subtype, is_error: subtype !== 'success', duration_ms: 4200, duration_api_ms: 3000, num_turns: 7, result: subtype === 'success' ? 'Bitti' : 'Durduruldu', stop_reason: 'end_turn', total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [], session_id: sid, uuid: uuid() });
}
