// Gerçek Claude Code ile `@dosya` açılımı ölçümü (madde 7, 2026-10-26): sahte Anthropic API (0 token), geçici ayar klasörü. Bkz. ../PLAN.md §4
// Kullanım: node dosya-anma.mjs <sdk.mjs yolu> <çalışma kökü>
// Her tur bir mesaj yollar; sahte API isteğin son kullanıcı mesajını (bütün blokları) <kök>/istekler.jsonl'a yazar, özet stdout'a.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [SDK, ROOT] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');
const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(PROJ, rel)), { recursive: true }); fs.writeFileSync(path.join(PROJ, rel), body); };
put('uygulama.js', 'satir1\nsatir2\nsatir3\nsatir4\n');
put('alt/b.js', 'b icerik\n');
put('bosluklu ad.txt', 'bosluk icerik\n');
put('şarkı.txt', 'turkce icerik\n');
put('buyuk.txt', 'x'.repeat(99) + '\n'.repeat(1) + ('y'.repeat(99) + '\n').repeat(4000)); // ~400 KB
for (const n of ['kacis dosya.txt', 'aralik.js', 'virgul.js', 'kod.js', 'iki1.js', 'iki2.js', 'tekrar.js', 'blok1.js', 'blok2.js']) put(n, `${n} 1\n${n} 2\n${n} 3\n${n} 4\n`);
put('resim.png', Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d2f6a10000000049454e44ae426082', 'hex'));
fs.writeFileSync(path.join(ROOT, 'disarida.txt'), 'disari icerik\n');
const reqLog = path.join(ROOT, 'istekler.jsonl');
fs.writeFileSync(reqLog, '');

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const text = (start, t) => [start,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: 'message_stop' }];
let lastReq = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      res.writeHead(req.url.includes('count_tokens') ? 200 : 404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    const b = JSON.parse(body || '{}');
    const msgs = b.messages || [];
    const main = (b.tools || []).some((t) => t.name === 'Bash');
    const id = 'msg_' + randomUUID().slice(0, 8);
    const usage = { input_tokens: 10, output_tokens: 1 };
    const start = { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null, usage } };
    if (main) {
      const last = [...msgs].reverse().find((m) => m.role === 'user') || {};
      lastReq = last;
      fs.appendFileSync(reqLog, JSON.stringify(last) + '\n');
    }
    if (!b.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: 'baslik' }], stop_reason: 'end_turn', stop_sequence: null, usage }));
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

const queue = new Q();
const q = sdk.query({ prompt: queue, options: {
  cwd: PROJ, env, settingSources: ['user', 'project', 'local'], model: 'claude-sonnet-4-5', permissionMode: 'default',
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  canUseTool: async (name, input) => { console.log('  canUseTool', name, JSON.stringify(input).slice(0, 100)); return { behavior: 'allow', updatedInput: input }; } } });
const waiters = [];
(async () => {
  for await (const m of q) {
    if (m.type === 'user' && !m.isReplay) console.log('  akışta user', JSON.stringify(m).slice(0, 300));
    if (m.type === 'system' && !['init', 'session_state_changed'].includes(m.subtype)) console.log('  system', m.subtype, JSON.stringify(m).slice(0, 200));
    if (m.type === 'attachment') console.log('  attachment', JSON.stringify(m).slice(0, 300));
    if (m.type === 'result') waiters.shift()?.(m);
  }
})();

// Son kullanıcı mesajının bloklarını özetler: her blok için tür + ilk/son karakterler
const brief = (msg) => {
  const c = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content || [];
  return c.map((bl) => bl.type === 'text'
    ? `text(${bl.text.length}): ${JSON.stringify(bl.text.length > 360 ? bl.text.slice(0, 260) + ' … ' + bl.text.slice(-80) : bl.text)}`
    : bl.type === 'image' ? `image(${bl.source?.media_type})` : bl.type === 'tool_result' ? 'tool_result ' + JSON.stringify(bl.content).slice(0, 200) : bl.type).join('\n      ');
};
const say = (label, content, extra = {}) => new Promise((resolve) => {
  waiters.push(resolve);
  lastReq = null;
  queue.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid: randomUUID(), ...extra });
  setTimeout(() => resolve('ZAMAN_ASIMI'), 60000);
}).then((r) => {
  console.log(`\n=== ${label} ===${r === 'ZAMAN_ASIMI' ? ' (zaman aşımı)' : ''}`);
  console.log('      ' + (lastReq ? brief(lastReq) : '(istek yok)'));
});

await say('düz metin @uygulama.js', 'bak @uygulama.js lütfen');
await say('blok dizisi (ek + metin)', [{ type: 'text', text: 'ilk blok' }, { type: 'text', text: 'bak @alt/b.js' }]);
await say('tırnaklı boşluklu ad', 'bak @"bosluklu ad.txt"');
await say('kaçışlı boşluk', 'bak @kacis\\ dosya.txt');
await say('klasör @alt/', 'bak @alt/');
await say('olmayan dosya', 'bak @yok.js');
await say('satır aralığı #L2-3', 'bak @aralik.js#L2-3');
await say('e-posta', 'yaz emre@ornek.com adresine');
await say('Türkçe ad', 'bak @şarkı.txt');
await say('sondaki virgül', 'bak @virgul.js, sonra');
await say('mutlak yol (proje dışı)', `bak @${path.join(ROOT, 'disarida.txt')}`);
await say('büyük dosya', 'bak @buyuk.txt');
await say('görsel', 'bak @resim.png');
await say('client_composed', 'bak @tekrar.js', { client_composed: true });
await say('kod içinde ters tırnak', 'kod: `@kod.js` burada');
await say('iki dosya', '@iki1.js ve @iki2.js');
await say('aynı dosya ikinci kez (değişmeden)', 'yine @uygulama.js');
fs.appendFileSync(path.join(PROJ, 'uygulama.js'), 'satir5\n');
await say('aynı dosya değişince', 'yine @uygulama.js');
await say('satır başında, önünde harf', 'x@iki1.js');
await say('ilk blokta anma (ek/yorum bloğu gibi)', [{ type: 'text', text: '<attached_file>\n@blok1.js\n</attached_file>' }, { type: 'text', text: 'metin @blok2.js' }]);
console.log('\nistekler:', reqLog);
queue.close(); q.close(); server.close();
setTimeout(() => process.exit(0), 500);
