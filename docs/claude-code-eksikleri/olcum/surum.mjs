// SDK / Claude Code sürüm yoklaması (2026-10-25, madde 9): her yükseltmede panelin dayandığı davranışlar yeniden okunur. Bkz. ../PLAN.md §4
// Sahte Anthropic API (0 token), girişsiz geçici ayar klasörü. Kullanım: node surum.mjs <sdk.mjs yolu> <çalışma kökü>
// Okunanlar: modele göre araç listesi (TodoWrite / Task* / ToolSearch, ertelenenler), panelin alwaysLoad işareti,
// mesajsız getContextUsage kategorileri (id / name / kind), init alanları, deneysel kullanım çağrısının varlığı.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [SDK, ROOT] = process.argv.slice(2);
const PROJ = fs.realpathSync(path.join(ROOT, 'proj'));
const CFG = path.join(ROOT, 'cfg');

// ---------- Sahte API: her isteğin araç listesini saklar, "tamam" der ----------
const requests = [];
const sse = (res, model, t) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = [
    { type: 'message_start', message: { id: 'msg_' + randomUUID().slice(0, 8), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }, { type: 'message_stop' }];
  for (const e of ev) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
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
    if ((b.tools || []).some((t) => t.name === 'Bash')) requests.push({ model: b.model, tools: b.tools, raw: body });
    sse(res, b.model, 'tamam');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.CLAUDE_CONFIG_DIR = CFG;
const sdk = await import(SDK);
const { z } = await import('zod'); // deponun node_modules'ından
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, ANTHROPIC_API_KEY: 'sk-ant-fake-0000', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

class Q { constructor() { this.items = []; this.w = []; } push(x) { const w = this.w.shift(); w ? w({ value: x, done: false }) : this.items.push(x); } close() { for (const w of this.w.splice(0)) w({ done: true }); this.closed = true; }
  [Symbol.asyncIterator]() { return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false }) : this.closed ? Promise.resolve({ done: true }) : new Promise((r) => this.w.push(r)) }; } }

// Panelin sunucusu gibi: biri alwaysLoad işaretli, biri değil
const mcp = () => {
  const ok = async () => ({ content: [{ type: 'text', text: 'ok' }] });
  const a = sdk.tool('yuklu_arac', 'Her zaman yüklü olmalı', { x: z.string().optional() }, ok);
  const b = sdk.tool('ertelenen_arac', 'Araç aramasına ertelenmeli', { x: z.string().optional() }, ok);
  return sdk.createSdkMcpServer({ name: 'panel', version: '1.0.0', tools: [{ ...a, _meta: { 'anthropic/alwaysLoad': true } }, b] });
};

async function probe(model) {
  const queue = new Q();
  const q = sdk.query({ prompt: queue, options: {
    cwd: PROJ, env, model, settingSources: [], permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code' }, mcpServers: { panel: mcp() }, perTaskStopAffordance: true,
  } });
  let init = null;
  const done = new Promise((resolve) => (async () => {
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') init = m;
      if (m.type === 'result') return resolve();
    }
    resolve();
  })().catch((e) => { console.log('akış hatası', e.message); resolve(); }));
  const ctx = await q.getContextUsage().catch((e) => ({ hata: e.message }));
  console.log(`\n=== ${model}`);
  console.log('kullanım çağrısı:', typeof q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET);
  console.log('bağlam:', ctx.hata || `toplam ${ctx.totalTokens} / ${ctx.rawMaxTokens} (%${ctx.percentage})`);
  for (const c of ctx.categories || []) console.log(`  ${String(c.id || '-').padEnd(22)} ${c.name.padEnd(28)} ${c.kind.padEnd(8)} ${c.tokens}`);
  console.log('skill listesi (skillFrontmatter):', ctx.skills?.skillFrontmatter?.length ?? 'yok', '| alanlar:', Object.keys(ctx.skills?.skillFrontmatter?.[0] || {}).join(','));
  const ir = await q.initializationResult().catch((e) => ({ hata: e.message }));
  console.log('initializationResult:', ir.hata || `komut ${ir.commands?.length}, alanlar ${Object.keys(ir).sort().join(',')}`);
  const models = await q.supportedModels().catch(() => []);
  const mm = models.find((x) => /opus/i.test(x.value)) || models[0];
  console.log('supportedModels:', models.length, '| alanlar:', Object.keys(mm || {}).sort().join(','), '| örnek:', mm?.value, JSON.stringify(mm?.supportedEffortLevels));
  const before = requests.length;
  queue.push({ type: 'user', message: { role: 'user', content: 'merhaba' }, parent_tool_use_id: null });
  await done;
  console.log('init alanları:', Object.keys(init || {}).sort().join(','));
  console.log('init permissionMode:', init?.permissionMode, '| model:', init?.model);
  const r = requests[before];
  if (!r) return console.log('ana istek gelmedi'), queue.close(), q.close();
  const loaded = r.tools.filter((t) => !t.defer_loading).map((t) => t.name);
  const deferred = r.tools.filter((t) => t.defer_loading).map((t) => t.name);
  console.log(`araçlar: ${r.tools.length} (yüklü ${loaded.length}, ertelenen ${deferred.length})`);
  console.log('  yüklü:', loaded.join(','));
  console.log('  ertelenen:', deferred.join(','));
  const has = (n) => (loaded.includes(n) ? 'yüklü' : deferred.includes(n) ? 'ertelenen' : 'yok');
  // Ertelenen araçlar tools listesinde değil, adları istemin bir yerinde anılır (araç araması)
  const mentioned = (n) => r.raw.split(JSON.stringify(n).slice(1, -1)).length - 1;
  for (const n of ['TodoWrite', 'TaskCreate', 'ToolSearch', 'Agent', 'Monitor', 'mcp__panel__yuklu_arac', 'mcp__panel__ertelenen_arac']) console.log(`  ${n}: ${has(n)}, istemde ${mentioned(n)} kez`);
  const i = r.raw.indexOf('mcp__panel__ertelenen_arac');
  if (i >= 0) console.log('  ertelenen adın çevresi:', JSON.stringify(r.raw.slice(Math.max(0, i - 260), i + 40)));
  const agent = r.tools.find((t) => t.name === 'Agent');
  const st = agent?.input_schema?.properties?.subagent_type;
  console.log('  Agent subagent_type:', JSON.stringify(st?.enum || st?.description || null)?.slice(0, 200), '| run_in_background:', !!agent?.input_schema?.properties?.run_in_background);
  queue.close(); q.close();
}

// Kancalar (hooks.js, compaction.js): açılışta SessionStart callback'i, her mesajda UserPromptSubmit, block ile tur API'ye gitmez,
// PreCompact block ile /compact atlanır (status compact_result / compact_error)
async function hooksProbe() {
  const seen = [];
  const cb = (ev) => async (input) => {
    seen.push(`${ev}:${input.source || input.trigger || '-'}`);
    if (ev === 'UserPromptSubmit' && /ENGELLE/.test(input.prompt)) return { decision: 'block', reason: 'deneme' };
    if (ev === 'PreCompact') return { decision: 'block', reason: 'deneme' };
    return {};
  };
  const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact'].map((e) => [e, [{ hooks: [cb(e)] }]]));
  const queue = new Q();
  const q = sdk.query({ prompt: queue, options: { cwd: PROJ, env, model: 'claude-opus-5-5', settingSources: [], permissionMode: 'default', hooks } });
  const out = [];
  const waiters = [];
  (async () => {
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'status' && (m.compact_result || m.compact_error)) out.push(`status ${m.compact_result} ${m.compact_error || ''}`);
      if (m.type === 'system' && m.subtype === 'informational') out.push(`informational ${String(m.content || m.message || '').replace(/\s+/g, ' ').slice(0, 80)}`);
      if (m.type === 'system' && m.subtype === 'compact_boundary') out.push('compact_boundary');
      if (m.type === 'result') { out.push(`RESULT ${m.subtype}`); waiters.shift()?.(); }
    }
  })().catch((e) => out.push('akış hatası ' + e.message));
  const say = (t) => new Promise((r) => { waiters.push(r); queue.push({ type: 'user', message: { role: 'user', content: t }, parent_tool_use_id: null }); });
  console.log('\n=== kancalar');
  let n = requests.length; await say('merhaba'); console.log('merhaba → API isteği', requests.length - n, '|', out.splice(0).join(' · '));
  n = requests.length; await say('ENGELLE bunu'); console.log('UserPromptSubmit block → API isteği', requests.length - n, '|', out.splice(0).join(' · '));
  n = requests.length; await say('/compact kısa tut'); console.log('PreCompact block → API isteği', requests.length - n, '|', out.splice(0).join(' · '));
  console.log('callback sırası:', seen.join(', '));
  queue.close(); q.close();
}

// Girişsiz hesap (kurulum sihirbazı → account:login): accountInfo biçimi
async function loginProbe() {
  const { ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ...bare } = env;
  const queue = new Q();
  const q = sdk.query({ prompt: queue, options: { cwd: PROJ, env: bare, settingSources: [], persistSession: false } });
  (async () => { for await (const _ of q); })().catch(() => {});
  console.log('\n=== girişsiz accountInfo:', JSON.stringify(await q.accountInfo().catch((e) => ({ hata: e.message }))));
  queue.close(); q.close();
}

for (const m of ['claude-opus-5-5', 'claude-sonnet-4-5']) await probe(m);
await hooksProbe();
await loginProbe();
server.close();
setTimeout(() => process.exit(0), 300);
