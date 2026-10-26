// Gerçek Claude Code ile kuyruk ölçümü (madde 6): Claude çalışırken giden mesaj, cancelAsyncMessage, priority,
// interrupt makbuzu, --replay-user-messages. Sahte Anthropic API'si (0 token), girişsiz geçici ayar klasörü.
// Kullanım: node kuyruk.mjs <sdk.mjs yolu> <çalışma kökü> [replay | hemen | durdur]
// durdur: araya giren metin API'ye ulaşıyor mu; interrupt({ cancelQueued: true }) kuyruktakileri ne yapıyor
// hemen: "Hemen gönder"in iki yolu (cancelAsyncMessage + priority 'now' ile yeniden gönderme; iç interrupt send_now)
// araçsız yavaş yanıtta, arka plana alınamayan MCP aracında ve Bash'te
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [SDK, ROOT, MODE] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');
const T0 = Date.now();
const ts = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(5);

// ---------- Sahte API ----------
const textOf = (m) => typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.type === 'text' ? b.text : b.type === 'tool_result' ? '[tool_result ' + JSON.stringify(b.content).slice(0, 60) + ']' : b.type === 'tool_use' ? `[tool_use ${b.name}]` : '').join(' ');
const clean = (t) => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/\s+/g, ' ').trim();
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
    const msgs = b.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const lt = clean(textOf(last));
    // Konuşmada geçen bütün işaretler (kuyruktaki mesaj API'ye ulaştı mı?)
    const marks = [...new Set(JSON.stringify(msgs).match(/[A-Z]+_\d+b?(?![a-z0-9])/g) || [])]; // araç sonucunun içindekiler de (JSON'da "\\n" önekli)
    console.log(ts(), 'API son:', lt.slice(0, 160), '| işaretler:', marks.join(','));
    const hasResult = /\[tool_result/.test(lt);
    const m = lt.match(/UZUN(\d+)_/);
    if (m && !hasResult) return sse(res, toolUse(b.model, 'Bash', { command: `sleep ${m[1]}; echo bash-bitti`, description: 'Uzun komut' }));
    if (/MCPYAVAS_/.test(lt) && !hasResult) return sse(res, toolUse(b.model, 'mcp__olcum__yavas', {}));
    if (/YAVAS_/.test(lt) && !hasResult) return sse(res, text(b.model, 'yavaş yanıt'), 4000);
    sse(res, text(b.model, 'tamam: ' + lt.slice(0, 40)));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.CLAUDE_CONFIG_DIR = CFG;
const sdk = await import(SDK);
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, ANTHROPIC_API_KEY: 'sk-ant-fake-0000', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };

class Q { constructor() { this.items = []; this.w = []; } push(x) { const w = this.w.shift(); w ? w({ value: x, done: false }) : this.items.push(x); } close() { for (const w of this.w.splice(0)) w({ done: true }); this.closed = true; }
  [Symbol.asyncIterator]() { return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false }) : this.closed ? Promise.resolve({ done: true }) : new Promise((r) => this.w.push(r)) }; } }

const names = new Map(); // uuid → işaret (günlükte okunur)
const nm = (u) => names.get(u) || (u ? u.slice(0, 8) : '-');
const QUIET = new Set(['stream_event']);
function open(extra, tag) {
  const queue = new Q();
  const q = sdk.query({ prompt: queue, options: { cwd: PROJ, env, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, model: 'claude-sonnet-4-5', ...extra } });
  const s = { q, queue, results: 0, sid: null };
  (async () => {
    try {
      for await (const m of q) {
        if (QUIET.has(m.type)) continue;
        if (m.session_id) s.sid = m.session_id;
        const sub = m.subtype ? '/' + m.subtype : '';
        if (m.type === 'system' && m.subtype === 'init') { console.log(ts(), tag, 'init capabilities:', JSON.stringify(m.capabilities)); continue; }
        if (m.type === 'result') { s.results++; console.log(ts(), tag, 'RESULT', m.subtype, 'n=' + s.results); continue; }
        if (m.type === 'assistant') { console.log(ts(), tag, 'assistant', clean(textOf(m.message)).slice(0, 80), nm(m.uuid)); continue; }
        if (m.type === 'user') {
          const c = m.message?.content;
          const tr = Array.isArray(c) && c[0]?.type === 'tool_result';
          console.log(ts(), tag, 'user', tr ? '(tool_result)' : clean(textOf(m.message)).slice(0, 100), 'uuid=' + nm(m.uuid), m.isReplay ? 'REPLAY' : '', m.isSynthetic ? 'synthetic' : '', m.priority ? 'priority=' + m.priority : '');
          continue;
        }
        const { type, subtype, session_id, uuid, ...rest } = m;
        console.log(ts(), tag, type + sub, JSON.stringify(rest).slice(0, 300).replace(/"([0-9a-f]{8}-[0-9a-f-]{27})"/g, (_, u) => names.get(u) ? `"${names.get(u)}"` : `"${u.slice(0, 8)}"`));
      }
    } catch (e) { console.log(ts(), tag, 'akış hatası', e.message); }
  })();
  s.push = (t, priority, given) => {
    const uuid = given || randomUUID();
    names.set(uuid, t);
    const msg = { type: 'user', uuid, message: { role: 'user', content: t }, parent_tool_use_id: null, origin: { kind: 'human' } };
    if (priority) msg.priority = priority;
    console.log(ts(), tag, '→ gönder', t, priority ? 'priority=' + priority : '');
    queue.push(msg);
    return uuid;
  };
  s.waitResults = async (n, max = 30000) => { const t = Date.now(); while (s.results < n && Date.now() - t < max) await sleep(100); if (s.results < n) console.log(ts(), tag, `!! ${n}. result gelmedi`); };
  s.end = () => { queue.close(); q.close(); };
  return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extra = MODE === 'replay' ? { extraArgs: { 'replay-user-messages': null } } : {};
console.log('Kip:', MODE || 'düz');

if (MODE === 'durdur') {
  const d = open({ enableFileCheckpointing: true }, '[D]');
  const dry = async (u, t) => { try { console.log(ts(), `rewindFiles(${t}, dryRun) →`, JSON.stringify(await d.q.rewindFiles(u, { dryRun: true }))); } catch (e) { console.log(ts(), `rewindFiles(${t}) hata`, e.message); } };
  console.log('=== D1. Araya giren metin (araç sonucunun içinde mi?) ve kod checkpoint\'i');
  d.push('UZUN3_1'); await sleep(1000); const u2 = d.push('ARAYA_2'); await d.waitResults(1); await sleep(1000);
  await dry(u2, 'ARAYA_2');
  console.log('=== D2. Kuyrukta iki mesaj varken interrupt({ cancelQueued: true })');
  const n = d.results;
  d.push('UZUN6_3'); await sleep(1200);
  const a = d.push('KALAN_4'), b = d.push('KALAN_5');
  await sleep(300);
  try { const r = await d.q.interrupt({ cancelQueued: true }); console.log(ts(), 'interrupt →', JSON.stringify(r).replace(a, 'KALAN_4').replace(b, 'KALAN_5')); } catch (e) { console.log(ts(), 'interrupt hata', e.message); }
  await d.waitResults(n + 1); await sleep(5000);
  console.log(ts(), 'result sayısı farkı', d.results - n);
  console.log('=== D3. Sonraki mesaj normal çalışıyor mu');
  d.push('SONRAKI_6'); await d.waitResults(n + 2); await sleep(500);
  console.log('=== D4. Araçsız turda kendi turunu açan sıradaki mesajın kod checkpoint\'i');
  d.push('YAVAS_7'); await sleep(1000); const u8 = d.push('SONRA_8'); await d.waitResults(n + 4, 15000); await sleep(500);
  await dry(u8, 'SONRA_8');
  d.end(); server.close(); setTimeout(() => process.exit(0), 800);
} else if (MODE === 'hemen') {
  const { z } = await import('zod'); // deponun node_modules'ından
  const slow = sdk.tool('yavas', 'Yavaş araç (5 sn)', { x: z.string().optional() }, async () => { await sleep(5000); return { content: [{ type: 'text', text: 'yavas-bitti' }] }; });
  const mcp = sdk.createSdkMcpServer({ name: 'olcum', version: '1.0.0', tools: [{ ...slow, _meta: { 'anthropic/alwaysLoad': true } }] });
  const h = open({ mcpServers: { olcum: mcp } }, '[H]');
  // İç yol: SDK'nın interrupt() yöntemi send_now'ı geçirmez; ham kontrol isteği (Query.request) ile
  const sendNow = async (uuid) => {
    try { const r = await h.q.request({ subtype: 'interrupt', send_now: true, message_uuid: uuid }); console.log(ts(), 'send_now →', JSON.stringify(r?.response ?? r)); } catch (e) { console.log(ts(), 'send_now hata', e.message); }
  };
  // Kamuya açık yol: kuyruktan çek, priority 'now' ile yeniden gönder (same: aynı kimlikle)
  const resendNow = async (uuid, t, same) => {
    let ok; try { ok = await h.q.cancelAsyncMessage(uuid); } catch (e) { ok = 'hata ' + e.message; }
    console.log(ts(), 'cancel →', ok);
    if (ok === true) h.push(t + (same ? '' : 'b'), 'now', same ? uuid : undefined);
  };
  const run = async (title, first, waitT, how) => {
    console.log('=== ' + title);
    const n = h.results;
    h.push(first);
    await sleep(1200);
    const t = 'BEKLE_' + (n + 2);
    const u = h.push(t);
    await sleep(waitT);
    await how(u, t);
    await h.waitResults(n + 1, 20000);
    await sleep(7000);
    console.log(ts(), 'result sayısı farkı', h.results - n);
  };
  await run('H1. Yavaş yanıt (araçsız): iptal + yeni kimlikle now', 'YAVAS_1', 300, (u, t) => resendNow(u, t, false));
  await run('H2. Yavaş yanıt (araçsız): send_now', 'YAVAS_3', 300, (u) => sendNow(u));
  await run('H3. Yavaş MCP aracı: iptal + yeni kimlikle now', 'MCPYAVAS_5', 300, (u, t) => resendNow(u, t, false));
  await run('H4. Yavaş MCP aracı: send_now', 'MCPYAVAS_7', 300, (u) => sendNow(u));
  await run('H5. Bash: send_now (komut henüz görev değil)', 'UZUN6_9', 300, (u) => sendNow(u));
  await run('H6. Bash: iptal + aynı kimlikle now', 'UZUN6_11', 300, (u, t) => resendNow(u, t, true));
  await run('H7. Bash: send_now (komut görev olduktan sonra)', 'UZUN6_13', 2500, (u) => sendNow(u));
  console.log('=== H8. Emilmiş mesaja send_now');
  { const n = h.results; h.push('UZUN3_15'); await sleep(1000); const u = h.push('EMILEN_16'); await h.waitResults(n + 1); await sendNow(u); await sleep(1500); }
  h.end();
  server.close();
  setTimeout(() => process.exit(0), 800);
} else {

const a = open(extra, '[A]');
console.log('=== 1. Araç sürerken giden mesaj (priority yok)');
a.push('UZUN4_1');
await sleep(1200);
const u2 = a.push('ARAYA_2');
await a.waitResults(1);
await sleep(1500);
console.log(ts(), 'result sayısı', a.results);

console.log('=== 2. Emilmeden önce cancelAsyncMessage');
const n2 = a.results;
a.push('UZUN4_3');
await sleep(1200);
const u4 = a.push('IPTAL_4');
await sleep(400);
try { console.log(ts(), 'cancelAsyncMessage(IPTAL_4) →', await a.q.cancelAsyncMessage(u4)); } catch (e) { console.log(ts(), 'cancelAsyncMessage hata', e.message); }
await a.waitResults(n2 + 1);
await sleep(1500);

console.log('=== 3. Emildikten sonra cancelAsyncMessage(ARAYA_2)');
try { console.log(ts(), 'cancelAsyncMessage(ARAYA_2) →', await a.q.cancelAsyncMessage(u2)); } catch (e) { console.log(ts(), 'hata', e.message); }
try { console.log(ts(), 'cancelAsyncMessage(bilinmeyen) →', await a.q.cancelAsyncMessage(randomUUID())); } catch (e) { console.log(ts(), 'hata', e.message); }

console.log('=== 4. Araçsız yavaş tur sürerken giden mesaj (kendi turu mu?)');
const n4 = a.results;
a.push('YAVAS_5');
await sleep(1200);
a.push('SONRA_6');
await a.waitResults(n4 + 2, 15000);
await sleep(1000);

for (const pr of ['now', 'next', 'later']) {
  console.log(`=== 5-${pr}. Araç sürerken priority=${pr}`);
  const n = a.results;
  a.push('UZUN5_7' + pr.length);
  await sleep(1200);
  a.push('ONCELIK_8' + pr.length, pr);
  await a.waitResults(n + 1, 20000);
  await sleep(6000);
  console.log(ts(), 'result sayısı farkı', a.results - n);
}

console.log('=== 6. Kuyrukta mesaj varken interrupt (makbuz)');
const n6 = a.results;
a.push('UZUN5_9');
await sleep(1200);
const u10 = a.push('KALAN_10');
await sleep(300);
try { console.log(ts(), 'interrupt →', JSON.stringify(await a.q.interrupt()).replace(u10, 'KALAN_10')); } catch (e) { console.log(ts(), 'interrupt hata', e.message); }
await a.waitResults(n6 + 1, 15000);
await sleep(5000);
console.log(ts(), 'result sayısı farkı', a.results - n6);

console.log('=== 7. Kuyruktaki mesajı iptal edip interrupt (Hemen gönder = iptal + interrupt + yeniden gönder?)');
const n7 = a.results;
a.push('UZUN6_11');
await sleep(1200);
const u12 = a.push('HEMEN_12');
await sleep(300);
try { console.log(ts(), 'cancel(HEMEN_12) →', await a.q.cancelAsyncMessage(u12)); } catch (e) { console.log(ts(), 'hata', e.message); }
try { console.log(ts(), 'interrupt →', JSON.stringify(await a.q.interrupt())); } catch (e) { console.log(ts(), 'interrupt hata', e.message); }
a.push('HEMEN_13');
await a.waitResults(n7 + 2, 15000);
await sleep(1500);

const sid = a.sid;
a.end();
await sleep(800);
// Kayıt: queue-operation ve queued_command satırları
const dir = path.join(CFG, 'projects', PROJ.replace(/[^a-zA-Z0-9]/g, '-'));
const file = path.join(dir, sid + '.jsonl');
if (fs.existsSync(file)) {
  console.log('=== Kayıt:', path.basename(file));
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    if (o.type === 'queue-operation') console.log('  queue-operation', o.operation, o.reason || '', JSON.stringify(o.content || '').slice(0, 40), o.commandUuid ? nm(o.commandUuid) : '');
    else if (o.type === 'attachment' && o.attachment?.type === 'queued_command') console.log('  attachment/queued_command', JSON.stringify(o.attachment.prompt || '').slice(0, 40), 'uuid=' + nm(o.uuid), 'src=' + nm(o.attachment.source_uuid || o.attachment.sourceUuid));
    else if (o.type === 'user' && typeof o.message?.content === 'string') console.log('  user', o.message.content.slice(0, 40), 'uuid=' + nm(o.uuid));
  }
} else console.log('kayıt yok', file);
server.close();
setTimeout(() => process.exit(0), 500);
}
