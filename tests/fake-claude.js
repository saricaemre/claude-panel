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
// Gerçek Claude Code gibi init mesajında verilen --model/--effort değerlerini bildir
const argOf = (k) => (process.argv.find((x) => x.startsWith(`--${k}=`)) || '').split('=')[1];
// Ayar klasöründe .fake-logged-out varsa süreç girişsiz açılmış sayılır (gerçek Claude Code girişi açılışta okur)
const LOGGED_OUT = fs.existsSync(require('path').join(process.env.CLAUDE_CONFIG_DIR || '', '.fake-logged-out'));
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
    if (/rapor/i.test(t)) await artifactTurn();
    else if (/blender/i.test(t)) await mcpTurn();
    else if (/tuzak/i.test(t)) await trapTurn();
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
async function perm(tool_name, input) {
  const r = await ask({ subtype: 'can_use_tool', tool_name, input, tool_use_id: 'x', permission_suggestions: [{ type: 'addRules', rules: [{ toolName: tool_name }], behavior: 'allow', destination: 'session' }] });
  log('PERM', JSON.stringify(r));
  return r;
}
async function runTurn(m) {
  const cwd = process.cwd();
  if (turn === 1) {
    out({ type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'SessionStart:startup', hook_event: 'SessionStart', output: '', stdout: 'Oturum başı doğrulaması: 13/13 kapı yeşil · sıradaki iş IS-279', stderr: '', outcome: 'success', uuid: uuid(), session_id: sid });
    out({ type: 'system', subtype: 'init', cwd, session_id: sid, model: MODEL_IDS[argOf('model')] || 'claude-opus-5-5', permissionMode: 'default', effort: argOf('effort') || 'high', tools: ['Read', 'Bash'], mcp_servers: [{ name: 'figma', status: 'connected' }, { name: 'blender', status: 'connected' }], slash_commands: ['compact', 'review', 'tasarim', 'context'], skills: ['tasarim'], agents: ['gorsel-dogrulayici'], claude_code_version: '2.1.300', apiKeySource: 'none', output_style: 'default', plugins: [], uuid: uuid() });
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
    '<style>.perm-card { display: none }</style>\n\n<a href="https://example.com/" style="position:fixed;inset:0">tam ekran link</a>\n\n- [x] görev kutucuğu kalır');
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
