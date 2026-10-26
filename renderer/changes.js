/* Claude Panel — Değişiklikler bölmesi: sohbetin klasöründe HEAD'e göre değişen dosyalar ve diff'leri (changes.js),
   bir dosyanın satırları vurgulanmış görünümü. Git deposu değilse Claude'un bu oturumdaki düzenlemeleri gösterilir.
   Claude `show` aracıyla açar; kullanıcı sohbetin üst çubuğundaki "Değişiklikler" düğmesiyle. */

const CH_STATUS = { M: 'Değişti', A: 'Eklendi', D: 'Silindi', U: 'Yeni (izlenmiyor)' };
const DIFF_LIMIT = 3000; // bir dosyada ilk çizilen satır sayısı

// Bu oturumda Claude'un düzenlediği dosyalar (toolCard → recordEdit)
function recordEdit(tab, name, input) {
  const p = input?.file_path || input?.notebook_path;
  if (!p || typeof p !== 'string') return;
  const abs = p.startsWith('/') ? p : `${tab.cwd}/${p}`;
  (tab.edits ||= []).push({ path: abs, name, input });
}

function splitPath(rel) {
  const i = rel.lastIndexOf('/');
  return i < 0 ? ['', rel] : [rel.slice(0, i + 1), rel.slice(i + 1)];
}

function statSpan(added, removed) {
  return h('span', { class: 'ch-stat' },
    added ? h('span', { class: 'ch-add' }, '+' + added) : null,
    removed ? h('span', { class: 'ch-del' }, '−' + removed) : null);
}

// Birleşik diff → satır numaralı satırlar; ctx ({ tab, abs }) verilirse satırlara yorum yazılır
function unifiedView(text, ctx) {
  const box = h('div', { class: 'ch-diff' });
  const rows = [];
  let o = 0, n = 0, started = false;
  for (const line of String(text).split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (m) {
      started = true;
      o = +m[1]; n = +m[2];
      rows.push(['hunk', '', '', line]);
      continue;
    }
    if (!started) continue;
    if (line.startsWith('+')) rows.push(['add', '', n++, line.slice(1)]);
    else if (line.startsWith('-')) rows.push(['del', o++, '', line.slice(1)]);
    else if (line.startsWith(' ')) rows.push(['ctx', o++, n++, line.slice(1)]);
    else if (line.startsWith('\\')) rows.push(['note', '', '', line.slice(2)]);
  }
  if (!rows.length) return h('div', { class: 'ch-empty' }, /Binary files/.test(text) ? 'İkili dosya' : 'Gösterilecek satır yok');
  const draw = (list) => {
    box.append(...list.map(([k, a, b, t]) => {
      const row = h('div', { class: 'dl dl-' + k },
        h('span', { class: 'ln' }, a), h('span', { class: 'ln' }, b), h('span', { class: 'lc' }, t));
      if (ctx && (k === 'add' || k === 'del' || k === 'ctx')) commentRow(row, { k, o: a, n: b, t });
      return row;
    }));
    if (ctx) drawLineComments(ctx.tab, box);
  };
  if (ctx) commentable(ctx.tab, box, ctx.abs, 'diff');
  draw(rows.slice(0, DIFF_LIMIT));
  if (rows.length > DIFF_LIMIT) {
    const more = h('button', { class: 'mini ch-more', onclick: () => { more.remove(); draw(rows.slice(DIFF_LIMIT)); } },
      `Kalan ${rows.length - DIFF_LIMIT} satırı göster`);
    box.append(more);
  }
  return box;
}

// Git dışı klasör: Edit/Write girdilerinden diff
function editView(edits) {
  const box = h('div', { class: 'ch-diff' });
  const add = (k, t) => box.append(h('div', { class: 'dl dl-' + k }, h('span', { class: 'ln' }), h('span', { class: 'ln' }), h('span', { class: 'lc' }, t)));
  for (const e of edits) {
    const parts = e.name === 'MultiEdit' ? e.input.edits || [] : e.name === 'Write' ? [{ old_string: '', new_string: e.input.content }] : [e.input];
    for (const p of parts) {
      add('hunk', e.name === 'Write' ? 'Dosya yazıldı' : 'Düzenleme');
      if (p.old_string) for (const l of String(p.old_string).split('\n')) add('del', l);
      for (const l of String(p.new_string ?? '').split('\n')) add('add', l);
    }
  }
  return box;
}

function changesView(tab) {
  const titleEl = h('span', { class: 'ch-title' }, 'Değişiklikler');
  const statEl = h('span', { class: 'ch-sum' });
  const backBtn = h('button', { class: 'icon-btn', title: 'Değişikliklere dön', hidden: true, onclick: () => view.showChanges() }, icon('back', 16));
  const head = h('div', { class: 'ch-head' },
    backBtn, titleEl, statEl, h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Yenile', onclick: () => (view.mode === 'file' ? view.showFile(view.file.path, view.file.line, view.file.endLine) : view.showChanges()) }, icon('refresh', 16)),
    h('button', { class: 'icon-btn', title: 'Kapat', onclick: () => closeChangesInChat(tab) }, icon('close', 16)));
  const body = h('div', { class: 'ch-body' });
  const el = h('div', { class: 'ch-pane' }, head, body);
  const message = (text, cls = '') => { body.innerHTML = ''; body.append(h('div', { class: 'ch-empty ' + cls }, text)); };

  const fileActions = (abs) => h('span', { class: 'ch-actions' },
    h('button', { class: 'icon-btn', title: 'Dosyayı göster', onclick: (e) => { e.preventDefault(); view.showFile(abs); } }, icon('eye', 14)),
    h('button', { class: 'icon-btn', title: 'Editörde aç', onclick: async (e) => {
      e.preventDefault();
      const r = await window.panel.fileOpen(abs, view.mode === 'file' && view.file?.path === abs ? view.file.line : undefined);
      if (!r.ok) toast('Açılamadı: ' + r.error);
    } }, icon('external', 14)),
    h('button', { class: 'icon-btn', title: 'Finder\'da göster', onclick: (e) => { e.preventDefault(); window.panel.fileReveal(abs); } }, icon('folder', 14)));

  const view = {
    el, tab, mode: 'changes', file: null,
    async showChanges(focus) {
      view.mode = 'changes';
      backBtn.hidden = true;
      titleEl.textContent = 'Değişiklikler';
      const keepOpen = new Set([...body.querySelectorAll('.ch-file[open]')].map((d) => d.dataset.path));
      const r = await window.panel.changesList(tab.cwd);
      if (view.mode !== 'changes') return;
      if (!r.ok) { statEl.textContent = ''; return message('Değişiklikler okunamadı: ' + r.error, 'err'); }
      updateChangesBadge(tab, r);
      body.innerHTML = '';
      const touched = new Set((tab.edits || []).map((e) => e.path));

      if (!r.git) {
        const byFile = new Map();
        for (const e of tab.edits || []) byFile.set(e.path, [...(byFile.get(e.path) || []), e]);
        statEl.textContent = byFile.size ? `${byFile.size} dosya · bu oturum` : '';
        body.append(h('div', { class: 'ch-note' }, 'Klasör bir git deposu değil; yalnız Claude\'un bu oturumdaki düzenlemeleri gösteriliyor.'));
        if (!byFile.size) return body.append(h('div', { class: 'ch-empty' }, 'Claude bu oturumda dosya düzenlemedi.'));
        for (const [abs, edits] of byFile) {
          const [dir, name] = splitPath(relPath(tab, abs));
          body.append(h('details', { class: 'ch-file', 'data-path': abs, open: abs === focus || keepOpen.has(abs) },
            h('summary', {}, h('span', { class: 'ch-badge ch-M' }, 'M'), h('span', { class: 'ch-name' }, h('span', { class: 'ch-dir' }, dir), name),
              h('span', { class: 'spacer' }), fileActions(abs)),
            editView(edits)));
        }
        return;
      }

      const total = r.files.reduce((s, f) => [s[0] + f.added, s[1] + f.removed], [0, 0]);
      statEl.replaceChildren(r.files.length ? `${r.files.length} dosya ` : '', statSpan(total[0], total[1]));
      if (!r.files.length) return message('Çalışma ağacı temiz: son commit\'ten bu yana değişiklik yok.');
      for (const f of r.files) {
        const abs = `${r.root}/${f.path}`;
        const [dir, name] = splitPath(f.path);
        const d = h('details', { class: 'ch-file', 'data-path': abs },
          h('summary', {},
            h('span', { class: 'ch-badge ch-' + f.status, title: CH_STATUS[f.status] }, f.status),
            h('span', { class: 'ch-name', title: f.path }, h('span', { class: 'ch-dir' }, dir), name),
            touched.has(abs) ? h('span', { class: 'ch-touched', title: 'Claude bu oturumda düzenledi' }) : null,
            h('span', { class: 'spacer' }),
            f.binary ? h('span', { class: 'ch-stat' }, 'ikili') : statSpan(f.added, f.removed),
            f.status === 'D' ? null : fileActions(abs)),
          h('div', { class: 'ch-diff-slot' }));
        let loaded = false;
        d.addEventListener('toggle', async () => {
          if (!d.open || loaded) return;
          loaded = true;
          const slot = d.querySelector('.ch-diff-slot');
          const dr = await window.panel.changesDiff(r.root, f.path);
          slot.replaceChildren(dr.ok ? unifiedView(dr.diff, { tab, abs }) : h('div', { class: 'ch-empty err' }, dr.error),
            dr.truncated ? h('div', { class: 'ch-note' }, 'Diff çok büyük; kesildi.') : '');
        });
        body.append(d);
        if (abs === focus || keepOpen.has(abs)) d.open = true;
      }
      if (r.truncated) body.append(h('div', { class: 'ch-note' }, 'İlk 500 dosya gösteriliyor.'));
      body.querySelector(`.ch-file[open]`)?.scrollIntoView({ block: 'nearest' });
    },
    async showFile(abs, line, endLine) {
      view.mode = 'file';
      view.file = { path: abs, line, endLine };
      backBtn.hidden = false;
      const rel = relPath(tab, abs);
      titleEl.textContent = splitPath(rel)[1];
      titleEl.title = rel;
      statEl.textContent = line ? `satır ${line}${endLine && endLine !== line ? '–' + endLine : ''}` : '';
      const r = await window.panel.fileRead(abs);
      if (view.file?.path !== abs) return;
      if (!r.ok) return message('Dosya okunamadı: ' + r.error, 'err');
      const from = line || 0, to = endLine || line || 0;
      const lines = r.content.split('\n');
      if (lines.length > 1 && lines.at(-1) === '') lines.pop();
      const box = h('div', { class: 'ch-diff ch-source' }, h('div', { class: 'ch-path' }, rel, fileActions(abs)),
        ...lines.map((t, i) => commentRow(h('div', { class: 'dl' + (i + 1 >= from && i + 1 <= to ? ' dl-mark' : '') },
          h('span', { class: 'ln' }, i + 1), h('span', { class: 'lc' }, t)), { k: 'src', o: '', n: i + 1, t })));
      commentable(tab, box, abs, 'source');
      drawLineComments(tab, box);
      body.replaceChildren(box);
      box.querySelector('.dl-mark')?.scrollIntoView({ block: 'center' });
    },
    destroy() { el.remove(); },
  };
  return view;
}

// Üst çubuktaki "Değişiklikler" düğmesinde dosya sayısı
function updateChangesBadge(tab, r) {
  const badge = tab.changesBadge;
  if (!badge) return;
  const n = r?.ok && r.git ? r.files.length : 0;
  badge.textContent = n ? String(n) : '';
  badge.hidden = !n;
}

async function refreshChanges(tab) {
  if (!tab?.cwd) return;
  if (tab.changesView?.mode === 'changes') return tab.changesView.showChanges();
  updateChangesBadge(tab, await window.panel.changesList(tab.cwd));
}

function openChangesInChat(tab, opts = {}) {
  if (!tab || tab.kind !== 'chat') return;
  closeArtifactInChat(tab);
  closeSimulatorInChat(tab);
  closeBrowserInChat(tab);
  closeOctopusInChat(tab);
  if (!tab.changesView) {
    tab.changesView = changesView(tab);
    tab.changesPane.append(tab.changesView.el);
  }
  tab.host.classList.add('changes-open');
  if (opts.mode === 'file') tab.changesView.showFile(opts.path, opts.line, opts.endLine);
  else tab.changesView.showChanges(opts.path);
}

function closeChangesInChat(tab) {
  if (!tab?.changesView) return;
  tab.changesView.destroy();
  tab.changesView = null;
  tab.host.classList.remove('changes-open');
}

function toggleChangesInChat(tab) {
  if (tab?.changesView) closeChangesInChat(tab); else openChangesInChat(tab);
}

// ---------- Satır yorumları (Claude Code masaüstündeki diff yorumu, CLI'deki /diff → ask) ----------
// Satırın solundaki "+" ile yazılır; basılı sürükleyerek ya da kutu açıkken ⇧ ile tıklayarak aralık seçilir.
// Yorumlar sekmede birikir (tab.lineComments), yazma alanındaki çipte sayılır ve sonraki mesajla toplu gider
// (chat.js → submit, messageContent); kutudaki "Hemen gönder" (⌘Enter) yalnız o yorumu hemen yollar.
// Claude'a <satir-yorumu dosya="…" satir="12-14"> bloğu olarak gider: seçilen satırların kodu (diff'te +/-/boşluk önekli) ve yorum.
const COMMENT_CODE_MAX = 80; // blokta en çok bu kadar kod satırı
let commentSeq = 0;

// Kod ya da yorum bloğu kapatamasın: ardından gelen kısım Claude'a kullanıcının mesajı gibi görünürdü (chat.js → fileSafe gibi)
const commentSafe = (s) => String(s).replace(/<(\/?satir-yorumu)/gi, '‹$1');
const lineSpan = (a, b) => (a === b ? String(a) : `${a}-${b}`);
const rowKey = (r) => `${r.__row.k}:${r.__row.o}:${r.__row.n}`;
const lineRows = (box) => [...box.querySelectorAll(':scope > .dl')].filter((r) => r.__row);

// Satırı yorumlanabilir yapar: k = add | del | ctx (diff) ya da src (dosya görünümü), o/n eski/yeni satır numarası
function commentRow(row, data) {
  row.__row = data;
  row.prepend(h('button', { class: 'ln-add', tabindex: -1, title: 'Bu satıra yorum yaz (sürükleyerek ya da ⇧ ile aralık)', 'aria-label': 'Satıra yorum yaz' }, '+'));
  return row;
}

function commentable(tab, box, abs, kind) {
  box.dataset.path = abs;
  box.dataset.kind = kind;
  box.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.ln-add');
    if (!btn || e.button !== 0) return;
    e.preventDefault(); // sürüklerken metin seçilmesin
    const rows = lineRows(box);
    const at = rows.indexOf(btn.parentElement);
    const a = e.shiftKey && box.__sel ? box.__sel.a : at; // ⇧: açık kutunun ilk satırından buraya
    let b = at;
    const mark = () => {
      const [i, j] = a <= b ? [a, b] : [b, a];
      rows.forEach((r, k) => r.classList.toggle('dl-sel', k >= i && k <= j));
    };
    mark();
    const over = (ev) => { const k = rows.indexOf(ev.target.closest?.('.dl')); if (k >= 0) { b = k; mark(); } };
    const up = () => {
      box.removeEventListener('mouseover', over);
      window.removeEventListener('mouseup', up, true);
      box.__sel = { a, b };
      commentEditor(tab, box, rows.slice(Math.min(a, b), Math.max(a, b) + 1));
    };
    box.addEventListener('mouseover', over);
    window.addEventListener('mouseup', up, true);
  });
}

function makeComment(tab, box, range, text) {
  const diff = box.dataset.kind === 'diff';
  const news = range.map((r) => r.__row.n).filter(Boolean);
  const old = !news.length; // yalnız silinen satırlar: numaralar eski dosyanın (HEAD)
  const nums = old ? range.map((r) => r.__row.o).filter(Boolean) : news;
  const abs = box.dataset.path;
  return {
    // Claude'a sohbetin klasörüne göre göreli, dışındaysa tam yol (relPath'in ~'lı yolu değil)
    id: 'lc' + ++commentSeq, abs, file: abs.startsWith(tab.cwd + '/') ? abs.slice(tab.cwd.length + 1) : abs, kind: box.dataset.kind,
    from: Math.min(...nums), to: Math.max(...nums), old, diff,
    code: range.map((r) => (diff ? { add: '+', del: '-', ctx: ' ' }[r.__row.k] : '') + r.__row.t),
    keys: [rowKey(range[0]), rowKey(range.at(-1))], // bölme yeniden çizilince satırları bulmak için
    text,
  };
}

const commentLabel = (c) => `${c.old ? 'Silinen satır' : 'Satır'} ${lineSpan(c.from, c.to)}`;

// Tek açık kutu: yenisi açılınca eskisi kapanır (yeni yorumun yazısı taşınır). existing verilirse düzenleme.
function commentEditor(tab, box, range, existing) {
  const prev = box.querySelector(':scope > .lc-card.editing');
  const carried = prev && !prev.__existing ? prev.__text() : '';
  prev?.remove();
  if (existing) box.__sel = null; // ⇧ ile aralık yalnız yeni yorumda
  box.__editing = existing?.id || null;
  box.querySelectorAll(':scope > .dl-sel').forEach((r) => r.classList.remove('dl-sel'));
  for (const r of range) r.classList.add('dl-sel');
  drawLineComments(tab, box);
  const info = existing || makeComment(tab, box, range, '');
  const input = h('textarea', { class: 'lc-input', rows: 3, placeholder: 'Claude\'a bu satırlar hakkında yazın…' });
  input.value = existing ? existing.text : carried;
  const close = () => {
    card.remove();
    box.__sel = null;
    box.__editing = null;
    box.querySelectorAll(':scope > .dl-sel').forEach((r) => r.classList.remove('dl-sel'));
    drawLineComments(tab, box);
  };
  const save = (now) => {
    const text = input.value.trim();
    if (!text) return input.focus();
    if (existing) { existing.text = text; close(); return syncLineComments(tab); }
    const c = makeComment(tab, box, range, text);
    close();
    if (now && tab.chatId && !tab.exited && !tab.reborning && !tab.rewinding) return sendMessage(tab, [{ type: 'text', text: commentBlockText(c) }]);
    if (now) toast('Şu an gönderilemiyor; yorum sonraki mesajla gidecek.');
    (tab.lineComments ||= []).push(c);
    syncLineComments(tab);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(e.metaKey && !existing); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  const card = h('div', { class: 'lc-card editing' },
    h('div', { class: 'lc-head' }, icon('chat', 13), h('span', { class: 'lc-where' }, commentLabel(info))),
    input,
    h('div', { class: 'lc-actions' },
      existing ? null : h('span', { class: 'lc-hint' }, 'Enter: sonraki mesajla · ⌘Enter: hemen'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'mini', onclick: close }, 'İptal'),
      existing ? null : h('button', { class: 'mini lc-now', title: 'Yalnız bu yorumu şimdi gönder (⌘Enter)', onclick: () => save(true) }, 'Hemen gönder'),
      h('button', { class: 'mini main lc-save', title: 'Enter', onclick: () => save(false) }, existing ? 'Kaydet' : 'Yorum ekle')));
  card.__existing = !!existing;
  card.__text = () => input.value;
  range.at(-1).after(card);
  input.focus();
}

// Kutudaki bekleyen yorumlar: satırları işaretli, son satırın altında kart
function drawLineComments(tab, box) {
  box.querySelectorAll(':scope > .lc-card:not(.editing)').forEach((el) => el.remove());
  box.querySelectorAll(':scope > .dl-cm').forEach((r) => r.classList.remove('dl-cm'));
  const rows = lineRows(box);
  const at = new Map(rows.map((r, i) => [rowKey(r), i]));
  for (const c of tab.lineComments || []) {
    if (c.abs !== box.dataset.path || c.kind !== box.dataset.kind || box.__editing === c.id) continue;
    const i = at.get(c.keys[0]), j = at.get(c.keys[1]);
    if (i == null || j == null || j < i) continue; // dosya değişti, satırlar yok: yorum çipte durur
    const range = rows.slice(i, j + 1);
    for (const r of range) r.classList.add('dl-cm');
    range.at(-1).after(h('div', { class: 'lc-card', 'data-id': c.id },
      h('div', { class: 'lc-head' }, icon('chat', 13), h('span', { class: 'lc-where' }, commentLabel(c) + ' · sonraki mesajla gidecek'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'mini', onclick: () => commentEditor(tab, box, range, c) }, 'Düzenle'),
        h('button', { class: 'mini lc-del', onclick: () => removeLineComment(tab, c.id) }, 'Sil')),
      h('div', { class: 'lc-text' }, c.text)));
  }
}

function syncLineComments(tab) {
  renderCommentChip(tab);
  for (const box of tab.changesView?.el.querySelectorAll('.ch-diff[data-path]') || []) drawLineComments(tab, box);
}

function removeLineComment(tab, id) {
  tab.lineComments = (tab.lineComments || []).filter((c) => c.id !== id);
  syncLineComments(tab);
}

function revealLineComment(tab, c) {
  openChangesInChat(tab, c.kind === 'source' ? { mode: 'file', path: c.abs, line: c.from, endLine: c.to } : { path: c.abs });
}

// Yazma kutusunun başındaki çip: "N satır yorumu"; tıklanınca liste (yere git, tek tek ya da hepsini kaldır)
function renderCommentChip(tab) {
  const el = tab.commentsEl;
  if (!el) return;
  const list = tab.lineComments || [];
  el.hidden = !list.length;
  if (!list.length) tab.commentsOpen = false;
  el.replaceChildren(...(list.length ? [
    h('button', { class: 'cc-chip' + (tab.commentsOpen ? ' open' : ''), title: 'Yorumları göster', onclick: () => { tab.commentsOpen = !tab.commentsOpen; renderCommentChip(tab); } },
      icon('chat', 14), h('span', { class: 'cc-count' }, `${list.length} satır yorumu`), h('small', {}, 'sonraki mesajla gider'), icon('chevronDown', 12)),
    tab.commentsOpen ? h('div', { class: 'cc-list' },
      ...list.map((c) => h('div', { class: 'cc-item', 'data-id': c.id },
        h('button', { class: 'cc-go', title: 'Değişikliklerde göster', onclick: () => revealLineComment(tab, c) },
          h('span', { class: 'cc-loc' }, `${c.file}:${lineSpan(c.from, c.to)}`), h('span', { class: 'cc-text' }, c.text)),
        h('button', { class: 'icon-btn cc-x', title: 'Yorumu kaldır', onclick: () => removeLineComment(tab, c.id) }, icon('close', 12)))),
      h('button', { class: 'mini cc-clear', onclick: () => { tab.lineComments = []; syncLineComments(tab); } }, 'Hepsini kaldır')) : null,
  ].filter(Boolean) : []));
}

// Gönderilecek bloklar; bekleyen yorumlar boşalır
function takeLineComments(tab) {
  const list = tab.lineComments || [];
  if (!list.length) return [];
  tab.lineComments = [];
  syncLineComments(tab);
  return list.map((c) => ({ type: 'text', text: commentBlockText(c) }));
}

function commentBlockText(c) {
  const code = c.code.slice(0, COMMENT_CODE_MAX);
  // Çit koddaki en uzun ` dizisinden uzun: kod çiti kapatamaz
  const run = Math.max(0, ...code.map((l) => Math.max(0, ...(l.match(/`+/g) || []).map((x) => x.length))));
  const fence = '`'.repeat(Math.max(3, run + 1));
  const cut = c.code.length > code.length ? `(Kodun ilk ${code.length} satırı; aralık ${c.code.length} satır.)\n` : '';
  return `<satir-yorumu dosya="${xmlAttr(c.file)}" ${c.old ? 'silinen-satir' : 'satir'}="${lineSpan(c.from, c.to)}">\n`
    + `${fence}${c.diff ? 'diff' : ''}\n${commentSafe(code.join('\n'))}\n${fence}\n${cut}${commentSafe(c.text)}\n</satir-yorumu>`;
}

// Balonda (renderer/chat.js → userBubble; geçmişte de) bloğun yerine dosya:satır ve yorum
function parseCommentBlock(text) {
  const m = /^<satir-yorumu dosya="([^"]*)" (satir|silinen-satir)="([^"]*)">\n(`{3,})[a-z]*\n[\s\S]*?\n\4\n([\s\S]*)\n<\/satir-yorumu>$/.exec(text);
  return m && { file: xmlUnattr(m[1]), old: m[2] !== 'satir', lines: m[3], text: m[5].replace(/^\(Kodun ilk \d+ satırı; aralık \d+ satır\.\)\n/, '') };
}

window.panel.onChangesOpen((chatId, opts) => openChangesInChat(chatsById.get(chatId), opts || {}));
