// Gerçek Claude Code ile arka plan görevleri ölçümü: sahte Anthropic API'si (0 token), geçici ayar klasörü.
// Kullanım: node arka.mjs <sdk.mjs yolu> <çalışma kökü>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [SDK, ROOT] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');
const T0 = Date.now();
const ts = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(5);

// ---------- Sahte API ----------
const textOf = (m) => typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.type === 'text' ? b.text : b.type === 'tool_result' ? '[tool_result ' + JSON.stringify(b.content).slice(0, 80) + ']' : b.type === 'tool_use' ? `[tool_use ${b.name}]` : '').join(' ');
let toolNames = null;
const sse = (res, events, delay = 0) => setTimeout(() => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}, delay);
const start = (model) => ({ type: 'message_start', message: { id: 'msg_' + randomUUID().slice(0, 8), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
const toolUse = (model, name, input) => [start(model),
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_' + randomUUID().slice(0, 8), name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }, { type: 'message_stop' }];
const text = (model, t) => [start(model),
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }, { type: 'message_stop' }];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      res.writeHead(req.url.includes('count_tokens') ? 200 : 404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    const b = JSON.parse(body || '{}');
    if (!b.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'x', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: 'Başlık' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    }
    const names = (b.tools || []).map((t) => t.name);
    if (names.includes('Bash') && !toolNames) toolNames = names;
    const msgs = b.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const lt = textOf(last).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
    const all = msgs.map(textOf).join(' | ');
    const sub = /ALT_AJAN_ISI/.test(textOf(msgs[0] || {})); // alt ajanın kendi isteği
    console.log(ts(), 'API', sub ? '(alt ajan)' : '(ana)', 'son:', lt.trim().slice(0, 110).replace(/\s+/g, ' '));
    const hasResult = /\[tool_result/.test(lt);
    if (sub) {
      if (!hasResult) return sse(res, toolUse(b.model, 'Bash', { command: 'sleep 8; echo alt-bitti', description: 'Alt ajanın komutu' }));
      return sse(res, text(b.model, 'alt iş bitti'));
    }
    if (/task-notification|<task_notification|görev bildirimi/i.test(lt)) return sse(res, text(b.model, 'bildirimi gördüm'));
    if (/YAVAS/.test(lt) && !hasResult) return sse(res, text(b.model, 'yavaş yanıt'), 5000);
    if (/ARKA_BASH/.test(lt) && !hasResult) return sse(res, toolUse(b.model, 'Bash', { command: 'sleep 7; echo arka-bitti', description: 'Uzun komut', run_in_background: true }));
    if (/ON_BASH/.test(lt) && !hasResult) return sse(res, toolUse(b.model, 'Bash', { command: 'sleep 9; echo on-bitti', description: 'Ön plandaki uzun komut' }));
    if (/ARKA_AJAN/.test(lt) && !hasResult) return sse(res, toolUse(b.model, 'Agent', { description: 'Alt iş', prompt: 'ALT_AJAN_ISI yap', subagent_type: 'general-purpose', run_in_background: true }));
    sse(res, text(b.model, 'tamam'));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.CLAUDE_CONFIG_DIR = CFG;
const sdk = await import(SDK);
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, ANTHROPIC_API_KEY: 'sk-ant-fake-0000', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

class Q { constructor() { this.items = []; this.w = []; } push(x) { const w = this.w.shift(); w ? w({ value: x, done: false }) : this.items.push(x); } close() { for (const w of this.w.splice(0)) w({ done: true }); this.closed = true; }
  [Symbol.asyncIterator]() { return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false }) : this.closed ? Promise.resolve({ done: true }) : new Promise((r) => this.w.push(r)) }; } }

const SHOW = new Set(['task_started', 'task_updated', 'task_progress', 'task_notification', 'background_tasks_changed', 'session_state_changed']);
function open(extra, tag) {
  const queue = new Q();
  const q = sdk.query({ prompt: queue, options: { cwd: PROJ, env, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, model: 'claude-sonnet-4-5', ...extra } });
  const s = { q, queue, waiters: [], tasks: [], results: 0 };
  (async () => {
    try {
      for await (const m of q) {
        if (m.type === 'system' && SHOW.has(m.subtype)) {
          const { type, subtype, uuid, session_id, ...rest } = m;
          console.log(ts(), tag, subtype, JSON.stringify(rest).slice(0, 330));
          if (subtype === 'task_started') s.tasks.push(m.task_id);
        }
        if (m.type === 'user' && Array.isArray(m.message?.content) && m.message.content[0]?.type === 'tool_result' && !m.parent_tool_use_id) {
          console.log(ts(), tag, 'tool_result', JSON.stringify(m.message.content[0].content).slice(0, 200), '| tool_use_result:', JSON.stringify(m.tool_use_result || null).slice(0, 220));
        }
        if (m.type === 'user' && !m.parent_tool_use_id && typeof m.message?.content === 'string') console.log(ts(), tag, 'user(str)', m.message.content.slice(0, 200).replace(/\s+/g, ' '), m.isSynthetic ? 'synthetic' : '', m.isReplay ? 'replay' : '');
        if (m.type === 'assistant' && m.parent_tool_use_id) { /* alt ajan */ }
        if (m.type === 'result') { s.results++; console.log(ts(), tag, 'RESULT', m.subtype); s.waiters.shift()?.(m); }
      }
    } catch (e) { console.log(ts(), tag, 'akış hatası', e.message); }
  })();
  s.say = (t) => new Promise((resolve) => { s.waiters.push(resolve); queue.push({ type: 'user', message: { role: 'user', content: t }, parent_tool_use_id: null, origin: { kind: 'human' } }); });
  s.end = () => { queue.close(); q.close(); };
  return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('=== 1. Arka plan Bash, kendiliğinden biter (bildirim turu?)');
const a = open({}, '[A]');
await a.say('ARKA_BASH');
await sleep(10000);
console.log('araçlar:', toolNames?.filter((n) => /Task|Monitor|Agent|Bash|Kill|Output/.test(n)).join(','));

console.log('=== 2. stopTask ile durdurma');
await a.say('ARKA_BASH');
const t2 = a.tasks[a.tasks.length - 1];
await sleep(1000);
try { await a.q.stopTask(t2); console.log(ts(), 'stopTask döndü'); } catch (e) { console.log('stopTask hata', e.message); }
await sleep(2500);

console.log('=== 3. perTaskStopAffordance YOK: arka plan Bash sürerken bir tur durdurulur');
await a.say('ARKA_BASH');
await sleep(500);
const p3 = a.say('YAVAS');
await sleep(1500);
await a.q.interrupt();
console.log(ts(), 'interrupt gönderildi');
await p3;
await sleep(7000);
a.end();
await sleep(800);

console.log('=== 4. perTaskStopAffordance VAR: aynı');
const b = open({ perTaskStopAffordance: true }, '[B]');
await b.say('ARKA_BASH');
await sleep(500);
const p4 = b.say('YAVAS');
await sleep(1500);
await b.q.interrupt();
console.log(ts(), 'interrupt gönderildi');
await p4;
await sleep(8000);

console.log('=== 5. Arka plan alt ajan, sonra stopTask');
await b.say('ARKA_AJAN');
await sleep(3000);
const t5 = b.tasks[b.tasks.length - 1];
try { await b.q.stopTask(t5); console.log(ts(), 'stopTask (ajan) döndü'); } catch (e) { console.log('stopTask hata', e.message); }
await sleep(3000);

console.log('=== 6. Ön plandaki Bash arka plana alınır (backgroundTasks)');
const p6 = b.say('ON_BASH');
await sleep(2500);
try { console.log(ts(), 'backgroundTasks →', await b.q.backgroundTasks()); } catch (e) { console.log('backgroundTasks hata', e.message); }
await p6;
await sleep(9000);
b.end();
server.close();
setTimeout(() => process.exit(0), 500);
