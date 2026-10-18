// Var olan projeyi Octopus'a alma ve Octopus ayarları (docs/octopus/OCTOPUS-PLANI.md P8.1, §7.8 b).
// Alma yalnız okur (İ1): klasörün geçmiş oturumları (scripts/sessions.mjs), hesabın kayıt klasörlerindeki oturum dosyalarının sayısı
// ve boyutu, projedeki karar dosyaları (defter taslağı). Onaylanınca yalnız panelin ahtapot kaydı yazılır: baş seçilen oturumdur
// (beden nedeni 'adopted'), hiçbir Claude Code süreci açılmaz, hiçbir oturum sıkıştırılmaz, projeye ve Claude Code ayarlarına yazılmaz.
// Ayarlar: ahtapot başına kol sınırı ve hafıza (settings.maxArms, settings.memory), ahtapotu olmayan hafıza projeleri (memoryProjects).
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const octopus = require('./octopus');
const hafiza = require('./hafiza');
const defter = require('./defter');
const { projectDirs } = require('./hafiza-isci');

// Defter taslağı için bakılan klasörler (proje köküne göre). Bulunan her klasör bir içe aktarma deseni önerir: <klasör>/*.md
const DECISION_DIRS = ['docs/kararlar', 'kararlar', 'docs/decisions', 'decisions', 'docs/adr', 'doc/adr', 'adr',
  'docs/architecture/decisions', 'docs/decision-records', 'docs/rfcs', 'rfcs'];
const SAMPLE = 4; // önizlemede desen başına satır
const MAX_ARMS = 8; // İ5: kol sınırı 8, ayarlardan düşürülebilir

let opts = null; // { projectKey, expandHome, listSessions, getConfig, saveConfig }

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Klasörün projesi: anahtar git kökü (ayrı kopyada ana depo), ad anahtarın son parçası
function projectOf(cwd) {
  const dir = opts.expandHome(cwd);
  if (!dir || !isDir(dir)) return null;
  const key = opts.projectKey(dir);
  return { key, cwd: dir, name: path.basename(key) || key };
}

// Hesabın kayıt klasörlerinde projenin oturum dosyaları (hafıza dizininin alacağı kadarı: üst düzey <oturum>.jsonl)
function recordFiles(accountId, key) {
  const root = hafiza.projectsDir(accountId);
  let files = 0, bytes = 0;
  for (const dir of root ? projectDirs(root, key) : []) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of names) {
      try { const st = fs.statSync(path.join(dir, n)); if (st.isFile()) { files++; bytes += st.size; } } catch {}
    }
  }
  return { files, bytes };
}

// Projedeki karar dosyası klasörleri: desen, dosya sayısı ve ilk birkaç satırın önizlemesi (defter.js'in içe aktarma ayrıştırıcısıyla)
function decisionPatterns(key) {
  const out = [];
  let root;
  try { root = fs.realpathSync(key); } catch { return out; }
  for (const d of DECISION_DIRS) {
    const abs = path.join(root, d);
    let real;
    try { real = fs.realpathSync(abs); } catch { continue; }
    if (!real.startsWith(root + path.sep) || !isDir(real)) continue;
    const pattern = d + '/*.md';
    const rows = defter.previewImport(key, [pattern]);
    if (!rows.length) continue;
    out.push({
      pattern, count: rows.length, open: rows.filter((r) => r.status === 'open').length,
      sample: rows.slice(0, SAMPLE).map((r) => ({ id: r.id, type: r.type, text: r.text, status: r.status })),
    });
  }
  return out;
}

const sessionRow = (s) => ({
  sessionId: s.sessionId, title: String(s.customTitle || s.summary || s.firstPrompt || '').slice(0, 160),
  at: s.lastModified || 0, size: s.fileSize || 0, cwd: s.cwd || '',
});

// "Projeyi Octopus'a al" penceresinin bilgisi (yalnız okur)
async function survey(accountId, cwd) {
  const project = projectOf(cwd);
  if (!project) return { ok: false, error: 'Klasör bulunamadı.' };
  const rec = octopus.forProject(accountId, project.key);
  if (rec) return { ok: true, project, octopusId: rec.id };
  const r = await opts.listSessions(accountId, project.key);
  if (!r?.ok) return { ok: false, error: 'Geçmiş oturumlar okunamadı: ' + (r?.error || 'bilinmiyor') };
  const sessions = r.sessions.filter((s) => isUuid(s.sessionId)).map(sessionRow).sort((a, b) => b.at - a.at);
  return { ok: true, project, octopusId: null, sessions, memory: recordFiles(accountId, project.key), imports: decisionPatterns(project.key) };
}

// Ahtapotu kurar: baş seçilen geçmiş oturum. Kayıt dışında hiçbir şey yazılmaz.
async function importProject(accountId, { cwd, sessionId, memory, imports }) {
  const project = projectOf(cwd);
  if (!project) throw new Error('Klasör bulunamadı.');
  if (octopus.forProject(accountId, project.key)) throw new Error('Bu projenin zaten bir ahtapotu var; kenar çubuğundaki "Ahtapotlar" listesinden açın.');
  if (!isUuid(sessionId)) throw new Error('Beyin olacak oturum seçilmedi.');
  const r = await opts.listSessions(accountId, project.key);
  const s = r?.ok && r.sessions.find((x) => x.sessionId === sessionId);
  if (!s) throw new Error('Seçilen oturum bu projenin geçmişinde bulunamadı.');
  const list = (Array.isArray(imports) ? imports : []).map((p) => defter.cleanPattern(p)).filter(Boolean);
  if (list.length !== (imports || []).length) throw new Error('Geçersiz içe aktarma deseni.');
  // Baş "Devam et" ile oturumun kendi klasöründe açılır (Claude Code kaydı o klasörün adıyla arar)
  const headCwd = s.cwd && isDir(s.cwd) ? s.cwd : project.cwd;
  const rec = octopus.create({
    accountId, project: { ...project, cwd: headCwd }, sessionId, reason: 'adopted',
    settings: { memory: memory !== false, ...(list.length ? { import: [...new Set(list)].slice(0, 10) } : {}) },
  });
  return { ok: true, id: rec.id };
}

// Ahtapotun ayarları (ayarlar sayfası): kol sınırı 1–8, hafıza açık/kapalı. Hafıza kapanınca proje dizinden düşer (arşiv kalır).
async function setOctopus(octoId, patch = {}) {
  const rec = octopus.get(octoId);
  if (!rec) throw new Error('Ahtapot bulunamadı.');
  const next = {};
  if ('maxArms' in patch) {
    const n = Math.round(+patch.maxArms);
    if (!(n >= 1 && n <= MAX_ARMS)) throw new Error(`Kol sınırı 1 ile ${MAX_ARMS} arasında olmalı.`);
    next.maxArms = n;
  }
  if ('memory' in patch) next.memory = !!patch.memory;
  octopus.setSettings(octoId, next);
  if ('memory' in next) await hafiza.refreshCoverage(rec.accountId, rec.project.key);
  return { ok: true, settings: octopus.get(octoId).settings };
}

// Ahtapotu olmayan ama hafızaya alınan projeler (config.json → memoryProjects, K5)
async function addMemoryProject(accountId, cwd) {
  const project = projectOf(cwd);
  if (!project) throw new Error('Klasör bulunamadı.');
  const cfg = opts.getConfig();
  if (!cfg.accounts.some((a) => a.id === accountId)) throw new Error('Hesap bulunamadı.');
  const list = (cfg.memoryProjects || []).filter((p) => !(p.accountId === accountId && p.key === project.key));
  list.push({ accountId, key: project.key });
  cfg.memoryProjects = list;
  opts.saveConfig(cfg);
  hafiza.scanSoon(500);
  return { ok: true, key: project.key };
}

async function removeMemoryProject(accountId, key) {
  const cfg = opts.getConfig();
  cfg.memoryProjects = (cfg.memoryProjects || []).filter((p) => !(p.accountId === accountId && p.key === key));
  opts.saveConfig(cfg);
  await hafiza.refreshCoverage(accountId, key);
  return { ok: true };
}

const wrap = (fn) => async (_e, ...args) => {
  try { return await fn(...args); } catch (err) { return { ok: false, error: err?.message || String(err) }; }
};

function setup(o) {
  opts = o;
  ipcMain.handle('octopus:survey', wrap(survey));
  ipcMain.handle('octopus:import', wrap(importProject));
  ipcMain.handle('octopus:settings', wrap(setOctopus));
  ipcMain.handle('memory:add', wrap(addMemoryProject));
  ipcMain.handle('memory:remove', wrap(removeMemoryProject));
}

module.exports = { setup, survey, importProject, DECISION_DIRS };
