// P7.1 yeniden oynatma ölçümü. Kayıtları yalnız okur; asıl oturum dosyasına yazmaz.
// İki beden de boş bir sahne klasöründe çalışır (/private/tmp/p71/sahne): projenin CLAUDE.md'si ve bugünkü (sonradan güncellenmiş)
// hafıza dosyaları bedenlere sızmasın. Araçsız (tools: []), ayarsız (settingSources: []), kayıt yazmadan (persistSession: false).
//   node olc.mjs a-hazir            A dalını aç (forkSession, 3. sıkıştırmadan hemen sonrası), sahneye taşı, bağlamı ölç (0 token)
//   node olc.mjs a-sor --onay       A bedenine soruları sor
//   node olc.mjs b-defter --onay    üç kesitten defter çıkar (ürünün defter.apply'ıyla geçici userData'da)
//   node olc.mjs b-not              devir notunu ürünün dogus.buildNote'uyla kur (0 token)
//   node olc.mjs b-sor --onay       B bedeni: 1. mesaj devir notu, 2. mesaj sorular
//   node olc.mjs temizle            A dalını sil, asıl dosyayı karşılaştır
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Module, { createRequire } from 'node:module';

const REPO = '/Users/emre/Claude Panel';
const W = '/tmp/p71';
const SDK = await import(REPO + '/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');
const SRC_ID = '6e15a2f4-0e77-4083-92fe-f4dafb9c913d';
const UP_TO = '71721c3f-d7fb-45c7-962a-c7019058ae39'; // 3. sıkıştırmadan sonraki ilk kayıt ("Compacted")
const MODEL = 'claude-opus-5-5';
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const SRC_DIR = path.join(PROJECTS, '-Users-emre-Documents-K-z-l-Elma');
const SRC = path.join(SRC_DIR, SRC_ID + '.jsonl');
const SAHNE = '/private/tmp/p71/sahne';
const SAHNE_DIR = path.join(PROJECTS, SAHNE.replace(/[^a-zA-Z0-9]/g, '-'));
const SET = JSON.parse(fs.readFileSync(REPO + '/docs/octopus/olcum/p71-soru-seti.json', 'utf8'));
const onay = process.argv.includes('--onay');
const cmd = process.argv[2];
const write = (f, s) => fs.writeFileSync(path.join(W, f), s, { mode: 0o600 });

const ANSWER_FRAME = 'Aşağıdaki soruları yalnız bu konuşmada bildiklerinle cevapla. Araç kullanma, dosya okuma, hiçbir şey arama. ' +
  'Bilmiyorsan o soruya yalnız "hatırlamıyorum" yaz; emin değilsen başına "tahmin:" koy. Uydurma. Her cevap aynı numarayla, kısa (1-3 cümle).\n\n';
const QUESTIONS = ANSWER_FRAME + SET.sorular.map((q) => `${q.no}. ${q.soru}`).join('\n');

const baseOptions = () => ({
  cwd: SAHNE, model: MODEL, persistSession: false, tools: [], settingSources: [], mcpServers: {}, strictMcpConfig: true,
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  canUseTool: async () => ({ behavior: 'deny', message: 'Ölçüm: araç kullanılmaz.' }),
});

// Akış girdisi: mesajları sırayla verir, her birinden sonra turun bitmesini bekler
function feeder() {
  const queue = [];
  let wake = null, done = false;
  return {
    push(text) { queue.push(text); wake?.(); },
    end() { done = true; wake?.(); },
    async *iter() {
      while (true) {
        while (queue.length) yield { type: 'user', message: { role: 'user', content: queue.shift() }, parent_tool_use_id: null, session_id: '' };
        if (done) return;
        await new Promise((r) => (wake = r));
        wake = null;
      }
    },
  };
}

async function run(options, prompts, label) {
  fs.mkdirSync(SAHNE, { recursive: true });
  const f = feeder();
  const q = SDK.query({ prompt: f.iter(), options });
  const turns = [];
  let cur = { text: '' };
  f.push(prompts[0]);
  let i = 1;
  const t0 = Date.now();
  for await (const m of q) {
    if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'text') cur.text += b.text;
    if (m.type === 'result') {
      const u = m.usage || {};
      cur.usage = { girdi: u.input_tokens, onbellek_yazma: u.cache_creation_input_tokens, onbellek_okuma: u.cache_read_input_tokens, cikti: u.output_tokens,
        api_karsiligi_usd: m.total_cost_usd, alt: m.subtype, sure_sn: Math.round((Date.now() - t0) / 1000) };
      turns.push(cur);
      console.error(`[${label}] tur ${turns.length}:`, JSON.stringify(cur.usage));
      cur = { text: '' };
      if (i < prompts.length) f.push(prompts[i++]);
      else { f.end(); break; }
    }
  }
  return turns;
}

// ---------- A ----------
async function aHazir() {
  if (fs.existsSync(path.join(W, 'a-dal.txt'))) throw new Error('A dalı zaten var: ' + fs.readFileSync(path.join(W, 'a-dal.txt'), 'utf8'));
  const dir = fs.realpathSync('/Users/emre/Documents/Kızıl Elma');
  const { sessionId: fork } = await SDK.forkSession(SRC_ID, { dir, upToMessageId: UP_TO, title: 'p71-olcum-a' });
  const from = path.join(SRC_DIR, fork + '.jsonl');
  fs.mkdirSync(SAHNE_DIR, { recursive: true, mode: 0o700 });
  fs.renameSync(from, path.join(SAHNE_DIR, fork + '.jsonl'));
  write('a-dal.txt', fork);
  console.log('A dalı', fork, '→', SAHNE_DIR);
  // Bağlam: mesaj göndermeden (0 token)
  fs.mkdirSync(SAHNE, { recursive: true });
  const f = feeder();
  const q = SDK.query({ prompt: f.iter(), options: { ...baseOptions(), resume: fork } });
  const u = await q.getContextUsage({ detail: 'summary' });
  f.end();
  q.close?.();
  const msgs = (u.categories || []).map((c) => `${c.name}: ${c.tokens}`).join(', ');
  console.log(JSON.stringify({ totalTokens: u.totalTokens, rawMaxTokens: u.rawMaxTokens, model: u.model }), '\n', msgs);
  write('a-baglam.json', JSON.stringify(u, null, 1));
}

async function aSor() {
  const fork = fs.readFileSync(path.join(W, 'a-dal.txt'), 'utf8').trim();
  if (!onay) { console.log('Soru sorulmadı (--onay yok). Soru metni:\n' + QUESTIONS); return; }
  const [t] = await run({ ...baseOptions(), resume: fork, maxTurns: 1 }, [QUESTIONS], 'A');
  write('cevap-a.json', JSON.stringify(t, null, 1));
  console.log(t.text);
}

// ---------- Ürün kodu (electron sahte, geçici userData) ----------
function product() {
  const UD = path.join(W, 'ud');
  fs.mkdirSync(UD, { recursive: true, mode: 0o700 });
  const fake = { app: { getPath: () => UD, isPackaged: false }, ipcMain: { handle() {}, on() {} }, BrowserWindow: class {} };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fake : orig.call(this, req, ...rest); };
  const req = createRequire(REPO + '/main.js');
  const octopus = req('./octopus.js'), defter = req('./defter.js'), dogus = req('./dogus.js');
  let octoId = fs.existsSync(path.join(W, 'octo.txt')) ? fs.readFileSync(path.join(W, 'octo.txt'), 'utf8').trim() : null;
  if (!octoId || !octopus.get(octoId)) {
    octoId = octopus.create({ accountId: 'olcum', project: { key: SAHNE, cwd: SAHNE, name: 'Kızıl Elma (P7.1 ölçümü)' }, sessionId: SRC_ID, settings: { memory: false } }).id;
    write('octo.txt', octoId);
  }
  return { octopus, defter, dogus, octoId };
}

// ---------- B ----------
const EXTRACT = (head, table, part, n) => `Bir Claude Code oturumunun (Kızıl Elma oyun projesi, 30 Eylül 2026) kaydını okuyacaksın. ` +
  `Bu oturumun beyniymişsin gibi, Claude Panel'in defterini tut. Defterin talimatı (beyin bu talimatı sistem isteminde alır):\n\n> ${head}\n\n` +
  `Kayıt üç kesit hâlinde, sırayla geliyor; bu ${n}/3. kesit. Defterin şu anki hâli:\n\n${table || 'Defter boş.'}\n\n` +
  `Kesitte "Emre" kullanıcı, "Claude" beyin; [araç …] satırları beynin araç çağrıları (sonuçları yok). ` +
  `Yalnız bu kesitte olanlara göre defteri güncelle. Cevabın yalnız bir JSON dizisi olsun, başka hiçbir şey yazma. Her öğe şunlardan biri:\n` +
  `{"islem":"ekle","tur":"karar|ret|zevk|kural|acik|bilgi","metin":"…","neden":"…"}\n{"islem":"yerine_koy","id":"D-3","metin":"…","neden":"…"}\n{"islem":"kapat","id":"D-3","neden":"…"}\n\n` +
  `--- KESİT ${n}/3 ---\n${part}\n--- KESİT SONU ---`;

async function bDefter() {
  const { defter, octoId } = product();
  const OPS = { ekle: 'add', yerine_koy: 'supersede', kapat: 'close' };
  const log = [];
  for (let n = 1; n <= 3; n++) {
    const done = path.join(W, `defter-ham-${n}.txt`);
    if (fs.existsSync(done)) { console.log(`kesit ${n} zaten işlendi`); continue; }
    const rows = defter.view(octoId).filter((r) => r.status === 'open');
    const table = rows.map((r) => defter.line(r)).join('\n');
    const prompt = EXTRACT(defter.HEAD_PROMPT, table, fs.readFileSync(path.join(W, `kesit-${n}.txt`), 'utf8'), n);
    if (!onay) { console.log(`kesit ${n}: istem ${prompt.length} karakter (~${Math.round(prompt.length / 3)} token). --onay ile gönderilir.`); continue; }
    const [t] = await run({ ...baseOptions(), maxTurns: 1 }, [prompt], 'B-defter-' + n);
    fs.writeFileSync(done, t.text, { mode: 0o600 });
    const m = t.text.match(/\[[\s\S]*\]/);
    const ops = m ? JSON.parse(m[0]) : [];
    for (const o of ops) {
      const r = defter.apply(octoId, OPS[o.islem], { id: o.id, type: o.tur, text: o.metin, why: o.neden }, 'bas', { sessionId: SRC_ID, uuid: null, ts: null });
      log.push({ kesit: n, op: o, ok: r.ok, error: r.error });
      if (!r.ok) console.error('  uygulanamadı:', JSON.stringify(o), r.error);
    }
    log.push({ kesit: n, usage: t.usage });
    console.log(`kesit ${n}: ${ops.length} işlem`);
  }
  if (log.length) fs.appendFileSync(path.join(W, 'defter-islem.jsonl'), log.map((x) => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
  console.log('\n' + defter.view(octoId).map((r) => defter.line(r)).join('\n'));
}

// dogus.js → formatTurns (dışa açık değil; birebir kopya, sabitler aynı)
const TURNS_N = 6, TURNS_MAX = 24000, USER_MAX = 3000, CLAUDE_MAX = 4000;
function clipMid(s, n) { if (s.length <= n) return s; const h = Math.floor(n * 0.4); return s.slice(0, h) + `\n[… ${s.length - n} karakter atlandı …]\n` + s.slice(s.length - (n - h)); }
const when = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
function formatTurns(turns) {
  const out = []; let total = 0;
  for (let i = turns.length - 1; i >= 0 && out.length < TURNS_N; i--) {
    const t = turns[i];
    const claude = t.claude.length ? clipMid(t.claude.join('\n\n'), CLAUDE_MAX) : t.tools ? `(yalnız araç kullandı: ${t.tools} çağrı)` : '(yanıt yok)';
    const s = `### Kullanıcı${t.ts ? ' · ' + when(t.ts) : ''}\n${clipMid(t.user, USER_MAX)}\n\n### Claude\n${claude}`;
    if (out.length && total + s.length > TURNS_MAX) break;
    out.unshift(s); total += s.length + 2;
  }
  return { text: out.join('\n\n'), count: out.length };
}
// dogus.js → readRows gibi: baştan 1 MB, sondan 4 MB (kesik kopyadan; asıl dosya 8 Ekim'e kadar sürüyor)
function windowRows(file, tail) {
  const buf = fs.readFileSync(file);
  const len = Math.min(buf.length, tail ? 4 * 1024 * 1024 : 1024 * 1024);
  let lines = buf.subarray(tail ? buf.length - len : 0, tail ? buf.length : len).toString('utf8').split('\n');
  if (len < buf.length) lines = tail ? lines.slice(1) : lines.slice(0, -1);
  return lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Ürünün bugünkü yolu (sondan 4 MB) ve düzeltilmiş yol (soy zinciri, zaman sırası). Gerçek kayıtta /compact dosyaya eski zincirin
// bir kopyasını ekliyor: dosyanın sonu 12:52'nin kayıtları, 13:11–15:50'nin tek kopyası ortada. Ölçüm düzeltilmiş notla yapılır.
async function bNot() {
  const { defter, dogus, octoId } = product();
  const { readRows, lineage } = await import(REPO + '/docs/octopus/prototip/ortak.mjs');
  const file = path.join(W, 'kesik.jsonl');
  const all = readRows(file);
  const { chain } = lineage(all);
  const ordered = all.filter((o) => o.uuid && chain.has(o.uuid) && o.timestamp).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const base = { digest: defter.headDigest(octoId, 20000), first: dogus.firstTask(windowRows(file, false)), arms: { text: '', count: 0 } };
  const at = '2026-09-30T15:53:22.418Z';
  const urun = dogus.buildNote({ oldSid: SRC_ID, parts: { ...base, turns: formatTurns(dogus.turnsOf(windowRows(file, true))) }, additions: '', at });
  const turns = formatTurns(dogus.turnsOf(ordered));
  const note = dogus.buildNote({ oldSid: SRC_ID, parts: { ...base, turns }, additions: '', at });
  write('devir-notu-urun.md', urun);
  write('devir-notu.md', note);
  console.log(JSON.stringify({ karakter: note.length, tahmini_token: Math.round(note.length / 3), defter: base.digest.length, ilk_gorev: base.first.length, turlar: turns.count, urun_notu_karakter: urun.length }));
}

async function bSor() {
  const note = fs.readFileSync(path.join(W, 'devir-notu.md'), 'utf8');
  if (!onay) { console.log(`Gönderilmedi (--onay yok). Not ${note.length} karakter.`); return; }
  const turns = await run({ ...baseOptions(), maxTurns: 1 }, [note, QUESTIONS], 'B');
  write('cevap-b.json', JSON.stringify(turns, null, 1));
  console.log(turns[1]?.text);
}

function temizle() {
  const fork = fs.existsSync(path.join(W, 'a-dal.txt')) ? fs.readFileSync(path.join(W, 'a-dal.txt'), 'utf8').trim() : null;
  if (fork) {
    const f = path.join(SAHNE_DIR, fork + '.jsonl');
    fs.rmSync(f, { force: true });
    fs.rmSync(path.join(SAHNE_DIR, fork), { recursive: true, force: true });
    fs.rmSync(path.join(W, 'a-dal.txt'));
  }
  try { if (!fs.readdirSync(SAHNE_DIR).length) fs.rmdirSync(SAHNE_DIR); } catch {}
  const [size, mtime] = fs.readFileSync(path.join(W, 'asil-once.txt'), 'utf8').trim().split(' ').map(Number);
  const st = fs.statSync(SRC);
  console.log(JSON.stringify({ dal_silindi: !!fork, sahne_klasoru_kaldi: fs.existsSync(SAHNE_DIR), asil_dosya_degismedi: st.size === size && Math.floor(st.mtimeMs / 1000) === mtime,
    kizil_elma_dal_artigi: fs.readdirSync(SRC_DIR).filter((x) => fork && x.startsWith(fork)) }));
}

const CMDS = { 'a-hazir': aHazir, 'a-sor': aSor, 'b-defter': bDefter, 'b-not': bNot, 'b-sor': bSor, temizle };
if (!CMDS[cmd]) { console.log('Kullanım: node olc.mjs a-hazir | a-sor [--onay] | b-defter [--onay] | b-not | b-sor [--onay] | temizle'); process.exit(1); }
await CMDS[cmd]();
