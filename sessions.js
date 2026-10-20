// Yan oturumlar: Claude bağımsız bir işi aynı hesapta, yeni bir sohbet sekmesinde başlatır (`sessions` aracı).
// Sekmeyi arayüz açar (arka planda, odak değişmez). Yan oturum her tur bitirdiğinde başlatan sohbete bir bildirim
// gider; arayüz onu başlatan sohbet boştayken Claude'a iletir (art arda en çok 5 kez, sonra kullanıcıyı bekler).
// Yan oturum bir izin kartında (soru, plan onayı) kullanıcıyı beklerken de başlatan sohbete kart gider; Claude'a iletilmez.
// Başlatan sohbet bir ahtapotun başıysa yan oturum onun koludur: durumu kayda da yazılır, kol kol açamaz (OCTOPUS-PLANI.md İ5).
const { ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const octopus = require('./octopus');
const defter = require('./defter');

let send = () => {};
let nextReq = 1;
const replies = new Map();
const children = new Map(); // yan oturumun chatId'si -> { parent, title, cwd, state, lastText, turns, arm, waitNoted }

// Bir sohbette aynı anda açık (bitmemiş, kapanmamış) yan oturum sınırı; ahtapotun başında kaydın settings.maxArms'ı geçerli
const MAX_CHILDREN = 8;
const ARM_RULE = 'Kollar kol açamaz; bunu başa öner.';
// Durum adları ahtapot kaydıyla aynı (octopus.js); Claude'a ve listeye Türkçe adları gider
const LABELS = { working: 'çalışıyor', waiting: 'izin bekliyor', reported: 'rapor verdi', stopped: 'durdu', done: 'bitti', closed: 'kapandı' };
const active = (c) => c.state !== 'closed' && c.state !== 'done';

function query(op, args, timeout = 60000) {
  const id = nextReq++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { replies.delete(id); reject(new Error('Arayüz yanıt vermedi')); }, timeout);
    replies.set(id, (r) => {
      clearTimeout(t);
      replies.delete(id);
      if (r?.ok) resolve(r); else reject(new Error(r?.error || 'Bilinmeyen hata'));
    });
    send('session:query', id, op, args);
  });
}

// chat-main.js kancaları. Kayıt sohbet başlarken yapılır (ilk tur, araç yanıt dönmeden bitebilir).
// Başlatan sohbet bir ahtapotun başıysa yan oturum kol olarak ahtapot kaydına da yazılır (octopus.js).
function register(chatId, parent, title, cwd, worktree) {
  const arm = octopus.armStarted(chatId, parent, { title, cwd, worktree });
  children.set(chatId, { parent, title: String(title || '').slice(0, 60), cwd, state: 'working', lastText: '', turns: 0, arm, waitNoted: false });
}
// Kol yeniden bağlandı ("Devam et", octopus.findArm): ahtapotun başı açıksa onun yan oturumu sayılır, değilse baş açılınca (relink).
// Durumu kayıttan; çalışıyor/bekliyor yazıyorsa eskidir (panel kapanırken yazılmaz), yeni açılan sohbet boştadır.
function rebind(chatId, ref, cwd) {
  const arm = octopus.get(ref.octoId)?.arms.find((a) => a.id === ref.armId);
  if (!arm) return;
  const state = ['reported', 'stopped', 'done'].includes(arm.state) ? arm.state : 'stopped';
  children.set(chatId, { parent: octopus.headChat(ref.octoId), title: arm.title, cwd, state, lastText: arm.lastReport || '', turns: 0, arm: ref, waitNoted: false });
}
// Baş yeniden açıldı (yeni sohbet kimliği): ahtapotun açık kolları ona bağlanır. Yoksa eski kimliğe bağlı kalıyor, baş `list`'te
// "yan oturum yok" görüyor, `done` / `close` reddediliyordu.
function relink(headChatId, octoId) {
  for (const c of children.values()) if (c.arm?.octoId === octoId && c.state !== 'closed') c.parent = headChatId;
}
function setState(c, state, extra = {}) {
  c.state = state;
  octopus.updateArm(c.arm, { state, ...extra });
}
function noteText(chatId, text) {
  const c = children.get(chatId);
  if (c && text) c.lastText = text;
}
// Yan oturuma mesaj gitti (kullanıcı ya da başlatan sohbet). Bitmiş kol yeni mesajla yeniden çalışır.
function noteBusy(chatId) {
  const c = children.get(chatId);
  if (!c || c.state === 'closed') return;
  c.waitNoted = false;
  setState(c, 'working', c.state === 'done' ? { endedAt: null } : {});
}
// Yan oturumda izin kartı açıldı ya da (hepsi) yanıtlandı. Başlatan sohbete turda bir kez kart gider: "seni bekliyor".
function noteWaiting(chatId, on, what = '') {
  const c = children.get(chatId);
  if (!c || c.state === 'closed' || c.state === 'done') return;
  if (!on) {
    if (c.state === 'waiting') setState(c, 'working');
    return;
  }
  if (c.state === 'waiting') return;
  setState(c, 'waiting');
  if (c.waitNoted || c.parent == null) return;
  c.waitNoted = true;
  send('session:event', c.parent, { childId: chatId, title: c.title, state: 'waiting', label: LABELS.waiting, text: String(what).slice(0, 300) });
}
// Bildirim son yanıtın ilk REPORT_MAX karakterini taşır; kesildiyse sonunda yazar. Kesilmediyse başlatan sohbetin `read` ile
// aynı metni ikinci kez bağlamına alması gerekmez (octopus.js → HEAD_PROMPT).
function turnEnded(chatId, ok) {
  const c = children.get(chatId);
  if (!c) return;
  const state = ok ? 'reported' : 'stopped';
  const text = c.lastText.slice(0, octopus.REPORT_MAX);
  const cut = c.lastText.length > octopus.REPORT_MAX ? `\n…[kesildi: yanıt ${c.lastText.length} karakter; tamamı için sessions read ${chatId}]` : '';
  c.turns++;
  c.waitNoted = false;
  if (c.state !== 'done') setState(c, state, { lastReport: text });
  if (c.parent != null) send('session:event', c.parent, { childId: chatId, title: c.title, state, label: LABELS[state], text: text + cut });
}
// Ahtapottaki "kesildi" octopus.chatClosed'da yazılır
function closed(chatId) {
  const c = children.get(chatId);
  if (c) c.state = 'closed';
}

// Yeni yan oturum açılamıyorsa nedeni: kol kol açamaz, sınır doldu
function startBlocked(chatId) {
  if (octopus.isArm(chatId)) return ARM_RULE;
  const maxArms = octopus.maxArms(chatId);
  const limit = maxArms || MAX_CHILDREN;
  const open = [...children.values()].filter((c) => c.parent === chatId && active(c)).length;
  if (open < limit) return null;
  return maxArms
    ? `Bu ahtapotta aynı anda en çok ${limit} kol çalışabilir. Doğruladığın kolları "done" ile bitir ya da kullanıcıdan kapatmasını iste.`
    : `Bu sohbetten en çok ${limit} yan oturum açık olabilir.`;
}

const own = (chatId, id) => {
  const c = children.get(id);
  if (!c || c.parent !== chatId) throw new Error(`${id} bu sohbetin başlattığı bir yan oturum değil`);
  return c;
};
// İşlemin hedefi: yan oturum numarası ya da (başta) kolun kimliği ("kol-3"). Sekmesi açık kol yan oturum olarak ({ id, c }),
// açık değilse yalnız kaydıyla ({ arm, ref }) döner.
function target(chatId, id) {
  if (typeof id === 'string' && /^kol-\d+$/.test(id.trim())) {
    const role = octopus.roleOf(chatId);
    const arm = role?.role === 'head' ? octopus.get(role.octoId)?.arms.find((a) => a.id === id.trim()) : null;
    if (!arm) throw new Error(`${id} bu ahtapotun kolu değil`);
    const open = octopus.armChat(role.octoId, arm.id);
    if (open != null && children.get(open)?.parent === chatId) return { id: open, c: children.get(open) };
    return { arm, ref: { octoId: role.octoId, armId: arm.id } };
  }
  const n = Number(id);
  return { id: n, c: own(chatId, n) };
}
// Başın sekmesi açık olmayan kolları (bitmemiş, kesilmemiş): `list`'te kimlikleriyle görünür, `done` / `close` ile kapatılır
function closedArms(chatId) {
  const role = octopus.roleOf(chatId);
  if (role?.role !== 'head') return [];
  return (octopus.get(role.octoId)?.arms || []).filter((a) => a.state !== 'cut' && a.state !== 'done' && octopus.armChat(role.octoId, a.id) == null);
}
const ARM_LABELS = { ...LABELS, cut: 'kesildi' };

const tilde = (p) => { const home = os.homedir(); return p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p; };
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// start'ın cwd'si (P9.2): sohbetin klasörüne göre çözülür (~, göreli yol); var olmayan ya da dosya olan klasör reddedilir.
// Reddedilmezse chat:start var olmayan klasörü sessizce ev klasörüne çevirirdi (kartta yazan klasörle açılan farklı olurdu), dosya ENOTDIR verirdi.
function resolveDir(input, cwd) {
  let p = String(input || '').trim();
  if (!p) return { dir: cwd, real: real(cwd) };
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  p = path.resolve(cwd, p);
  let r;
  try { r = fs.realpathSync(p); } catch { return { error: `${tilde(p)} klasörü yok` }; }
  if (!fs.statSync(r).isDirectory()) return { error: `${tilde(p)} bir klasör değil` };
  return { dir: p, real: r };
}

// start'ın modeli ve eforu: verilmezse yan oturum hesabın yeni sohbet seçimini alır (chatPrefs). Model listesi bilinirse ad listeden çözülür
// (değer, tam kimlik ya da görünen ad: "opus", "claude-opus-5-5", "Opus 5.5"), efor modelin desteklediklerine göre denetlenir; bilinmeyen ad
// kart açmadan reddedilir ve seçenekler Claude'a söylenir. Liste yoksa yalnız biçim denetlenir (komut satırına --model= olarak gider).
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_LABELS = { low: 'düşük', medium: 'orta', high: 'yüksek', xhigh: 'çok yüksek', max: 'maksimum' };
const squash = (v) => String(v || '').toLowerCase().replace(/^claude[-\s]*/, '').replace(/[\s._-]+/g, '');
function resolveModel(input = {}, models) {
  const want = String(input.model || '').trim();
  const effort = String(input.effort || '').trim();
  if (effort && !EFFORTS.includes(effort)) return { error: `Bilinmeyen efor "${effort}"; seçenekler: ${EFFORTS.join(', ')}` };
  const list = (Array.isArray(models) ? models : []).filter((m) => m?.value && m.value !== 'default');
  let row = null;
  if (want) {
    if (list.length) {
      const k = squash(want);
      row = list.find((m) => m.value === want) || list.find((m) => [m.value, m.resolvedModel, m.displayName].some((x) => x && squash(x) === k));
      if (!row) return { error: `Bilinmeyen model "${want}"; seçenekler: ${list.map((m) => `${m.value} (${m.displayName || m.value})`).join(', ')}` };
    } else if (!/^[A-Za-z0-9][\w.:\[\]-]{0,79}$/.test(want)) return { error: `Geçersiz model adı "${want}"` };
  }
  const levels = row?.supportedEffortLevels;
  if (effort && row && (row.supportsEffort === false || (Array.isArray(levels) && !levels.includes(effort)))) {
    return { error: `${row.displayName || row.value} "${effort}" eforunu desteklemiyor${levels?.length ? '; seçenekler: ' + levels.join(', ') : ''}` };
  }
  return { model: row?.value || want || '', effort, label: [row?.displayName || want, effort && EFFORT_LABELS[effort] + ' efor'].filter(Boolean).join(', ') };
}

// İzin: başlatmak her seferinde kartla (yeni bir Claude oturumu açar, kullanım harcar); gerisi kendi yan oturumlarında sormadan.
// Reddedilecek başlatma (kol, sınır, olmayan klasör) kart açmadan araca gider; araç nedeniyle reddeder.
// Klasör sohbetin klasörünün ve projesinin (git kökü; ayrı kopyada ana depo) dışındaysa başlık onu söyler: kartta ham girdinin içinde, uzun görev
// tanımının altında kalıyordu. Gösterilen yol gerçek yoldur (symlink içeride görünüp dışarıyı açmasın).
function permission(chatId, input = {}, { cwd, project, models } = {}) {
  // Çalışan ya da kullanıcıyı bekleyen yan oturumu kapatmak kartla (yarım tur kaybolur); bitmiş, rapor vermiş, durmuş olanı sormadan
  if (input.action === 'close') {
    let t = null;
    try { t = target(chatId, input.id); } catch { return null; }
    return t.c && (t.c.state === 'working' || t.c.state === 'waiting') ? { title: `Claude çalışan "${t.c.title}" yan oturumunu kapatmak istiyor` } : null;
  }
  if (input.action !== 'start' || startBlocked(chatId)) return null;
  const m = resolveModel(input, models);
  if (m.error) return null;
  const tail = m.label ? ` (${m.label})` : '';
  const title = 'Claude yeni bir yan oturum başlatmak istiyor' + tail;
  if (!input.cwd || !cwd) return { title };
  const r = resolveDir(input.cwd, cwd);
  if (r.error) return null;
  const inside = [cwd, project].filter(Boolean).map(real).some((b) => r.real === b || r.real.startsWith(b + path.sep));
  return { title: inside ? title : `Claude ${tilde(r.real)} klasöründe yeni bir yan oturum başlatmak istiyor${tail}` };
}

function createTool(sdk, z, { chatId, cwd, getModels = () => null }) {
  return sdk.tool(
    'sessions',
    'Bağımsız bir işi Claude Panel\'de ayrı bir yan oturuma (aynı hesapta yeni bir sohbet sekmesi) devreder. Kullanıcı ayrı, paralel ya da ' +
      'arka planda iş istediğinde ya da iş birbirinden bağımsız parçalara ayrılıyorsa kullan; küçük işleri burada yap. "start" her seferinde ' +
      'kullanıcıya sorulur; prompt, bu konuşmayı görmeyen bir oturum için eksiksiz bir görev tanımı olmalı (dosyalar, ne yapılacak, bitti ne demek). ' +
      'Yan oturum her turu bitirdiğinde sana <yan-oturum-olayi> bildirimi gelir (kullanıcı yazmadı); sonucu doğrulamadan bitti deme. ' +
      '"send" yan oturuma mesaj yazar, "read" son yanıtının tamamını okur (bildirim zaten ilk ' + octopus.REPORT_MAX + ' karakterini taşır), "list" durumlarını verir, "done" sonucunu doğruladığın yan oturumu bitti olarak işaretler ' +
      '(sekmesi açık kalır; açık yan oturum sınırından düşer), "close" sekmesini kapatır (oturum kaydı kalır; bitti denmemişse kol "kesildi" olur, ' +
      'ahtapotta artık çizilmez; kullanıcı kolları kapatmanı isterse önce doğruladıklarını "done" ile bitir, sonra "close"). Ahtapotun başında ' +
      '"list" sekmesi kapalı kolları da kimliğiyle (kol-3) verir; "read", "done", "close" bu kimliği de alır. Dosya yazan paralel işlerde worktree: true ver (yan oturum kendi dalında çalışır, dosyalar çakışmaz). ' +
      'Kullanıcı yan oturum için model ya da efor isterse model ve effort ver (ör. model "opus", effort "xhigh" = çok yüksek); verilmezse hesabın yeni sohbet seçimi kullanılır. ' +
      'Uygulanan model ve efor yanıtta yazar; kullanıcıya onu söyle. ' +
      'Bu sohbet bir ahtapotun koluysa yan oturum açamazsın; gerekiyorsa başa öner.',
    {
      action: z.enum(['start', 'list', 'send', 'read', 'done', 'close']).describe('Yapılacak iş'),
      title: z.string().optional().describe('start: sekme adı (60 karakterden kısa)'),
      prompt: z.string().optional().describe('start: yan oturuma ilk mesaj (eksiksiz görev tanımı)'),
      cwd: z.string().optional().describe('start: çalışma klasörü (varsayılan bu sohbetin klasörü)'),
      worktree: z.boolean().optional().describe('start: yan oturum ayrı bir git çalışma kopyasında (kendi dalında) çalışsın; dosya yazan paralel işler için önerilir'),
      model: z.string().optional().describe('start: yan oturumun modeli: takma ad ("opus", "sonnet", "haiku"), tam kimlik ya da görünen ad; verilmezse hesabın yeni sohbet seçimi'),
      effort: z.enum(EFFORTS).optional().describe('start: düşünme eforu (low düşük, medium orta, high yüksek, xhigh çok yüksek, max maksimum); verilmezse hesabın yeni sohbet seçimi'),
      id: z.union([z.number(), z.string()]).optional().describe('send/read/done/close: yan oturum numarası (start ya da list\'ten); başta sekmesi kapalı kol için kolun kimliği (kol-3)'),
      message: z.string().optional().describe('send: yan oturuma yazılacak mesaj'),
    },
    async (a) => {
      const ok = (text) => ({ content: [{ type: 'text', text }] });
      try {
        switch (a.action) {
          case 'start': {
            if (octopus.isArm(chatId)) return { content: [{ type: 'text', text: ARM_RULE }], isError: true };
            const title = String(a.title || '').trim().slice(0, 60);
            const prompt = String(a.prompt || '').trim();
            if (!title || !prompt) throw new Error('title ve prompt gerekli');
            const blocked = startBlocked(chatId);
            if (blocked) throw new Error(blocked);
            const target = resolveDir(a.cwd, cwd);
            if (target.error) throw new Error(target.error);
            const dir = target.dir;
            const m = resolveModel(a, getModels());
            if (m.error) throw new Error(m.error);
            // Ahtapotun kolu: ilk mesajına başın defterinden kural, ret ve zevk (P5.2) ve öbür açık kollar eklenir; kol reddedilenleri
            // ve kimin neyle uğraştığını bilsin (yeni kol henüz kayıtta değil, listede kendisi yok)
            const role = octopus.roleOf(chatId);
            const note = role?.role === 'head' ? defter.armNote(role.octoId) + octopus.peerNote(role.octoId) : '';
            const { id } = await query('start', { parentId: chatId, title, prompt: prompt + note, cwd: dir, worktree: !!a.worktree,
              model: m.model || undefined, effort: m.effort || undefined });
            if (!children.has(id)) register(id, chatId, title, dir);
            const { cwd: where, branch, model, effort } = await query('info', { childId: id });
            const runs = `model ${model || 'hesabın varsayılanı'}, efor ${EFFORT_LABELS[effort] || 'modelin varsayılanı'}`;
            return ok(`Yan oturum ${id} başladı: "${title}" (${where}${branch ? ', dal ' + branch : ''}; ${runs}). Her turunu bitirdiğinde sana bildirim gelecek.`);
          }
          case 'list': {
            const list = [...children.entries()].filter(([, c]) => c.parent === chatId);
            const shut = closedArms(chatId);
            if (!list.length && !shut.length) return ok('Bu sohbetin başlattığı yan oturum yok.');
            const last = (t) => (t ? ' · son: ' + t.replace(/\s+/g, ' ').slice(0, 120) : '');
            return ok([
              ...list.map(([id, c]) => `${id}${c.arm ? ` (${c.arm.armId})` : ''} · ${c.title} · ${LABELS[c.state]} · ${c.turns} tur${last(c.lastText)}`),
              ...shut.map((arm) => `${arm.id} · ${arm.title} · ${ARM_LABELS[arm.state] || arm.state} · sekmesi kapalı${last(arm.lastReport)}`),
            ].join('\n'));
          }
          case 'send': {
            const t = target(chatId, a.id);
            if (!t.c) throw new Error(`${t.arm.id} kolunun sekmesi açık değil; kullanıcı kenar çubuğundan açabilir`);
            if (t.c.state === 'closed') throw new Error(`Yan oturum ${t.id} kapandı`);
            const message = String(a.message || '').trim();
            if (!message) throw new Error('message gerekli');
            await query('send', { childId: t.id, text: message, parentId: chatId });
            return ok(`Yan oturum ${t.id}'e yazıldı. Turu bitince bildirim gelecek.`);
          }
          case 'read': {
            const t = target(chatId, a.id);
            if (!t.c) return ok(`${t.arm.id} · ${t.arm.title} · ${ARM_LABELS[t.arm.state] || t.arm.state} · sekmesi kapalı\n\n${t.arm.lastReport || '(rapor yok)'}`);
            return ok(`${t.id} · ${t.c.title} · ${LABELS[t.c.state]}\n\n${t.c.lastText.slice(0, 20000) || '(henüz yanıt yok)'}`);
          }
          // Kapanmış (kesilmiş) kol da bitti sayılabilir: baş işini sonradan doğrulamış olabilir
          case 'done': {
            const t = target(chatId, a.id);
            if (!t.c) {
              if (t.arm.state === 'done') return ok(`${t.arm.id} zaten bitti.`);
              octopus.updateArm(t.ref, { state: 'done', endedAt: octopus.now() });
              return ok(`${t.arm.id} ("${t.arm.title}") bitti olarak işaretlendi.`);
            }
            const c = t.c;
            if (c.state === 'done') return ok(`Yan oturum ${t.id} zaten bitti.`);
            if (c.state !== 'closed') c.state = 'done';
            octopus.updateArm(c.arm, { state: 'done', endedAt: octopus.now() });
            return ok(`Yan oturum ${t.id} ("${c.title}") bitti olarak işaretlendi${c.arm ? '; ahtapotta kolu "bitti"' : ''}. Sekmesi açık; kapatmak için "close".`);
          }
          // Sekmeyi arayüz kapatır (renderer/sessions.js); kol octopus.chatClosed'da "kesildi" olur, bitmişse "bitti" kalır
          case 'close': {
            const t = target(chatId, a.id);
            if (!t.c) {
              octopus.closeArm(t.ref.octoId, t.ref.armId); // kenar çubuğundan da kalkar (closed); bitmiş kol "bitti" kalır
              if (t.arm.state === 'done') return ok(`${t.arm.id} ("${t.arm.title}") bitmiş ve sekmesi kapalı; ahtapotta çizilmiyor, listeden de kaldırıldı.`);
              return ok(`${t.arm.id} ("${t.arm.title}") kapatıldı (kesildi); ahtapotta artık çizilmez.`);
            }
            if (t.c.state === 'closed') return ok(`Yan oturum ${t.id} zaten kapalı.`);
            const was = t.c.state;
            await query('close', { childId: t.id });
            return ok(`Yan oturum ${t.id} ("${t.c.title}") kapatıldı; oturum kaydı diskte duruyor${t.c.arm ? `. Ahtapotta kolu "${was === 'done' ? 'bitti' : 'kesildi'}", artık çizilmez` : ''}.`);
          }
          default:
            throw new Error('Bilinmeyen işlem: ' + a.action);
        }
      } catch (err) {
        return { content: [{ type: 'text', text: 'Yan oturum: ' + (err?.message || err) }], isError: true };
      }
    }
  );
}

function setup({ getWindow }) {
  send = (...args) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(...args);
  };
  ipcMain.on('session:reply', (_e, id, r) => replies.get(id)?.(r));
}

module.exports = { setup, createTool, permission, resolveModel, register, rebind, relink, noteText, noteBusy, noteWaiting, turnEnded, closed };
