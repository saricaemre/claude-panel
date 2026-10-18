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
}

module.exports = {
  setup, get, create, setHead, addArm, setArm, setSettings, setExam, forProject, listForAccount, privateDir, root,
  bindHead, adopt, noteSession, expectBody, armStarted, updateArm, isArm, roleOf, maxArms, noteTodos, noteBrief, chatClosed, shutdown, onChange, now,
};
