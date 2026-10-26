// Gerçek Claude Code ile küçük kolaylıkların ölçümü (madde 10). Sahte Anthropic API'si (0 token), girişsiz geçici ayar klasörü.
// Kullanım: node kolayliklar.mjs <sdk.mjs yolu> <çalışma kökü> oneri | kabuk | sinir
// oneri: promptSuggestions → prompt_suggestion ne zaman geliyor, öneri isteğinin biçimi, ilk tur / plan kipi
// kabuk: shouldQuery: false ile kayda eklenen mesaj (bash kipi): akışta ne görünür, sonraki isteğe nasıl girer, kayıt,
//        kod checkpoint'i, geri sarma (resumeSessionAt) ve Claude çalışırken gönderilirse ne olur
// sinir: anthropic-ratelimit-unified-* başlıkları ve 429 → rate_limit_event, turun sonu (ORT_AUTH=oauth ile sahte OAuth jetonu)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [SDK, ROOT, MODE] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');
const T0 = Date.now();
const ts = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Sahte API ----------
const textOf = (m) => typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.type === 'text' ? b.text : b.type === 'tool_result' ? '[tool_result ' + JSON.stringify(b.content).slice(0, 60) + ']' : b.type === 'tool_use' ? `[tool_use ${b.name}]` : '').join(' ');
const clean = (t) => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/\s+/g, ' ').trim();
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
const reset = () => Math.floor(Date.now() / 1000) + 3600;
// Sınır kipinin sırası: her ana istekte bir sonraki başlık takımı
let limitStep = 0;
const LIMIT_PLAN = [
  { name: 'izin (allowed)', status: 200, h: (r) => ({ 'anthropic-ratelimit-unified-status': 'allowed', 'anthropic-ratelimit-unified-reset': String(r), 'anthropic-ratelimit-unified-representative-claim': 'five_hour' }) },
  { name: 'uyarı (allowed_warning %85)', status: 200, h: (r) => ({ 'anthropic-ratelimit-unified-status': 'allowed', 'anthropic-ratelimit-unified-reset': String(r), 'anthropic-ratelimit-unified-representative-claim': 'five_hour', 'anthropic-ratelimit-unified-5h-status': 'allowed_warning', 'anthropic-ratelimit-unified-5h-utilization': '0.85', 'anthropic-ratelimit-unified-5h-reset': String(r), 'anthropic-ratelimit-unified-5h-surpassed-threshold': '0.8' }) },
  { name: 'ret (429 rejected)', status: 429, h: (r) => ({ 'anthropic-ratelimit-unified-status': 'rejected', 'anthropic-ratelimit-unified-reset': String(r), 'anthropic-ratelimit-unified-representative-claim': 'five_hour', 'anthropic-ratelimit-unified-5h-status': 'rejected', 'anthropic-ratelimit-unified-5h-utilization': '1.0', 'anthropic-ratelimit-unified-5h-reset': String(r), 'anthropic-ratelimit-unified-overage-status': 'rejected', 'anthropic-ratelimit-unified-overage-disabled-reason': 'org_level_disabled', 'retry-after': '3600' }) },
];
const requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      if (MODE === 'sinir' && !req.url.includes('count_tokens')) console.log(ts(), 'API başka istek', req.method, req.url);
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
    const raw = textOf(last);
    const lt = clean(raw);
    const send = (events, extraHeaders = {}, status = 200, delay = 0) => setTimeout(() => {
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited (sahte)' } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', ...extraHeaders });
      for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    }, delay);
    if (/\[SUGGESTION MODE/.test(raw)) {
      requests.push({ kind: 'oneri', msgs: msgs.length, model: b.model, max_tokens: b.max_tokens, tools: (b.tools || []).length });
      console.log(ts(), 'API ÖNERİ İSTEĞİ model=' + b.model, 'mesaj=' + msgs.length, 'araç=' + (b.tools || []).length, 'max_tokens=' + b.max_tokens, 'thinking=' + JSON.stringify(b.thinking || null), 'son blok:', JSON.stringify(raw.slice(0, 60)));
      return send(text(b.model, process.env.ORT_ONERI ?? 'testleri çalıştır'));
    }
    requests.push({ kind: 'ana', last: lt, all: msgs.map((m) => m.role[0] + ':' + clean(textOf(m)).slice(0, 120)) });
    console.log(ts(), 'API son:', lt.slice(0, 200));
    if (MODE === 'kabuk') console.log(ts(), '   mesajlar:', JSON.stringify(msgs.map((m) => m.role[0] + ':' + clean(textOf(m)).slice(0, 160))));
    if (MODE === 'sinir') {
      const p = LIMIT_PLAN[Math.min(limitStep++, LIMIT_PLAN.length - 1)];
      console.log(ts(), 'API sınır adımı:', p.name);
      return send(text(b.model, 'tamam: ' + lt.slice(0, 30)), p.h(reset()), p.status);
    }
    const m = lt.match(/UZUN(\d+)_/);
    if (m && !/\[tool_result/.test(lt)) return send(toolUse(b.model, 'Bash', { command: `sleep ${m[1]}; echo bash-bitti`, description: 'Uzun komut' }));
    if (/YAZ_/.test(lt) && !/\[tool_result/.test(lt)) return send(toolUse(b.model, 'Write', { file_path: path.join(PROJ, 'a.txt'), content: 'yazıldı\n' }));
    send(text(b.model, 'tamam: ' + lt.slice(0, 40)));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.CLAUDE_CONFIG_DIR = CFG;
const sdk = await import(SDK);
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
if (process.env.ORT_AUTH === 'oauth') { env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-fake-0000'; delete env.ANTHROPIC_API_KEY; }
else env.ANTHROPIC_API_KEY = 'sk-ant-fake-0000';

class Q { constructor() { this.items = []; this.w = []; } push(x) { const w = this.w.shift(); w ? w({ value: x, done: false }) : this.items.push(x); } close() { for (const w of this.w.splice(0)) w({ done: true }); this.closed = true; }
  [Symbol.asyncIterator]() { return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false }) : this.closed ? Promise.resolve({ done: true }) : new Promise((r) => this.w.push(r)) }; } }

const names = new Map();
const nm = (u) => names.get(u) || (u ? u.slice(0, 8) : '-');
const QUIET = new Set(['stream_event']);
function open(extra, tag) {
  const queue = new Q();
  const q = sdk.query({ prompt: queue, options: { cwd: PROJ, env, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, model: 'claude-sonnet-4-5', ...extra } });
  const s = { q, queue, results: 0, sid: null, lastAssistant: null, all: [] };
  (async () => {
    try {
      for await (const m of q) {
        if (QUIET.has(m.type)) continue;
        s.all.push(m);
        if (m.session_id) s.sid = m.session_id;
        const sub = m.subtype ? '/' + m.subtype : '';
        if (m.type === 'system' && m.subtype === 'init') { console.log(ts(), tag, 'init permissionMode=' + m.permissionMode); continue; }
        if (m.type === 'result') { s.results++; console.log(ts(), tag, 'RESULT', m.subtype, 'is_error=' + m.is_error, 'n=' + s.results, JSON.stringify(m.result || '').slice(0, 200), m.errors ? 'errors=' + JSON.stringify(m.errors).slice(0, 200) : ''); continue; }
        if (m.type === 'assistant') { s.lastAssistant = m.uuid; console.log(ts(), tag, 'assistant', JSON.stringify(clean(textOf(m.message)).slice(0, 160)), 'error=' + (m.error || '-'), 'uuid=' + nm(m.uuid)); continue; }
        if (m.type === 'user') {
          const c = m.message?.content;
          const tr = Array.isArray(c) && c[0]?.type === 'tool_result';
          console.log(ts(), tag, 'user', tr ? '(tool_result)' : JSON.stringify(clean(textOf(m.message)).slice(0, 100)), 'uuid=' + nm(m.uuid), m.isReplay ? 'REPLAY' : '', m.isSynthetic ? 'synthetic' : '');
          continue;
        }
        const { type, subtype, session_id, uuid, ...rest } = m;
        console.log(ts(), tag, type + sub, JSON.stringify(rest).slice(0, 600).replace(/"([0-9a-f]{8}-[0-9a-f-]{27})"/g, (_, u) => names.get(u) ? `"${names.get(u)}"` : `"${u.slice(0, 8)}"`));
      }
    } catch (e) { console.log(ts(), tag, 'akış hatası', e.message); }
    console.log(ts(), tag, 'akış bitti');
  })();
  s.push = (t, extra = {}, label) => {
    const uuid = randomUUID();
    names.set(uuid, label || t.slice(0, 20));
    const msg = { type: 'user', uuid, message: { role: 'user', content: t }, parent_tool_use_id: null, ...extra };
    console.log(ts(), tag, '→ gönder', JSON.stringify(t.slice(0, 80)), JSON.stringify(extra));
    queue.push(msg);
    return uuid;
  };
  s.waitResults = async (n, max = 30000) => { const t = Date.now(); while (s.results < n && Date.now() - t < max) await sleep(100); if (s.results < n) console.log(ts(), tag, `!! ${n}. result gelmedi`); };
  s.end = () => { queue.close(); q.close(); };
  return s;
}
const transcript = (sid) => {
  const dir = path.join(CFG, 'projects');
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, d, sid + '.jsonl');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  return [];
};
const row = (r) => `${r.type}${r.subtype ? '/' + r.subtype : ''} uuid=${nm(r.uuid)} parent=${nm(r.parentUuid)}${r.isMeta ? ' meta' : ''} ${JSON.stringify(clean(textOf(r.message || {})).slice(0, 90))}`;
console.log('Kip:', MODE, process.env.ORT_AUTH ? 'auth=' + process.env.ORT_AUTH : '');

if (MODE === 'oneri') {
  const a = open({ promptSuggestions: true }, '[A]');
  console.log('=== O1. İlk tur (önerinin gelmemesi beklenir)');
  a.push('MERHABA_1'); await a.waitResults(1); await sleep(3000);
  console.log('=== O2. İkinci tur');
  a.push('IKINCI_2'); await a.waitResults(2); await sleep(3000);
  console.log('=== O3. Araçlı tur');
  a.push('UZUN1_3'); await a.waitResults(3); await sleep(3000);
  console.log('=== O4. Öneri boş metin (sessiz kalma)');
  process.env.ORT_ONERI = '';
  a.push('DORT_4'); await a.waitResults(4); await sleep(3000);
  process.env.ORT_ONERI = 'Let me run the tests';
  console.log('=== O5. Claude ağzından öneri ("Let me …")');
  a.push('BES_5'); await a.waitResults(5); await sleep(3000);
  delete process.env.ORT_ONERI;
  console.log('=== O6. Plan kipi');
  await a.q.setPermissionMode('plan');
  a.push('ALTI_6'); await a.waitResults(6); await sleep(3000);
  await a.q.setPermissionMode('bypassPermissions');
  console.log('=== O7. Öneri gelmeden yeni mesaj (tur biter bitmez)');
  a.push('YEDI_7'); await a.waitResults(7); a.push('SEKIZ_8'); await a.waitResults(8); await sleep(3000);
  console.log('Öneri istekleri:', JSON.stringify(requests.filter((r) => r.kind === 'oneri')));
  console.log('prompt_suggestion mesajları:', JSON.stringify(a.all.filter((m) => m.type === 'prompt_suggestion').map((m) => m.suggestion)));
  const rows = transcript(a.sid);
  console.log('kayıtta öneri geçiyor mu:', rows.some((r) => JSON.stringify(r).includes('testleri çalıştır')), '| SUGGESTION MODE kayıtta:', rows.some((r) => JSON.stringify(r).includes('SUGGESTION MODE')));
  a.end();
} else if (MODE === 'kabuk') {
  const BASH = '<bash-input>ls</bash-input>';
  const OUT = '<bash-stdout>KABUK_CIKTI dosya.txt</bash-stdout><bash-stderr></bash-stderr>';
  // Kanca: UserPromptSubmit kabuk mesajında da çağrılıyor mu; öneri: kabuğun boş "turu"ndan sonra öneri isteği gidiyor mu
  const hooks = { UserPromptSubmit: [{ hooks: [async (i) => { console.log(ts(), 'KANCA UserPromptSubmit', JSON.stringify(String(i.prompt).slice(0, 50))); return {}; }] }] };
  const a = open({ enableFileCheckpointing: true, promptSuggestions: true, hooks }, '[A]');
  console.log('=== K1. Normal tur (iki tur: öneri ilk turda gelmez)');
  a.push('ILK_0'); await a.waitResults(1); await sleep(800); a.results = 0;
  const u1 = a.push('YAZ_1'); await a.waitResults(1); await sleep(800);
  const asst1 = a.lastAssistant;
  console.log('=== K2. shouldQuery: false (iki mesaj: girdi + çıktı), boştayken');
  const ub1 = a.push(BASH, { shouldQuery: false }, 'BASH_IN');
  const ub2 = a.push(OUT, { shouldQuery: false }, 'BASH_OUT');
  await sleep(3000);
  console.log(ts(), 'result sayısı (1 beklenir):', a.results, '| API ana istek sayısı:', requests.filter((r) => r.kind === 'ana').length);
  console.log('=== K3. Sonraki mesaj: kabuk çıktısı isteğe giriyor mu');
  const u3 = a.push('SONRAKI_3'); await a.waitResults(2); await sleep(800);
  for (const u of [ub1, ub2, u3]) {
    try { console.log(ts(), `rewindFiles(${nm(u)}, dryRun) →`, JSON.stringify(await a.q.rewindFiles(u, { dryRun: true }))); } catch (e) { console.log(ts(), `rewindFiles(${nm(u)}) hata`, e.message); }
  }
  console.log('=== K4. Claude çalışırken shouldQuery: false');
  const n = a.results;
  a.push('UZUN3_4'); await sleep(1200);
  a.push('<bash-input>pwd</bash-input>', { shouldQuery: false }, 'BASH2_IN');
  a.push('<bash-stdout>KABUK_IKI</bash-stdout><bash-stderr></bash-stderr>', { shouldQuery: false }, 'BASH2_OUT');
  await a.waitResults(n + 1); await sleep(3000);
  console.log(ts(), 'result farkı', a.results - n);
  a.push('SONRAKI_5'); await a.waitResults(n + 2); await sleep(800);
  console.log('=== K5. Turdan hemen sonra yalnız kabuk mesajı, sonra hiçbir şey (kayda yazılıyor mu)');
  a.push('<bash-input>date</bash-input>', { shouldQuery: false }, 'BASH3_IN');
  await sleep(2500);
  const sid = a.sid;
  a.end(); await sleep(1000);
  const rows = transcript(sid);
  console.log('Kayıt (user/assistant ve diğerleri):');
  for (const r of rows) if (r.type !== 'file-history-snapshot') console.log('  ', row(r));
  console.log('snapshot messageId:', rows.filter((r) => r.type === 'file-history-snapshot').map((r) => nm(r.messageId)).join(','));
  const by = (u) => rows.find((r) => r.uuid === u);
  console.log('SONRAKI_3 ebeveyni:', nm(by(u3)?.parentUuid), '| BASH_IN ebeveyni:', nm(by(ub1)?.parentUuid));
  const sm = await sdk.getSessionMessages(sid, { dir: PROJ });
  console.log('getSessionMessages:', sm.map((m) => m.type[0] + ':' + nm(m.uuid) + ':' + clean(textOf(m.message || {})).slice(0, 30)).join(' | '));
  console.log('=== K6. Geri sarma: SONRAKI_3\'ün ebeveynine resumeSessionAt (kabuk mesajı kalır mı)');
  const b = open({ resume: sid, resumeSessionAt: by(u3)?.parentUuid }, '[B]');
  b.push('GERI_6'); await b.waitResults(1); await sleep(500); b.end(); await sleep(800);
  console.log('=== K7. Geri sarma: kabuktan önceki asistan mesajına (resumeDropsTurn yok)');
  const c = open({ resume: sid, resumeSessionAt: asst1 }, '[C]');
  c.push('GERI_7'); await c.waitResults(1); await sleep(500); c.end(); await sleep(800);
  console.log('=== K8. Aynısı resumeDropsTurn=SONRAKI_3 ile (red beklenir: aradaki kabuk mesajı)');
  const d = open({ resume: sid, resumeSessionAt: asst1, resumeDropsTurn: u3 }, '[D]');
  d.push('GERI_8'); await d.waitResults(1, 8000); await sleep(500); d.end();
} else if (MODE === 'sinir') {
  const a = open({}, '[A]');
  for (let i = 1; i <= 3; i++) {
    console.log(`=== S${i}. ${LIMIT_PLAN[i - 1].name}`);
    a.push('SINIR_' + i); await a.waitResults(i, 20000); await sleep(1500);
  }
  console.log('=== S4. Ret sonrası yeni mesaj (yine 429)');
  a.push('SINIR_4'); await a.waitResults(4, 20000); await sleep(1500);
  try { console.log('get_usage:', JSON.stringify(await a.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })).slice(0, 400)); } catch (e) { console.log('get_usage hata', e.message); }
  console.log('rate_limit_event sayısı:', a.all.filter((m) => m.type === 'rate_limit_event').length);
  a.end();
}
server.close();
setTimeout(() => process.exit(0), 1000);
