// Yeniden doğuş (docs/octopus/OCTOPUS-PLANI.md §7.8 f, P7.3): sıkıştırmanın yerine geçer. Başın sohbetinde, yalnız kullanıcının onayıyla (İ1):
//   1. eski beden kısa bir turda defterini günceller;
//   2. devir notu kurulur: defter özeti, oturumun ilk görevi, son turlar (oturum dosyasından, kelimesi kelimesine), açık kollar;
//   3. eski beden notu okur ve eksiklerini söyler (kendi sürecinde: önbelleği sıcak; yeni bir süreçte sistem istemi değiştiği için dal önbelleğe denk gelmezdi);
//   4. aynı sekmede yeni bir Claude Code süreci (yeni beden) açılır, ilk mesajı devir notudur; ahtapot kaydında beden nedeni 'rebirth';
//   5. yeni bedenin ilk turundan sonra sınav (sinav.js, neden 'rebirth');
//   6. eski beden fosil olur: oturum dosyası olduğu gibi kalır (silinmez, sıkıştırılmaz; İ2), danis ile ona danışılır.
// Sohbet kimliği değişmez: kollar, bölmeler, PR izleme ve kartlar yeni bedene bağlı kalır (chat-main.js → c.rebirth).
// Her doğuş <ahtapot>/devir.jsonl'e eklenir (an, eski ve yeni beden, not, eklemeler; dosya 600).
const { ipcMain } = require('electron');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const octopus = require('./octopus');
const defter = require('./defter');
const compaction = require('./compaction');

const MARK = '[Claude Panel · yeniden doğuş';        // eski bedene giden adım mesajları (devir notunun son turlarına girmez)
const NOTE_MARK = '[Claude Panel devir notu]';       // yeni bedenin ilk mesajı
const DEFTER_MAX = 20000, TURNS_N = 6, TURNS_MAX = 24000, USER_MAX = 3000, CLAUDE_MAX = 4000, FIRST_MAX = 2000, ARMS_MAX = 3000, ADD_MAX = 4000;
const ARM_LABELS = { working: 'çalışıyor', waiting: 'seni bekliyor', reported: 'rapor verdi', stopped: 'durdu' };

const DEFTER_PROMPT = `${MARK} 1/2] Birazdan bu bedenin yerine yeni bir beden (yeni bir Claude Code oturumu) açılacak. Yeni beden bu konuşmayı görmeyecek; ` +
  'yalnız defteri, son turları ve açık kolları içeren bir devir notu alacak. Defterde olmayan ama sürmesi gereken ret, zevk, karar, kural ve açık işleri ' +
  'şimdi `defter` ile yaz (retleri gerekçesiyle); eskiyen satırı `yerine_koy`, biten işi `kapat`. Başka iş yapma, dosyalara dokunma. ' +
  'Bitince tek cümleyle ne yazdığını söyle.';
const AUDIT_PROMPT = `${MARK} 2/2] Aşağıdaki devir notu yeni bedenin açılış belgesi; yeni beden bu konuşmayı görmeyecek. Notu oku ve yalnız şunu yaz: ` +
  'yeni bedenin bilmesi gereken ama notta olmayan önemli ne var? (yarım kalan iş ve nerede kaldığı, kullanıcının son istekleri, tuzaklar, dosya yolları). ' +
  'Kısa maddeler; araç kullanma. Eksik yoksa yalnız "Eksik yok." yaz.';

let send = () => {};
const ctls = new Map();   // chatId -> chat-main.js'in denetimi { accountId, dir, getSessionId, isBusy, configDir, turn, rebirth, setRebirthing }
const running = new Set();

function register(chatId, ctl) { ctls.set(chatId, ctl); }
function forget(chatId) { ctls.delete(chatId); }

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// Ortası atılır: başı (bağlam) ve sonu (varılan yer) kalır
function clipMid(s, n) {
  if (s.length <= n) return s;
  const head = Math.floor(n * 0.4);
  return s.slice(0, head) + `\n[… ${s.length - n} karakter atlandı …]\n` + s.slice(s.length - (n - head));
}
const when = (ts) => {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// ---------- Oturum dosyası (yalnız okunur) ----------

// <ayar klasörü>/projects/<klasör>/<oturum>.jsonl (SDK ayar klasörünü süreç başına bir kez okuduğu için dosya doğrudan okunur; CLAUDE.md §5)
function sessionFile(configDir, sessionId) {
  const root = path.join(configDir, 'projects');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return null; }
  for (const n of names) {
    const f = path.join(root, n, sessionId + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Kimliği verilen kaydı dosyanın sonundan başa doğru arar (geri sarma: chat-main.js → rewindPoint). Kayıt dosyası GB'larca olabilir,
// geri sarılan mesaj çoğu zaman yenidir; yalnız kimliği geçen satırlar ayrıştırılır. Aynı kayıt birden çok kez geçebilir (CLAUDE.md §5), sondaki alınır.
async function findEntry(file, uuid, type) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const needle = Buffer.from(`"uuid":"${uuid}"`);
    const CHUNK = 1 << 20;
    let pos = (await fh.stat()).size;
    let carry = Buffer.alloc(0); // sonraki parçadan kalan, başı bu parçada olan satır
    while (pos > 0) {
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, pos);
      const all = Buffer.concat([buf, carry]);
      let end = all.length;
      for (let i = all.length - 1; i >= -1; i--) {
        if (i >= 0 && all[i] !== 0x0a) continue;
        if (i < 0 && pos > 0) { carry = all.subarray(0, end); break; } // satırın başı önceki parçada
        const line = all.subarray(i + 1, end);
        end = i;
        if (!line.includes(needle)) continue;
        try {
          const o = JSON.parse(line.toString('utf8'));
          if (o.uuid === uuid && (!type || o.type === type)) return o;
        } catch {}
      }
    }
    return null;
  } finally {
    await fh.close();
  }
}

// Kullanıcının yazdığı metin: araç sonucu, sıkıştırma özeti, kanca ve komut kayıtları sayılmaz
function userText(o) {
  if (o.type !== 'user' || o.isMeta || o.isCompactSummary || o.isSidechain) return null;
  const c = o.message?.content;
  let t = '';
  if (typeof c === 'string') t = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b?.type === 'tool_result')) return null;
    t = c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  }
  t = t.trim();
  if (!t || /^<(?:command-|local-command)/.test(t)) return null;
  return t;
}
function claudeOf(o) {
  if (o.type !== 'assistant' || o.isSidechain) return null;
  const c = Array.isArray(o.message?.content) ? o.message.content : [];
  return { text: c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim(), tools: c.filter((b) => b?.type === 'tool_use').length };
}

// Turlar dosya sırasıyla (dallanmada aynı kayıt birden çok kez geçer: uuid ile tekilleştirilir). Yeniden doğuşun kendi adım turları atlanır.
function turnsOf(rows) {
  const seen = new Set(), turns = [];
  for (const o of rows) {
    if (o.uuid) { if (seen.has(o.uuid)) continue; seen.add(o.uuid); }
    const u = userText(o);
    if (u) { turns.push({ ts: o.timestamp, user: u, claude: [], tools: 0 }); continue; }
    const a = claudeOf(o);
    const t = turns[turns.length - 1];
    if (a && t) { if (a.text) t.claude.push(a.text); t.tools += a.tools; }
  }
  return turns.filter((t) => !t.user.startsWith(MARK));
}

// Bedenin konuşması zaman sırasıyla (P7.4). Dosya sırası zaman sırası değil: /compact dosyaya eski zincirin bir kopyasını
// (aynı uuid ve zamanlarla) ekleyebiliyor, dosyanın sonu saatler önceki turlar olabiliyor (CLAUDE.md §5). Bu yüzden dosyanın
// tamamı akışla okunur; her uuid'in ilk geçtiği satır alınır, zincir en son yazılan mesajdan geriye yürür (parentUuid, sınırda
// logicalParentUuid; terk edilen dallar ve yan zincir dışarıda kalır), metinli kayıtlar zamana göre dizilir. Bellekte yalnız
// ebeveynler ve kullanıcı/Claude metinleri tutulur (araç sonuçları ve görseller değil). uuid'siz kayıtta dosya sırası kalır.
async function readConversation(file) {
  const nodes = new Map(), texts = [];
  let tip = null, seq = 0;
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      seq++;
      if (o.uuid) {
        if (nodes.has(o.uuid)) continue;
        nodes.set(o.uuid, { p: o.parentUuid, l: o.logicalParentUuid });
        if ((o.type === 'user' || o.type === 'assistant') && !o.isSidechain && o.timestamp && (!tip || o.timestamp >= tip.ts)) tip = { uuid: o.uuid, ts: o.timestamp };
      }
      const u = userText(o), a = u ? null : claudeOf(o);
      if (u) texts.push({ seq, type: 'user', uuid: o.uuid, timestamp: o.timestamp, message: { content: u } });
      else if (a) texts.push({ seq, type: 'assistant', uuid: o.uuid, timestamp: o.timestamp, message: { content: [{ type: 'text', text: a.text }, ...Array.from({ length: a.tools }, () => ({ type: 'tool_use' }))] } });
    }
  } catch { return []; }
  if (!tip) return texts;
  const chain = new Set();
  for (let cur = nodes.get(tip.uuid), id = tip.uuid; cur && !chain.has(id); ) {
    chain.add(id);
    id = nodes.has(cur.p) ? cur.p : cur.l;
    cur = nodes.get(id);
  }
  return texts.filter((o) => chain.has(o.uuid)).sort((x, y) => (x.timestamp || '').localeCompare(y.timestamp || '') || x.seq - y.seq);
}

function formatTurns(turns) {
  const out = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0 && out.length < TURNS_N; i--) {
    const t = turns[i];
    const claude = t.claude.length ? clipMid(t.claude.join('\n\n'), CLAUDE_MAX) : t.tools ? `(yalnız araç kullandı: ${t.tools} çağrı)` : '(yanıt yok)';
    const s = `### Kullanıcı${t.ts ? ' · ' + when(t.ts) : ''}\n${clipMid(t.user, USER_MAX)}\n\n### Claude\n${claude}`;
    if (out.length && total + s.length > TURNS_MAX) break;
    out.unshift(s);
    total += s.length + 2;
  }
  return { text: out.join('\n\n'), count: out.length };
}

// Oturumun ilk görevi: bedenin ilk kullanıcı mesajı. Beden bir yeniden doğuşla açıldıysa ilk mesajı devir notudur: oradaki görev taşınır.
function firstTask(rows) {
  for (const o of rows) {
    const u = userText(o);
    if (!u) continue;
    if (u.startsWith(NOTE_MARK)) {
      const m = u.match(/\n## Oturumun ilk görevi\n([\s\S]*?)(?:\n## |$)/);
      return m ? m[1].trim() : '';
    }
    return clipMid(u, FIRST_MAX);
  }
  return '';
}

function armsText(rec) {
  const open = (rec?.arms || []).filter((a) => a.state !== 'done' && a.state !== 'cut');
  let out = '';
  for (const a of open) {
    const l = `- ${a.id} · ${a.title || 'başlıksız'} (${ARM_LABELS[a.state] || a.state})` +
      (a.brief ? `: görev: ${clip(a.brief.replace(/\s+/g, ' '), 300)}` : '') + (a.lastReport ? `; son rapor: ${clip(a.lastReport.replace(/\s+/g, ' '), 500)}` : '');
    if (out.length + l.length > ARMS_MAX) { out += `\n… ${open.length - out.split('\n').length} kol daha (sessions list).`; break; }
    out += (out ? '\n' : '') + l;
  }
  return { text: out, count: open.length };
}

// Devir notunun parçaları: eski bedenin oturum dosyasından (yalnız okunur) ve ahtapot kaydından
async function gather(ctl, octoId, oldSid) {
  const file = sessionFile(ctl.configDir, oldSid);
  const rows = file ? await readConversation(file) : [];
  return { file, first: firstTask(rows), turns: formatTurns(turnsOf(rows)), arms: armsText(octopus.get(octoId)), digest: defter.headDigest(octoId, DEFTER_MAX) };
}

function buildNote({ oldSid, parts, additions, at }) {
  return [
    `${NOTE_MARK} Yeni bir bedenle uyandın: Claude Panel'de bu projenin beyni (Octopus ahtapotunun başı) sensin, ama önceki konuşmayı görmüyorsun. ` +
      `Önceki beden bu notu ${when(at)} bıraktı. Aşağıdakiler masanda, gerisi kayıtta duruyor.\n` +
      `Önceki bedenin oturumu: ${oldSid}. Bir ayrıntı gerekirse önce \`hatirla\` ile ara, \`hatirla_oku\` ile oku; yetmezse \`danis\` ile ona sor (kaynak: { oturum: "${oldSid}" }).`,
    '## Defter\n' + (parts.digest || 'Defter boş.'),
    '## Oturumun ilk görevi\n' + (parts.first || 'Kayıtta bulunamadı.'),
    '## Son turlar (kayıttan, kelimesi kelimesine)\n' + (parts.turns.text || 'Kayıtta tur bulunamadı.'),
    '## Açık kollar\n' + (parts.arms.text ? parts.arms.text + '\nKollar raporlarını sana iletmeye devam eder.' : 'Açık kol yok.'),
    additions ? '## Önceki bedenin eklemeleri\n' + additions : null,
    'Notu okuduğunu ve nerede kaldığınızı iki üç cümleyle söyle, sonra kullanıcıyı bekle; kendiliğinden yeni bir işe başlama.',
  ].filter(Boolean).join('\n\n');
}

function record(octoId, entry) {
  const dir = path.join(octopus.root(), octoId);
  octopus.privateDir(octopus.root());
  octopus.privateDir(dir);
  const f = path.join(dir, 'devir.jsonl');
  fs.appendFileSync(f, JSON.stringify(entry) + '\n', { mode: 0o600 });
  fs.chmodSync(f, 0o600);
}

// ---------- Akış ----------

function check(chatId) {
  const ctl = ctls.get(chatId);
  if (!ctl) return { error: 'Sohbet açık değil.' };
  const where = octopus.roleOf(chatId);
  if (where?.role !== 'head') return { error: 'Yeniden doğuş yalnız ahtapotun başında yapılır.' };
  if (running.has(chatId)) return { error: 'Yeniden doğuş zaten sürüyor.' };
  if (ctl.isBusy()) return { error: 'Claude çalışıyor; tur bitince yeniden deneyin.' };
  const oldSid = ctl.getSessionId();
  if (!oldSid) return { error: 'Başın oturumu henüz yok.' };
  return { ctl, octoId: where.octoId, oldSid };
}

// Onay kartı için: tahmini bedel ve notun büyüklüğü (İ6). Tahmin: son tur sonundaki bağlam (compaction.js), not ~3 karakter/token.
async function plan(chatId) {
  const k = check(chatId);
  if (k.error) return { ok: false, error: k.error };
  const parts = await gather(k.ctl, k.octoId, k.oldSid);
  const note = buildNote({ oldSid: k.oldSid, parts, additions: '', at: new Date().toISOString() });
  const rows = defter.view(k.octoId).filter((r) => r.status === 'open').length;
  return {
    ok: true, context: compaction.last(chatId)?.totalTokens ?? null, noteTokens: Math.round(note.length / 3), noteChars: note.length,
    rows, turns: parts.turns.count, arms: parts.arms.count, file: !!parts.file, session: k.oldSid,
  };
}

async function start(chatId) {
  const k = check(chatId);
  if (k.error) return { ok: false, error: k.error };
  const { ctl, octoId, oldSid } = k;
  const ev = (kind, x = {}) => send('dogus:event', chatId, { kind, ...x });
  running.add(chatId);
  ctl.setRebirthing(true);
  const at = octopus.now();
  try {
    // 1. Eski beden defterini günceller (tur hata verse de not kayıttan kurulur)
    ev('step', { step: 'defter' });
    const sig = () => new Map(defter.view(octoId).map((r) => [r.id, r.status + '|' + r.text]));
    const before = sig();
    const r1 = await ctl.turn(DEFTER_PROMPT);
    if (!r1) throw new Error('Sohbet kapandı.');
    const changed = [...sig()].filter(([id, v]) => before.get(id) !== v).length;

    // 2. Devir notu
    ev('step', { step: 'note', changed });
    const parts = await gather(ctl, octoId, oldSid);
    let note = buildNote({ oldSid, parts, additions: '', at });
    ev('note', { note, turns: parts.turns.count, arms: parts.arms.count });

    // 3. Eski beden notu okur, eksikleri söyler
    ev('step', { step: 'audit' });
    // Nottaki son turlar etiketi kapatamasın (kayıttan birebir alıntı)
    const r3 = await ctl.turn(AUDIT_PROMPT + '\n\n<devir-notu>\n' + note.replace(/<(\/?devir-notu)/gi, '‹$1') + '\n</devir-notu>');
    if (!r3) throw new Error('Sohbet kapandı.');
    const said = (r3.result?.subtype === 'success' ? r3.text : '').trim();
    const additions = /^["“]?eksik yok\.?["”]?$/i.test(said) ? '' : clipMid(said, ADD_MAX);
    note = buildNote({ oldSid, parts, additions, at });

    // 4. Yeni beden: defter notun içinde, ilk mesajda ayrıca konmaz; eski sınavın kaçırılanları da notta
    ev('step', { step: 'birth', note, additions });
    defter.markTabled(chatId, octoId);
    const r4 = await ctl.rebirth(note);
    const newSid = ctl.getSessionId();
    if (!r4 || !newSid) throw new Error('Yeni beden açılamadı. Eski bedenin oturumu yerinde; "Bu oturuma devam et" ile geri dönebilirsiniz.');
    record(octoId, { at, from: oldSid, to: newSid, defterChanged: changed, turns: parts.turns.count, arms: parts.arms.count, additions, note });
    ev('done', { from: oldSid, to: newSid });
    return { ok: true, from: oldSid, to: newSid };
  } catch (err) {
    ev('error', { error: err?.message || String(err) });
    return { ok: false, error: err?.message || String(err) };
  } finally {
    running.delete(chatId);
    ctl.setRebirthing(false);
  }
}

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  ipcMain.handle('dogus:plan', (_e, chatId) => plan(chatId));
  ipcMain.handle('dogus:start', (_e, chatId) => start(chatId));
}

module.exports = { setup, register, forget, plan, start, buildNote, readConversation, turnsOf, formatTurns, firstTask, sessionFile, findEntry, MARK, NOTE_MARK };
