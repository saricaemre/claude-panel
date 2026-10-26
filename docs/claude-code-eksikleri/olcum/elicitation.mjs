// Gerçek Claude Code ile MCP elicitation ölçümü (madde 8, 2026-10-26): sahte Anthropic API (0 token), geçici ayar klasörü,
// elicitation isteyen stdio MCP sunucusu (elic-sunucu.mjs). Bkz. ../PLAN.md §4
// Kullanım: node elicitation.mjs <sdk.mjs yolu> <çalışma kökü> [senaryo…]
// Senaryolar: kabul, ret, vazgec, yok (onElicitation verilmez), yanlis (şemaya uymayan içerik), kesinti (beklerken interrupt),
// adres (url kipi + tamamlandı bildirimi), adres-hata (-32042), izin (permissionDisplay _meta), kanca (Elicitation kancası yanıtlar)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [SDK, ROOT, ...WANT] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ELIC_LOG = path.join(ROOT, 'sunucu.jsonl');
fs.writeFileSync(ELIC_LOG, '');
const reqLog = path.join(ROOT, 'istekler.jsonl');
fs.writeFileSync(reqLog, '');

// ---------- Sahte API ----------
const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const textOf = (m) => typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.type === 'text' ? b.text : b.type === 'tool_result' ? '[tool_result ' + JSON.stringify(b.content).slice(0, 600) + ']' : b.type === 'tool_use' ? `[tool_use ${b.name}]` : '').join(' ');
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
const TOOLS = { FORM: 'form_iste', ADRESHATA: 'adres_hatasi', ADRES: 'adres_iste', IZIN: 'izin_iste' };
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
    const msgs = b.messages || [];
    const last = [...msgs].reverse().find((m) => m.role === 'user') || {};
    const lastText = textOf(last);
    const main = tools.includes('Bash');
    fs.appendFileSync(reqLog, JSON.stringify({ main, tools: tools.filter((t) => t.startsWith('mcp__')), lastTail: lastText.slice(-800) }) + '\n');
    const id = 'msg_' + randomUUID().slice(0, 8);
    const usage = { input_tokens: 10, output_tokens: 1 };
    const start = { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null, usage } };
    if (!main) {
      if (!b.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: 'başlık' }], stop_reason: 'end_turn', usage })); }
      return sse(res, text(start, 'başlık'));
    }
    if (lastText.includes('[tool_result')) return sse(res, text(start, 'tamam'));
    for (const [k, t] of Object.entries(TOOLS)) {
      if (new RegExp('\\b' + k + '\\b').test(lastText)) {
        const full = 'mcp__elic__' + t;
        if (!tools.includes(full)) console.log('UYARI: araç isteğin tools listesinde yok (ertelenmiş?)', full);
        return sse(res, toolUse(start, full, {}));
      }
    }
    sse(res, text(start, 'tamam'));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

process.env.CLAUDE_CONFIG_DIR = CFG;
const sdk = await import(SDK);
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, ANTHROPIC_API_KEY: 'sk-ant-fake-0000', ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

class Q { constructor() { this.items = []; this.w = []; } push(x) { const w = this.w.shift(); w ? w({ value: x, done: false }) : this.items.push(x); } close() { for (const w of this.w.splice(0)) w({ done: true }); this.closed = true; }
  [Symbol.asyncIterator]() { return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false }) : this.closed ? Promise.resolve({ done: true }) : new Promise((r) => this.w.push(r)) }; } }

const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(6);
function open(answer, tag, extra = {}) {
  const queue = new Q();
  const opts = {
    cwd: PROJ, env, settingSources: ['user'], model: 'claude-sonnet-4-5', permissionMode: 'default',
    mcpServers: { elic: { type: 'stdio', command: process.execPath, args: [path.join(HERE, 'elic-sunucu.mjs')], env: { ORT_ELIC_LOG: ELIC_LOG, ORT_ELIC_TIMEOUT: process.env.ORT_ELIC_TIMEOUT || '60000', PATH: process.env.PATH } } },
    canUseTool: async (name, input) => { console.log(ms(), tag, 'canUseTool', name); return { behavior: 'allow', updatedInput: input }; },
    ...extra,
  };
  if (answer) opts.onElicitation = async (request, o) => {
    console.log(ms(), tag, 'onElicitation', JSON.stringify(request), 'requestId', o.requestId);
    o.signal.addEventListener('abort', () => console.log(ms(), tag, 'onElicitation SIGNAL ABORT', o.signal.reason?.message || String(o.signal.reason || '')));
    return answer(request, o);
  };
  const q = sdk.query({ prompt: queue, options: opts });
  const s = { q, queue, waiters: [] };
  (async () => {
    try {
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') console.log(ms(), tag, 'init mcp', JSON.stringify(m.mcp_servers), 'tools', m.tools.filter((t) => t.startsWith('mcp__')).join(','));
        else if (m.type === 'system' && !['session_state_changed'].includes(m.subtype)) console.log(ms(), tag, 'system', m.subtype, JSON.stringify(m).slice(0, 400));
        if (m.type === 'assistant') for (const b of m.message?.content || []) if (b.type === 'tool_use') console.log(ms(), tag, 'tool_use', b.name);
        if (m.type === 'user' && Array.isArray(m.message?.content)) for (const b of m.message.content) if (b.type === 'tool_result') console.log(ms(), tag, 'tool_result is_error', !!b.is_error, JSON.stringify(b.content).slice(0, 500));
        if (m.type === 'result') { console.log(ms(), tag, 'result', m.subtype, m.is_error ? 'HATA' : ''); s.waiters.shift()?.(m); }
      }
    } catch (e) { console.log(ms(), tag, 'akış hatası', e.message); for (const w of s.waiters.splice(0)) w(null); }
  })();
  s.say = (t) => new Promise((resolve) => {
    s.waiters.push(resolve);
    queue.push({ type: 'user', message: { role: 'user', content: t }, parent_tool_use_id: null, uuid: randomUUID() });
    setTimeout(() => resolve('ZAMAN_ASIMI'), 90000);
  }).then((r) => { if (r === 'ZAMAN_ASIMI') console.log(tag, 'zaman aşımı'); });
  s.end = () => { queue.close(); q.close(); };
  return s;
}
const run = async (name, answer, prompt, extra, during) => {
  if (WANT.length && !WANT.includes(name)) return;
  console.log(`\n=== ${name} ===`);
  const before = fs.readFileSync(ELIC_LOG, 'utf8').length;
  const s = open(answer, `[${name}]`, extra);
  const p = s.say(prompt);
  if (during) await during(s);
  await p;
  await new Promise((r) => setTimeout(r, 2500));
  for (const line of fs.readFileSync(ELIC_LOG, 'utf8').slice(before).trim().split('\n').filter(Boolean)) console.log('  sunucu', line.slice(0, 600));
  s.end();
  await new Promise((r) => setTimeout(r, 600));
};

const FORM = { ad: 'Emre', eposta: 'a@b.co', yas: 30, oran: 0.5, onay: true, renk: 'mavi', boy: 's', etiketler: ['a', 'c'] };
await run('kabul', async () => ({ action: 'accept', content: FORM }), 'FORM');
await run('ret', async () => ({ action: 'decline' }), 'FORM');
await run('vazgec', async () => ({ action: 'cancel' }), 'FORM');
await run('yok', null, 'FORM');
await run('yanlis', async () => ({ action: 'accept', content: { ad: 5, yas: 'otuz' } }), 'FORM');
await run('eksik', async () => ({ action: 'accept', content: { ad: 'E' } }), 'FORM');
// Beklerken interrupt: sinyal düşer mi, araç ne döner
await run('kesinti', (req, o) => new Promise((res) => { o.signal.addEventListener('abort', () => res({ action: 'cancel' })); }), 'FORM', {},
  async (s) => { await new Promise((r) => setTimeout(r, 4000)); console.log(ms(), '[kesinti] interrupt'); await s.q.interrupt().catch((e) => console.log('interrupt hata', e.message)); });
// Sunucunun zaman aşımı: yanıt hiç verilmez (ORT_ELIC_TIMEOUT=3000 ile koşulur)
await run('zaman', (req, o) => new Promise((res) => { o.signal.addEventListener('abort', () => res({ action: 'cancel' })); }), 'FORM');
await run('adres', async () => ({ action: 'accept' }), 'ADRES');
await run('adres-ret', async () => ({ action: 'decline' }), 'ADRES');
await run('adres-hata', async () => ({ action: 'accept' }), 'ADRESHATA');
await run('izin', async () => ({ action: 'accept', content: { onay: true } }), 'IZIN');
await run('kanca', async () => ({ action: 'decline' }), 'FORM', { hooks: { Elicitation: [{ hooks: [async (input) => { console.log(ms(), '[kanca] Elicitation kancası', JSON.stringify(input).slice(0, 300)); return { hookSpecificOutput: { hookEventName: 'Elicitation', action: 'accept', content: { ad: 'Kanca', onay: true } } }; }] }] } });
console.log('\nistekler:', reqLog, 'sunucu:', ELIC_LOG);
server.close();
setTimeout(() => process.exit(0), 500);
