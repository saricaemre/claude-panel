// Skill'ler: yazma alanındaki "Skill'ler" düğmesinin ve "Skill'leri yönet" penceresinin ana süreç tarafı.
//
// Liste, mesaj göndermeyen kısa ömürlü bir Claude Code sürecinden gelir (0 token, ~0,5 sn): initializationResult().commands
// ad, açıklama ve takma adları, getContextUsage().skills kaynakları (userSettings, projectSettings, syncedSkills, plugin, built-in) verir.
// Kapalı skill'ler de görünsün diye bu sürece dosyalardaki bütün skillOverrides anahtarları 'on' olarak --settings ile verilir;
// kancalar kapalı, MCP sunucusu açılmaz.
//
// Açıp kapama Claude Code'un kendi ayarıdır: settings.json → skillOverrides { <anahtar>: on | name-only | user-invocable-only | off }
// (yok = on). Panel hesabın genel settings.json'una yazar (symlink ise hedefine, eklentiler gibi); klasörün .claude/settings(.local).json'u
// aynı anahtarı belirliyorsa o kazanır, değiştirilemez gösterilir. Claude Code'un /skills menüsü .claude/settings.local.json'a yazar.
// Gerçek Claude Code 2.1.300'de ölçüldü (2026-10-20, girişsiz geçici ayar klasörü):
//  - Anahtar skill'in klasör adıdır: frontmatter adı farklıysa (ogilvy/ → ogilvy-copywriting) yalnız klasör adı işler; o ad SlashCommand.aliases'ta.
//    Yerleşik skill'de adı, eski komutta (commands/x.md) dosya adı. claude.ai skill'inde Claude Code önce iç adla, sonra niteliksiz adla arar.
//  - Eklenti skill'leri skillOverrides'ı yok sayar (Claude Code kodunda source plugin → hep açık); eklentiyle birlikte açılıp kapanır.
//  - Açık oturum ayar dosyasını izler: değişiklik commands_changed ile kendiliğinden uygulanır (symlink'li dosyada da).
const { ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const MODES = ['on', 'name-only', 'user-invocable-only', 'off'];
const SOURCES = { userSettings: 'user', projectSettings: 'project', syncedSkills: 'claudeai', plugin: 'plugin', 'built-in': 'builtin' };
const ORDER = ['user', 'project', 'claudeai', 'plugin', 'builtin'];
const SUFFIX = /\s*\((user|project|local|claude\.ai sync|managed|policy)\)$/; // Claude Code açıklamanın sonuna kaynağı ekler
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROBE_TTL = 30000;

let deps = null;
const cache = new Map(); // `${hesap}\0${klasör}` -> { at, data }

function setup(d) {
  deps = d;
  ipcMain.handle('skills:list', (_e, accountId, cwd, force) => wrap(() => list(accountId, cwd, force)));
  ipcMain.handle('skills:set', (_e, accountId, skill, mode) => wrap(() => setMode(accountId, skill, mode)));
  ipcMain.handle('skills:create', (_e, accountId, name, description) => wrap(() => create(accountId, name, description)));
  // Açık sohbetin komut listesi (yazma alanındaki "/" önerileri açıklamalarıyla): SDK commands_changed'i izler
  ipcMain.handle('chat:commands', async (_e, chatId) => {
    const c = deps.getChat(chatId);
    if (!c) return [];
    const list = await deps.withTimeout(c.q.supportedCommands(), 10000).catch(() => null);
    return Array.isArray(list) ? list.map(cleanCommand) : [];
  });
}

const wrap = async (fn) => {
  try { return { ok: true, ...(await fn()) }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
};

const ORIGINS = { user: 'user', project: 'project', 'claude.ai sync': 'claudeai' };
const cleanCommand = (c) => ({
  name: String(c.name || ''), description: String(c.description || '').replace(SUFFIX, ''),
  origin: ORIGINS[(String(c.description || '').match(SUFFIX) || [])[1]] || null,
  argumentHint: String(c.argumentHint || ''), aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [], builtin: !!c.builtin,
});

const configHome = (account) => deps.expandHome(account.configDir) || path.join(os.homedir(), '.claude');
const userSettings = (account) => deps.realFile(path.join(configHome(account), 'settings.json'));
const overridesOf = (f) => {
  const v = deps.readJson(f)?.skillOverrides;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};

function account(accountId) {
  const a = deps.getAccount(accountId);
  if (!a) throw new Error('Hesap bulunamadı: ' + accountId);
  return a;
}

// Ayar katmanları: genel (panel buraya yazar), proje ve yerel (klasörün .claude/ dosyaları; varsa onlar kazanır)
function layers(a, dir) {
  const file = userSettings(a);
  const key = deps.projectKey(dir);
  // Proje klasörü ev klasörüyse .claude/settings.json genel ayarın kendisidir; proje ayarı sayılmaz (eklentilerdeki gibi)
  const scoped = (f) => (deps.realFile(f) === file ? {} : overridesOf(f));
  return {
    file, project: key,
    user: overridesOf(file),
    proj: scoped(path.join(key, '.claude', 'settings.json')),
    local: scoped(path.join(key, '.claude', 'settings.local.json')),
  };
}

// Mesaj göndermeyen kısa ömürlü süreç: komutlar ve skill kaynakları
async function probe(accountId, dir, forceOn) {
  const sdk = await deps.loadSdk();
  const env = await deps.accountEnv(accountId);
  const queue = new deps.InputQueue();
  const options = {
    cwd: dir, env, settingSources: ['user', 'project', 'local'], persistSession: false,
    strictMcpConfig: true, mcpServers: {}, settings: { disableAllHooks: true, skillOverrides: forceOn }, stderr: () => {},
  };
  if (process.env.CLAUDE_PANEL_CLAUDE_BIN) options.pathToClaudeCodeExecutable = process.env.CLAUDE_PANEL_CLAUDE_BIN;
  const q = sdk.query({ prompt: queue, options });
  (async () => { try { for await (const _ of q); } catch {} })(); // akışı boşalt
  try {
    const init = await deps.withTimeout(q.initializationResult(), 30000);
    const ctx = await deps.withTimeout(q.getContextUsage(), 15000).catch(() => null);
    return { commands: (init?.commands || []).map(cleanCommand), frontmatter: ctx?.skills?.skillFrontmatter || [] };
  } finally {
    try { queue.close(); } catch {}
    try { q.close(); } catch {}
  }
}

// Kişisel ya da proje skill'inin dosyası ve anahtarı (klasör adı): adı ve takma adları diskte aranır
function locate(a, dir, source, names) {
  const roots = [];
  if (source === 'user') roots.push(configHome(a));
  else {
    // Claude Code proje skill'lerini klasörden yukarı doğru .claude/ klasörlerinde arar
    const home = os.homedir();
    for (let d = path.resolve(dir); ; d = path.dirname(d)) {
      roots.push(path.join(d, '.claude'));
      if (d === home || d === path.dirname(d)) break;
    }
  }
  for (const root of roots) {
    for (const n of names) {
      if (!n || n.includes(':') || n.includes('/')) continue;
      const skill = path.join(root, 'skills', n, 'SKILL.md');
      if (fs.existsSync(skill)) return { key: n, path: skill };
      const cmd = path.join(root, 'commands', n + '.md');
      if (fs.existsSync(cmd)) return { key: n, path: cmd };
    }
  }
  return null;
}

async function list(accountId, cwd, force) {
  const a = account(accountId);
  const dir = deps.expandHome(cwd) || os.homedir();
  if (!fs.existsSync(dir)) throw new Error('Klasör yok: ' + dir);
  const L = layers(a, dir);
  const id = `${accountId}\0${dir}`;
  let hit = cache.get(id);
  if (force || !hit || Date.now() - hit.at > PROBE_TTL) {
    const forceOn = Object.fromEntries([L.user, L.proj, L.local].flatMap((o) => Object.keys(o)).map((k) => [k, 'on']));
    hit = { at: Date.now(), data: await probe(accountId, dir, forceOn) };
    cache.set(id, hit);
  }
  const { commands, frontmatter } = hit.data;
  const fm = new Map(frontmatter.map((s) => [s.name, SOURCES[s.source] || 'user']));
  const skills = [];
  for (const c of commands) {
    const fromFm = fm.get(c.name);
    if (c.builtin && fromFm !== 'builtin') continue; // /compact, /model gibi yerleşik komutlar skill değil
    // Model listesinde olmayan (yazarı yalnız kullanıcıya açmış) skill'in kaynağı açıklamanın sonundaki etiketten
    const source = fromFm || (c.builtin ? 'builtin' : c.origin || (c.name.includes(':') ? 'plugin' : 'user'));
    const names = [...new Set([c.name, ...c.aliases])];
    let key = c.name;
    let file = null;
    if (source === 'user' || source === 'project') {
      const found = locate(a, dir, source, [...c.aliases.filter((x) => !x.includes(':')), c.name]);
      key = found?.key || c.aliases.find((x) => !x.includes(':')) || c.name;
      file = found?.path || null;
    }
    // Claude Code kişisel/proje skill'inde yalnız klasör adına, öbürlerinde iç ada ve niteliksiz ada bakar
    const lookup = source === 'user' || source === 'project' ? [key] : [...new Set([key, ...names])];
    const pick = (o) => lookup.map((n) => o[n]).find((v) => MODES.includes(v));
    const lock = source === 'plugin' ? 'plugin' : pick(L.local) ? 'local' : pick(L.proj) ? 'project' : null;
    const mode = source === 'plugin' ? 'on' : pick(L.local) || pick(L.proj) || pick(L.user) || 'on';
    skills.push({
      name: c.name, key, names: lookup, description: c.description, argumentHint: c.argumentHint, source, mode, lock, path: file,
      // Yazarı "disable-model-invocation" demiş: Claude kendiliğinden kullanamaz, model listesine hiç girmez
      userOnly: !fromFm && source !== 'plugin',
    });
  }
  skills.sort((x, y) => ORDER.indexOf(x.source) - ORDER.indexOf(y.source) || x.name.localeCompare(y.name, 'tr'));
  return { skills, file: L.file, shared: L.file !== path.join(configHome(a), 'settings.json'), project: L.project };
}

// Genel settings.json'a yazar; skill'in öbür adlarıyla duran eski kayıtlar silinir (Claude Code önce iç adla arar, eskisi kazanmasın)
function setMode(accountId, skill, mode) {
  const a = account(accountId);
  if (!MODES.includes(mode)) throw new Error('Geçersiz durum: ' + mode);
  const key = String(skill?.key || '');
  if (!/^[\w.:@-]{1,128}$/.test(key)) throw new Error('Geçersiz skill adı');
  const names = [key, ...(Array.isArray(skill.names) ? skill.names : [])].map(String).filter((n) => /^[\w.:@-]{1,128}$/.test(n));
  const file = userSettings(a);
  const s = deps.readJsonForWrite(file);
  const o = { ...(s.skillOverrides && typeof s.skillOverrides === 'object' ? s.skillOverrides : {}) };
  for (const n of names) delete o[n];
  if (mode !== 'on') o[key] = mode;
  if (Object.keys(o).length) s.skillOverrides = o; else delete s.skillOverrides;
  deps.writeJsonAtomic(file, s);
  return { mode, file };
}

// Yeni kişisel skill: <ayar klasörü>/skills/<ad>/SKILL.md (Claude Code'un beklediği biçim). Var olanın üzerine yazılmaz.
function create(accountId, name, description) {
  const a = account(accountId);
  name = String(name || '').trim();
  if (!NAME_RE.test(name)) throw new Error('Ad küçük harf, rakam ve tire olmalı (ör. haftalik-rapor)');
  const dir = path.join(configHome(a), 'skills', name);
  if (fs.existsSync(dir)) throw new Error(`"${name}" adında bir skill zaten var`);
  const desc = String(description || '').replace(/\s+/g, ' ').trim()
    || 'Bu skill ne işe yarar ve Claude onu ne zaman kullanmalı? Buraya bir iki cümleyle yazın.';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n# ${name}\n\nClaude bu skill'i kullanırken izleyeceği adımlar:\n\n1. \n`, { flag: 'wx' });
  for (const k of cache.keys()) if (k.startsWith(accountId + '\0')) cache.delete(k);
  return { path: file, name };
}

module.exports = { setup, MODES };
