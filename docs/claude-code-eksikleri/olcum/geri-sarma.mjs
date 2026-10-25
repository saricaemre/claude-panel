// Gerçek Claude Code ile geri sarma ölçümü (2026-10-25): sahte Anthropic API (0 token), geçici ayar klasörü. Bkz. ../PLAN.md §4
// Kullanım: node olc.mjs <sdk.mjs yolu> <çalışma kökü>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [SDK, ROOT] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');
const FILE = path.join(PROJ, 'a.txt');
const log = [];

// ---------- Sahte API ----------
let n = 0;
const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const textOf = (m) => typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.type === 'text' ? b.text : b.type === 'tool_result' ? '[tool_result]' : b.type === 'tool_use' ? `[tool_use ${b.name}]` : '').join(' ');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      res.writeHead(req.url.includes('count_tokens') ? 200 : 404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    const b = JSON.parse(body || '{}');
    const main = (b.tools || []).some((t) => t.name === 'Write');
    const msgs = b.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const lastText = textOf(last);
    if (main) log.push({ n: ++n, msgs: msgs.map((m) => m.role[0] + ':' + textOf(m).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim().slice(0, 40)) });
    const id = 'msg_' + randomUUID().slice(0, 8);
    const usage = { input_tokens: 10, output_tokens: 1 };
    const start = { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null, usage } };
    const m = main && /YAZ:(\w+)/.exec(lastText);
    if (!b.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: 'Başlık' }], stop_reason: 'end_turn', usage }));
    }
    if (m && !lastText.includes('[tool_result]')) {
      const input = JSON.stringify({ file_path: FILE, content: m[1] + '\n' });
      return sse(res, [start,
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_' + randomUUID().slice(0, 8), name: 'Write', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: 'message_stop' }]);
    }
    sse(res, [start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'tamam' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' }]);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

process.env.CLAUDE_CONFIG_DIR = CFG;
const sdk = await import(SDK);
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, ANTHROPIC_API_KEY: 'sk-ant-fake-0000', ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

class Q { constructor() { this.items = []; this.w = []; } push(x) { const w = this.w.shift(); w ? w({ value: x, done: false }) : this.items.push(x); } close() { for (const w of this.w.splice(0)) w({ done: true }); this.closed = true; }
  [Symbol.asyncIterator]() { return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false }) : this.closed ? Promise.resolve({ done: true }) : new Promise((r) => this.w.push(r)) }; } }

function open(extra, tag) {
  const queue = new Q();
  const q = sdk.query({ prompt: queue, options: { cwd: PROJ, env, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, model: 'claude-sonnet-4-5', ...extra } });
  const s = { q, queue, msgs: [], waiters: [], sid: null };
  (async () => {
    try {
      for await (const m of q) {
        s.msgs.push(m);
        if (!m.parent_tool_use_id && (m.type === 'assistant' || (m.type === 'user' && Array.isArray(m.message?.content)))) s.lastChain = m.uuid;
        if (m.session_id) s.sid = m.session_id;
        if (m.type === 'user' && !m.parent_tool_use_id && typeof m.message?.content === 'string') console.log(tag, 'user echo uuid', m.uuid, m.isReplay ? 'replay' : '');
        if (m.type === 'result') { console.log(tag, 'result', m.subtype, m.is_error ? 'HATA ' + (m.errors || m.result) : ''); s.waiters.shift()?.(m); }
      }
    } catch (e) { console.log(tag, 'akış hatası', e.message); for (const w of s.waiters.splice(0)) w(null); }
  })();
  s.say = (text, uuid = randomUUID()) => new Promise((resolve) => {
    s.waiters.push(resolve);
    queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, uuid, origin: { kind: 'human' } });
    setTimeout(() => resolve('ZAMAN_ASIMI'), 60000);
  }).then((r) => { if (r === 'ZAMAN_ASIMI') console.log(tag, 'zaman aşımı'); return uuid; });
  s.end = () => { queue.close(); q.close(); };
  return s;
}
const read = () => fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim() : '(yok)';
const transcript = (sid) => {
  for (const d of fs.readdirSync(path.join(CFG, 'projects'))) {
    const f = path.join(CFG, 'projects', d, sid + '.jsonl');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  }
  return [];
};

// 1. İki tur: dosya v1, sonra v2
const a = open({ enableFileCheckpointing: true }, '[A]');
const U1 = await a.say('YAZ:v1');
console.log('U1 sonrası dosya:', read());
const chainBeforeU2 = a.lastChain;
const U2 = await a.say('YAZ:v2');
console.log('U2 sonrası dosya:', read());
const sid = a.sid;
let rows = transcript(sid);
const byUuid = (u) => rows.find((r) => r.uuid === u);
console.log('kayıtta U1:', !!byUuid(U1), 'parent', byUuid(U1)?.parentUuid, '| U2:', !!byUuid(U2), 'parent', byUuid(U2)?.parentUuid);
console.log('akıştaki son zincir uuid (U2 öncesi):', chainBeforeU2, '== U2.parent?', chainBeforeU2 === byUuid(U2)?.parentUuid);
console.log('kayıt türleri:', [...new Set(rows.map((r) => r.type))].join(','));
console.log('snapshot messageId\'leri:', rows.filter((r) => r.type === 'file-history-snapshot').map((r) => r.messageId === U1 ? 'U1' : r.messageId === U2 ? 'U2' : r.messageId).join(','));

// 2. Kodu U2'ye geri sar (önce deneme)
console.log('dryRun U2:', JSON.stringify(await a.q.rewindFiles(U2, { dryRun: true })));
console.log('rewind U2:', JSON.stringify(await a.q.rewindFiles(U2)), '→ dosya', read());
// U2 yeniden ileri? (geri sarılan bir noktadan sonra tekrar yazılabiliyor mu)
a.end();
await new Promise((r) => setTimeout(r, 800));

// 3. Konuşmayı U2'den öncesine: yeni süreç, resumeSessionAt = U2'nin ebeveyni
const at = byUuid(U2)?.parentUuid;
const b = open({ enableFileCheckpointing: true, resume: sid, resumeSessionAt: at }, '[B]');
const U3 = await b.say('merhaba');
console.log('B oturum kimliği:', b.sid, b.sid === sid ? '(aynı)' : '(YENİ)');
console.log('B ilk istekteki mesajlar:', JSON.stringify(log[log.length - 1].msgs));
// 4. Süreç değişti: U1'e kod geri sarma hâlâ çalışıyor mu?
console.log('B dryRun U1:', JSON.stringify(await b.q.rewindFiles(U1, { dryRun: true })));
console.log('B rewind U1:', JSON.stringify(await b.q.rewindFiles(U1)), '→ dosya', read());
// 5. B'de yeni bir yazma, sonra o turu geri sar (kayıt dallanmışken)
const U4 = await b.say('YAZ:v4');
console.log('U4 sonrası dosya:', read());
console.log('B rewind U4:', JSON.stringify(await b.q.rewindFiles(U4)), '→ dosya', read());
b.end();
await new Promise((r) => setTimeout(r, 800));

// 6. getSessionMessages hangi dalı veriyor?
const sm = await sdk.getSessionMessages(sid, { dir: PROJ });
console.log('getSessionMessages:', sm.map((m) => m.type[0] + ':' + textOf(m.message || {}).slice(0, 20)).join(' | '));

// 7. resumeDropsTurn: son turu (U4) at → kabul mü? İki tur at (U3 ve U4) → ret mi?
rows = transcript(sid);
const c1 = open({ resume: sid, resumeSessionAt: byUuid(U4)?.parentUuid, resumeDropsTurn: U4 }, '[C1]');
await c1.say('selam');
c1.end();
await new Promise((r) => setTimeout(r, 800));
rows = transcript(sid);
const c2 = open({ resume: sid, resumeSessionAt: byUuid(U3)?.parentUuid, resumeDropsTurn: U3 }, '[C2]');
await c2.say('selam2');
c2.end();
console.log('istek günlüğü:'); for (const l of log) console.log(' ', l.n, JSON.stringify(l.msgs));
server.close();
setTimeout(() => process.exit(0), 500);
