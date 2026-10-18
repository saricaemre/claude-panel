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

// Birleşik diff → satır numaralı satırlar
function unifiedView(text) {
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
  const draw = (list) => box.append(...list.map(([k, a, b, t]) => h('div', { class: 'dl dl-' + k },
    h('span', { class: 'ln' }, a), h('span', { class: 'ln' }, b), h('span', { class: 'lc' }, t))));
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
          slot.replaceChildren(dr.ok ? unifiedView(dr.diff) : h('div', { class: 'ch-empty err' }, dr.error),
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
        ...lines.map((t, i) => h('div', { class: 'dl' + (i + 1 >= from && i + 1 <= to ? ' dl-mark' : '') },
          h('span', { class: 'ln' }, i + 1), h('span', { class: 'lc' }, t))));
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

window.panel.onChangesOpen((chatId, opts) => openChangesInChat(chatsById.get(chatId), opts || {}));
