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
};
const PUBLISH_TOOL = 'mcp__panel__publish_artifact';
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
// MCP araçlarında kod taşıyan alanlar (Blender execute_blender_code, Figma figma_execute…) kod bloğu olarak çizilir
const MCP_CODE_KEYS = ['code', 'script', 'python', 'javascript', 'js', 'sql'];
const MCP_LANGS = [[/blender/i, 'python'], [/figma|pencil/i, 'javascript'], [/unity/i, 'csharp']];
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
  other: (n) => `${n} araç`,
};

// ---------- Markdown ----------

// Claude'un yanıtındaki ham HTML: form ve düğme pencereyi dış siteye götürebilir, stil izin kartlarını örtebilir.
// input kalır (GFM görev listesi kutucukları); form olmadan bir yere gönderemez.
const PURIFY = {
  FORBID_TAGS: ['form', 'button', 'style', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'action', 'formaction'],
};

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

function toolLabel(name) {
  if (name === PUBLISH_TOOL) return 'Artifact yayımlandı';
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

async function createChatTab(acctId, cwd, mode, resumeId, opts = {}) {
  const a = acct(acctId);
  const pane = state.panes[acctId];
  if (!a || !pane) return;
  if (state.active !== acctId || state.view[acctId] !== 'code') selectAccount(acctId, 'code');

  const prefs = state.cfg.chatPrefs?.[acctId] || {};
  const tab = {
    kind: 'chat', acctId, cwd, mode, title: '…', exited: false, activity: false, attention: false,
    chatId: null, sessionId: resumeId || null, busy: false, models: [], model: '', effort: prefs.effort || '',
    modelChoice: prefs.model || '', permissionMode: prefs.mode || '',
    toolCards: new Map(), live: new Map(), images: [], slash: [], pendingPerms: new Map(),
    group: null, todos: [], started: false,
  };

  // --- Üst çubuk
  const titleEl = h('div', { class: 'ct-title' }, a.name, h('span', { class: 'ct-sep' }, '·'), h('span', { class: 'ct-folder' }, tilde(cwd).split('/').pop() || cwd));
  const statusEl = h('span', { class: 'ct-status' });
  const sideBtn = h('button', { class: 'icon-btn', title: 'Yan paneli aç/kapat', onclick: () => toggleSide(tab) }, icon('panel', 17));
  const top = h('div', { class: 'chat-top' },
    titleEl, statusEl, h('span', { class: 'spacer' }),
    h('button', { class: 'top-btn', title: 'Bu oturumu terminalde aç', onclick: () => openInTerminal(tab) }, icon('terminal', 15), 'Terminal'),
    sideBtn);

  // --- Mesaj listesi ve boş ekran
  const list = h('div', { class: 'chat-list' });
  const welcome = h('div', { class: 'chat-welcome' },
    h('div', { class: 'welcome-mark' }, '✳'),
    h('div', { class: 'welcome-title' }, `${tilde(cwd).split('/').pop() || 'Proje'} üzerinde ne yapalım?`),
    h('div', { class: 'welcome-sub' }, `${a.name} hesabı · ${tilde(cwd)}`));
  const scroller = h('div', { class: 'chat-scroll' }, welcome, list);

  // --- Yazma alanı
  const input = h('textarea', { class: 'composer-input', rows: 1, placeholder: 'Claude\'a yazın…' });
  const attach = h('div', { class: 'composer-attach' });
  const slashBox = h('div', { class: 'slash-box', hidden: true });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: (e) => { [...e.target.files].forEach((f) => addImage(tab, f)); e.target.value = ''; } });
  const sendBtn = h('button', { class: 'send-btn', title: 'Gönder (Enter)', onclick: () => submit(tab) }, icon('arrowUp', 17));
  const stopBtn = h('button', { class: 'stop-btn', title: 'Durdur (Esc)', hidden: true, onclick: () => interrupt(tab) }, h('span'));
  const modeSel = selectEl('meta-select', 'İzin modu (Shift+Tab)', MODES, (v) => changeMode(tab, v));
  const picker = modelPicker(acctId,
    () => ({ model: tab.modelChoice || '', effort: tab.effort || '', resolved: tab.model, models: tab.models }),
    (patch) => ('model' in patch ? changeModel(tab, patch.model) : changeEffort(tab, patch.effort)));
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'composer-inner' },
      slashBox,
      h('div', { class: 'composer-box' },
        attach, input,
        h('div', { class: 'composer-bar' },
          h('button', { class: 'plus-btn', title: 'Görsel ekle', onclick: () => fileInput.click() }, icon('plus', 17)),
          fileInput,
          h('span', { class: 'spacer' }),
          stopBtn, sendBtn)),
      h('div', { class: 'composer-meta' },
        h('span', { class: 'meta-folder', title: cwd }, icon('folder', 14), tilde(cwd).split('/').pop() || cwd),
        modeSel,
        h('span', { class: 'spacer' }),
        picker, usageButton(acctId))));

  // --- Yan panel
  const progressBody = h('div', { class: 'side-body' }, h('div', { class: 'side-empty' }, 'Claude görev listesi oluşturunca burada görünür.'));
  const progressCount = h('span', { class: 'side-count' });
  const contextBody = h('div', { class: 'side-body' }, h('div', { class: 'side-row' }, icon('folder', 14), tilde(cwd)));
  const sessionBody = h('div', { class: 'side-body' }, h('div', { class: 'side-empty' }, '—'));
  const side = h('aside', { class: 'chat-side' },
    h('details', { class: 'side-sec', open: true }, h('summary', {}, 'İlerleme', progressCount), progressBody),
    h('details', { class: 'side-sec', open: true }, h('summary', {}, 'Bağlam'), contextBody),
    h('details', { class: 'side-sec', open: true }, h('summary', {}, 'Oturum'), sessionBody));

  const main = h('div', { class: 'chat-main' }, top, scroller, composer);
  const artPane = h('div', { class: 'chat-art' });
  const host = h('div', { class: 'term-host chat-host active' + (window.innerWidth > 1250 ? ' side-open' : '') }, main, artPane, side);
  host.__tab = tab;
  Object.assign(tab, {
    host, list, scroller, artPane, welcome, input, attach, slashBox, sendBtn, stopBtn, picker, modeSel,
    statusEl, progressBody, progressCount, contextBody, sessionBody,
  });
  syncSelects(tab);

  pane.termArea.append(host);
  pane.launcher.classList.remove('active');
  for (const t of state.tabs[acctId]) t.host.classList.remove('active');

  wireComposer(tab);
  list.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link) { e.preventDefault(); window.panel.openExternal(link.href); }
  });

  state.tabs[acctId].push(tab);
  state.activeTab[acctId] = tab;
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
      divider(tab, 'Buradan devam ediliyor');
    }
  }

  const res = await window.panel.chatStart({
    accountId: acctId, cwd, mode, resumeId,
    model: tab.modelChoice || undefined,
    effort: tab.effort || undefined,
    permissionMode: tab.permissionMode || undefined,
  });
  if (!res.ok) {
    setStatus(tab, 'error', 'Başlatılamadı');
    markStarted(tab);
    note(tab, 'Claude Code başlatılamadı: ' + res.error + loginHint(res.error), 'error');
    tab.exited = true;
    renderTabs(acctId);
    return;
  }
  tab.chatId = res.id;
  tab.cwd = res.cwd;
  tab.title = res.title;
  chatsById.set(res.id, tab);
  setStatus(tab, 'idle', '');
  renderTabs(acctId);
  renderSidebar();
  focusCurrent();
  scrollDown(tab, true);
  if (opts.send) { tab.input.value = opts.send; submit(tab); }
  else if (opts.draft) setDraft(tab, opts.draft);
}

function setDraft(tab, text) {
  tab.input.value = text;
  tab.autosize?.();
  requestAnimationFrame(() => { tab.input.focus(); tab.input.setSelectionRange(text.length, text.length); });
}

function toggleSide(tab) {
  tab.host.classList.toggle('side-open');
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
  tab.list.append(el);
  if (stick) scrollDown(tab, true);
  return el;
}
function note(tab, text, cls = '') {
  return append(tab, h('div', { class: 'chat-note ' + cls }, text));
}
function divider(tab, text) {
  endGroup(tab);
  return append(tab, h('div', { class: 'chat-divider' }, h('span', {}, text)));
}
function setStatus(tab, kind, text) {
  tab.statusEl.className = 'ct-status ' + kind;
  tab.statusEl.textContent = text;
}
function setBusy(tab, busy) {
  tab.busy = busy;
  tab.stopBtn.hidden = !busy;
  tab.sendBtn.hidden = busy && !tab.input.value.trim();
  setStatus(tab, busy ? 'busy' : 'idle', busy ? 'Çalışıyor' : '');
  renderTabs(tab.acctId);
}

function userBubble(tab, content, queued) {
  const text = typeof content === 'string' ? content : (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const imgs = Array.isArray(content) ? content.filter((b) => b.type === 'image') : [];
  // Sistem tarafından eklenen içerikleri (komut çıktıları, hatırlatmalar) gizle
  if (!imgs.length && /^\s*<(command-|local-command|system-reminder|bash-)/.test(text)) return null;
  markStarted(tab);
  endGroup(tab);
  const el = h('div', { class: 'msg-user' + (queued ? ' queued' : '') },
    imgs.length ? h('div', { class: 'user-imgs' }, imgs.map((b) => h('img', { src: `data:${b.source?.media_type};base64,${b.source?.data}` }))) : null,
    text ? h('div', { class: 'user-text' }, text) : null);
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
  const el = h('details', { class: 'tool-group' }, h('summary', {}, spinner, summaryText, h('span', { class: 'grp-chev' }, '›')), body);
  // Araçların döndürdüğü görseller grup kapalıyken de görünsün diye grubun hemen altına
  const shots = h('div', { class: 'grp-shots' });
  const group = { el, body, shots, summaryText, spinner, counts: {}, running: new Set(), errors: 0, last: '' };
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
}

function toolCard(tab, block, parentCard) {
  const { id, name, input } = block;
  if (tab.toolCards.has(id)) return tab.toolCards.get(id).el;
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
  const card = { el, status, body, sub, name, input, group: null };
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
    if (nearBottom(tab)) scrollDown(tab, true);
  }
  if (name === 'TodoWrite') updateProgress(tab, input.todos);
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
}

function finishGroups(tab) {
  // Tur bittiğinde hâlâ "çalışıyor" görünen satırları kapat
  for (const card of tab.toolCards.values()) {
    if (card.status.classList.contains('running')) card.status.className = 'tool-status done';
    if (card.group) { card.group.running.clear(); updateGroup(tab, card.group); }
  }
}

// ---------- Yan panel ----------

function updateProgress(tab, todos) {
  tab.todos = todos || [];
  const done = tab.todos.filter((t) => t.status === 'completed').length;
  tab.progressCount.textContent = tab.todos.length ? `${done} / ${tab.todos.length}` : '';
  tab.progressBody.innerHTML = '';
  tab.progressBody.append(tab.todos.length ? todoList(tab.todos) : h('div', { class: 'side-empty' }, 'Görev yok.'));
}

function updateContext(tab, init) {
  const rows = [h('div', { class: 'side-row' }, icon('folder', 14), tilde(init.cwd || tab.cwd))];
  const mcp = init.mcp_servers || [];
  if (mcp.length) {
    rows.push(h('div', { class: 'side-label' }, 'MCP sunucuları'));
    rows.push(h('div', { class: 'side-chips' }, mcp.map((s) =>
      h('span', { class: 'side-chip' + (s.status === 'connected' ? '' : ' off'), title: s.status }, s.name))));
  }
  if ((init.skills || []).length) {
    rows.push(h('div', { class: 'side-label' }, `Skill'ler (${init.skills.length})`));
    rows.push(h('div', { class: 'side-chips' }, init.skills.slice(0, 30).map((s) => h('span', { class: 'side-chip' }, s))));
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
      if (!parent && fromHistory) userBubble(tab, content);
      return;
    }
    const results = (content || []).filter((b) => b.type === 'tool_result');
    for (const r of results) toolResult(tab, r);
    if (!results.length && !parent && fromHistory) userBubble(tab, content);
  }
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
    case 'assistant': {
      const id = msg.message?.id;
      const types = new Set((msg.message?.content || []).map((b) => b.type));
      for (const [key, live] of tab.live) {
        if (key.startsWith(id + ':') && types.has(live.type)) { live.el.remove(); tab.live.delete(key); }
      }
      renderBlocks(tab, msg, false);
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
      refreshUsageSoon(tab.acctId);
      const secs = Math.round((msg.duration_ms || 0) / 1000);
      updateSession(tab, { lastTurn: secs >= 60 ? `${Math.floor(secs / 60)} dk ${secs % 60} sn` : `${secs} sn` });
      if (msg.is_error || msg.subtype !== 'success') {
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
    case 'rate_limit_event': {
      const info = msg.rate_limit_info || {};
      refreshUsageSoon(tab.acctId);
      if (info.status && info.status !== 'allowed') note(tab, 'Kullanım limiti: ' + (info.status === 'allowed_warning' ? 'limite yaklaşıldı' : 'limite ulaşıldı'), 'warn');
      return;
    }
    default:
      return;
  }
}

function handleSystem(tab, msg) {
  switch (msg.subtype) {
    case 'init': {
      tab.slash = (msg.slash_commands || []).map((c) => '/' + c.replace(/^\//, ''));
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
        tab.hookText = String(text).slice(0, 600);
        tab.welcome.querySelector('.welcome-hook')?.remove();
        if (!tab.started) tab.welcome.append(h('div', { class: 'welcome-hook' }, tab.hookText));
        else note(tab, tab.hookText, 'muted hook');
      }
      return;
    }
    case 'status':
      if (msg.permissionMode) { tab.permissionMode = msg.permissionMode; syncSelects(tab); }
      if (msg.status === 'compacting') note(tab, 'Sohbet özetleniyor…', 'muted');
      return;
    case 'compact_boundary':
      divider(tab, 'Sohbet özetlendi');
      return;
    case 'api_retry':
      setStatus(tab, 'busy', `Yeniden deneniyor (${msg.attempt}/${msg.max_retries})`);
      return;
    case 'session_state_changed':
      if (msg.state === 'running' && !tab.busy) setBusy(tab, true);
      if (msg.state === 'idle' && tab.busy) setBusy(tab, false);
      return;
    case 'local_command_output':
    case 'informational':
    case 'notification':
      if (msg.content || msg.text) note(tab, msg.content || msg.text, msg.level === 'warning' ? 'warn' : 'muted');
      return;
    case 'commands_changed':
      if (Array.isArray(msg.slash_commands)) tab.slash = msg.slash_commands.map((c) => '/' + String(c.name || c).replace(/^\//, ''));
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
  tab.stopBtn.hidden = true;
  tab.sendBtn.hidden = false;
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
    card.classList.add('answered');
  };

  let card;
  if (req.toolName === 'AskUserQuestion') card = questionCard(tab, req, reply);
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
  endGroup(tab);
  tab.pendingPerms.set(req.rid, card);
  append(tab, card);
  scrollDown(tab, true);
  if (!isVisible(tab) || !document.hasFocus()) flagAttention(tab, 'Claude onayınızı bekliyor');
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

function handlePermissionDone(chatId, rid) {
  const tab = chatsById.get(chatId);
  const card = tab?.pendingPerms.get(rid);
  if (!card) return;
  tab.pendingPerms.delete(rid);
  card.classList.add('answered');
  for (const b of card.querySelectorAll('button, input')) b.disabled = true;
  if (!tab.pendingPerms.size && tab.attention && isVisible(tab)) clearFlags(tab);
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
    input.style.height = Math.min(input.scrollHeight, 300) + 'px';
    if (tab.busy) tab.sendBtn.hidden = !input.value.trim();
  };
  tab.autosize = autosize;
  input.addEventListener('input', () => { autosize(); updateSlash(tab); });
  input.addEventListener('keydown', (e) => {
    if (!tab.slashBox.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
      const items = [...tab.slashBox.children];
      let i = items.findIndex((x) => x.classList.contains('on'));
      if (e.key === 'ArrowDown') i = (i + 1) % items.length;
      else if (e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length;
      else { input.value = items[Math.max(i, 0)].dataset.cmd + ' '; tab.slashBox.hidden = true; e.preventDefault(); return; }
      items.forEach((x, j) => x.classList.toggle('on', j === i));
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(tab); }
    else if (e.key === 'Escape') { if (!tab.slashBox.hidden) tab.slashBox.hidden = true; else if (tab.busy) interrupt(tab); }
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(tab); }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); files.forEach((f) => addImage(tab, f)); }
  });
  tab.host.addEventListener('dragover', (e) => { e.preventDefault(); });
  tab.host.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if (f.type.startsWith('image/')) addImage(tab, f);
      else if (f.path) { input.value += (input.value ? ' ' : '') + '@' + relPath(tab, f.path); autosize(); }
    }
    input.focus();
  });
  tab.scroller.addEventListener('scroll', () => { tab.stick = nearBottom(tab); });
}

function updateSlash(tab) {
  const v = tab.input.value;
  const box = tab.slashBox;
  if (!/^\/[^\s]*$/.test(v) || !tab.slash.length) { box.hidden = true; return; }
  const matches = tab.slash.filter((c) => c.toLowerCase().startsWith(v.toLowerCase())).slice(0, 8);
  box.innerHTML = '';
  matches.forEach((c, i) => box.append(h('div', {
    class: 'slash-item' + (i === 0 ? ' on' : ''), 'data-cmd': c,
    onmousedown: (e) => { e.preventDefault(); tab.input.value = c + ' '; box.hidden = true; tab.input.focus(); },
  }, c)));
  box.hidden = !matches.length;
}

function addImage(tab, file) {
  const reader = new FileReader();
  reader.onload = () => {
    const [meta, data] = String(reader.result).split(',');
    const mediaType = meta.match(/data:(.*?);/)?.[1] || 'image/png';
    const img = { mediaType, data };
    tab.images.push(img);
    const thumb = h('div', { class: 'attach-thumb' },
      h('img', { src: reader.result }),
      h('button', { class: 'attach-x', onclick: () => { tab.images.splice(tab.images.indexOf(img), 1); thumb.remove(); } }, '×'));
    tab.attach.append(thumb);
  };
  reader.readAsDataURL(file);
}

function submit(tab) {
  const text = tab.input.value.trim();
  if ((!text && !tab.images.length) || !tab.chatId) return;
  if (text === '/clear' || text === '/new') {
    tab.input.value = '';
    const { acctId, cwd } = tab;
    closeTab(tab, true);
    createChatTab(acctId, cwd, 'new');
    return;
  }
  const images = tab.images.splice(0);
  tab.attach.innerHTML = '';
  const content = images.length
    ? [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })), { type: 'text', text }]
    : text;
  userBubble(tab, content, tab.busy);
  window.panel.chatSend(tab.chatId, text, images);
  tab.input.value = '';
  tab.autosize?.();
  tab.slashBox.hidden = true;
  tab.stick = true;
  scrollDown(tab, true);
  if (!tab.busy) setBusy(tab, true);
}

async function interrupt(tab) {
  if (!tab.chatId || !tab.busy) return;
  setStatus(tab, 'busy', 'Durduruluyor');
  await window.panel.chatInterrupt(tab.chatId);
}

function openInTerminal(tab) {
  if (!tab.sessionId) { toast('Oturum henüz başlamadı; önce bir mesaj gönderin.'); return; }
  launch(tab.acctId, tab.cwd, 'resume-id', tab.sessionId);
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
    listEl.append(h('div', { class: 'empty-recent' }, r?.ok ? 'Bu klasörde bu hesapla açılmış oturum yok.' : 'Okunamadı: ' + r?.error));
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
