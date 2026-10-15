#!/usr/bin/env node
// Sahte Claude Code: Agent SDK'nın stream-json protokolünü taklit eder (yalnız testler için).
// Uygulama CLAUDE_PANEL_CLAUDE_BIN ile bu dosyayı gerçek Claude Code yerine çalıştırır.
// Gelen her satırı FAKE_CLAUDE_LOG dosyasına yazar; testler bu günlüğü denetler.
const readline = require('readline');
const fs = require('fs');
const LOG = process.env.FAKE_CLAUDE_LOG || require('path').join(require('os').tmpdir(), 'fake-claude.log');
const log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
log('ARGS', JSON.stringify(process.argv.slice(2)), 'CFG', process.env.CLAUDE_CONFIG_DIR, 'CWD', process.cwd());
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sid = '11111111-2222-3333-4444-555555555555';
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
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  log('IN', line.slice(0, 300));
  if (m.type === 'control_request') {
    const sub = m.request.subtype;
    let response = {};
    if (sub === 'initialize') response = { commands: [], models: [
      { value: 'opus', displayName: 'Opus 5.5', description: 'En güçlü', supportsEffort: true, supportedEffortLevels: ['low','medium','high','xhigh','max'] },
      { value: 'sonnet', displayName: 'Sonnet 5.5', description: 'Hızlı', supportsEffort: true, supportedEffortLevels: ['low','medium','high'] }], account: {} };
    if (sub === 'interrupt') interrupted = true;
    out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
    return;
  }
  if (m.type === 'control_response') { const r = pending.get(m.response.request_id); pending.delete(m.response.request_id); r && r(m.response.response || m.response); return; }
  if (m.type === 'user') { turn++; await runTurn(m); }
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
async function perm(tool_name, input) {
  const r = await ask({ subtype: 'can_use_tool', tool_name, input, tool_use_id: 'x', permission_suggestions: [{ type: 'addRules', rules: [{ toolName: tool_name }], behavior: 'allow', destination: 'session' }] });
  log('PERM', JSON.stringify(r));
  return r;
}
async function runTurn(m) {
  const cwd = process.cwd();
  if (turn === 1) {
    out({ type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'SessionStart:startup', hook_event: 'SessionStart', output: '', stdout: 'Oturum başı doğrulaması: 13/13 kapı yeşil · sıradaki iş IS-279', stderr: '', outcome: 'success', uuid: uuid(), session_id: sid });
    out({ type: 'system', subtype: 'init', cwd, session_id: sid, model: 'claude-opus-5-5', permissionMode: 'default', effort: 'high', tools: ['Read', 'Bash'], mcp_servers: [{ name: 'figma', status: 'connected' }], slash_commands: ['compact', 'review', 'tasarim', 'context'], skills: ['tasarim'], agents: ['gorsel-dogrulayici'], claude_code_version: '2.1.300', apiKeySource: 'none', output_style: 'default', plugins: [], uuid: uuid() });
  }
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
function finish(subtype) {
  interrupted = false;
  out({ type: 'result', subtype, is_error: subtype !== 'success', duration_ms: 4200, duration_api_ms: 3000, num_turns: 7, result: subtype === 'success' ? 'Bitti' : 'Durduruldu', stop_reason: 'end_turn', total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [], session_id: sid, uuid: uuid() });
}
