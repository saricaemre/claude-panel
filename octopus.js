// Octopus: ahtapot kaydı (docs/octopus/OCTOPUS-PLANI.md §7.3). Bir hesap ve bir proje için baş (projenin ana oturumu)
// ve başın açtığı kollar (yan oturumlar, sessions.js). Kayıt <userData>/octopus/<id>/ahtapot.json'da durur
// (klasör 700, dosya 600); panel yeniden açılınca kenar çubuğunda geri gelir. Kollar kendiliğinden açılmaz (token harcamasın).
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let send = () => {};
const records = new Map(); // ahtapot kimliği -> kayıt (her değişiklik hemen diske yazılır)
let loaded = false;
// Açık sohbetlerin ahtapottaki yeri: chatId -> { octoId, role: 'head' | 'arm', armId, draft }
// draft: henüz oturum kimliği gelmemiş yeni baş; kayıt ilk session_id ile yazılır (mesajsız kapanan sohbet ahtapot bırakmaz)
const live = new Map();
let shuttingDown = false;
const listeners = []; // kayıt değişince (hafiza.js: ahtapot projeleri kendiliğinden dizinlenir)

const root = () => path.join(app.getPath('userData'), 'octopus');
const fileOf = (id) => path.join(root(), id, 'ahtapot.json');
const now = () => new Date().toISOString();

function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

// Yarım dosya kalmasın diye geçici dosyaya yazıp yeniden adlandırır
function write(rec) {
  privateDir(root());
  privateDir(path.join(root(), rec.id));
  const f = fileOf(rec.id);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
  send('octopus:changed', rec.accountId);
  for (const fn of listeners) { try { fn(rec); } catch {} }
}

// Okunamayan kayıt atlanır; bellekte olmadığı için üzerine de yazılmaz
function load() {
  if (loaded) return;
  loaded = true;
  let names = [];
  try { names = fs.readdirSync(root()); } catch { return; }
  for (const n of names) {
    if (!/^oc_[0-9a-f]{16}$/.test(n)) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(fileOf(n), 'utf8'));
      if (rec?.version === 1 && rec.id === n) records.set(n, rec);
    } catch {}
  }
}

const get = (id) => { load(); return records.get(id) || null; };

function create({ id, accountId, project, sessionId, reason = 'first', settings = {} }) {
  load();
  const at = now();
  const rec = {
    version: 1,
    id: id || 'oc_' + crypto.randomBytes(8).toString('hex'),
    accountId,
    project, // { key: chat-main.js → projectKey(), cwd, name }
    createdAt: at,
    head: { sessionId, bodies: [{ sessionId, from: at, to: null, reason }] },
    arms: [],
    settings: { maxArms: 8, ...settings }, // memory: false → hafızaya alınmaz (hafiza.js → targets); import: defter.js
  };
  records.set(rec.id, rec);
  write(rec);
  return rec;
}

// Başın bedeni değişti (devam edilen oturum yeni bir kimlikle açıldı)
function setHead(octoId, sessionId, reason = 'resume') {
  const rec = get(octoId);
  if (!rec || rec.head.sessionId === sessionId) return;
  const at = now();
  for (const b of rec.head.bodies) if (!b.to) b.to = at;
  rec.head.bodies.push({ sessionId, from: at, to: null, reason });
  rec.head.sessionId = sessionId;
  write(rec);
}

function addArm(octoId, { sessionId = null, title = '', brief = '', cwd = '', worktree = null }) {
  const rec = get(octoId);
  if (!rec) return null;
  const n = rec.arms.reduce((m, a) => Math.max(m, +String(a.id).replace(/\D/g, '') || 0), 0) + 1;
  const arm = {
    id: `kol-${n}`, sessionId, title: String(title).slice(0, 60), brief: String(brief).slice(0, 4000), cwd,
    state: 'working', worktree, createdAt: now(), endedAt: null, lastReport: '', todos: null,
  };
  rec.arms.push(arm);
  write(rec);
  return arm;
}

// Değişen bir alan yoksa diske yazılmaz (her mesajda "çalışıyor" gelir)
function setArm(octoId, armId, patch) {
  const rec = get(octoId);
  const arm = rec?.arms.find((a) => a.id === armId);
  if (!arm) return null;
  if (Object.entries(patch).every(([k, v]) => JSON.stringify(arm[k]) === JSON.stringify(v))) return arm;
  Object.assign(arm, patch);
  write(rec);
  return arm;
}

// Ahtapotun ayarları (settings): maxArms, import (defter.js → içe aktarılan dosya desenleri)
function setSettings(octoId, patch) {
  const rec = get(octoId);
  if (!rec) return null;
  rec.settings = { ...rec.settings, ...patch };
  write(rec);
  return rec.settings;
}

// Son sınavın özeti (sinav.js; ayrıntısı <ahtapot>/sinav.jsonl): başın üstünde puan olarak görünür
function setExam(octoId, exam) {
  const rec = get(octoId);
  if (!rec) return null;
  rec.exam = exam;
  write(rec);
  return exam;
}

function forProject(accountId, key) {
  load();
  return [...records.values()].find((r) => r.accountId === accountId && r.project?.key === key) || null;
}

function listForAccount(accountId) {
  load();
  return [...records.values()].filter((r) => r.accountId === accountId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- chat-main.js ve sessions.js kancaları ----------

// Sohbet baş olarak başlıyor: octopus 'new' (yeni ahtapot) ya da var olan ahtapotun kimliği (baş "Devam et" ile açıldı).
// Ahtapotun kimliğini döner; aynı projede zaten ahtapot varsa yenisi açılmaz (null).
function bindHead(chatId, { octopus, accountId, project }) {
  if (octopus === 'new') {
    if (forProject(accountId, project.key)) return null;
    const id = 'oc_' + crypto.randomBytes(8).toString('hex');
    live.set(chatId, { octoId: id, role: 'head', draft: { accountId, project } });
    return id;
  }
  const rec = get(octopus);
  if (!rec || rec.accountId !== accountId) return null;
  live.set(chatId, { octoId: rec.id, role: 'head' });
  return rec.id;
}

// Sohbetin oturum kimliği geldi ya da değişti
function noteSession(chatId, sessionId) {
  const b = live.get(chatId);
  if (!b || !sessionId) return;
  if (b.role === 'head') {
    if (b.draft) {
      // Sohbet kapanırken iki kez gelmesin diye taslak önce silinir
      const { accountId, project } = b.draft;
      delete b.draft;
      if (!forProject(accountId, project.key)) create({ id: b.octoId, accountId, project, sessionId });
      else live.delete(chatId);
    } else {
      setHead(b.octoId, sessionId, b.nextReason || 'resume');
      delete b.nextReason;
    }
  } else {
    const arm = get(b.octoId)?.arms.find((a) => a.id === b.armId);
    if (arm && arm.sessionId !== sessionId) setArm(b.octoId, b.armId, { sessionId });
  }
}

// Yeniden doğuş (dogus.js): başın sohbetinde yeni bir Claude Code süreci açılacak; ilk session_id yeni beden olarak 'rebirth' nedeniyle yazılır
function expectBody(chatId, reason) {
  const b = live.get(chatId);
  if (b?.role === 'head' && !b.draft) b.nextReason = reason;
}

// Var olan bir sohbet beyin olur ("Bu sohbeti beyin yap"). Yalnız panelin kaydı yazılır; oturum dosyasına ve projeye dokunulmaz (İ1).
// Oturum kimliği henüz yoksa (mesajsız yeni sohbet) yeni baş gibi ilk session_id ile yazılır.
function adopt(chatId, { accountId, project, sessionId }) {
  if (live.has(chatId)) throw new Error('Bu sohbet zaten bir ahtapota bağlı.');
  if (forProject(accountId, project.key)) throw new Error('Bu projenin zaten bir ahtapotu var; kenar çubuğundaki "Ahtapotlar" listesinden açın.');
  if (!sessionId) return bindHead(chatId, { octopus: 'new', accountId, project });
  const rec = create({ accountId, project, sessionId, reason: 'adopted' });
  live.set(chatId, { octoId: rec.id, role: 'head' });
  return rec.id;
}

// Bir yan oturum başladı (sessions.register); başlatan sohbet bir ahtapotun başıysa kol olarak kaydedilir.
// Kolun yeri ({ octoId, armId }) döner; sessions.js durumları bununla yazar (sekme kapansa da "done" diyebilsin diye).
function armStarted(chatId, parentChatId, { title, cwd, worktree }) {
  const p = live.get(parentChatId);
  if (!p || p.role !== 'head' || p.draft || !get(p.octoId)) return null;
  const arm = addArm(p.octoId, { title, cwd, worktree: worktree ? { path: worktree.path, branch: worktree.branch } : null });
  if (!arm) return null;
  live.set(chatId, { octoId: p.octoId, role: 'arm', armId: arm.id });
  return { octoId: p.octoId, armId: arm.id };
}

// "Devam et" ile açılan oturum bir kolunsa (kenar çubuğu, ahtapot bölmesi, geçmiş) sohbet yeniden o kol olur: baş onu yine görür,
// raporu başa gider, kapanınca kayıtta "kesildi" olur. Eskiden düz sohbet açılıyordu; baş yeniden açılınca kollarını göremiyor,
// bitiremiyor, kapatamıyordu (2026-10-19, Kızıl Elma). Aynı kola bağlı açık bir sohbet varsa bağlanmaz. Yalnız arar; bağlama bindArm.
function findArm(accountId, sessionId) {
  if (!sessionId) return null;
  load();
  for (const rec of records.values()) {
    if (rec.accountId !== accountId) continue;
    const arm = rec.arms.find((a) => a.sessionId === sessionId);
    if (arm) return armChat(rec.id, arm.id) == null ? { octoId: rec.id, armId: arm.id } : null;
  }
  return null;
}
function bindArm(chatId, ref) {
  if (ref && get(ref.octoId)) live.set(chatId, { octoId: ref.octoId, role: 'arm', armId: ref.armId });
}
// Ahtapotun açık baş sohbeti ve kolun açık sohbeti (yoksa null)
function headChat(octoId) {
  for (const [id, b] of live) if (b.role === 'head' && !b.draft && b.octoId === octoId) return id;
  return null;
}
function armChat(octoId, armId) {
  for (const [id, b] of live) if (b.role === 'arm' && b.octoId === octoId && b.armId === armId) return id;
  return null;
}
// Sekmesi açık olmayan kolu kapatmak (sağ tık "Kolu kapat", başın `sessions close`'u): bitmemişse "kesildi" olur, ahtapotta çizilmez.
// Bitmiş kol zaten çizilmez (sekmesi kapalı); dokunulmaz.
function closeArm(octoId, armId) {
  const arm = get(octoId)?.arms.find((a) => a.id === armId);
  if (!arm) return null;
  if (arm.state !== 'done' && arm.state !== 'cut') setArm(octoId, armId, { state: 'cut', endedAt: now() });
  return arm;
}

// Kolun durumu (sessions.js): working, waiting, reported, stopped, done. Panel kapanırken yazılmaz (kayıt olduğu gibi kalır).
function updateArm(ref, patch) {
  if (!ref || shuttingDown) return;
  setArm(ref.octoId, ref.armId, patch);
}

const isArm = (chatId) => live.get(chatId)?.role === 'arm';

// Sohbetin ahtapottaki yeri (defter.js): { octoId, role: 'head' | 'arm', armId }; kaydı henüz yazılmamış yeni baş null
function roleOf(chatId) {
  const b = live.get(chatId);
  if (!b || b.draft || !get(b.octoId)) return null;
  return { octoId: b.octoId, role: b.role, armId: b.armId || null };
}

// Başın sistem istemine eklenen görev tanımı (chat-main.js → systemPrompt.append; hafiza.js ve defter.js → HEAD_PROMPT ile).
// Yoksa baş, sessions aracının "küçük işleri burada yap" açıklamasına uyup verilen işi kendisi yapıyordu (2026-10-18, Kızıl Elma).
const HEAD_PROMPT = 'Baş olarak işi kendin yapmazsın: yönü tutar, işi kollara böler, sonuçları doğrularsın. Kullanıcı birden çok adım sürecek bir iş ' +
  'verdiğinde (kod yazmak, dosya değiştirmek, varlık üretmek, uzun bir araştırma) onu `sessions start` ile bir kola ver; birbirinden bağımsız ' +
  'parçalar varsa her birine ayrı kol aç (aynı depoda dosya yazan paralel kollara `worktree: true`). Kolun `prompt`\'u bu konuşmayı görmeyen bir ' +
  'oturum için eksiksiz olsun: amaç, ilgili dosyalar, verilen kararlar ve kısıtlar, bitti ne demek, nasıl doğrulanacak. Kendin yalnız kısa işleri ' +
  'yap: soruyu yanıtlamak, plan ve karar, işi bölmek için gereken okumalar, defter ve hafıza. Kullanıcı açıkça kendin yapmanı isterse yap. ' +
  'Kollar kısa ve sabit biçimde rapor verir (sonuç, değişenler, doğrulama, açık); başka biçim gerekiyorsa `prompt`\'ta açıkça iste. ' +
  'Kol rapor verince (`<yan-oturum-olayi>`: kolun son mesajının kendisi; kesildiyse sonunda yazar) sonucu doğrula: rapordaki doğrulamaya, ' +
  'gerekirse değişen dosyalara bak. `read` aynı raporu yeniden getirir, yalnız rapor kesildiyse gerekir. Eksikse `send` ile geri gönder, tamamsa `done`. ' +
  'Böylece masan uzun süre temiz kalır, sıkıştırma gecikir.\n' +
  'Kollar aynı anda çalışır ve birbirini yalnız ilk mesajlarına eklenen açık kollar listesinden bilir; çakışmayı önlemek senin işin, kullanıcının ' +
  'bunu her seferinde söylemesi gerekmez. Kol açmadan önce alanını ayır: hangi dosya, klasör ve kayıtlara yazacağını `prompt`\'a açıkça yaz, iki ' +
  'kola aynı dosyayı verme. Projenin ortak kayıtları (numaralı oturum ya da sürüm, günlük, durum tablosu, kilit, sayaç) tek elde kalsın: ya ' +
  'kendin güncelle ya da tek bir kola ver ve öbürlerine "buna yazma" de. Yeni kolun işi çalışan bir kolun alanına değiyorsa önce o kola `send` ' +
  'ile haber ver ya da bitmesini bekle. Kol ortak bir şeye yazması gerektiğini söylerse sen karar ver.';

// Kolun raporu: her turun son mesajı başa bu kadar karakterle gider (sessions.js → turnEnded; kayıttaki lastReport da)
const REPORT_MAX = 1500;
// Kolun sistem istemine eklenen rapor biçimi (chat-main.js → systemPrompt.append). Rapor başın bağlamına girer ve orada her turda yeniden
// okunur; başın masası kolunkinden pahalıdır. Kısalık yalnız yazıya: işin, okumanın ve doğrulamanın kendisi kısalmaz (2026-10-18, Emre).
const ARM_PROMPT = 'Bu sohbet bir Octopus kolu: görevi ahtapotun başı (ana oturum) verdi, sonucu baş kullanıcıyla tartışacak. Her turunun son mesajı ' +
  `başa rapor olarak gider (ilk ${REPORT_MAX.toLocaleString('tr-TR')} karakteri); okuyan kullanıcı değil baş. Raporu düz ve kısa yaz, en önemlisi başta:\n` +
  'Sonuç: bitti, yarım ya da takıldı (tek cümle).\n' +
  'Değişenler: dosya yolları ve her biri için tek satır; dosya değişmeyen işte bulgular, kısa maddeler ve kaynaklarıyla.\n' +
  'Doğrulama: çalıştırdığın komut ve sonucu; yapamadıysan nedeni.\n' +
  'Açık: başın kararını bekleyen soru, risk ya da yapılmayan; yoksa bu satırı yazma.\n' +
  'Görevi yeniden anlatma; gerekçe öyküsü, kod ya da diff alıntısı, selam ve kapanış cümlesi yazma: baş ayrıntı isterse dosyaya bakar ya da sorar. ' +
  'Çalışırken ara mesajların da kısa olsun. Baş görev tanımında başka bir rapor biçimi istediyse ona uy. ' +
  'Kısalık yalnız yazıda: okumayı, düşünmeyi, işin kendisini ve doğrulamayı kısaltma.';

// Kolun ilk mesajına eklenen koordinasyon notu (sessions.js → start; defter.js → stripArmNote görev tanımından atar).
// Kollar birbirini bilmiyordu; Kızıl Elma'da baş iki kolun aynı numaralı kayda yazmaması için kendi kilidini uyduruyordu (2026-10-18).
// Durum adlarında "rapor" yok: sahte CLI turu mesajdaki kelimeyle seçer.
const PEER_MARK = '\n\n---\nAhtapotun öbür kolları';
const PEER_STATES = { working: 'çalışıyor', waiting: 'izin bekliyor', reported: 'turu bitti', stopped: 'durdu' };
function peerNote(octoId) {
  const rec = get(octoId);
  if (!rec) return '';
  const root = rec.project?.key || '';
  const where = (a) => {
    if (a.worktree?.branch) return `ayrı kopya, dal ${a.worktree.branch}`;
    const rel = root && a.cwd ? path.relative(root, a.cwd) : '';
    return !a.cwd || a.cwd === root ? 'proje klasörü' : rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `proje içinde ${rel}` : a.cwd;
  };
  // Yalnız şu an açık sekmesi olan kollar: panel kapanırken durum yazılmadığı için kayıtta eski "çalışıyor"lar kalabilir
  const open = new Set([...live.values()].filter((b) => b.role === 'arm' && b.octoId === octoId).map((b) => b.armId));
  const list = rec.arms.filter((a) => open.has(a.id) && PEER_STATES[a.state])
    .map((a) => `- ${a.title || a.id} (${PEER_STATES[a.state]}; ${where(a)})${a.brief ? ': ' + a.brief.replace(/\s+/g, ' ').slice(0, 240) : ''}`);
  return PEER_MARK + (list.length ? ' (seninle aynı anda çalışıyorlar; başın onlara verdiği görevler):\n' + list.join('\n')
    : ': şu an açık başka kol yok, ama sen çalışırken baş yenilerini açabilir.') +
    '\nGörev tanımın açıkça vermedikçe başka bir kolun alanına ya da projenin ortak kayıtlarına (numaralı oturum ya da sürüm, günlük, durum ' +
    'tablosu, kilit, sayaç) yazma; gerekiyorsa son mesajında başa söyle, o halletsin.';
}

// Başın aynı anda çalışabilecek kol sınırı (İ5); baş değilse null
function maxArms(chatId) {
  const b = live.get(chatId);
  if (b?.role !== 'head' || b.draft) return null;
  const rec = get(b.octoId);
  return rec ? rec.settings?.maxArms || 8 : null;
}

// Kolun son görev listesi (TodoWrite): kaç iş bitti, kaç iş var
function noteTodos(chatId, todos) {
  const b = live.get(chatId);
  if (b?.role !== 'arm' || shuttingDown || !Array.isArray(todos)) return;
  setArm(b.octoId, b.armId, { todos: { done: todos.filter((t) => t?.status === 'completed').length, total: todos.length } });
}

// Kolun ilk mesajı: görev tanımı
function noteBrief(chatId, text) {
  const b = live.get(chatId);
  if (b?.role !== 'arm' || !text) return;
  const arm = get(b.octoId)?.arms.find((a) => a.id === b.armId);
  if (arm && !arm.brief) setArm(b.octoId, b.armId, { brief: text.slice(0, 4000) });
}

// Sohbet kapandı. Kol "kesildi" olur; panel kapanırken kapananlar kesilmiş sayılmaz (yeniden açılınca kayıt aynı kalır).
// Başın "bitti" dediği kol sekmesi kapanınca da "bitti" kalır.
function chatClosed(chatId) {
  const b = live.get(chatId);
  if (!b) return;
  live.delete(chatId);
  if (b.role !== 'arm' || shuttingDown) return;
  const arm = get(b.octoId)?.arms.find((a) => a.id === b.armId);
  if (arm && arm.state !== 'done') setArm(b.octoId, b.armId, { state: 'cut', endedAt: now() });
}

function shutdown() { shuttingDown = true; }

const onChange = (fn) => { listeners.push(fn); };

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  ipcMain.handle('octopus:list', (_e, accountId) => listForAccount(accountId));
  // Sağ tık "Kolu kapat" (renderer/octopus.js), sekmesi açık olmayan kol için; açık sekmeyi arayüz kendisi kapatır
  ipcMain.handle('octopus:closeArm', (_e, octoId, armId) => {
    if (armChat(octoId, armId) != null) return { ok: false, error: 'Kolun sekmesi açık.' };
    return closeArm(octoId, armId) ? { ok: true } : { ok: false, error: 'Kol bulunamadı.' };
  });
}

module.exports = {
  setup, get, create, setHead, addArm, setArm, setSettings, setExam, forProject, listForAccount, privateDir, root,
  HEAD_PROMPT, ARM_PROMPT, REPORT_MAX, PEER_MARK, peerNote, bindHead, adopt, noteSession, expectBody, armStarted, findArm, bindArm, headChat, armChat, closeArm, updateArm, isArm, roleOf, maxArms, noteTodos, noteBrief, chatClosed, shutdown, onChange, now,
};
