// Gerçek Claude Code ile izin reddi ölçümü (madde 5, 2026-10-25): sahte Anthropic API (0 token), geçici ayar klasörü. Bkz. ../PLAN.md §4
// Kullanım: node izin-reddi.mjs <sdk.mjs yolu> <çalışma kökü> [senaryo…]
// Senaryolar: kural (permissions.deny, Bash), kural-web (permissions.deny, WebFetch), kural-dosya (yola bağlı Read kuralı), disallowed (disallowedTools), dontask, oto (otomatik kip; sınıflandırıcının isteği günlüğe), ajan (alt ajanda ret)
// Sınıflandırıcının yanıtı: ORT_SINIF=izin|ret (varsayılan ret). ORT_MODEL: öbür senaryoların modeli (varsayılan claude-sonnet-4-5)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [SDK, ROOT, ...WANT] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');
fs.writeFileSync(path.join(PROJ, 'a.txt'), 'x\n');
fs.writeFileSync(path.join(PROJ, 'gizli.txt'), 'gizli\n');
fs.writeFileSync(path.join(CFG, 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm:*)', 'WebFetch(domain:example.com)', 'Read(./gizli.txt)'] } }));
const SINIF = process.env.ORT_SINIF || 'ret';
const reqLog = path.join(ROOT, 'istekler.jsonl');
fs.writeFileSync(reqLog, '');

// ---------- Sahte API ----------
const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const textOf = (m) => typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.type === 'text' ? b.text : b.type === 'tool_result' ? '[tool_result]' : b.type === 'tool_use' ? `[tool_use ${b.name}]` : '').join(' ');
const toolUse = (start, name, input) => [start,
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_' + randomUUID().slice(0, 8), name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: 'message_stop' }];
const text = (start, t) => [start,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: 'message_stop' }];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      res.writeHead(req.url.includes('count_tokens') ? 200 : 404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    const b = JSON.parse(body || '{}');
    const tools = (b.tools || []).map((t) => t.name);
    const sys = (Array.isArray(b.system) ? b.system.map((s) => s.text).join('\n') : String(b.system || ''));
    const msgs = b.messages || [];
    // Opus 5.5'te isteğin sonunda system rollü bir mesaj olabilir: son kullanıcı mesajı rolle bulunur
    const last = [...msgs].reverse().find((m) => m.role === 'user') || {};
    const lastText = textOf(last);
    const main = tools.includes('Bash');
    const sub = main && !tools.includes('Agent') && !tools.includes('Task');
    const kind = main ? (sub ? 'ajan' : 'ana') : 'diger';
    fs.appendFileSync(reqLog, JSON.stringify({ kind, roles: msgs.map((m) => m.role).join(','), lastTail: lastText.slice(-300), model: b.model, stream: !!b.stream, max_tokens: b.max_tokens, stop: b.stop_sequences, thinking: b.thinking, tools, tool_choice: b.tool_choice, sys: sys.slice(0, 1500), sysTail: sys.slice(-2500), lastUserTail: lastText.slice(-1200), msgs: msgs.map((m) => m.role[0] + ':' + textOf(m).slice(0, 3000)) }) + '\n');
    const id = 'msg_' + randomUUID().slice(0, 8);
    const usage = { input_tokens: 10, output_tokens: 1 };
    const start = { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null, usage } };
    if (!main) {
      // Sınıflandırıcı ya da başlık: araç zorlanmışsa o araçla yanıt ver
      // Sınıflandırıcı (CLI 2.1.310): 1. aşama "</severity>"da duran 64 token'lık istek (<severity>N, 50 sınır),
      // 2. aşama <thinking>…</thinking><severity>N</severity><category>Kural adı</category> (kategori yalnız ret için)
      const stage1 = (b.stop_sequences || []).includes('</severity>');
      const forced = b.tool_choice?.type === 'tool' ? b.tool_choice.name : (b.tools?.length === 1 ? b.tools[0].name : null);
      const content = forced
        ? [{ type: 'tool_use', id: 'toolu_' + randomUUID().slice(0, 8), name: forced, input: forcedInput(b.tools.find((t) => t.name === forced)) }]
        : stage1 ? [{ type: 'text', text: SINIF === 'ret' ? '<severity>90' : '<severity>10' }]
        : [{ type: 'text', text: SINIF === 'ret' ? '<thinking>sahte</thinking><severity>90</severity><category>Git Destructive</category>' : '<thinking>sahte</thinking><severity>10</severity>' }];
      if (!b.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: b.model, content, stop_reason: forced ? 'tool_use' : stage1 ? 'stop_sequence' : 'end_turn', stop_sequence: stage1 ? '</severity>' : null, usage }));
      }
      if (forced) return sse(res, toolUse(start, forced, content[0].input));
      return sse(res, text(start, content[0].text));
    }
    if (lastText.includes('[tool_result]')) return sse(res, text(start, 'tamam'));
    if (/AJAN/.test(lastText) && !sub) return sse(res, toolUse(start, tools.includes('Agent') ? 'Agent' : 'Task', { description: 'sil', prompt: 'SIL dosyayı', subagent_type: 'general-purpose', run_in_background: false }));
    if (/OKU/.test(lastText)) return sse(res, toolUse(start, 'Read', { file_path: path.join(PROJ, 'gizli.txt') }));
    if (/GETIR/.test(lastText)) return sse(res, toolUse(start, 'WebFetch', { url: 'https://example.com/', prompt: 'özet' }));
    if (/SIL/.test(lastText)) return sse(res, toolUse(start, 'Bash', { command: 'rm a.txt', description: 'a.txt sil' }));
    if (/YAZDIR/.test(lastText)) return sse(res, toolUse(start, 'Bash', { command: 'git push --force origin main', description: 'zorla gönder' }));
    sse(res, text(start, 'tamam'));
  });
});
// Zorlanan aracın şemasından uydurma girdi (sınıflandırıcı biçimi bilinmiyor; ilk koşuda istek okunur)
function forcedInput(t) {
  const props = t?.input_schema?.properties || {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.type === 'boolean') out[k] = SINIF === 'ret';
    else if (v.enum) out[k] = v.enum.find((e) => /block|deny|ret|yes/i.test(e) === (SINIF === 'ret')) ?? v.enum[0];
    else if (v.type === 'string') out[k] = 'sahte gerekçe';
    else if (v.type === 'number' || v.type === 'integer') out[k] = 1;
  }
  return out;
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

process.env.CLAUDE_CONFIG_DIR = CFG;
const sdk = await import(SDK);
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, ANTHROPIC_API_KEY: 'sk-ant-fake-0000', ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

class Q { constructor() { this.items = []; this.w = []; } push(x) { const w = this.w.shift(); w ? w({ value: x, done: false }) : this.items.push(x); } close() { for (const w of this.w.splice(0)) w({ done: true }); this.closed = true; }
  [Symbol.asyncIterator]() { return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false }) : this.closed ? Promise.resolve({ done: true }) : new Promise((r) => this.w.push(r)) }; } }

// Panel gibi: canUseTool verilir (kart açılırsa günlüğe yazar ve izin verir)
function open(extra, tag) {
  const queue = new Q();
  const asked = [];
  const q = sdk.query({ prompt: queue, options: {
    cwd: PROJ, env, settingSources: ['user'], model: process.env.ORT_MODEL || 'claude-sonnet-4-5', allowDangerouslySkipPermissions: true,
    canUseTool: async (name, input, o) => { asked.push(name); console.log(tag, 'canUseTool', name, JSON.stringify(input).slice(0, 80), 'reason', o.decisionReason ? JSON.stringify(o.decisionReason).slice(0, 200) : '-', o.decision_reason_type || ''); return { behavior: 'allow', updatedInput: input }; },
    ...extra } });
  const s = { q, queue, waiters: [], asked };
  (async () => {
    try {
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') console.log(tag, 'init permissionMode', m.permissionMode);
        if (m.type === 'system' && m.subtype === 'permission_denied') console.log(tag, 'PERMISSION_DENIED', JSON.stringify(m));
        if (m.type === 'system' && !['init', 'permission_denied', 'session_state_changed'].includes(m.subtype)) console.log(tag, 'system', m.subtype, JSON.stringify(m).slice(0, 300));
        if (m.type === 'assistant') for (const b of m.message?.content || []) if (b.type === 'tool_use') console.log(tag, 'tool_use', b.id, b.name, m.parent_tool_use_id ? 'alt ajan ' + m.parent_tool_use_id : '');
        if (m.type === 'user' && Array.isArray(m.message?.content)) for (const b of m.message.content) if (b.type === 'tool_result') console.log(tag, 'tool_result', b.tool_use_id, 'is_error', !!b.is_error, JSON.stringify(b.content).slice(0, 400), m.parent_tool_use_id ? 'alt ajan' : '');
        if (m.type === 'result') { console.log(tag, 'result', m.subtype, 'permission_denials', JSON.stringify(m.permission_denials)); s.waiters.shift()?.(m); }
      }
    } catch (e) { console.log(tag, 'akış hatası', e.message); for (const w of s.waiters.splice(0)) w(null); }
  })();
  s.say = (t) => new Promise((resolve) => {
    s.waiters.push(resolve);
    queue.push({ type: 'user', message: { role: 'user', content: t }, parent_tool_use_id: null, uuid: randomUUID() });
    setTimeout(() => resolve('ZAMAN_ASIMI'), 90000);
  }).then((r) => { if (r === 'ZAMAN_ASIMI') console.log(tag, 'zaman aşımı'); });
  s.end = () => { queue.close(); q.close(); };
  return s;
}
const run = async (name, extra, prompt) => {
  if (WANT.length && !WANT.includes(name)) return;
  console.log(`\n=== ${name} ===`);
  const s = open(extra, `[${name}]`);
  await s.say(prompt);
  console.log(`[${name}] a.txt`, fs.existsSync(path.join(PROJ, 'a.txt')) ? 'duruyor' : 'SİLİNDİ');
  s.end();
  await new Promise((r) => setTimeout(r, 600));
};

await run('kural', { permissionMode: 'default' }, 'SIL');
await run('kural-web', { permissionMode: 'default' }, 'GETIR');
await run('kural-dosya', { permissionMode: 'default' }, 'OKU');
await run('disallowed', { permissionMode: 'default', disallowedTools: ['Bash(rm:*)'] }, 'SIL');
await run('dontask', { permissionMode: 'dontAsk' }, 'YAZDIR');
// Otomatik kip Sonnet 4.5'te açılmıyor (init "default" der); Opus 5.5'te açık. Sınıflandırıcının istekleri claude-sonnet-5'e gider
await run('oto', { permissionMode: 'auto', model: 'claude-opus-5-5' }, 'YAZDIR');
await run('ajan', { permissionMode: 'default' }, 'AJAN');
console.log('\nistekler:', reqLog);
server.close();
setTimeout(() => process.exit(0), 500);
