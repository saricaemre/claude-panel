/* Claude Panel — sohbet görünümü (Claude Code, terminalsiz; Claude uygulaması düzeninde) */

const chatsById = new Map(); // chatId -> tab

const MODES = [
  { value: 'default', label: 'Her şeyi sor' },
  { value: 'acceptEdits', label: 'Düzenlemeleri kabul et' },
  { value: 'auto', label: 'Otomatik' },
  { value: 'plan', label: 'Plan' },
  { value: 'bypassPermissions', label: 'Tam yetki' },
];
const EFFORTS = [
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
  { value: 'xhigh', label: 'Çok yüksek' },
  { value: 'max', label: 'Maksimum' },
];

const TOOL_NAMES = {
  Read: 'Okundu', Edit: 'Düzenlendi', MultiEdit: 'Düzenlendi', Write: 'Yazıldı', Bash: 'Komut',
  Grep: 'Arandı', Glob: 'Dosya bulundu', WebFetch: 'Web sayfası', WebSearch: 'Web araması',
  Task: 'Alt ajan', Agent: 'Alt ajan', TodoWrite: 'Görevler', Skill: 'Skill', NotebookEdit: 'Not defteri',
  ExitPlanMode: 'Plan', AskUserQuestion: 'Soru', BashOutput: 'Komut çıktısı', KillShell: 'Komut durduruldu',
};
const TOOL_ICONS = {
  Read: 'file', Edit: 'pencil', MultiEdit: 'pencil', Write: 'file', Bash: 'terminal', Grep: 'search', Glob: 'folder',
  WebFetch: 'globe', WebSearch: 'search', Task: 'sparkle', Agent: 'sparkle', TodoWrite: 'check', Skill: 'layers',
  NotebookEdit: 'file', AskUserQuestion: 'chat', ExitPlanMode: 'layers', mcp__panel__publish_artifact: 'artifacts',
  mcp__panel__simulator: 'phone', mcp__panel__browser: 'globe', mcp__panel__terminal: 'terminal', mcp__panel__show: 'panel', mcp__panel__show_widget: 'sparkle', mcp__panel__sessions: 'layers', mcp__panel__wrap_up: 'check',
  mcp__panel__open: 'external', mcp__panel__pr: 'code', mcp__panel__defter: 'book',
};
const PUBLISH_TOOL = 'mcp__panel__publish_artifact';
const SIM_TOOL = 'mcp__panel__simulator';
const BROWSER_TOOL = 'mcp__panel__browser';
const TERMINAL_TOOL = 'mcp__panel__terminal';
const TERMINAL_ACTIONS = { list: 'sekmeler', read: 'okuma', run: 'komut', stop: 'durdurma (Ctrl-C)' };
const SHOW_TOOL = 'mcp__panel__show';
const BROWSER_ACTIONS = {
  navigate: 'gezinme', screenshot: 'ekran görüntüsü', read_page: 'sayfa ağacı', find: 'arama', get_text: 'sayfa metni', click: 'tıklama',
  type: 'yazı', key: 'tuş', scroll: 'kaydırma', hover: 'imleç', form_input: 'form', wait: 'bekleme', console: 'konsol', network: 'ağ',
  eval: 'JavaScript', resize: 'görünüm',
};
const SIM_ACTIONS = {
  list: 'cihazlar', attach: 'açıldı', launch: 'uygulama başlatıldı', screenshot: 'ekran görüntüsü', tap: 'dokunma', swipe: 'kaydırma',
  touch_path: 'hareket', touch2_path: 'iki parmak', rotate: 'döndürme', text: 'yazı', button: 'düğme', open_url: 'adres açıldı', describe_ui: 'arayüz ağacı', detach: 'bağlantı kesildi',
};
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
// MCP araçlarında kod taşıyan alanlar (Blender execute_blender_code, Figma figma_execute…) kod bloğu olarak çizilir
const MCP_CODE_KEYS = ['code', 'script', 'python', 'javascript', 'js', 'sql'];
const MCP_LANGS = [[/blender/i, 'python'], [/figma|pencil|^panel$/i, 'javascript'], [/unity/i, 'csharp']];
function mcpCodeField(name, input) {
  if (!name.startsWith('mcp__') || name === PUBLISH_TOOL || !input) return null;
  const key = MCP_CODE_KEYS.find((k) => typeof input[k] === 'string' && input[k].trim());
  if (!key) return null;
  const server = name.split('__')[1] || '';
  const lang = { python: 'python', javascript: 'javascript', js: 'javascript', sql: 'sql' }[key]
    || (MCP_LANGS.find(([re]) => re.test(server)) || [])[1] || '';
  return { key, lang, code: input[key] };
}
// Grup özeti için kategoriler: [tekil/çoğul ifade]
function toolCategory(name) {
  if (name === 'Bash' || name === 'BashOutput') return 'bash';
  if (name === 'Read') return 'read';
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name)) return 'edit';
  if (name === 'Grep' || name === 'Glob') return 'search';
  if (name === 'TodoWrite') return 'todo';
  if (name === 'Task' || name === 'Agent') return 'agent';
  if (name === 'WebFetch' || name === 'WebSearch') return 'web';
  if (name === 'mcp__panel__publish_artifact') return 'artifact';
  if (name === SIM_TOOL) return 'sim';
  if (name === BROWSER_TOOL) return 'browser';
  if (name === TERMINAL_TOOL) return 'terminal';
  if (name === 'mcp__panel__show_widget') return 'widget';
  if (name === 'mcp__panel__sessions') return 'session';
  if (name === 'mcp__panel__wrap_up') return 'wrap';
  if (name === 'mcp__panel__open') return 'open';
  if (name === 'mcp__panel__pr') return 'pr';
  if (name === 'mcp__panel__defter') return 'defter';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}
const CATEGORY_TEXT = {
  bash: (n) => `${n} komut çalıştırıldı`,
  read: (n) => `${n} dosya okundu`,
  edit: (n) => `${n} dosya düzenlendi`,
  search: (n) => `${n} arama yapıldı`,
  todo: () => 'görevler güncellendi',
  agent: (n) => `${n} alt ajan çalıştı`,
  web: (n) => `${n} web isteği`,
  mcp: (n) => `${n} MCP aracı`,
  artifact: (n) => (n > 1 ? `${n} artifact yayımlandı` : 'artifact yayımlandı'),
  sim: (n) => `${n} simülatör işlemi`,
  browser: (n) => `${n} tarayıcı işlemi`,
  terminal: (n) => `${n} terminal işlemi`,
  widget: (n) => (n > 1 ? `${n} görsel gösterildi` : 'görsel gösterildi'),
  session: (n) => `${n} yan oturum işlemi`,
  wrap: () => 'özet',
  open: (n) => (n > 1 ? `${n} dosya açıldı` : 'dosya açıldı'),
  pr: (n) => `${n} PR işlemi`,
  defter: (n) => (n > 1 ? `defterde ${n} işlem` : 'defter'),
  other: (n) => `${n} araç`,
};

// ---------- Markdown ----------

// Claude'un yanıtındaki ham HTML: form ve düğme pencereyi dış siteye götürebilir, stil izin kartlarını örtebilir.
// input kalır (GFM görev listesi kutucukları); form olmadan bir yere gönderemez.
// Panelin kendi sınıfları ve id'leri de atılır (sahte izin kartı, ekranı örten katman); yalnız kod dili (language-*) kalır.
const PURIFY = {
  FORBID_TAGS: ['form', 'button', 'style', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'action', 'formaction', 'id'],
};
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName !== 'class') return;
  data.attrValue = data.attrValue.split(/\s+/).filter((c) => /^language-[\w-]+$/.test(c)).join(' ');
  if (!data.attrValue) data.keepAttr = false;
});

function md(text) {
  let html;
  try {
    html = DOMPurify.sanitize(marked.parse(text || '', { breaks: false, gfm: true }), PURIFY);
  } catch {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }
  return html;
}

function mdInto(el, text) {
  el.innerHTML = md(text);
  for (const pre of el.querySelectorAll('pre')) wrapCodeBlock(pre);
  return el;
}

// Kod bloklarına dil etiketi, Artifact ve Kopyala düğmeleri
function wrapCodeBlock(pre) {
  if (pre.parentElement?.classList.contains('codeblock')) return pre.parentElement;
  const code = pre.querySelector('code');
  const lang = (code?.className.match(/language-([\w-]+)/) || [])[1] || '';
  const copy = h('button', { class: 'code-copy', title: 'Kopyala', onclick: () => {
    navigator.clipboard.writeText(code ? code.textContent : pre.textContent);
    copy.textContent = 'Kopyalandı';
    setTimeout(() => (copy.textContent = 'Kopyala'), 1200);
  } }, 'Kopyala');
  const save = h('button', { class: 'code-copy', title: 'Artifacts\'e kaydet', onclick: () => {
    const tab = save.closest('.chat-host')?.__tab;
    saveCodeAsArtifact(tab, code ? code.textContent : pre.textContent, lang);
  } }, icon('artifacts', 13), 'Artifact');
  const wrap = h('div', { class: 'codeblock' }, h('div', { class: 'code-head' }, h('span', {}, lang || 'kod'), h('span', { class: 'spacer' }), save, copy));
  if (pre.parentNode) pre.replaceWith(wrap);
  wrap.append(pre);
  return wrap;
}

function relPath(tab, p) {
  if (!p || typeof p !== 'string') return '';
  if (tab.cwd && p.startsWith(tab.cwd + '/')) return p.slice(tab.cwd.length + 1);
  return tilde(p);
}

// Yan oturumun klasörü sohbetin klasörünün dışındaysa özette görünür (P9.2); göreli yol ve ~ sohbetin klasörüne göre çözülür
function outsideDir(tab, cwd) {
  let p = String(cwd || '').trim();
  if (!p || !tab.cwd) return '';
  const home = state.info.home;
  if (home && (p === '~' || p.startsWith('~/'))) p = home + p.slice(1);
  if (!p.startsWith('/')) p = tab.cwd + '/' + p;
  const parts = [];
  for (const s of p.split('/')) if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s);
  p = '/' + parts.join('/');
  return p === tab.cwd || p.startsWith(tab.cwd + '/') ? '' : 'klasör ' + tilde(p);
}

function toolLabel(name) {
  if (name === PUBLISH_TOOL) return 'Artifact yayımlandı';
  if (name === SIM_TOOL) return 'Simülatör';
  if (name === BROWSER_TOOL) return 'Tarayıcı';
  if (name === TERMINAL_TOOL) return 'Terminal';
  if (name === SHOW_TOOL) return 'Gösterildi';
  if (name === 'mcp__panel__show_widget') return 'Görsel';
  if (name === 'mcp__panel__sessions') return 'Yan oturum';
  if (name === 'mcp__panel__wrap_up') return 'Özet';
  if (name === 'mcp__panel__open') return 'Açıldı';
  if (name === 'mcp__panel__pr') return 'PR';
  if (name === 'mcp__panel__defter') return 'Defter';
  if (name === 'mcp__panel__danis') return 'Danışma';
  if (name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    return `${server} · ${rest.join('__')}`;
  }
  return TOOL_NAMES[name] || name;
}

function toolSummary(tab, name, input = {}) {
  switch (name) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit':
      return relPath(tab, input.file_path || input.notebook_path);
    case 'Bash': return input.description || (input.command || '').split('\n')[0];
    case 'Grep': return `${input.pattern || ''}${input.path ? ' · ' + relPath(tab, input.path) : ''}`;
    case 'Glob': return input.pattern || '';
    case 'WebFetch': return input.url || '';
    case 'WebSearch': return input.query || '';
    case 'Task': case 'Agent': return input.description || input.subagent_type || '';
    case 'Skill': return input.skill || input.command || '';
    case PUBLISH_TOOL: return input.title || relPath(tab, input.file_path) || '';
    case SIM_TOOL: {
      const where = input.x != null ? ` (${input.x}, ${input.y})${input.x2 != null ? ` → (${input.x2}, ${input.y2})` : ''}` : '';
      const extra = input.device || input.name || input.text || input.orientation || input.url || (input.app_path ? relPath(tab, input.app_path) : '') || input.bundle_id || '';
      return (SIM_ACTIONS[input.action] || input.action || '') + where + (extra ? ' · ' + extra : '');
    }
    case BROWSER_TOOL: {
      const where = input.ref || (input.x != null ? `(${input.x}, ${input.y})` : '');
      const extra = input.url || input.query || input.text || (input.value != null ? String(input.value) : '') || input.preset || input.code?.split('\n')[0] || '';
      return [BROWSER_ACTIONS[input.action] || input.action || '', where, extra].filter(Boolean).join(' · ').slice(0, 200);
    }
    case TERMINAL_TOOL:
      return [TERMINAL_ACTIONS[input.action] || input.action || '', input.tab_id != null ? 'sekme ' + input.tab_id : '', input.command || ''].filter(Boolean).join(' · ');
    case 'mcp__panel__wrap_up':
      return String(input.recap || '').slice(0, 120);
    case 'mcp__panel__sessions':
      return [{ start: 'başlat', list: 'liste', send: 'mesaj', read: 'okuma' }[input.action] || input.action || '', input.title || (input.id != null ? 'oturum ' + input.id : ''),
        input.action === 'start' ? outsideDir(tab, input.cwd) : '',
        input.action === 'start' ? [input.model, input.effort && (effortLabel(input.effort) || input.effort).toLocaleLowerCase('tr') + ' efor'].filter(Boolean).join(', ') : '',
        input.message || ''].filter(Boolean).join(' · ').slice(0, 200);
    case 'mcp__panel__open':
      return `${input.action === 'reveal' ? 'Finder' : 'editör'} · ${relPath(tab, input.path)}${input.line ? ':' + input.line : ''}`;
    case 'mcp__panel__defter':
      return [DF_OPS[input.islem] || input.islem || '', input.id || '', input.tur ? DF_TYPES[input.tur] || input.tur : '', input.metin || ''].filter(Boolean).join(' · ').slice(0, 200);
    case 'mcp__panel__danis': {
      const k = input.kaynak || {};
      const from = k.kol ? 'kol ' + k.kol : [k.oturum ? String(k.oturum).slice(0, 8) : '', k.an || ''].filter(Boolean).join(' · ');
      return [from, input.soru || ''].filter(Boolean).join(' · ').slice(0, 200);
    }
    case 'mcp__panel__pr':
      return [{ status: 'durum', watch: input.autofix ? 'izle · otomatik düzeltme' : 'izle', unwatch: 'izlemeyi bırak' }[input.action] || input.action || '', input.number ? '#' + input.number : ''].filter(Boolean).join(' · ');
    case SHOW_TOOL:
      return input.action === 'file' ? `${relPath(tab, input.path)}${input.line ? ':' + input.line : ''}` : 'değişiklikler' + (input.path ? ' · ' + relPath(tab, input.path) : '');
    case 'TodoWrite': {
      const t = input.todos || [];
      return `${t.filter((x) => x.status === 'completed').length}/${t.length}`;
    }
    default: {
      const cf = mcpCodeField(name, input);
      if (cf) return cf.code.split('\n').map((l) => l.trim()).find((l) => l && !/^(#|\/\/|import\s|from\s\S+\s+import\s|const\s+\w+\s*=\s*require\()/.test(l)) || cf.code.trim().split('\n')[0];
      const first = Object.values(input).find((v) => typeof v === 'string');
      return first ? first.slice(0, 120) : '';
    }
  }
}

function pre(text, cls = '') {
  const t = String(text ?? '');
  const LIMIT = 6000;
  const el = h('pre', { class: 'tool-pre ' + cls }, t.length > LIMIT ? t.slice(0, LIMIT) : t);
  if (t.length > LIMIT) {
    const more = h('button', { class: 'mini', onclick: () => { el.textContent = t; more.remove(); } },
      `Tamamını göster (${Math.round(t.length / 1000)} bin karakter)`);
    return h('div', {}, el, more);
  }
  return el;
}

function diffView(oldStr, newStr) {
  const box = h('div', { class: 'diff' });
  if (oldStr) for (const l of String(oldStr).split('\n')) box.append(h('div', { class: 'diff-del' }, '− ' + l));
  for (const l of String(newStr ?? '').split('\n')) box.append(h('div', { class: 'diff-add' }, '+ ' + l));
  return box;
}

function todoList(todos) {
  return h('ul', { class: 'todos' }, (todos || []).map((t) =>
    h('li', { class: 'todo ' + t.status },
      h('span', { class: 'todo-box' }, t.status === 'completed' ? '✓' : ''),
      h('span', {}, t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content))));
}

function toolInputView(tab, name, input = {}) {
  switch (name) {
    case 'Bash': return pre('$ ' + (input.command || ''), 'cmd');
    case 'Edit': return diffView(input.old_string, input.new_string);
    case 'MultiEdit': return h('div', {}, (input.edits || []).map((e) => diffView(e.old_string, e.new_string)));
    case 'Write': return diffView('', String(input.content || '').split('\n').slice(0, 60).join('\n'));
    case 'Read': return null;
    case 'TodoWrite': return todoList(input.todos);
    case 'Task': case 'Agent': return input.prompt ? mdInto(h('div', { class: 'md small-md' }), input.prompt) : null;
    default: {
      const cf = mcpCodeField(name, input);
      if (cf) {
        const { [cf.key]: _code, ...rest } = input;
        const block = wrapCodeBlock(h('pre', {}, h('code', { class: cf.lang ? 'language-' + cf.lang : '' }, cf.code)));
        return h('div', { class: 'mcp-input' }, block, Object.keys(rest).length ? pre(JSON.stringify(rest, null, 2)) : null);
      }
      return Object.keys(input).length ? pre(JSON.stringify(input, null, 2)) : null;
    }
  }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b.type === 'text' ? b.text : '')).filter(Boolean).join('\n');
  }
  return content == null ? '' : JSON.stringify(content, null, 2);
}

// Araç sonucundaki görseller: API biçimi { source: { media_type, data } } ya da ham MCP biçimi { mimeType, data }
function resultImages(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b?.type === 'image').map((b) => {
    const type = b.source?.media_type || b.mimeType || 'image/png';
    const data = b.source?.data || b.data;
    return /^image\/[\w.+-]+$/.test(type) && typeof data === 'string' ? `data:${type};base64,${data}` : null;
  }).filter(Boolean);
}

function selectEl(cls, title, options, onchange) {
  return h('select', { class: cls, title, onchange: (e) => onchange(e.target.value) },
    options.map((o) => h('option', { value: o.value }, o.label)));
}

// ---------- Sekme oluşturma ----------

// Oturumun açık sohbet sekmesi, bütün hesaplarda. Hesaplar projects klasörünü paylaşabildiği için (ayarlari-esitle.sh) aynı oturum
// başka hesabın geçmişinde de görünür; iki sekme iki Claude Code süreci demektir, ikisi aynı kayda yazar (ana süreçte de reddedilir).
// continueOf: "Devam et" (continue) ile açılan sekmenin, ilk session_id gelene kadar sürdürdüğü varsayılan oturum.
function openSessionTab(sessionId) {
  if (!sessionId) return null;
  for (const list of Object.values(state.tabs)) {
    const t = list.find((x) => x.kind === 'chat' && !x.exited && (x.sessionId || x.continueOf) === sessionId);
    if (t) return t;
  }
  return null;
}

// "Devam et": Claude Code klasörün en son oturumunu sürdürür; aynısı listeden bulunur (yalnız okunur)
async function lastSessionOf(acctId, cwd) {
  const r = await window.panel.chatSessions(acctId, cwd);
  if (!r?.ok) return null;
  return r.sessions.filter((s) => !s.cwd || s.cwd === cwd).sort((x, y) => y.lastModified - x.lastModified)[0]?.sessionId || null;
}

// opts.background: yan oturum (sessions.js); hesap, görünüm ve etkin sekme değişmez. opts.parentId: başlatan sohbet
async function createChatTab(acctId, cwd, mode, resumeId, opts = {}) {
  const a = acct(acctId);
  const pane = state.panes[acctId];
  if (!a || !pane) return;
  const bg = !!opts.background;
  // Devam edilen oturum bir sekmede açıksa (hangi hesapta olursa olsun) o sekmeye geçilir
  const continueOf = mode === 'continue' && Object.values(state.tabs).flat().some((t) => t.kind === 'chat' && !t.exited)
    ? await lastSessionOf(acctId, cwd) : null;
  const open = mode === 'resume' ? openSessionTab(resumeId) : openSessionTab(continueOf);
  if (open) {
    if (!bg) {
      showTab(open.acctId, open);
      toast(`Bu oturum ${acct(open.acctId)?.name || open.acctId} hesabında açık.`);
    }
    if (opts.draft) setDraft(open, opts.draft);
    return open;
  }
  if (!bg && (state.active !== acctId || state.view[acctId] !== 'code')) selectAccount(acctId, 'code');

  const prefs = state.cfg.chatPrefs?.[acctId] || {};
  const tab = {
    kind: 'chat', acctId, cwd, mode, title: '…', exited: false, activity: false, attention: false,
    chatId: null, sessionId: resumeId || null, continueOf, busy: false, models: [], model: '', effort: opts.effort ?? prefs.effort ?? '',
    modelChoice: opts.model ?? prefs.model ?? '', permissionMode: prefs.mode || '', envId: opts.envId ?? envOf(acctId)?.id ?? '',
    toolCards: new Map(), live: new Map(), attachments: [], slash: [], pendingPerms: new Map(), denials: new Map(), turnDenials: [],
    group: null, todos: [], started: false, parentId: opts.parentId || null, autoTurns: 0, pendingEvents: [], pr: null,
  };

  const env = environmentsList().find((e) => e.id === tab.envId) || null;
  tab.envName = env?.name || '';

  // --- Üst satır: mesajların üstünde yüzer (hesap ve klasör adı sekmede ve kenar çubuğunda).
  // Bölme düğmeleri yalnız ikon, adları title'da. Solda yalnız hata ve kapanış yazılır (setStatus); "çalışıyor" alttaki canlı göstergede.
  const statusEl = h('span', { class: 'ct-status' });
  const sideBtn = h('button', { class: 'icon-btn side-toggle', onclick: () => setSidePanel(!tab.host.classList.contains('side-open')) }, icon('panel', 16));
  const topBtn = (cls, title, onclick, ...kids) => h('button', { class: 'top-btn icon-only ' + cls, title, 'aria-label': title.replace(/ \(.*\)$/, ''), onclick }, ...kids);
  const top = h('div', { class: 'chat-top' },
    tab.parentId ? h('button', { class: 'top-btn', title: 'Bu yan oturumu başlatan sohbete git', onclick: () => {
      const p = chatsById.get(tab.parentId);
      if (p) activateTab(p.acctId, p); else toast('Başlatan sohbet kapanmış.');
    } }, icon('back', 14), 'Başlatan sohbet') : null,
    statusEl, h('span', { class: 'spacer' }),
    tab.prChip = h('button', { class: 'top-btn pr-chip', hidden: true, onclick: () => prMenu(tab) }),
    // Ahtapotun başında görünür (renderer/octopus.js → refreshOctopusPanes)
    tab.octoBtn = topBtn('octo-toggle', 'Ahtapot: yanda aç/kapat', () => toggleOctopusInChat(tab), icon('octopus', 16)),
    topBtn('changes-toggle', 'Değişiklikler: yanda aç/kapat (⌘⇧D)', () => toggleChangesInChat(tab),
      icon('code', 16), tab.changesBadge = h('span', { class: 'top-badge', hidden: true })),
    // Projede .claude/launch.json varsa görünür (renderer/browser.js → refreshPreview)
    tab.previewBtn = topBtn('preview-toggle', 'Önizleme: launch.json\'daki geliştirme sunucuları', (e) => previewMenu(tab, e.currentTarget), icon('play', 16)),
    topBtn('browser-toggle', 'Tarayıcı: yanda aç/kapat (⌘⇧B)', () => toggleBrowserInChat(tab), icon('globe', 16)),
    topBtn('sim-toggle', 'Simülatör: iOS simülatörünü yanda aç/kapat (⌘⇧S)', () => toggleSimulatorInChat(tab), icon('phone', 16)),
    topBtn('term-open', 'Terminal: bu oturumu terminalde aç', () => openInTerminal(tab), icon('terminal', 16)),
    h('button', { class: 'icon-btn chat-more', title: 'Sohbet menüsü', onclick: (e) => chatMenu(tab, e.currentTarget) }, icon('more', 16)),
    sideBtn);
  tab.octoBtn.hidden = true;
  tab.previewBtn.hidden = true;

  // --- Mesaj listesi ve boş ekran
  const list = h('div', { class: 'chat-list' });
  const welcome = h('div', { class: 'chat-welcome' },
    h('div', { class: 'welcome-mark' }, '✳'),
    h('div', { class: 'welcome-title' }, h('em', {}, tilde(cwd).split('/').pop() || 'Proje'), ' üzerinde ne yapalım?'),
    h('div', { class: 'welcome-sub' }, `${a.name} hesabı · ${tilde(cwd)}`));
  const actEl = activityEl(tab); // çalışırken canlı gösterge (renderer/activity.js)
  const scroller = h('div', { class: 'chat-scroll' }, welcome, list, actEl);

  // --- Yazma alanı
  const input = h('textarea', { class: 'composer-input', rows: 1, placeholder: 'Claude\'a yazın…' });
  const attach = h('div', { class: 'composer-attach' });
  const slashBox = h('div', { class: 'slash-box', hidden: true });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true,
    onchange: (e) => { addAttachments(tab.attachments, attach, [...e.target.files]); e.target.value = ''; } });
  const sendBtn = h('button', { class: 'send-btn', title: 'Gönder (Enter)', onclick: () => submit(tab, true) }, icon('arrowUp', 17));
  const stopBtn = h('button', { class: 'stop-btn', title: 'Durdur (Esc)', hidden: true, onclick: () => interrupt(tab) }, h('span'));
  const modeSel = selectEl('meta-select', 'İzin modu (Shift+Tab)', MODES, (v) => changeMode(tab, v));
  const picker = modelPicker(acctId,
    () => ({ model: tab.modelChoice || '', effort: tab.effort || '', resolved: tab.model, models: tab.models }),
    (patch) => ('model' in patch ? changeModel(tab, patch.model) : changeEffort(tab, patch.effort)));
  // Tek kutu: yazı, altında tek çubuk (yeni sohbet ekranındaki .new-composer gibi). Solda ekler, bağlayıcılar, skill'ler,
  // izin modu ve sohbetin yeri (klasör, ortam, ayrı kopya); sağda bağlam halkası, model/efor, plan kullanımı, gönder
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'composer-inner' },
      slashBox,
      tab.tasksBar = tasksBar(), // arka plandaki görevler (renderer/activity.js)
      tab.planBar = planBar(),
      tab.composerBox = h('div', { class: 'composer-box' },
        tab.commentsEl = h('div', { class: 'composer-comments', hidden: true }), // satır yorumları (renderer/changes.js)
        attach,
        tab.shellChip = shellChip(), // "!" kabuk kipi (renderer/kabuk.js)
        input,
        h('span', { class: 'suggest-hint', title: 'Önerilen istemi al' }, 'Tab'), // önerilen istem (renderer/istem.js)
        h('div', { class: 'composer-bar' },
          h('button', { class: 'plus-btn', title: 'Dosya veya fotoğraf ekle', onclick: () => fileInput.click() }, icon('plus', 17)),
          fileInput,
          connectorsButton(acctId, () => tab.cwd),
          skillsButton(acctId, () => tab.cwd, () => tab.input),
          modeSel,
          h('span', { class: 'cb-place' },
            h('span', { class: 'meta-folder', title: `Klasör: ${tilde(cwd)}` }, icon('folder', 14), h('span', {}, tilde(cwd).split('/').pop() || cwd)),
            env ? h('span', { class: 'meta-folder meta-env', title: `Ortam: ${env.name} (${envSummary(env)})` }, icon('box', 14), h('span', {}, env.name)) : null,
            tab.wtChip = h('span', { class: 'meta-folder meta-wt', hidden: true })),
          h('span', { class: 'spacer' }),
          tab.ctxRing = contextRing(tab), picker, usageButton(acctId),
          stopBtn, sendBtn))));

  // --- Yan panel
  const progressBody = h('div', { class: 'side-body' }, h('div', { class: 'side-empty' }, 'Claude görev listesi oluşturunca burada görünür.'));
  const progressCount = h('span', { class: 'side-count' });
  const contextBody = h('div', { class: 'side-body' }, h('div', { class: 'side-row' }, icon('folder', 14), tilde(cwd)),
    env ? h('div', { class: 'side-row' }, icon('box', 14), `Ortam: ${tab.envName}`) : null);
  const sessionBody = h('div', { class: 'side-body' }, h('div', { class: 'side-empty' }, '—'));
  const side = h('aside', { class: 'chat-side' },
    // İlerleme ve Bağlam her sohbette kapalı başlar, kullanıcı tıklayınca açılır
    // (görev sayısı başlıkta görünür; yarım görevler yazma alanının üstünde de var).
    h('details', { class: 'side-sec side-progress' }, h('summary', {}, 'İlerleme', progressCount), progressBody),
    h('details', { class: 'side-sec side-context' }, h('summary', {}, 'Bağlam'), contextBody),
    h('details', { class: 'side-sec', open: true }, h('summary', {}, 'Oturum'), sessionBody));

  const main = h('div', { class: 'chat-main' }, top, scroller, composer);
  const artPane = h('div', { class: 'chat-art' });
  const simPane = h('div', { class: 'chat-sim' });
  const browserPane = h('div', { class: 'chat-browser' });
  const changesPane = h('div', { class: 'chat-changes' });
  const octoPane = h('div', { class: 'chat-octo' });
  // Yan panel varsayılan kapalı; açık/kapalı son durumu config.json → sidePanelOpen (setSidePanel)
  const host = h('div', { class: 'term-host chat-host' + (bg ? '' : ' active') }, main, artPane, simPane, browserPane, changesPane, octoPane, side);
  host.__tab = tab;
  syncSideBtn(host, sideBtn, !!state.cfg.sidePanelOpen);
  Object.assign(tab, {
    host, list, scroller, actEl, artPane, simPane, browserPane, changesPane, octoPane, welcome, input, attach, slashBox, sendBtn, stopBtn, picker, modeSel,
    statusEl, progressBody, progressCount, contextBody, sessionBody,
  });
  syncSelects(tab);

  pane.termArea.append(host);
  if (!bg) {
    pane.launcher.classList.remove('active');
    for (const t of state.tabs[acctId]) t.host.classList.remove('active');
  }

  wireComposer(tab);
  list.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link) { e.preventDefault(); window.panel.openExternal(link.href); }
  });

  state.tabs[acctId].push(tab);
  if (!bg) state.activeTab[acctId] = tab;
  renderTabs(acctId);
  renderSidebar();
  setStatus(tab, 'busy', 'Başlatılıyor');

  // Devam edilen oturumun geçmişini yükle
  if (mode === 'resume' && resumeId) {
    const r = await window.panel.chatHistory(acctId, resumeId, cwd);
    if (r?.ok && r.messages.length) {
      markStarted(tab);
      for (const m of r.messages) renderHistoryMessage(tab, m);
      endGroup(tab);
      tab.wrapBox = null;
      closeWrapBoxes(tab); // geçmişteki kutular cevaplanmış sayılır
      divider(tab, 'Buradan devam ediliyor');
    }
  }

  if (env?.setup.trim()) setStatus(tab, 'busy', 'Ortam hazırlanıyor');
  const res = await window.panel.chatStart({
    accountId: acctId, cwd, mode, resumeId, envId: tab.envId || undefined,
    model: tab.modelChoice || undefined,
    effort: tab.effort || undefined,
    permissionMode: tab.permissionMode || undefined,
    parentId: tab.parentId || undefined, title: opts.title || undefined, worktree: !!opts.worktree || undefined,
    octopus: opts.octopus || undefined,
  });
  if (!res.ok) {
    setStatus(tab, 'error', 'Başlatılamadı');
    markStarted(tab);
    note(tab, 'Claude Code başlatılamadı: ' + res.error + loginHint(res.error), 'error');
    tab.startError = res.error;
    tab.exited = true;
    renderTabs(acctId);
    return tab;
  }
  tab.chatId = res.id;
  tab.cwd = res.cwd;
  tab.octopusId = res.octopus || null; // ahtapotun başı (renderer/octopus.js)
  tab.title = opts.title || res.title;
  // Ayrı çalışma kopyası: yazma alanının çubuğunda dal adı (worktrees.js)
  if (res.worktree) {
    tab.worktree = res.worktree;
    tab.wtChip.replaceChildren(icon('layers', 14), h('span', {}, res.worktree.branch));
    tab.wtChip.title = `Ayrı çalışma kopyası: ${tilde(res.worktree.path)}\nDal: ${res.worktree.branch}\nSekme kapanınca kopya temizse silinir, değişiklik varsa korunur.`;
    tab.wtChip.hidden = false;
  }
  chatsById.set(res.id, tab);
  tab.browserView?.register(); // sohbet başlamadan açılmış tarayıcı bölmesi
  refreshChanges(tab);
  refreshPreview(tab);
  setStatus(tab, 'idle', '');
  renderTabs(acctId);
  renderSidebar();
  if (!bg) focusCurrent();
  scrollDown(tab, true);
  if (opts.send || opts.attachments?.length) {
    tab.input.value = opts.send || '';
    tab.attachments.push(...(opts.attachments || []));
    submit(tab);
  }
  else if (opts.draft) setDraft(tab, opts.draft);
  return tab;
}

// Üst satırdaki "…" menüsü
function chatMenu(tab, anchor) {
  if (openMenu.anchor === anchor) return closeMenu();
  openMenu(anchor, [octopusMenuItem(tab), memoryMenuItem(tab)]); // renderer/octopus.js, renderer/hafiza.js
}

function setDraft(tab, text) {
  tab.input.value = text;
  tab.autosize?.();
  requestAnimationFrame(() => { tab.input.focus(); tab.input.setSelectionRange(text.length, text.length); });
}

// Yan panel (İlerleme / Bağlam / Oturum) bütün sohbetlerde birlikte açılıp kapanır; son durum yeni sohbetlere ve sonraki açılışa geçer
function syncSideBtn(host, btn, open) {
  host.classList.toggle('side-open', open);
  btn.classList.toggle('on', open);
  btn.title = open ? 'Yan paneli kapat' : 'Yan paneli aç (ilerleme, bağlam, oturum)';
  btn.setAttribute('aria-pressed', String(open));
}
function setSidePanel(open) {
  state.cfg.sidePanelOpen = open;
  for (const t of Object.values(state.tabs).flat()) {
    if (t.kind === 'chat') syncSideBtn(t.host, t.host.querySelector('.side-toggle'), open);
  }
  window.panel.saveConfig({ sidePanelOpen: open }).then((c) => { state.cfg = c; });
}

// ---------- Görünüm yardımcıları ----------

function markStarted(tab) {
  if (tab.started) return;
  tab.started = true;
  tab.welcome.remove();
}
function nearBottom(tab) {
  const s = tab.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
}
function scrollDown(tab, force) {
  if (force || tab.stick !== false) tab.scroller.scrollTop = tab.scroller.scrollHeight;
}
function append(tab, el) {
  const stick = nearBottom(tab);
  const anchor = el.classList?.contains('queued') ? null : tailAnchor(tab, el);
  if (anchor) tab.list.insertBefore(el, anchor);
  else tab.list.append(el);
  if (stick) scrollDown(tab, true);
  return el;
}
// Listenin kuyruğu: iş sürerken görev kartı en altta kalır (renderer/wrapup.js → renderPlanCard), Claude'un henüz almadığı
// mesajlar (sırada) ondan da sonra; alınınca alındıkları yere otururlar (settleQueued)
function tailAnchor(tab, el) {
  const card = tab.planCard;
  if (card && card !== el && card.classList.contains('pinned') && card.parentNode === tab.list) return card;
  return [...tab.list.querySelectorAll(':scope > .msg-user.queued')].find((q) => q !== el) || null;
}
// Sıradaki mesajlar hariç son öğe
function lastSettled(tab) {
  let el = tab.list.lastElementChild;
  while (el?.classList.contains('queued')) el = el.previousElementSibling;
  return el;
}
function note(tab, text, cls = '') {
  return append(tab, h('div', { class: 'chat-note ' + cls }, text));
}
// Açılış hook'unun çıktısı uzun olabilir: tek satırlık, kapalı bir özet; tıklanınca tam metin.
function hookNote(msg, text) {
  const n = text.split('\n').filter((l) => l.trim()).length;
  const label = `${(msg.hook_name || msg.hook_event).split(':')[0]} hook'u çalıştı` + (n > 1 ? ` · ${n} satır` : '');
  return h('details', { class: 'hook-note' }, h('summary', {}, label), h('div', { class: 'hook-body' }, text));
}
function divider(tab, text) {
  endGroup(tab);
  return append(tab, h('div', { class: 'chat-divider' }, h('span', {}, text)));
}
// Sohbetin durumu sekmenin kabında (data-status: busy | idle | error | off). Üst satırda yalnız hata ve kapanış yazılır;
// meşgulken metin (Başlatılıyor, Ortam hazırlanıyor, Yeniden deneniyor, Durduruluyor) alttaki canlı göstergeye gider (renderer/activity.js)
function setStatus(tab, kind, text) {
  tab.host.dataset.status = kind;
  tab.statusEl.className = 'ct-status ' + kind;
  tab.statusEl.textContent = kind === 'error' || kind === 'off' ? text : '';
  if (kind === 'busy' && text) { startActivity(tab); setActivity(tab, text); }
  else if (kind !== 'busy' && !tab.busy) stopActivity(tab);
}
function setBusy(tab, busy) {
  tab.busy = busy;
  if (busy) clearSuggestion(tab); // renderer/istem.js
  if (busy) startActivity(tab); else stopActivity(tab); // renderer/activity.js
  tab.stopBtn.hidden = !busy;
  tab.sendBtn.hidden = busy && !tab.input.value.trim();
  setStatus(tab, busy ? 'busy' : 'idle', '');
  renderTabs(tab.acctId);
}

// uuid: mesajın Claude Code'daki kimliği (canlıda arayüz verir, geçmişte kayıttan gelir); varsa balonda "Geri sar" düğmesi
// queued: Claude çalışırken gitti; alınana kadar (command_lifecycle started) "Sırada", "Geri al" ve "Hemen gönder". draft: yazma
// kutusundaki hâli (metin, ekler, satır yorumları); geri alınınca olduğu gibi döner
function userBubble(tab, content, queued, uuid, draft) {
  const blocks = Array.isArray(content) ? content : [];
  const texts = typeof content === 'string' ? [content] : blocks.filter((b) => b.type === 'text').map((b) => b.text);
  const files = texts.map(parseFileBlock).filter(Boolean);
  const comments = texts.map(parseCommentBlock).filter(Boolean); // satır yorumları (renderer/changes.js)
  const text = texts.filter((t) => !parseFileBlock(t) && !parseCommentBlock(t)).join('\n');
  const imgs = blocks.filter((b) => b.type === 'image');
  // Sistem tarafından eklenen içerikleri (komut çıktıları, hatırlatmalar) gizle
  if (!imgs.length && !files.length && !comments.length && /^\s*<(command-|local-command|system-reminder|bash-)/.test(text)) return null;
  markStarted(tab);
  endGroup(tab);
  queued = queued && !!uuid; // kimliksiz mesajın alındığı bilinmez (command_lifecycle kimliğe bağlı)
  const el = h('div', { class: 'msg-user' + (queued ? ' queued' : ''), 'data-uuid': uuid || null },
    imgs.length ? h('div', { class: 'user-imgs' }, imgs.map((b) => h('img', { src: `data:${b.source?.media_type};base64,${b.source?.data}` }))) : null,
    files.length ? h('div', { class: 'user-files' }, files.map((f) =>
      h('div', { class: 'attach-file', title: f.path || f.name }, fileChipBody(f.name, f.embedded ? 'İçerik eklendi' : 'Yol verildi')))) : null,
    comments.length ? h('div', { class: 'user-comments' }, comments.map((c) => h('div', { class: 'uc-item' },
      h('div', { class: 'uc-loc' }, icon('chat', 12), `${c.file}:${c.lines.replace('-', '–')}${c.old ? ' (silinen)' : ''}`),
      h('div', { class: 'uc-text' }, c.text)))) : null,
    text ? h('div', { class: 'user-text' }, text) : null,
    uuid ? h('button', { class: 'mu-rewind', title: 'Bu mesaja geri sar (kod, konuşma ya da ikisi)', 'aria-label': 'Bu mesaja geri sar',
      onclick: (e) => { e.stopPropagation(); openRewind(tab, el); } }, icon('history', 15)) : null,
    queued ? h('div', { class: 'mu-queue' },
      h('span', { class: 'muq-label' }, 'Sırada'),
      h('button', { class: 'muq-btn muq-withdraw', title: 'Kuyruktan çek; mesaj yazma kutusuna döner',
        onclick: (e) => { e.stopPropagation(); withdrawQueued(tab, el); } }, 'Geri al'),
      h('button', { class: 'muq-btn muq-now', title: 'Claude sonraki adımı beklemeden şimdi okusun (süren komut arka plana alınır, araçsız yanıt kesilir)',
        onclick: (e) => { e.stopPropagation(); sendQueuedNow(tab, el); } }, 'Hemen gönder')) : null);
  if (queued) el.__draft = draft || { text };
  if (!tab.titleSet && text) {
    tab.titleSet = true;
    tab.sessionTitle = text.slice(0, 80);
  }
  return append(tab, el);
}

function assistantText(tab, text) {
  markStarted(tab);
  endGroup(tab);
  return append(tab, mdInto(h('div', { class: 'msg-assistant md' }), text));
}

// Claude'un son yanıtının altında saati (Claude uygulamasındaki gibi): tur bitince
// son metin mesajına konur, bir öncekinden kalkar. Geçmişte zaman yok (SDK vermiyor).
function replyTime(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' ' + time;
}
function stampLastReply(tab) {
  const at = tab.lastReplyAt;
  tab.lastReplyAt = null;
  if (!at) return;
  const msgs = tab.list.querySelectorAll(':scope > .msg-assistant:not(.live)');
  const last = msgs[msgs.length - 1];
  if (!last) return;
  tab.list.querySelectorAll(':scope > .msg-time').forEach((el) => el.remove());
  const full = new Date(at).toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'medium' });
  const stick = nearBottom(tab);
  last.after(h('div', { class: 'msg-time', title: full, 'data-at': String(at) }, replyTime(at)));
  if (stick) scrollDown(tab, true);
}

function thinkingBlock(tab, text) {
  if (!text?.trim()) return null;
  markStarted(tab);
  endGroup(tab);
  const body = mdInto(h('div', { class: 'thinking-body md' }), text);
  return append(tab, h('details', { class: 'thinking' }, h('summary', {}, 'Düşündü'), body));
}

// ---------- Araç grupları (Claude uygulamasındaki "Ran N commands…" satırı) ----------

function currentGroup(tab) {
  if (tab.group) return tab.group;
  markStarted(tab);
  const summaryText = h('span', { class: 'grp-text' });
  const spinner = h('span', { class: 'grp-spin' });
  const body = h('div', { class: 'grp-body' });
  const deniedEl = h('span', { class: 'grp-denied', hidden: true });
  const el = h('details', { class: 'tool-group' }, h('summary', {}, spinner, summaryText, deniedEl, h('span', { class: 'grp-chev' }, '›')), body);
  // Araçların döndürdüğü görseller grup kapalıyken de görünsün diye grubun hemen altına
  const shots = h('div', { class: 'grp-shots' });
  const group = { el, body, shots, summaryText, spinner, deniedEl, counts: {}, running: new Set(), errors: 0, denied: 0, last: '' };
  tab.group = group;
  append(tab, el);
  append(tab, shots);
  return group;
}

function endGroup(tab) {
  tab.group = null;
}

function updateGroup(tab, group) {
  const entries = Object.entries(group.counts).sort((a, b) => b[1] - a[1]);
  const parts = [];
  let rest = 0;
  entries.forEach(([cat, n], i) => {
    if (i < 2) parts.push(CATEGORY_TEXT[cat](n));
    else rest += n;
  });
  let text = parts.join(', ');
  if (rest) text += ` ve ${rest} araç daha`;
  if (group.running.size) text = group.last ? `${group.last}` : text;
  group.summaryText.textContent = text.charAt(0).toLocaleUpperCase('tr') + text.slice(1);
  group.spinner.className = 'grp-spin' + (group.running.size ? ' on' : group.errors ? ' err' : '');
  group.el.classList.toggle('running', group.running.size > 0);
  group.deniedEl.hidden = !group.denied;
  group.deniedEl.textContent = group.denied ? `${group.denied} engellendi` : '';
}

function toolCard(tab, block, parentCard) {
  const { id, name, input } = block;
  if (tab.toolCards.has(id)) return tab.toolCards.get(id).el;
  // Panelin görev listesi aracı satır olarak görünmez, kartı günceller (renderer/wrapup.js)
  // Aynı çağrı iki kez gelirse (geçmiş + canlı) advance iki kez ilerlemesin diye kimlikler ayrı tutulur
  if (name === PLAN_TOOL && !parentCard) {
    if (!(tab.planCalls ||= new Set()).has(id)) { tab.planCalls.add(id); applyPlan(tab, input); }
    return null;
  }
  const status = h('span', { class: 'tool-status running' });
  const body = h('div', { class: 'tool-body' });
  const view = toolInputView(tab, name, input);
  if (view) body.append(view);
  const sub = h('div', { class: 'tool-sub' });
  body.append(sub);
  const el = h('details', { class: 'tool-row' },
    h('summary', {},
      h('span', { class: 'tool-icon' }, icon(TOOL_ICONS[name] || (name.startsWith('mcp__') ? 'layers' : 'settings'), 14)),
      h('span', { class: 'tool-name' }, toolLabel(name)),
      h('span', { class: 'tool-arg' }, toolSummary(tab, name, input)),
      status),
    body);
  const card = { el, status, body, sub, name, input, group: null, parent: parentCard || null };
  tab.toolCards.set(id, card);

  if (parentCard) {
    parentCard.sub.append(el);
  } else {
    const group = currentGroup(tab);
    card.group = group;
    group.body.append(el);
    const cat = toolCategory(name);
    group.counts[cat] = (group.counts[cat] || 0) + 1;
    group.running.add(id);
    group.last = `${toolLabel(name)}: ${toolSummary(tab, name, input)}`;
    updateGroup(tab, group);
    activityForTool(tab, name);
    if (nearBottom(tab)) scrollDown(tab, true);
  }
  // Alt ajanda ret olayı araç çağrısından önce gelir (ölçüldü): bekleyen ret satır çizilince uygulanır
  const denied = tab.denials.get(id);
  if (denied) markDenied(tab, card, denied);
  if (name === 'TodoWrite') updateProgress(tab, input.todos);
  if (FILE_TOOLS.has(name) || name === 'NotebookEdit') recordEdit(tab, name, input);
  if (name === 'mcp__panel__show_widget') showWidget(tab, card, input);
  if (name === WRAP_TOOL) showWrapUp(tab, input);
  return el;
}

function toolResult(tab, block) {
  const card = tab.toolCards.get(block.tool_use_id);
  if (!card) return;
  card.status.className = 'tool-status ' + (block.is_error ? 'error' : 'done');
  if (card.group) {
    card.group.running.delete(block.tool_use_id);
    if (block.is_error) card.group.errors++;
    updateGroup(tab, card.group);
    if (!card.group.running.size) setActivity(tab, 'Düşünüyor');
  }
  if (block.is_error) card.el.classList.add('error');
  if (FILE_TOOLS.has(card.name) && !block.is_error && card.input?.file_path) {
    const p = card.input.file_path.startsWith('/') ? card.input.file_path : `${tab.cwd}/${card.input.file_path}`;
    card.body.append(h('div', { class: 'tool-extra' },
      h('button', { class: 'mini', title: 'Bu dosyayı Artifacts galerisine ekle', onclick: () => addFileAsArtifact(tab, p) }, icon('artifacts', 13), 'Artifacts\'e ekle')));
  }
  const imgs = resultImages(block.content);
  if (imgs.length) {
    const target = card.group ? card.group.shots : card.body;
    const stick = nearBottom(tab);
    for (const src of imgs) {
      const img = h('img', { src, title: toolLabel(card.name), onclick: () => img.classList.toggle('zoom') });
      target.append(h('figure', { class: 'tool-shot' }, img, card.group ? h('figcaption', {}, toolLabel(card.name)) : null));
    }
    if (stick) scrollDown(tab, true);
  }
  const text = resultText(block.content).trim();
  if (!text || card.name === 'TodoWrite') return;
  if (['Edit', 'MultiEdit', 'Write'].includes(card.name) && !block.is_error) return;
  card.body.append(pre(text, block.is_error ? 'err' : 'out'));
  // Defter yazması grup kapalıyken de görünür (grubun altında tek satır, "Geri al" ile)
  if (card.name === 'mcp__panel__defter' && !block.is_error) {
    const x = defterChatLine(tab, card, text);
    if (x) { const stick = nearBottom(tab); (card.group ? card.group.shots : card.body).append(x); if (stick) scrollDown(tab, true); }
  }
}

function finishGroups(tab) {
  // Tur bittiğinde hâlâ "çalışıyor" görünen satırları kapat
  for (const card of tab.toolCards.values()) {
    if (card.status.classList.contains('running')) card.status.className = 'tool-status done';
    if (card.group) { card.group.running.clear(); updateGroup(tab, card.group); }
  }
}

// ---------- İzin retleri (system/permission_denied) ----------
// Claude Code kart açmadan reddettiği çağrıyı bildirir: otomatik kipin sınıflandırıcısı, ret kuralı, kip (gerçek CLI 2.1.310'da
// ölçüldü, docs/claude-code-eksikleri/olcum/izin-reddi.mjs). Claude bunu araç sonucundan bilir, kullanıcı satırdaki çipten ve
// tur sonundaki satırdan. Olay "en iyi çaba"dır; kesin kayıt result.permission_denials: olayı gelmeyen ret oradan eklenir.
const DENY_REASONS = {
  classifier: 'Otomatik kip', rule: 'İzin kuralı', subcommandResults: 'İzin kuralı', mode: 'İzin kipi',
  asyncAgent: 'Arka plandaki ajan soramadı', hook: 'Kanca', workingDir: 'Çalışma klasörünün dışında',
  safetyCheck: 'Güvenlik denetimi', sandboxOverride: 'Kum havuzu', permissionPromptTool: 'İzin aracı',
};
function denyReason(d) {
  const base = DENY_REASONS[d.type] || 'Engellendi';
  if (d.type !== 'classifier' || !d.reason) return base;
  // Sınıflandırıcı kuralın adını köşeli parantezle verir ("[Git Destructive]"); yanıtı okunamazsa "could not evaluate"
  const rule = /^\[([^\]]+)\]/.exec(d.reason)?.[1];
  if (rule) return `${base}: ${rule}`;
  return /could not evaluate/i.test(d.reason) ? `${base}: değerlendirilemedi` : base;
}
// title için: yalnız kuralın adından fazlasını söyleyen ham gerekçe (İngilizce, Claude Code'un metni)
const denyTitle = (d) => [denyReason(d), /^\[[^\]]+\]$/.test(d.reason) ? '' : d.reason].filter(Boolean).join('\n');
function permissionDenied(tab, msg) {
  const id = msg.tool_use_id;
  if (!id || tab.denials.has(id)) return;
  const d = { id, name: msg.tool_name, type: msg.decision_reason_type || '', reason: msg.decision_reason || '', agent: msg.agent_id || null };
  tab.denials.set(id, d);
  tab.turnDenials.push(d);
  const card = tab.toolCards.get(id);
  if (card) markDenied(tab, card, d);
}
function markDenied(tab, card, d) {
  if (card.denied) return;
  card.denied = d;
  card.el.classList.add('denied');
  card.status.before(h('span', { class: 'tool-denied', title: denyTitle(d) }, 'engellendi'));
  // Alt ajanın satırı iç içe: sayı en dıştaki satırın grubuna
  let top = card;
  while (top.parent) top = top.parent;
  if (top.group) { top.group.denied++; updateGroup(tab, top.group); }
}
function settleDenials(tab, msg) {
  const list = tab.turnDenials;
  tab.turnDenials = [];
  for (const p of msg.permission_denials || []) {
    if (!p?.tool_use_id || tab.denials.has(p.tool_use_id)) continue;
    const d = { id: p.tool_use_id, name: p.tool_name, input: p.tool_input, type: '', reason: '' };
    tab.denials.set(d.id, d);
    list.push(d);
    const card = tab.toolCards.get(d.id);
    if (card) markDenied(tab, card, d);
  }
  if (!list.length) return;
  const n = list.length;
  const head = list.every((d) => d.type === 'classifier') ? `Otomatik kip ${n} işlemi engelledi` : `${n} işlem engellendi`;
  // Satır sohbetin sonunda durur: en alttayken açılırsa liste yazma kutusunun altında kalmasın
  let stick = false;
  const note = h('details', { class: 'deny-note', ontoggle: () => { if (note.open && stick) scrollDown(tab, true); } },
    h('summary', { onclick: () => { stick = nearBottom(tab); } }, h('span', { class: 'dn-ic' }, icon('lock', 13)), head),
    h('div', { class: 'dn-list' }, ...list.map((d) => {
      const card = tab.toolCards.get(d.id);
      const name = card?.name || d.name || '';
      return h('div', { class: 'dn-item', 'data-id': d.id, title: card ? 'Satıra git' : null, onclick: () => revealTool(card) },
        h('span', { class: 'dn-tool' }, toolLabel(name)),
        h('span', { class: 'dn-arg' }, toolSummary(tab, name, card?.input || d.input || {})),
        h('span', { class: 'dn-why', title: denyTitle(d) }, denyReason(d)));
    })));
  append(tab, note);
}
// Tur sonundaki listeden satıra: satırı (gerekçesi gövdesinde), grubunu ve alt ajandaysa üst satırları açar
function revealTool(card) {
  if (!card) return;
  for (let c = card; c; c = c.parent) { c.el.open = true; if (c.group) c.group.el.open = true; }
  card.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.el.classList.remove('flash');
  void card.el.offsetWidth;
  card.el.classList.add('flash');
}

// ---------- Yan panel ----------

// card: sohbetteki kart da güncellensin (geri sarmada hayır: kalan kart yerinde durur)
function updateProgress(tab, todos, card = true) {
  tab.todos = todos || [];
  const done = tab.todos.filter((t) => t.status === 'completed').length;
  tab.progressCount.textContent = tab.todos.length ? `${done} / ${tab.todos.length}` : '';
  tab.progressBody.innerHTML = '';
  tab.progressBody.append(tab.todos.length ? todoList(tab.todos) : h('div', { class: 'side-empty' }, 'Görev yok.'));
  if (card) renderPlanCard(tab); // sohbetteki kutucuklu kart (renderer/wrapup.js)
  updatePlanBar(tab);
}

// Bağlam bölümü: klasör, ortam, pencerede yer tutan kalemler, MCP sunucuları, skill'ler. Döküm tur sonundaki ölçümden (compaction.js → summarize).
// init'in skills'i Claude Code'un bildiği bütün skill'lerdir; "Yalnız ben çağırırım" yapılanlar ve yazarın kullanıcıya bıraktıkları Claude'un
// listesine girmez, bağlamda yer tutmaz (2026-10-20, gerçek CLI'de ölçüldü). Ölçüm gelince ikisi ayrı gösterilir.
// Satırlar `id` ile adlandırılır (SDK: İngilizce ad değişebilir, id değişmez); bilinmeyen satır Claude Code'un verdiği adla görünür.
const CTX_NAMES = { system_prompt: 'Sistem istemi', system_tools: 'Claude Code araçları', mcp_tools: 'MCP araçları', mcp_instructions: 'MCP talimatları',
  memory_files: 'CLAUDE.md ve bellek', skills: 'Skill listesi', custom_agents: 'Ajanlar', messages: 'Konuşma' };

function updateContext(tab, init) {
  if (init) tab.ctxInit = init;
  init = tab.ctxInit || {};
  const u = tab.context;
  const rows = [h('div', { class: 'side-row' }, icon('folder', 14), tilde(init.cwd || tab.cwd))];
  if (tab.envName) rows.push(h('div', { class: 'side-row' }, icon('box', 14), `Ortam: ${tab.envName}`));
  if (u?.categories?.length) {
    rows.push(h('div', { class: 'side-label' }, u.totalTokens ? `Bağlamda ~${fmtTokens(u.totalTokens)} token` : 'Bağlamda'));
    rows.push(h('div', { class: 'side-ctx' }, ...[...u.categories].sort((a, b) => b.tokens - a.tokens).map((c) =>
      h('div', { class: 'side-ctx-row' }, h('span', {}, CTX_NAMES[c.id] || c.name), h('span', { class: 'side-ctx-n' }, fmtTokens(c.tokens))))));
  }
  const mcp = init.mcp_servers || [];
  if (mcp.length) {
    rows.push(h('div', { class: 'side-label' }, 'MCP sunucuları'));
    rows.push(h('div', { class: 'side-chips' }, mcp.map((s) =>
      h('span', { class: 'side-chip' + (s.status === 'connected' ? '' : ' off'), title: s.status }, s.name))));
  }
  const all = init.skills || [];
  const listed = u?.skills?.listed;
  if (listed) {
    // Claude Code aynı skill'i iki yerde farklı adla verebilir (listede "anthropic-skills:deep-research", init'te "deep-research")
    const tail = (n) => n.slice(n.lastIndexOf(':') + 1);
    const seen = new Set(listed.flatMap((s) => [s.name, tail(s.name)]));
    const userOnly = all.filter((n) => !seen.has(n) && !seen.has(tail(n)));
    if (listed.length) {
      rows.push(h('div', { class: 'side-label' }, `Claude'un skill listesinde (${listed.length}) · ~${fmtTokens(u.skills.tokens)} token`));
      rows.push(h('div', { class: 'side-chips side-skills' }, listed.map((s) => h('span', { class: 'side-chip', title: `${s.tokens} token` }, s.name))));
    }
    if (userOnly.length) {
      rows.push(h('div', { class: 'side-label', title: 'Claude kendiliğinden kullanmaz, adlarını da görmez; /ad ile çağrılınca yüklenir' },
        `Yalnız /ad ile çağrılanlar (${userOnly.length}) · bağlamda yer tutmaz`));
      rows.push(h('div', { class: 'side-chips side-skills-user' }, userOnly.map((n) => h('span', { class: 'side-chip user' }, n))));
    }
  } else if (all.length) {
    rows.push(h('div', { class: 'side-label' }, `Skill'ler (${all.length})`));
    rows.push(h('div', { class: 'side-chips' }, all.map((s) => h('span', { class: 'side-chip' }, s))));
  }
  if ((init.agents || []).length) {
    rows.push(h('div', { class: 'side-label' }, 'Ajanlar'));
    rows.push(h('div', { class: 'side-chips' }, init.agents.map((s) => h('span', { class: 'side-chip' }, s))));
  }
  tab.contextBody.innerHTML = '';
  tab.contextBody.append(...rows);
}

function updateSession(tab, extra = {}) {
  Object.assign(tab, extra);
  const rows = [];
  if (tab.version) rows.push(h('div', { class: 'side-row' }, `Claude Code ${tab.version}`));
  if (tab.model) rows.push(h('div', { class: 'side-row' }, `Model: ${tab.model}`));
  if (tab.lastTurn) rows.push(h('div', { class: 'side-row' }, `Son tur: ${tab.lastTurn}`));
  if (tab.sessionId) rows.push(h('div', { class: 'side-row muted', title: tab.sessionId }, `Oturum: ${tab.sessionId.slice(0, 8)}…`));
  tab.sessionBody.innerHTML = '';
  tab.sessionBody.append(...(rows.length ? rows : [h('div', { class: 'side-empty' }, '—')]));
}

// ---------- Mesajların çizimi ----------

function renderBlocks(tab, msg, fromHistory) {
  const content = msg.message?.content;
  const parent = msg.parent_tool_use_id ? tab.toolCards.get(msg.parent_tool_use_id) : null;
  if (msg.type === 'assistant' || msg.message?.role === 'assistant') {
    for (const b of Array.isArray(content) ? content : []) {
      if (parent) {
        if (b.type === 'tool_use') toolCard(tab, b, parent);
        continue;
      }
      if (b.type === 'text' && b.text?.trim()) assistantText(tab, b.text);
      else if (b.type === 'thinking') thinkingBlock(tab, b.thinking);
      else if (b.type === 'tool_use') toolCard(tab, b);
    }
    if (msg.error && !fromHistory) note(tab, 'Hata: ' + (typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error)), 'error');
  } else if (msg.type === 'user' || msg.message?.role === 'user') {
    if (typeof content === 'string') {
      if (!parent && fromHistory && !shellFromHistory(tab, content)) historyBubble(tab, content, msg.uuid); // kabuk mesajı: renderer/kabuk.js
      return;
    }
    const results = (content || []).filter((b) => b.type === 'tool_result');
    for (const r of results) toolResult(tab, r);
    if (!results.length && !parent && fromHistory) historyBubble(tab, content, msg.uuid);
  }
}
// Geçmişin kullanıcı mesajı: balon, metni ↑ / Ctrl+R geçmişine (renderer/istem.js)
function historyBubble(tab, content, uuid) {
  const el = userBubble(tab, content, false, uuid);
  const text = el?.querySelector?.('.user-text')?.textContent;
  if (text) rememberPrompt(tab, text);
}

function renderHistoryMessage(tab, m) {
  if (m.type === 'system') return;
  renderBlocks(tab, m, true);
}

// ---------- SDK mesajları ----------

function handleChatMsg(chatId, msg) {
  const tab = chatsById.get(chatId);
  if (!tab) return;
  if (msg.session_id && msg.session_id !== tab.sessionId) { tab.sessionId = msg.session_id; updateSession(tab); }

  switch (msg.type) {
    case 'system':
      return handleSystem(tab, msg);
    case 'stream_event':
      return handleStream(tab, msg);
    case 'command_lifecycle':
      return handleLifecycle(tab, msg);
    case 'assistant': {
      // Kullanım sınırı (429): metin ve "Hata" notu yerine sınır kartı (renderer/sinir.js)
      if (msg.error === 'rate_limit' && !msg.parent_tool_use_id) { limitHit(tab, msg); markActivity(tab); return; }
      if (blockedCompactText(tab, msg)) return; // engellenen otomatik sıkıştırma sessiz (renderer/compaction.js)
      const id = msg.message?.id;
      const types = new Set((msg.message?.content || []).map((b) => b.type));
      for (const [key, live] of tab.live) {
        if (key.startsWith(id + ':') && types.has(live.type)) { live.el.remove(); tab.live.delete(key); }
      }
      renderBlocks(tab, msg, false);
      if (types.has('text')) tab.lastReplyAt = Date.now();
      markActivity(tab);
      return;
    }
    case 'user':
      renderBlocks(tab, msg, false);
      return;
    case 'result': {
      for (const live of tab.live.values()) live.el.remove();
      tab.live.clear();
      finishGroups(tab);
      endGroup(tab);
      setBusy(tab, false);
      settlePlanCard(tab);
      settleDenials(tab, msg); // tur özetinden önce: kutu en sonda kalır
      settleWrapUp(tab);
      stampLastReply(tab);
      updatePlanBar(tab);
      deliverSessionEvents(tab);
      offerRetention(tab); // renderer/compaction.js
      refreshUsageSoon(tab.acctId);
      refreshChanges(tab);
      refreshPreview(tab); // Claude launch.json yazmış olabilir
      const secs = Math.round((msg.duration_ms || 0) / 1000);
      updateSession(tab, { lastTurn: secs >= 60 ? `${Math.floor(secs / 60)} dk ${secs % 60} sn` : `${secs} sn` });
      // Öneri yalnız başarılı turun ardından (CLI API hatasından sonra üretmez): 429 anında bittiği için önceki turun geç gelen
      // önerisi bu sonuçtan sonra gelebiliyordu (e2e'de görüldü)
      tab.suggestOk = !msg.is_error && msg.subtype === 'success';
      const limited = tab.limitTurn; // sınır kartı çizildi: "Durdu" notu yinelemesin
      tab.limitTurn = false;
      if ((msg.is_error || msg.subtype !== 'success') && !limited) {
        const reason = msg.result || msg.errors?.join('\n') || msg.subtype;
        if (!/interrupt|error_during_execution/i.test(String(msg.subtype)) || msg.result) note(tab, 'Durdu: ' + reason + loginHint(reason), 'error');
        else note(tab, 'Durduruldu.', 'muted');
      }
      if (!isVisible(tab) || !document.hasFocus()) flagAttention(tab, 'Claude işi bitirdi');
      return;
    }
    case 'tool_progress': {
      const card = tab.toolCards.get(msg.tool_use_id);
      if (card) card.status.dataset.time = `${Math.round(msg.elapsed_time_seconds)} sn`;
      return;
    }
    case 'auth_status':
      if (msg.error) note(tab, 'Giriş hatası: ' + msg.error + loginHint('login'), 'error');
      return;
    case 'rate_limit_event':
      return handleRateLimit(tab, msg); // renderer/sinir.js
    case 'prompt_suggestion':
      return handleSuggestion(tab, msg); // renderer/istem.js
    default:
      return;
  }
}

function handleSystem(tab, msg) {
  switch (msg.subtype) {
    case 'init': {
      tab.slash = (msg.slash_commands || []).map((c) => '/' + c.replace(/^\//, ''));
      loadChatCommands(tab); // açıklamalar (renderer/skills.js)
      if (msg.permissionMode) tab.permissionMode = msg.permissionMode;
      if (msg.effort) tab.effort = msg.effort;
      updateSession(tab, { model: msg.model, version: msg.claude_code_version });
      updateContext(tab, msg);
      syncSelects(tab);
      return;
    }
    case 'hook_response': {
      const out = (msg.stdout || msg.output || '').trim();
      if (msg.outcome === 'error') note(tab, `Hook hatası (${msg.hook_event}): ${(msg.stderr || out).slice(0, 600)}`, 'error');
      else if (out && /SessionStart/.test(msg.hook_event)) {
        let text = out;
        try { const j = JSON.parse(out); text = j.systemMessage || j.hookSpecificOutput?.additionalContext || out; } catch {}
        tab.hookText = String(text).slice(0, 8000);
        tab.welcome.querySelector('.hook-note')?.remove();
        if (!tab.started) tab.welcome.append(hookNote(msg, tab.hookText));
        else append(tab, hookNote(msg, tab.hookText));
      }
      return;
    }
    case 'status':
      if (msg.permissionMode) { tab.permissionMode = msg.permissionMode; syncSelects(tab); }
      compactStatus(tab, msg); // renderer/compaction.js
      return;
    case 'compact_boundary':
      divider(tab, 'Sohbet özetlendi');
      tab.octoView?.ink(); // ahtapotun başında mürekkep (renderer/octopus.js)
      return;
    case 'api_retry':
      setStatus(tab, 'busy', `Yeniden deneniyor (${msg.attempt}/${msg.max_retries})`);
      return;
    // Claude Code kendiliğinden tur açınca da gelir (arka plan görevi bitti; chat-main.js CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS verir)
    case 'session_state_changed':
      if (msg.state === 'running' && !tab.busy) setBusy(tab, true);
      if (msg.state === 'idle' && tab.busy) setBusy(tab, false);
      return;
    case 'task_started':
    case 'task_updated':
    case 'task_progress':
    case 'task_notification':
    case 'background_tasks_changed':
      handleTaskMsg(tab, msg); // arka plan görevleri (renderer/activity.js)
      return;
    case 'local_command_output':
    case 'informational':
    case 'notification':
      if (msg.content || msg.text) note(tab, msg.content || msg.text, msg.level === 'warning' ? 'warn' : 'muted');
      return;
    case 'permission_denied':
      permissionDenied(tab, msg);
      return;
    case 'commands_changed':
      // Skill açılıp kapanınca ya da yeni skill bulununca Claude Code tam listeyi yollar (SDKCommandsChangedMessage.commands)
      setChatCommands(tab, msg.commands);
      return;
    default:
      return;
  }
}

function handleStream(tab, msg) {
  if (msg.parent_tool_use_id) return;
  const ev = msg.event || {};
  if (ev.type === 'message_start') { tab.curMsgId = ev.message?.id; return; }
  if (ev.type === 'content_block_start') {
    const type = ev.content_block?.type;
    if (type !== 'text' && type !== 'thinking') return;
    markStarted(tab);
    endGroup(tab);
    setActivity(tab, type === 'text' ? 'Yazıyor' : 'Düşünüyor');
    const key = `${tab.curMsgId}:${ev.index}`;
    const el = type === 'text'
      ? h('div', { class: 'msg-assistant md live' })
      : h('details', { class: 'thinking live' }, h('summary', {}, 'Düşünüyor…'), h('div', { class: 'thinking-body' }));
    tab.live.set(key, { type, el, text: '' });
    append(tab, el);
    return;
  }
  if (ev.type === 'content_block_delta') {
    const live = tab.live.get(`${tab.curMsgId}:${ev.index}`);
    if (!live) return;
    const d = ev.delta || {};
    const add = d.type === 'text_delta' ? d.text : d.type === 'thinking_delta' ? d.thinking : '';
    if (!add) return;
    live.text += add;
    const stick = nearBottom(tab);
    if (live.type === 'text') {
      cancelAnimationFrame(live.raf);
      live.raf = requestAnimationFrame(() => { live.el.innerHTML = md(live.text); if (stick) scrollDown(tab, true); });
    } else {
      live.el.querySelector('.thinking-body').textContent = live.text;
      if (stick) scrollDown(tab, true);
    }
  }
}

function loginHint(text) {
  return /log ?in|logged|authenticat|oauth|credential/i.test(String(text || ''))
    ? '\n\nBu hesapta Claude Code girişi yok gibi görünüyor. Üstteki "Terminal" ile açıp /login yapın, sonra buraya dönün.'
    : '';
}

function markActivity(tab) {
  if (!isVisible(tab) && !tab.activity) {
    tab.activity = true;
    renderTabs(tab.acctId);
  }
}

function flagAttention(tab, body) {
  if (!tab.attention) {
    tab.attention = true;
    renderTabs(tab.acctId);
    renderSidebar();
  }
  window.panel.notify(`${acct(tab.acctId)?.name || ''} · ${tab.title}`, body);
}

function handleChatEnd(chatId, err) {
  const tab = chatsById.get(chatId);
  if (!tab) return;
  chatsById.delete(chatId);
  tab.exited = true;
  tab.busy = false;
  stopActivity(tab);
  resetTasks(tab);
  tab.stopBtn.hidden = true;
  tab.sendBtn.hidden = false;
  for (const el of tab.list.querySelectorAll(':scope > .msg-user.queued')) returnQueued(tab, el); // Claude almadan süreç kapandı
  finishGroups(tab);
  setStatus(tab, err ? 'error' : 'off', err ? 'Hata ile kapandı' : 'Kapandı');
  markStarted(tab);
  if (err) note(tab, 'Claude Code kapandı: ' + err + loginHint(err), 'error');
  append(tab, h('div', { class: 'chat-reopen' },
    h('button', { class: 'primary-btn', onclick: () => reopen(tab) }, 'Bu oturuma devam et')));
  renderTabs(tab.acctId);
  renderSidebar();
}

function reopen(tab) {
  const { acctId, cwd, sessionId } = tab;
  closeTab(tab, true);
  if (sessionId) createChatTab(acctId, cwd, 'resume', sessionId);
  else createChatTab(acctId, cwd, 'continue');
}

// ---------- İzin ve soru kartları ----------

function handlePermission(chatId, req) {
  const tab = chatsById.get(chatId);
  if (!tab) return;
  markStarted(tab);
  const reply = (r) => {
    window.panel.chatPermissionReply(chatId, req.rid, r);
    card.dataset.reply = r.behavior || r.action; // izin kartında allow/deny, MCP formunda accept/decline/cancel
    card.classList.add('answered');
    tab.octoView?.refresh();
  };

  let card;
  if (req.elicitation) card = elicitationCard(tab, req, reply); // MCP sunucusunun form/adres isteği (renderer/elicitation.js)
  else if (req.toolName === 'AskUserQuestion') card = questionCard(tab, req, reply);
  else if (req.toolName === 'ExitPlanMode') card = planCard(tab, req, reply);
  else {
    const view = toolInputView(tab, req.toolName, req.input);
    card = h('div', { class: 'perm-card' },
      h('div', { class: 'perm-title' }, req.title || `Claude şunu kullanmak istiyor: ${toolLabel(req.toolName)}`),
      h('div', { class: 'perm-arg' }, toolSummary(tab, req.toolName, req.input)),
      view,
      req.decisionReason ? h('div', { class: 'perm-reason' }, req.decisionReason) : null,
      h('div', { class: 'perm-actions' },
        h('button', { class: 'primary-btn', onclick: () => reply({ behavior: 'allow' }) }, 'İzin ver'),
        req.canAlways ? h('button', { class: 'ghost-btn', onclick: () => reply({ behavior: 'allow', always: true }) }, 'Bu oturumda hep izin ver') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost-btn', onclick: () => reply({ behavior: 'deny', message: 'Kullanıcı reddetti' }) }, 'Reddet'),
        h('button', { class: 'ghost-btn danger', onclick: () => reply({ behavior: 'deny', message: 'Kullanıcı reddetti ve durdurdu', interrupt: true }) }, 'Reddet ve durdur')));
  }
  // Başın "yeni kol" kartı ahtapot bölmesinde tomurcuk olarak görünür (renderer/octopus.js → pendingStarts)
  if (req.toolName === 'mcp__panel__sessions' && req.input?.action === 'start') card.dataset.start = String(req.input.title || 'Yeni kol');
  endGroup(tab);
  tab.pendingPerms.set(req.rid, card);
  tab.octoView?.refresh();
  append(tab, card);
  scrollDown(tab, true);
  if (!isVisible(tab) || !document.hasFocus()) flagAttention(tab, req.elicitation ? `${req.elicitation.displayName || req.elicitation.serverName} sizden bilgi istiyor` : 'Claude onayınızı bekliyor');
}

function questionCard(tab, req, reply) {
  const questions = req.input?.questions || [];
  const qEls = questions.map((q) => {
    const chosen = new Set();
    const other = h('input', { type: 'text', class: 'q-other', placeholder: 'Başka bir cevap yazın…' });
    const opts = q.options.map((o) => {
      const btn = h('button', { class: 'q-opt', onclick: () => {
        if (q.multiSelect) { chosen.has(o.label) ? chosen.delete(o.label) : chosen.add(o.label); btn.classList.toggle('on'); }
        else { chosen.clear(); chosen.add(o.label); for (const b of btn.parentNode.children) b.classList.remove('on'); btn.classList.add('on'); }
      } }, h('b', {}, o.label), o.description ? h('span', {}, o.description) : null);
      return btn;
    });
    return { q, chosen, other, el: h('div', { class: 'q-block' },
      h('div', { class: 'q-head' }, q.header ? h('span', { class: 'q-chip' }, q.header) : null, q.question),
      h('div', { class: 'q-opts' }, opts), other) };
  });
  return h('div', { class: 'perm-card question' },
    qEls.map((x) => x.el),
    h('div', { class: 'perm-actions' },
      h('button', { class: 'primary-btn', onclick: () => {
        const answers = {};
        for (const x of qEls) answers[x.q.question] = x.other.value.trim() || [...x.chosen].join(', ');
        reply({ behavior: 'allow', updatedInput: { ...req.input, answers } });
      } }, 'Cevapla'),
      h('button', { class: 'ghost-btn', onclick: () => reply({ behavior: 'deny', message: 'Kullanıcı soruyu yanıtlamadı' }) }, 'Atla')));
}

function planCard(tab, req, reply) {
  return h('div', { class: 'perm-card plan' },
    h('div', { class: 'perm-title' }, 'Claude planını onayınıza sunuyor'),
    mdInto(h('div', { class: 'md plan-body' }), req.input?.plan || ''),
    h('div', { class: 'perm-actions' },
      h('button', { class: 'primary-btn', onclick: () => { reply({ behavior: 'allow' }); changeMode(tab, 'acceptEdits'); } }, 'Onayla, düzenlemeleri kabul et'),
      h('button', { class: 'ghost-btn', onclick: () => { reply({ behavior: 'allow' }); changeMode(tab, 'default'); } }, 'Onayla, her adımda sor'),
      h('button', { class: 'ghost-btn', onclick: () => reply({ behavior: 'deny', message: 'Kullanıcı planı onaylamadı; planda kalmaya devam et ve ne değişmesi gerektiğini sor.' }) }, 'Planda kal')));
}

function handlePermissionDone(chatId, rid, why) {
  const tab = chatsById.get(chatId);
  const card = tab?.pendingPerms.get(rid);
  if (!card) return;
  tab.pendingPerms.delete(rid);
  if (card.classList.contains('elicit')) elicitationClosed(card, why);
  card.classList.add('answered');
  for (const b of card.querySelectorAll('button, input, select')) b.disabled = true;
  if (!tab.pendingPerms.size && tab.attention && isVisible(tab)) clearFlags(tab);
  tab.octoView?.refresh();
}

// ---------- Model, efor, mod ----------

function saveAcctPrefs(acctId, patch) {
  const prefs = { model: '', effort: '', mode: '', ...(state.cfg.chatPrefs?.[acctId] || {}), ...patch };
  state.cfg.chatPrefs = { ...(state.cfg.chatPrefs || {}), [acctId]: prefs };
  window.panel.saveConfig({ chatPrefs: { [acctId]: prefs } });
}

function savePrefs(tab) {
  saveAcctPrefs(tab.acctId, { model: tab.modelChoice || '', effort: tab.effort || '', mode: tab.permissionMode || '' });
}

function syncSelects(tab) {
  tab.picker.refresh();
  if (tab.permissionMode) tab.modeSel.value = tab.permissionMode;
}

function prettyModel(id) {
  const m = String(id).replace(/^claude-/, '').replace(/-\d{8}$/, '');
  const [fam, ...ver] = m.split('-');
  return fam ? fam.charAt(0).toUpperCase() + fam.slice(1) + (ver.length ? ' ' + ver.join('.') : '') : id;
}

function handleModels(chatId, models) {
  const tab = chatsById.get(chatId);
  if (!tab || !Array.isArray(models)) return;
  tab.models = models;
  (acctInfo[tab.acctId] ||= {}).models = models;
  syncSelects(tab);
}

async function changeModel(tab, model) {
  tab.modelChoice = model;
  savePrefs(tab);
  syncSelects(tab);
  if (!tab.chatId) return;
  const r = await window.panel.chatSetModel(tab.chatId, model);
  if (r !== true) toast('Model değiştirilemedi: ' + r);
}

async function changeEffort(tab, level) {
  tab.effort = level;
  savePrefs(tab);
  syncSelects(tab);
  if (!tab.chatId) return;
  const r = await window.panel.chatSetEffort(tab.chatId, level);
  if (r !== true) toast('Efor değiştirilemedi: ' + r);
}

async function changeMode(tab, mode) {
  tab.permissionMode = mode;
  tab.modeSel.value = mode;
  savePrefs(tab);
  if (!tab.chatId) return;
  const r = await window.panel.chatSetMode(tab.chatId, mode);
  if (r !== true) toast('Mod değiştirilemedi: ' + r);
}

function cycleMode(tab) {
  const order = ['default', 'acceptEdits', 'plan', 'auto'];
  const i = order.indexOf(tab.modeSel.value);
  changeMode(tab, order[(i + 1) % order.length]);
}

// ---------- Yazma alanı ----------

function wireComposer(tab) {
  const { input } = tab;
  const autosize = () => {
    input.style.height = 'auto';
    // Gizli sekmede (arka planda açılan yan oturum, kol) scrollHeight 0'dır: yükseklik
    // verilmez, yoksa yazma alanı 0 px kalır ve sekmeye geçince yazılamaz.
    if (input.scrollHeight) input.style.height = Math.min(input.scrollHeight, 300) + 'px';
    if (tab.busy) tab.sendBtn.hidden = !input.value.trim();
  };
  tab.autosize = autosize;
  // "/" önerileri yalnız kutu "/…" iken; öbür durumda imlecin önündeki `@…` parçası (renderer/mentions.js)
  // Ctrl+R araması açıksa kutu geçmişi süzer (renderer/istem.js)
  const suggest = () => { if (tab.histSearch) return updateHistorySearch(tab); updateSlash(tab); if (tab.slashBox.hidden) updateMention(tab); };
  input.addEventListener('beforeinput', (e) => shellBeforeInput(tab, e)); // boş kutuya "!": kabuk kipi (renderer/kabuk.js)
  input.addEventListener('input', () => { promptTyped(tab); autosize(); suggest(); });
  input.addEventListener('click', () => updateMention(tab));
  input.addEventListener('keyup', (e) => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) updateMention(tab); });
  input.addEventListener('blur', () => { if (tab.slashBox.classList.contains('mention')) tab.slashBox.hidden = true; closeHistorySearch(tab); });
  input.addEventListener('keydown', (e) => {
    if (!tab.slashBox.hidden && !e.isComposing && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
      const items = [...tab.slashBox.children].filter((x) => x.__pick);
      // Ctrl+R araması eşleşmesizken de açık kalır: Enter aranan metni göndermesin, yalnız kutuyu kapatsın
      if (!items.length) { e.preventDefault(); if (e.key === 'Enter' || e.key === 'Tab') closeHistorySearch(tab); return; }
      let i = items.findIndex((x) => x.classList.contains('on'));
      if (e.key === 'ArrowDown') i = (i + 1) % items.length;
      else if (e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length;
      else { e.preventDefault(); items[Math.max(i, 0)].__pick(); return; }
      items.forEach((x, j) => x.classList.toggle('on', j === i));
      e.preventDefault();
      return;
    }
    if (shellKeys(tab, e) || promptKeys(tab, e)) return; // kabuk kipinden çıkma; geçmiş, Ctrl+R, önerilen istem
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(tab, true); }
    else if (e.key === 'Escape') { if (!tab.slashBox.hidden) { tab.slashBox.hidden = true; closeHistorySearch(tab); } else if (tab.busy) interrupt(tab); }
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(tab); }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addAttachments(tab.attachments, tab.attach, files); }
  });
  tab.host.addEventListener('dragover', (e) => { e.preventDefault(); });
  tab.host.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addAttachments(tab.attachments, tab.attach, files);
    input.focus();
  });
  tab.scroller.addEventListener('scroll', () => { tab.stick = nearBottom(tab); });
  wireReplySelection(tab);
}

// Claude'un yanıtında metin seçilince üstünde "Yanıtla" düğmesi; tıklanınca seçim alıntı olarak yazma alanına girer
function wireReplySelection(tab) {
  const btn = h('button', { class: 'reply-sel', hidden: true, title: 'Seçili metni alıntılayarak yanıtla',
    onmousedown: (e) => e.preventDefault(), // seçim kaybolmasın
    onclick: () => { quoteReply(tab, btn.dataset.text || ''); btn.hidden = true; window.getSelection()?.removeAllRanges(); },
  }, icon('reply', 14), 'Yanıtla');
  tab.scroller.append(btn);
  tab.replyBtn = btn;
  const update = () => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    const range = text ? sel.getRangeAt(0) : null;
    const node = range?.commonAncestorContainer;
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!text || !el?.closest('.msg-assistant') || !tab.list.contains(el)) { btn.hidden = true; return; }
    const r = range.getBoundingClientRect();
    const box = tab.scroller.getBoundingClientRect();
    btn.dataset.text = text;
    btn.hidden = false;
    const left = Math.min(Math.max(r.left - box.left + r.width / 2 - btn.offsetWidth / 2, 8), box.width - btn.offsetWidth - 8);
    const above = r.top - box.top - btn.offsetHeight - 8;
    btn.style.left = left + 'px';
    btn.style.top = (above > 30 ? above : r.bottom - box.top + 8) + tab.scroller.scrollTop + 'px';
  };
  tab.list.addEventListener('mouseup', () => setTimeout(update, 0));
  tab.list.addEventListener('keyup', (e) => { if (e.shiftKey) update(); });
  document.addEventListener('selectionchange', () => { if (!btn.hidden && window.getSelection()?.isCollapsed) btn.hidden = true; });
}

function quoteReply(tab, text) {
  if (!text) return;
  const quote = text.split('\n').map((l) => '> ' + l).join('\n');
  const cur = tab.input.value.replace(/\s+$/, '');
  setDraft(tab, (cur ? cur + '\n\n' : '') + quote + '\n\n');
}

function updateSlash(tab) {
  const v = tab.input.value;
  const box = tab.slashBox;
  if (!/^\/[^\s]*$/.test(v) || !tab.slash.length) { box.hidden = true; return; }
  const matches = tab.slash.filter((c) => c.toLowerCase().startsWith(v.toLowerCase())).slice(0, 8);
  box.classList.remove('mention');
  box.innerHTML = '';
  const pick = (c) => { tab.input.value = c + ' '; box.hidden = true; tab.input.focus(); };
  matches.forEach((c, i) => {
    const info = tab.cmdInfo?.get(c);
    const el = h('div', {
      class: 'slash-item' + (i === 0 ? ' on' : ''), 'data-cmd': c, title: info?.description || '',
      onmousedown: (e) => { e.preventDefault(); pick(c); },
    }, h('span', { class: 'slash-name' }, c),
    info?.argumentHint ? h('span', { class: 'slash-hint' }, info.argumentHint) : null,
    info?.description ? h('span', { class: 'slash-desc' }, info.description) : null);
    el.__pick = () => pick(c);
    box.append(el);
  });
  box.hidden = !matches.length;
}

// ---------- Ekler (dosya ve fotoğraf) ----------
// Görsel → görsel bloğu (büyükse küçültülür). Küçük metin dosyası → içeriğiyle bir metin bloğu.
// Diğerleri (PDF, Office belgesi, büyük dosya, klasör) → yalnız yolu gider; Claude Read aracıyla okur.
// Dosya blokları <attached_file …> etiketiyle yazılır; geçmiş yüklenirken de kart olarak çizilir.

const ATTACH_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const IMAGE_MAX = 3.75 * 1024 * 1024; // base64 ile 5 MB API sınırının altında kalsın
const TEXT_MAX = 256 * 1024;
const TEXT_TYPE = /^text\/|json|xml|javascript|yaml|toml|x-sh/;
const TEXT_EXT = /\.(txt|md|markdown|mdx|csv|tsv|json|jsonl|ya?ml|toml|ini|cfg|conf|env|xml|svg|html?|css|scss|less|m?js|cjs|jsx|tsx?|py|rb|go|rs|java|kts?|swift|c|cc|cpp|h|hpp|cs|php|sh|zsh|bash|fish|sql|graphql|vue|svelte|lua|r|log|diff|patch)$/i;

const readAsDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

// Büyük fotoğrafı uzun kenarı 2048 px olacak şekilde küçült (saydamlık için JPEG dışındakiler WebP)
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const out = await canvas.convertToBlob({ type: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', quality: 0.85 });
  return out.size <= IMAGE_MAX ? out : null;
}

async function readAttachment(file) {
  const path = window.panel.filePath(file);
  const name = file.name || path.split('/').pop() || 'dosya';
  const base = { name, path, size: file.size };
  try {
    if (ATTACH_IMAGE.test(file.type)) {
      const blob = file.size > IMAGE_MAX ? await shrinkImage(file) : file;
      if (blob) {
        const url = await readAsDataUrl(blob);
        return { ...base, kind: 'image', mediaType: blob.type, data: url.slice(url.indexOf(',') + 1), url };
      }
    } else if (file.size <= TEXT_MAX && (TEXT_TYPE.test(file.type) || TEXT_EXT.test(name))) {
      const text = await file.text();
      if (!text.includes('\u0000')) return { ...base, kind: 'text', text };
    }
  } catch {} // okunamayan (ör. klasör) → yolu verilir
  if (path) return { ...base, kind: 'file' };
  toast(`${name} eklenemedi: dosya okunamadı`);
  return null;
}

// list: ek dizisi (sekmenin ya da Yeni sohbet ekranının), el: kartların çizildiği kutu
async function addAttachments(list, el, files) {
  for (const f of files) {
    const a = await readAttachment(f);
    if (a) list.push(a);
  }
  renderAttachments(list, el);
}

function renderAttachments(list, el) {
  el.innerHTML = '';
  for (const a of list) {
    const remove = h('button', { class: 'attach-x', title: 'Kaldır', onclick: () => { list.splice(list.indexOf(a), 1); renderAttachments(list, el); } }, '×');
    el.append(a.kind === 'image'
      ? h('div', { class: 'attach-thumb', title: a.name }, h('img', { src: a.url }), remove)
      : h('div', { class: 'attach-file', title: a.path || a.name }, fileChipBody(a.name, a.kind === 'text' ? 'İçerik eklendi' : 'Yol verildi'), remove));
  }
}

function fileChipBody(name, sub) {
  const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase().slice(0, 5);
  return [h('span', { class: 'af-ic' }, icon('file', 16)),
    h('span', { class: 'af-text' }, h('span', { class: 'af-name' }, name), h('small', {}, [ext, sub].filter(Boolean).join(' · ')))];
}

const xmlAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xmlUnattr = (s) => s.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// Dosyanın içindeki etiket bloğu kapatamasın: ardından gelen kısım Claude'a kullanıcının mesajı gibi görünürdü
const fileSafe = (s) => String(s).replace(/<(\/?attached_file)/gi, '‹$1');

function fileBlockText(a) {
  const attrs = `name="${xmlAttr(a.name)}"` + (a.path ? ` path="${xmlAttr(a.path)}"` : '');
  return a.kind === 'text'
    ? `<attached_file ${attrs}>\n${fileSafe(a.text)}\n</attached_file>`
    : `<attached_file ${attrs}>İçerik eklenmedi; gerekirse dosyayı bu yoldan okuyun.</attached_file>`;
}

function parseFileBlock(text) {
  const m = /^<attached_file name="([^"]*)"(?: path="([^"]*)")?>([\s\S]*)<\/attached_file>$/.exec(text);
  return m && { name: xmlUnattr(m[1]), path: m[2] ? xmlUnattr(m[2]) : '', embedded: m[3].startsWith('\n') };
}

// Gönderilen içerik: ek yoksa düz metin, varsa önce ekler, sonra satır yorumları (renderer/changes.js), sonra metin (Claude uygulaması gibi)
function messageContent(text, atts, comments = []) {
  if (!atts.length && !comments.length) return text;
  return [
    ...atts.map((a) => (a.kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }
      : { type: 'text', text: fileBlockText(a) })),
    ...comments,
    ...(text ? [{ type: 'text', text }] : []),
  ];
}

// typed: kullanıcı yazma kutusunda Enter'a ya da gönder düğmesine bastı. Kabuk kipi yalnız o zaman komut çalıştırır; öbür yollar
// (tur özeti düğmesi, yeni sohbet ekranı) kutuya kodla metin koyup buraya gelir, onların metni komut olarak çalışmaz.
function submit(tab, typed = false) {
  const text = tab.input.value.trim();
  if (tab.shellMode && typed) {
    if (!text || !tab.chatId) return;
    tab.slashBox.hidden = true;
    return runShell(tab, text); // renderer/kabuk.js
  }
  if (tab.shellMode) setShellMode(tab, false);
  if ((!text && !tab.attachments.length && !tab.lineComments?.length) || !tab.chatId) return;
  if (tab.reborning) return toast('Yeniden doğuş sürüyor; bitince yazabilirsiniz.'); // renderer/dogus.js
  if (tab.rewinding) return toast('Geri sarma sürüyor; bitince yazabilirsiniz.'); // ekler ve yorumlar kaybolmasın
  rememberPrompt(tab, text); // ↑ / Ctrl+R (renderer/istem.js)
  limitUserSent(tab); // sınırda otomatik devam kapanır (renderer/sinir.js)
  if (text === '/clear' || text === '/new') {
    tab.input.value = '';
    const { acctId, cwd } = tab;
    closeTab(tab, true);
    createChatTab(acctId, cwd, 'new');
    return;
  }
  const draft = { text, attachments: tab.attachments.slice(), comments: (tab.lineComments || []).slice() }; // sıradaysa geri alınabilir
  const content = messageContent(text, tab.attachments.splice(0), takeLineComments(tab));
  tab.attach.innerHTML = '';
  tab.input.value = '';
  tab.autosize?.();
  tab.slashBox.hidden = true;
  closeHistorySearch(tab);
  sendMessage(tab, content, draft);
}

// Kullanıcının mesajı olarak gider (yazma alanından ya da bir karttaki düğmeden; yazma alanındaki taslak korunur)
// opts.auto: panelin kendisi gönderiyor (sınırda otomatik devam: renderer/sinir.js)
function sendMessage(tab, content, draft, opts = {}) {
  if (!tab.chatId) return;
  if (tab.reborning) return toast('Yeniden doğuş sürüyor; bitince yazabilirsiniz.');
  if (tab.rewinding) return toast('Geri sarma sürüyor; bitince yazabilirsiniz.');
  if (!opts.auto) tab.autoTurns = 0; // kullanıcı yazdı: yan oturum ve PR bildirimleri yeniden kendiliğinden iletilebilir
  tab.suggestOk = false; // önceki turun önerisi geç gelirse atılır (renderer/istem.js)
  if (typeof content === 'string' && /^\/compact\b/.test(content)) tab.compactRequested = true; // "özetleniyor" notu (renderer/compaction.js)
  clearSuggestion(tab);
  closeWrapBoxes(tab);
  const uuid = crypto.randomUUID(); // Claude Code kayda ve kod checkpoint'ine bu kimlikle yazar (geri sarma)
  // Claude çalışıyor ya da önceki sıradaki mesaj henüz alınmadı: bu da sıraya girer
  userBubble(tab, content, tab.busy || !!tab.list.querySelector(':scope > .msg-user.queued'), uuid, draft);
  window.panel.chatSend(tab.chatId, content, uuid);
  tab.stick = true;
  scrollDown(tab, true);
  if (!tab.busy) setBusy(tab, true);
}

async function interrupt(tab) {
  if (!tab.chatId || !tab.busy) return;
  setStatus(tab, 'busy', 'Durduruluyor');
  // "Durdur" kuyruktakileri de çeker (chat-main.js → chat:interrupt); cancelled olayı önce gelmediyse burada geri konur
  const r = await window.panel.chatInterrupt(tab.chatId);
  const ids = (r?.cancelled || []).filter((u) => tab.queueReturned?.has(u) || queuedBubble(tab, u));
  for (const u of ids) { const el = queuedBubble(tab, u); if (el) returnQueued(tab, el); }
  if (ids.length) toast(ids.length === 1 ? 'Sıradaki mesaj yazma kutusuna geri kondu.' : `Sıradaki ${ids.length} mesaj yazma kutusuna geri kondu.`);
}

// ---------- Kuyruk: Claude çalışırken giden mesajlar (chat-main.js → command_lifecycle, chat:withdraw, chat:sendNow) ----------
// Claude Code mesajı sonraki araç adımında araya alır (araçsız turda tur bitince, kendi turunda). Alınana kadar balon listenin
// sonunda "Sırada" durur (append → tailAnchor); alınınca o anki yerine oturur. "Geri al" yazma kutusuna döndürür, "Hemen gönder"
// Claude'un şimdi okumasını ister (priority 'now'; yeni kimlikle, çünkü iptal edilen kimlik yeniden kullanılamıyor).
function queuedBubble(tab, uuid) {
  return [...tab.list.querySelectorAll(':scope > .msg-user.queued')].find((el) => el.dataset.uuid === uuid) || null;
}
function handleLifecycle(tab, msg) {
  const u = msg.command_uuid;
  if (typeof u !== 'string') return;
  (tab.cmdStates ||= new Map()).set(u, msg.state);
  if (tab.cmdStates.size > 300) tab.cmdStates.delete(tab.cmdStates.keys().next().value);
  const el = queuedBubble(tab, u);
  if (msg.state === 'started') {
    if (el) settleQueued(tab, el);
    if (!tab.busy) setBusy(tab, true); // tur bitmişken alındı: kendi turu başladı
  } else if (el && !el.__pending && ['cancelled', 'discarded', 'refused'].includes(msg.state)) returnQueued(tab, el); // gitmeyecek: metin kaybolmasın
}
// Alındı: sıradaki balon, sıradakilerin ve sabit görev kartının önüne (Claude'un o anki yerine) oturur; sonraki araçlar altında yeni grupta
function settleQueued(tab, el) {
  if (!el.classList.contains('queued')) return;
  el.classList.remove('queued', 'sending');
  el.querySelector('.mu-queue')?.remove();
  delete el.__draft;
  endGroup(tab);
  const stick = nearBottom(tab);
  const anchor = tailAnchor(tab, el);
  if (anchor) tab.list.insertBefore(el, anchor); else tab.list.append(el);
  if (stick) scrollDown(tab, true);
}
// Gitmedi (geri alındı, Durdur çekti): balon kalkar, yazma kutusuna olduğu gibi döner (yazılmakta olanın arkasına)
function returnQueued(tab, el) {
  const d = el.__draft || { text: el.querySelector('.user-text')?.textContent || '' };
  (tab.queueReturned ||= new Set()).add(el.dataset.uuid);
  el.remove();
  if (d.text) {
    tab.input.value = [tab.input.value.trim(), d.text].filter(Boolean).join('\n\n');
    tab.autosize?.();
    tab.sendBtn.hidden = tab.busy && !tab.input.value.trim();
  }
  if (d.attachments?.length) { tab.attachments.push(...d.attachments); renderAttachments(tab.attachments, tab.attach); }
  if (d.comments?.length) { tab.lineComments = [...(tab.lineComments || []), ...d.comments]; syncLineComments(tab); }
  tab.input.focus();
}
async function withdrawQueued(tab, el) {
  if (el.__pending || !tab.chatId) return;
  el.__pending = true;
  const r = await window.panel.chatWithdraw(tab.chatId, el.dataset.uuid);
  el.__pending = false;
  if (r?.ok) return returnQueued(tab, el);
  if (r?.taken) {
    if (tab.cmdStates?.get(el.dataset.uuid) === 'started') settleQueued(tab, el);
    return toast('Claude mesajı az önce aldı; geri alınamadı.');
  }
  toast('Geri alınamadı: ' + (r?.error || 'bilinmeyen hata'));
}
async function sendQueuedNow(tab, el) {
  if (el.__pending || !tab.chatId) return;
  el.__pending = true;
  el.classList.add('sending');
  el.querySelector('.muq-label').textContent = 'Gönderiliyor';
  const r = await window.panel.chatSendNow(tab.chatId, el.dataset.uuid);
  el.__pending = false;
  if (r?.ok) {
    el.dataset.uuid = r.uuid; // alındığını yeni kimlik söyler
    if (tab.cmdStates?.get(r.uuid) === 'started') settleQueued(tab, el);
    return;
  }
  el.classList.remove('sending');
  const label = el.querySelector('.muq-label');
  if (label) label.textContent = 'Sırada';
  if (r?.taken) {
    if (tab.cmdStates?.get(el.dataset.uuid) === 'started') settleQueued(tab, el);
    return toast('Claude mesajı az önce aldı.');
  }
  toast('Gönderilemedi: ' + (r?.error || 'bilinmeyen hata'));
}

// ---------- Geri sarma (Claude Code'un /rewind'i; ana süreç: chat-main.js → chat:rewindPreview / chat:rewind) ----------
// Balondaki düğme: önce ön izleme (kodda değişecek dosyalar, konuşma geri sarılabilir mi), sonra seçim penceresi.
// Konuşma geri sarılınca mesaj ve sonrası listeden kalkar, mesaj yazma kutusuna döner (düzeltip yeniden gönderilir).
async function openRewind(tab, el) {
  const uuid = el.dataset.uuid;
  if (!uuid || !tab.chatId || tab.exited) return toast('Sohbet kapalı; geri sarmak için önce "Devam et" ile açın.');
  if (tab.busy || tab.reborning || tab.rewinding) return toast('Claude çalışırken geri sarılamaz; turun bitmesini bekleyin ya da durdurun.');
  const p = await window.panel.chatRewindPreview(tab.chatId, uuid);
  if (!p?.ok) return toast(p?.error || 'Geri sarılamadı.');
  const choice = await rewindDialog(tab, p);
  if (!choice) return;
  tab.rewinding = true;
  setStatus(tab, 'busy', 'Geri sarılıyor');
  let r;
  try { r = await window.panel.chatRewind(tab.chatId, uuid, choice); } finally { tab.rewinding = false; setStatus(tab, tab.busy ? 'busy' : 'idle', ''); }
  const files = r?.files && p.code.filesChanged?.length
    ? ` (${p.code.filesChanged.length} dosya, +${p.code.insertions || 0} −${p.code.deletions || 0})` : '';
  if (r?.files) refreshChanges(tab);
  if (!r?.ok) {
    if (r?.files) note(tab, `Kod bu mesajın öncesine geri sarıldı${files}; konuşma geri sarılamadı.`, 'rewound');
    return toast('Geri sarılamadı: ' + (r?.error || 'bilinmeyen hata'));
  }
  if (choice.convo) {
    const text = el.querySelector('.user-text')?.textContent || '';
    const lost = el.querySelector('.user-imgs, .user-files') ? ' Ekleri yeniden eklemeniz gerekir.' : '';
    truncateFrom(tab, el);
    resetTasks(tab); // eski süreç kapandı, arka plan görevleri onunla
    note(tab, (choice.code ? `Kod ve konuşma bu mesajın öncesine geri sarıldı${files}.` : 'Konuşma bu mesajın öncesine geri sarıldı; dosyalara dokunulmadı.') + lost, 'rewound');
    if (text && !tab.input.value.trim()) setDraft(tab, text);
  } else {
    note(tab, `Kod bu mesajın öncesine geri sarıldı${files}; konuşma yerinde.`, 'rewound');
  }
  scrollDown(tab, true);
}

function rewindDialog(tab, { code, convo, bgTasks }) {
  const files = code.canRewind ? code.filesChanged || [] : [];
  const both = files.length > 0 && convo.ok;
  // Sağdaki birincil seçenek: ikisi, olmazsa konuşma, olmazsa kod
  const opts = [
    files.length && { key: 'code', label: 'Yalnız kodu', v: { code: true } },
    convo.ok && { key: 'convo', label: 'Yalnız konuşmayı', v: { convo: true } },
    both && { key: 'both', label: 'Kodu ve konuşmayı', v: { code: true, convo: true } },
  ].filter(Boolean);
  const rel = (f) => (f.startsWith(tab.cwd + '/') ? f.slice(tab.cwd.length + 1) : tilde(f));
  const codeText = !code.canRewind ? code.error
    : !files.length ? 'Bu mesajdan sonra Claude\'un dosya araçlarıyla değişen dosya yok.'
    : `${files.length} dosya bu mesajdan önceki hâline döner (+${code.insertions || 0} −${code.deletions || 0} satır).`;
  return new Promise((resolve) => {
    const done = (v) => { modal.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && opts.length) { e.preventDefault(); done(opts[opts.length - 1].v); }
    };
    const modal = h('div', { class: 'modal dlg rewind-dlg' },
      h('div', { class: 'modal-card dlg-card' },
        h('h2', {}, 'Bu mesaja geri sar'),
        h('div', { class: 'rw-sec', 'data-sec': 'code' }, h('div', { class: 'rw-head' }, icon('code', 14), 'Kod'), h('p', {}, codeText),
          files.length ? h('ul', { class: 'rw-files' }, ...files.slice(0, 6).map((f) => h('li', { title: f }, rel(f))),
            files.length > 6 ? h('li', { class: 'rw-more' }, `+${files.length - 6} dosya daha`) : null) : null),
        h('div', { class: 'rw-sec', 'data-sec': 'convo' }, h('div', { class: 'rw-head' }, icon('chat', 14), 'Konuşma'),
          h('p', {}, convo.ok ? 'Bu mesaj ve sonrası sohbetten silinir; mesaj yazma kutusuna geri gelir, düzeltip yeniden gönderebilirsiniz.' : convo.text),
          convo.ok && bgTasks ? h('p', { class: 'rw-warn' }, `Arka planda ${bgTasks} görev sürüyor; konuşma geri sarılırsa durur.`) : null),
        h('p', { class: 'rw-note' }, 'Bash komutlarının, alt ajanların ve yan oturumların değiştirdiği dosyalar geri gelmez.'),
        h('div', { class: 'modal-actions' },
          h('span', { class: 'spacer' }),
          h('button', { class: 'ghost-btn', onclick: () => done(null) }, opts.length ? 'Vazgeç' : 'Kapat'),
          ...opts.map((o, i) => h('button', { class: i === opts.length - 1 ? 'primary-btn' : 'ghost-btn', 'data-rewind': o.key, onclick: () => done(o.v) }, o.label)))));
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) done(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(modal);
    modal.querySelector('.primary-btn')?.focus();
  });
}

// Konuşma geri sarıldı: mesaj ve sonrası listeden kalkar. Silinen araç kartları unutulur (aynı kimlikli araç yeniden çizilebilsin),
// görev listesi kalan son karttaki hâline döner (renderer/wrapup.js → restorePlanAfterRewind)
function truncateFrom(tab, el) {
  const gone = [];
  for (let n = el; n; n = n.nextElementSibling) gone.push(n);
  for (const n of gone) n.remove();
  for (const [id, card] of tab.toolCards) if (!card.el.isConnected) tab.toolCards.delete(id);
  tab.planCalls?.clear();
  endGroup(tab);
  tab.wrapBox = null;
  tab.lastReplyAt = null;
  restorePlanAfterRewind(tab);
}

function openInTerminal(tab) {
  if (!tab.sessionId) { toast('Oturum henüz başlamadı; önce bir mesaj gönderin.'); return; }
  launch(tab.acctId, tab.cwd, 'resume-id', tab.sessionId, tab.envId);
}

// ---------- Geçmiş oturum seçici ----------

async function showSessionPicker(acctId, dir) {
  const a = acct(acctId);
  const listEl = h('div', { class: 'session-list' }, h('div', { class: 'empty-recent' }, 'Yükleniyor…'));
  const modal = h('div', { class: 'modal' },
    h('div', { class: 'modal-card' },
      h('div', { class: 'modal-head' },
        h('h2', {}, `Geçmiş oturumlar · ${a?.name} · ${tilde(dir)}`),
        h('button', { class: 'icon-btn', onclick: () => modal.remove() }, '✕')),
      listEl));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) modal.remove(); });
  document.body.append(modal);

  const r = await window.panel.chatSessions(acctId, dir);
  listEl.innerHTML = '';
  if (!r?.ok || !r.sessions?.length) {
    listEl.append(h('div', { class: 'empty-recent' }, r?.ok ? 'Bu klasörde geçmiş oturum yok.' : 'Okunamadı: ' + r?.error));
    return;
  }
  const fmt = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  for (const s of r.sessions) {
    listEl.append(h('div', { class: 'session-row' },
      h('div', { class: 'session-main', onclick: () => { modal.remove(); createChatTab(acctId, dir, 'resume', s.sessionId); } },
        h('div', { class: 'session-title' }, s.customTitle || s.summary || s.firstPrompt || s.sessionId),
        h('div', { class: 'session-meta' }, fmt.format(new Date(s.lastModified)), s.gitBranch ? ` · ${s.gitBranch}` : '')),
      h('button', { class: 'mini', title: 'Terminalde aç', onclick: () => { modal.remove(); launch(acctId, dir, 'resume-id', s.sessionId); } }, 'Terminal')));
  }
}

// ---------- Olay bağlantıları ----------

window.panel.onChatMsg(handleChatMsg);
window.panel.onChatEnd(handleChatEnd);
window.panel.onChatPermission(handlePermission);
window.panel.onChatPermissionDone(handlePermissionDone);
window.panel.onChatModels(handleModels);
