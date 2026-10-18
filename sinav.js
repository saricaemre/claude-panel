// Sınav (docs/octopus/OCTOPUS-PLANI.md P7.2): sıkıştırmadan ve yeniden doğuştan (P7.3) sonra başın neyi hatırladığı ölçülür.
// Sorular defterin açık satırlarından türe göre şablonla üretilir ("Neler reddedildi ve neden? (2 ret)"). Soruları başın son kaydından açılan,
// araçsız ve kayıt yazmayan bir dal yanıtlar (danis.js → branch; asıl oturuma dokunulmaz, dal her durumda silinir). Puan satır başına anahtar
// kelimeyle verilir: satırın kelimelerinin (Türkçe arama biçimi, ilk 5 harf) en az yarısı cevapta geçiyorsa hatırlanmış sayılır. Küçük model yok.
// Hatırlanmayan satırlar başın bir sonraki mesajında masaya konur (defter.js → noteMissed). Puan ahtapot kaydında (exam) başın üstünde görünür,
// her sınavın ayrıntısı <ahtapot>/sinav.jsonl'e eklenir (İ2; dosya 600).
// Bedel (İ6, K7): tahmin, sıkıştırmadan sonraki tur sonunda ölçülen bağlam boyutu (compaction.js → getContextUsage). 30.000 tokenın altı
// kendiliğinden çalışır; üstü ya da ölçülemeyen tahmin sohbette kartla sorulur.
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const octopus = require('./octopus');
const defter = require('./defter');
const danis = require('./danis');
const hooks = require('./hooks');
const { norm } = require('./hafiza-isci');

const THRESHOLD = 30000; // K7: bu tahminin altı onaysız
// Ayarlardan değiştirilebilir (config.json → thresholds.sinav, P8.1); yoksa THRESHOLD
let thresholdOf = () => null;
const threshold = () => { const n = thresholdOf(); return Number.isInteger(n) && n >= 0 ? n : THRESHOLD; };
const ROWS_MAX = 40, KEYS_MAX = 6, ANSWER_KEEP = 8000, MISSED_SHOW = 20;
const QUESTIONS = {
  kural: (n) => `Bu projede kullanıcıyla konan kurallar neler? (${n} kural)`,
  ret: (n) => `Bu projede neler reddedildi ve neden? (${n} ret)`,
  zevk: (n) => `Kullanıcının zevki ve kalite çıtası ne? (${n} satır)`,
  karar: (n) => `Hangi kararlar verildi? (${n} karar)`,
  acik: (n) => `Hangi işler açık, yapılmayı bekliyor? (${n} iş)`,
  bilgi: (n) => `Bu proje hakkında bilmen gereken hangi bilgiler var? (${n} bilgi)`,
};
// Sorunun kendi kelimeleri ve satırlarda sık geçen genel kelimeler puana sayılmaz (cevap onları her zaman tekrarlar)
const GENERIC = new Set(['olmal', 'olsun', 'gerek', 'yerin', 'kulla', 'proje', 'satir', 'kalit', 'cizgi']);
const FRAME_WHY = { compact: 'Bağlamın az önce sıkıştırıldı', rebirth: 'Az önce yeni bir bedenle (devir notuyla) uyandın' };
const frame = (reason) => `[Claude Panel sınavı] ${FRAME_WHY[reason] || FRAME_WHY.compact}; bu kısa sınav neyi hatırladığını ölçüyor. Araç kullanma, hiçbir şeye bakma; ` +
  'yalnız şu an bağlamında olanlarla cevapla. Hatırlamadığını uydurma, "hatırlamıyorum" de. Her cevabı sorunun numarasıyla başlat; ' +
  'her satırı kısa ve somut yaz (ne, kimlik varsa kimliği, gerekçe).';

let send = () => {};
const states = new Map(); // chatId -> { ctx, due, offer, running }
const st = (chatId) => { if (!states.has(chatId)) states.set(chatId, { ctx: null, due: null, offer: null, running: false }); return states.get(chatId); };

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const words = (s) => norm(String(s || '')).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Anahtar: rakamlar olduğu gibi, en az 4 harfli kelimeler ilk 5 harfiyle (ekler düşsün); günlük ve genel kelimeler atlanır
function keysOf(text, exclude) {
  const out = [];
  for (const w of words(text)) {
    const k = /^\d+$/.test(w) ? w : w.length >= 4 ? w.slice(0, 5) : null;
    if (!k || defter.STOP.has(w) || GENERIC.has(k) || exclude.has(k) || out.includes(k)) continue;
    out.push(k);
  }
  return out.slice(0, KEYS_MAX);
}

// Sınav: masaya konan satırlar (açık; dosyadan gelenler yalnız sabitse), görünüm sırasıyla en çok 40; anahtarı olmayan satır puanlanmaz
function build(octoId, reason = 'compact') {
  const open = defter.view(octoId).filter((r) => r.status === 'open' && (!r.imported || r.pinned)).slice(0, ROWS_MAX);
  const types = defter.ORDER.filter((t) => open.some((r) => r.type === t));
  const questions = types.map((t) => ({ type: t, text: QUESTIONS[t](open.filter((r) => r.type === t).length) }));
  const exclude = new Set(questions.flatMap((q) => words(q.text).filter((w) => w.length >= 4).map((w) => w.slice(0, 5))));
  const rows = open.map((r) => ({ id: r.id, type: r.type, keys: keysOf(r.text, exclude) })).filter((r) => r.keys.length);
  const asked = questions.filter((q) => rows.some((r) => r.type === q.type));
  const prompt = frame(reason) + '\n\n' + asked.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
  return { rows, questions: asked, prompt };
}

// Satır, anahtarlarının en az yarısı cevapta geçiyorsa hatırlanmış sayılır (kelime başı: "usturlap" → ustur…; rakam tam)
function score(rows, answer) {
  const toks = words(answer);
  const has = (k) => (/^\d+$/.test(k) ? toks.includes(k) : toks.some((t) => t.startsWith(k)));
  return rows.map((r) => {
    const matched = r.keys.filter(has);
    return { ...r, matched, hit: matched.length >= Math.ceil(r.keys.length / 2) };
  });
}

function record(octoId, entry) {
  const dir = path.join(octopus.root(), octoId);
  octopus.privateDir(octopus.root());
  octopus.privateDir(dir);
  const f = path.join(dir, 'sinav.jsonl');
  fs.appendFileSync(f, JSON.stringify(entry) + '\n', { mode: 0o600 });
  fs.chmodSync(f, 0o600);
}

// ---------- Akış ----------

// chat-main.js: sohbet açılırken (sdk, klasör, ortam, yardımcı süreç, oturum kimliği)
function register(chatId, ctx) { st(chatId).ctx = ctx; }
function forget(chatId) { states.delete(chatId); }

// Sınav gerekiyor: PostCompact kancası ya da compact_boundary mesajı (hangisi gelirse; ikisi aynı işi yapar), yeniden doğuş (P7.3).
// Sınav turun sonunda yapılır: o an kayıt tamdır, son mesaj cevapsız bir araç çağrısı değildir.
function noteDue(chatId, reason = 'compact') {
  if (octopus.roleOf(chatId)?.role !== 'head') return;
  st(chatId).due = reason;
}

// chat-main.js: tur sonu, bağlam ölçüldükten sonra (u: compaction.refresh'in sonucu ya da null)
function turnEnded(chatId, u) {
  const s = states.get(chatId);
  if (!s?.due || s.running || !s.ctx) return;
  const reason = s.due;
  s.due = null;
  const where = octopus.roleOf(chatId);
  if (where?.role !== 'head') return;
  const exam = build(where.octoId, reason);
  if (!exam.rows.length) return; // defterde ölçülecek satır yok
  const estimate = typeof u?.totalTokens === 'number' ? u.totalTokens : null;
  s.offer = { reason, estimate, octoId: where.octoId };
  if (estimate == null || estimate > threshold()) {
    send('sinav:event', chatId, { kind: 'ask', reason, estimate, threshold: threshold(), rows: exam.rows.length, questions: exam.questions.length });
    return;
  }
  run(chatId);
}

async function run(chatId) {
  const s = states.get(chatId);
  const offer = s?.offer;
  if (!offer || s.running) return { ok: false, error: 'Bekleyen sınav yok.' };
  s.offer = null;
  s.running = true;
  const { ctx } = s;
  const exam = build(offer.octoId, offer.reason);
  send('sinav:event', chatId, { kind: 'running', rows: exam.rows.length, questions: exam.questions.length, estimate: offer.estimate });
  try {
    const sessionId = ctx.getSessionId();
    if (!sessionId) throw new Error('Başın oturumu henüz yok.');
    if (!exam.rows.length) throw new Error('Defterde ölçülecek satır kalmadı.');
    const r = await danis.branch(ctx.sdk, {
      session: sessionId, cwd: fs.realpathSync(ctx.cwd), env: ctx.env, helper: ctx.helper, prompt: exam.prompt, title: 'octopus-sinav',
    });
    if (!r.answer) throw new Error('Dal cevap vermedi' + (r.res?.subtype && r.res.subtype !== 'success' ? ' (' + r.res.subtype + ')' : '') + '.');
    const scored = score(exam.rows, r.answer);
    const hit = scored.filter((x) => x.hit).length;
    const missed = scored.filter((x) => !x.hit).map((x) => x.id);
    const u = r.res?.usage || {};
    const at = octopus.now();
    record(offer.octoId, {
      at, sessionId, reason: offer.reason, estimate: offer.estimate, hit, total: scored.length,
      questions: exam.questions.map((q) => q.text), rows: scored.map(({ id, type, keys, matched, hit: h }) => ({ id, type, keys, matched, hit: h })),
      answer: r.answer.slice(0, ANSWER_KEEP), model: r.est.model, ms: r.ms,
      usage: { input: danis.inputOf(u), output: u.output_tokens || 0, costUsd: typeof r.res?.total_cost_usd === 'number' ? r.res.total_cost_usd : null },
    });
    octopus.setExam(offer.octoId, { at, sessionId, reason: offer.reason, hit, total: scored.length, missed: missed.slice(0, 50) });
    if (states.get(chatId) !== s) return { ok: true, hit, total: scored.length }; // sohbet sınav sürerken kapandı
    defter.noteMissed(chatId, offer.octoId, missed, offer.reason);
    const rows = defter.view(offer.octoId);
    send('sinav:event', chatId, {
      kind: 'done', reason: offer.reason, hit, total: scored.length, questions: exam.questions.map((q) => q.text),
      missed: missed.slice(0, MISSED_SHOW).map((id) => clip(defter.line(rows.find((x) => x.id === id) || { id, type: '', text: '' }).split('\n')[0], 160)),
      more: Math.max(0, missed.length - MISSED_SHOW),
      cost: danis.costLine(r) + ' Dal silindi.',
    });
    return { ok: true, hit, total: scored.length };
  } catch (err) {
    send('sinav:event', chatId, { kind: 'error', error: err?.message || String(err) });
    return { ok: false, error: err?.message || String(err) };
  } finally {
    s.running = false;
  }
}

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  // PostCompact: yalnız not alır (karar verme yetkisi yok, §7.7)
  hooks.provide('PostCompact', (_input, { chatId }) => { noteDue(chatId, 'compact'); return null; });
  // Eşiğin üstündeki sınavın kartı: "Sınavı yap" ya da "Atla"
  ipcMain.handle('sinav:run', (_e, chatId) => run(chatId));
  ipcMain.handle('sinav:skip', (_e, chatId) => {
    const s = states.get(chatId);
    if (!s?.offer) return { ok: false };
    s.offer = null;
    return { ok: true };
  });
}

const configure = ({ getThreshold }) => { if (getThreshold) thresholdOf = getThreshold; };

module.exports = { setup, configure, register, forget, noteDue, turnEnded, run, build, score, keysOf, threshold, THRESHOLD };
