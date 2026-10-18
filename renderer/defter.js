// Defter sekmesi (OCTOPUS-PLANI.md §7.4, P5.1): başın ahtapot bölmesinde "Ahtapot"un yanında (renderer/octopus.js → octopusView).
// Satırlar listelenir, eklenir, düzenlenir, sabitlenir, birinin yerine konur, kapatılır, geri alınır. Hiçbiri silmez:
// her işlem defter.jsonl'e yeni bir olay olarak eklenir (defter.js → apply). Kaynak bağlantısı satırın yazıldığı anı
// hafıza dizininden açar (hatirla_oku ile aynı okuma). Sohbetteki defter satırlarının "Geri al"ı da buradaki geri almayla aynı.
// "Dosyalardan al" (P5.2): projenin kendi karar dosyaları (ör. docs/kararlar/K*.md) salt okunur satırlar olarak gelir; düzenlenmez,
// sabitlenir, kapatılır, yerine yenisi konur (bunlar da defterde olaydır, dosyaya yazılmaz). Desen ahtapotun kaydında durur.

const DF_TYPES = { karar: 'karar', ret: 'ret', zevk: 'zevk', kural: 'kural', acik: 'açık iş', bilgi: 'bilgi' };
const DF_BY = { bas: 'Beyin', kullanici: 'Sen', 'ice-aktarma': 'Dosya' };
const DF_OPS = { listele: 'liste', ekle: 'ekle', duzenle: 'düzelt', yerine_koy: 'yerine koy', kapat: 'kapat' };
const dfDay = (ts) => (ts ? new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '');

// Ana süreçte defter değişince açık Defter sekmeleri yenilenir
window.panel.onDefterChanged((octoId) => {
  for (const list of Object.values(state.tabs)) for (const t of list) if (t.octopusId === octoId) t.octoView?.defter?.refresh();
});

function defterView(tab) {
  const typeSel = h('select', { class: 'df-filter', title: 'Tür' },
    h('option', { value: '' }, 'Bütün türler'), Object.entries(DF_TYPES).map(([k, v]) => h('option', { value: k }, v)));
  const allBox = h('input', { type: 'checkbox', class: 'df-all' });
  const bar = h('div', { class: 'df-bar' },
    h('button', { class: 'mini main df-add', onclick: () => openForm('add', null) }, icon('plus', 13), 'Satır ekle'),
    h('button', { class: 'mini df-import', title: 'Projenin kendi karar dosyalarını salt okunur satırlar olarak al', onclick: () => openImportForm() }, icon('file', 13), 'Dosyalardan al'),
    h('span', { class: 'spacer' }),
    typeSel,
    h('label', { class: 'df-all-l', title: 'Kapanan ve yerini başkasına bırakan satırlar da' }, allBox, 'Kapananlar'));
  const formHost = h('div', { class: 'df-form-host' });
  const note = h('div', { class: 'df-note' });
  const list = h('div', { class: 'df-list' });
  const el = h('div', { class: 'df-pane', hidden: true }, bar, formHost, note, list);
  let rows = [], seq = 0, form = null, failed = '', imports = [], root = '';

  async function refresh() {
    if (!tab.octopusId) return;
    const mine = ++seq;
    const r = await window.panel.defterList(tab.octopusId);
    if (mine !== seq) return;
    rows = r?.ok ? r.rows : [];
    imports = r?.ok ? r.imports || [] : [];
    root = r?.ok ? r.root || '' : '';
    failed = r?.ok ? '' : r?.error || 'Defter okunamadı.';
    render();
  }

  const act = async (op, args, ok) => {
    const r = await window.panel.defterApply(tab.octopusId, op, args);
    if (!r?.ok) { toast(r?.error || 'Defter yazılamadı.'); return false; }
    if (ok) toast(ok);
    return true;
  };

  function render() {
    const open = rows.filter((r) => r.status === 'open');
    const files = rows.filter((r) => r.imported).length;
    const shown = rows.filter((r) => (allBox.checked || r.status === 'open') && (!typeSel.value || r.type === typeSel.value));
    note.textContent = failed || (!rows.length
      ? 'Defter boş. Beyin ret, zevk, karar, kural ve açık işleri buraya yazar; sen de ekleyebilirsin. Hiçbir satır silinmez, her değişiklik geri alınabilir.'
      : `${open.length} açık satır` + (rows.length > open.length ? ` · ${rows.length - open.length} kapanan` : '')
        + (files ? ` · ${files} satır dosyalardan (${imports.join(', ')}; salt okunur)` : '') + '. Sıra: sabitlenenler, kural, ret, zevk, karar, açık iş, bilgi.');
    list.replaceChildren(...shown.map(rowEl));
  }

  function rowEl(r) {
    const byId = (id) => rows.find((x) => x.id === id);
    const status = r.status === 'superseded' ? `yerini ${r.supersededBy} aldı` : r.status === 'closed' ? 'kapandı' : '';
    const replaces = rows.filter((x) => x.supersededBy === r.id).map((x) => x.id);
    const btn = (label, title, onclick, cls = '') => h('button', { class: 'mini df-act ' + cls, title, onclick }, label);
    return h('div', { class: 'df-row', 'data-id': r.id, 'data-type': r.type, 'data-status': r.status, 'data-pinned': r.pinned ? '1' : null },
      h('div', { class: 'df-meta' },
        h('span', { class: 'df-type t-' + r.type }, DF_TYPES[r.type] || r.type),
        h('span', { class: 'df-id' }, r.id),
        r.pinned ? h('span', { class: 'df-pin', title: 'Sabit: masaya önce konur' }, icon('pin', 12)) : null,
        r.imported ? h('span', { class: 'df-file', title: 'Projenin dosyası; salt okunur' }, icon('file', 12), r.file) : null,
        h('span', {}, dfDay(r.at) + (r.imported ? '' : ' · ' + (DF_BY[r.by] || r.by))),
        replaces.length ? h('span', {}, replaces.join(', ') + ' yerine') : null,
        status ? h('span', { class: 'df-status' }, status) : null),
      h('div', { class: 'df-text' }, r.text),
      r.why ? h('div', { class: 'df-why' }, r.why) : null,
      r.closeWhy ? h('div', { class: 'df-why' }, 'Kapanış: ' + r.closeWhy) : null,
      h('div', { class: 'df-actions' },
        r.imported ? null : btn('Düzenle', 'Metni, gerekçeyi ya da türü düzelt (eski hâli defterde kalır)', () => openForm('edit', r), 'df-edit'),
        r.status === 'open' ? btn(r.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle', 'Sabit satırlar masaya önce konur', () => act(r.pinned ? 'unpin' : 'pin', { id: r.id }), 'df-pinb') : null,
        r.status === 'open' ? btn('Yerine koy', 'Bu satırın yerine yenisini yaz; eskisi "yerini aldı" olarak kalır', () => openForm('supersede', r), 'df-sup') : null,
        r.status === 'open' ? btn('Kapat', 'Biten iş ya da artık geçerli olmayan satır', () => act('close', { id: r.id }), 'df-close') : null,
        r.source?.sessionId ? btn('Kaynak', 'Satırın yazıldığı an (hafızadan, kelimesi kelimesine)', () => openDefterSource(tab, r), 'df-src') : null,
        r.imported && root ? btn('Dosyayı aç', 'Editörde aç (yalnız okumak için; defter dosyaya yazmaz)', () => window.panel.fileOpen(root + '/' + r.file), 'df-open') : null,
        r.status === 'superseded' && byId(r.supersededBy) ? btn(r.supersededBy + '\'e git', '', () => list.querySelector(`.df-row[data-id="${r.supersededBy}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })) : null,
        r.events.length ? btn('Geri al', 'Bu satırdaki son değişikliği geri al (geri alma da defterde bir olay olarak kalır)', () => undoLast(r), 'df-undo') : null));
  }

  async function undoLast(r) {
    const last = r.events[r.events.length - 1];
    if (r.events.length === 1 && !r.imported) {
      const ok = await dialogModal({ title: r.id + ' geri alınsın mı?', body: 'Satır defterden kalkar. Olay günlüğünde eklenmesi ve geri alınması durur.', okLabel: 'Geri al' });
      if (!ok) return;
    }
    // Yerine koyma iki olaydır (yeni satır + eskinin kapanması); yeni satırın eklenmesi geri alınınca eskisi kendiliğinden açılır
    await act('revert', { ns: [last] }, r.id + ': son değişiklik geri alındı');
  }

  function openForm(mode, r) {
    closeForm();
    const type = h('select', { class: 'df-ftype' }, Object.entries(DF_TYPES).map(([k, v]) => h('option', { value: k }, v)));
    type.value = r?.type || 'karar';
    const text = h('textarea', { class: 'dlg-input df-ftext', rows: 3, maxlength: 600, placeholder: 'Satır: kısa ve kendi başına anlaşılır', spellcheck: 'false' });
    text.value = mode === 'edit' || mode === 'supersede' ? r.text : '';
    const why = h('input', { type: 'text', class: 'dlg-input df-fwhy', maxlength: 600, placeholder: 'Neden (isteğe bağlı)', spellcheck: 'false' });
    why.value = mode === 'edit' ? r.why : '';
    const title = { add: 'Yeni satır', edit: r?.id + ' düzelt', supersede: r?.id + ' yerine yeni satır' }[mode];
    const save = async () => {
      const args = { type: type.value, text: text.value, why: why.value };
      const ok = mode === 'add' ? await act('add', args, 'Deftere eklendi')
        : mode === 'edit' ? await act('edit', { id: r.id, ...args }, r.id + ' düzeltildi')
        : await act('supersede', { id: r.id, ...args }, r.id + ' yerine yeni satır yazıldı');
      if (ok) closeForm();
    };
    form = h('div', { class: 'df-form', 'data-mode': mode },
      h('div', { class: 'df-form-head' }, h('b', {}, title), h('span', { class: 'spacer' }), type),
      text, why,
      h('div', { class: 'df-form-actions' },
        mode === 'edit' ? h('span', { class: 'df-hint' }, 'Eski hâli defterde kalır.') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost-btn', onclick: closeForm }, 'Vazgeç'),
        h('button', { class: 'primary-btn df-save', onclick: save }, 'Kaydet')));
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeForm(); }
      else if (e.key === 'Enter' && (e.metaKey || e.target === why)) { e.preventDefault(); save(); }
    });
    formHost.append(form);
    text.focus();
  }

  // İçe aktarma deseni: proje köküne göre, birden çoksa virgülle; boş kaydedilirse içe aktarma kapanır
  function openImportForm() {
    closeForm();
    const field = h('input', { type: 'text', class: 'dlg-input df-fimport', placeholder: 'docs/kararlar/K*.md', spellcheck: 'false' });
    field.value = imports.join(', ');
    const save = async () => {
      const list = field.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
      const r = await window.panel.defterImport(tab.octopusId, list);
      if (!r?.ok) return toast(r?.error || 'Kaydedilemedi.');
      toast(list.length ? `Dosyalardan ${r.count} satır alındı` : 'İçe aktarma kapatıldı');
      closeForm();
    };
    form = h('div', { class: 'df-form', 'data-mode': 'import' },
      h('div', { class: 'df-form-head' }, h('b', {}, 'Dosyalardan al')),
      h('div', { class: 'df-hint df-import-hint' }, 'Projenin kendi karar dosyaları defterde salt okunur satır olarak görünür; mesaja uyanlar Claude\'un masasına gelir. '
        + 'Desen proje köküne göre, yalnız dosya adında * olabilir; birden çoksa virgülle. Dosyalara hiç yazılmaz. Boş kaydedersen içe aktarma kapanır.'),
      field,
      h('div', { class: 'df-form-actions' },
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost-btn', onclick: closeForm }, 'Vazgeç'),
        h('button', { class: 'primary-btn df-save', onclick: save }, 'Kaydet')));
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeForm(); }
      else if (e.key === 'Enter') { e.preventDefault(); save(); }
    });
    formHost.append(form);
    field.focus();
  }

  function closeForm() { form?.remove(); form = null; }

  typeSel.addEventListener('change', render);
  allBox.addEventListener('change', render);
  return { el, refresh, destroy() { seq++; } };
}

// Satırın kaynağı: yazıldığı oturumdaki kayıt ve komşuları (hafıza dizini; kayıtlar yalnız okunur)
async function openDefterSource(tab, r) {
  const list = h('div', { class: 'mem-list' }, h('div', { class: 'mem-note' }, 'Hafızadan okunuyor…'));
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const modal = h('div', { class: 'modal mem-modal df-src-modal' },
    h('div', { class: 'modal-card mem-card' },
      h('div', { class: 'modal-head' },
        h('h2', {}, r.id + ' · kaynak'),
        h('span', { class: 'mem-proj' }, r.text.length > 60 ? r.text.slice(0, 59) + '…' : r.text),
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Kapat', onclick: close }, icon('close', 16))),
      h('div', { class: 'mem-note' }, r.source.uuid ? 'Satırın dayandığı kayıt ve çevresi.' : 'Satır yazılmadan önceki son mesajın ve çevresi.'),
      list));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(modal);
  const res = await window.panel.defterSource(tab.octopusId, r.id);
  if (!res?.ok) {
    list.replaceChildren(h('div', { class: 'mem-note' }, (res?.error || 'Okunamadı.') + ' Yeni yazılan satırın kaydı tur bitince birkaç saniyede hafızaya girer.'));
    return;
  }
  list.replaceChildren(...res.records.map((x) => h('div', { class: 'mem-hit open' + (x.target ? ' df-target' : ''), 'data-uuid': x.uuid, 'data-place': x.place },
    h('div', { class: 'mem-meta' },
      h('span', {}, x.ts ? new Date(x.ts).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'tarihsiz'),
      h('span', {}, MEM_ROLE[x.role] || x.role),
      h('span', { class: 'mem-place ' + x.place }, MEM_PLACE[x.place] || x.place)),
    h('div', { class: 'mem-text' }, x.parts.map((p) => p.text).join('\n')))));
  modal.querySelector('.df-target')?.scrollIntoView({ block: 'center' });
}

// Sohbetteki defter satırı: başarılı her yazma grubun altında tek satır olarak görünür, "Geri al" ile
// (araç sonucundaki olay numaraları; renderer/chat.js → toolResult). Geçmiş yüklenince de çizilir; geri alınmışsa ana süreç söyler.
function defterChatLine(tab, card, text) {
  if (!tab.octopusId || card.input?.islem === 'listele') return null;
  const m = text.match(/\(olay ((?:#\d+(?:, )?)+);/);
  if (!m) return null;
  const ns = [...m[1].matchAll(/#(\d+)/g)].map((x) => +x[1]);
  const b = h('button', { class: 'mini df-chat-undo', title: 'Bu yazmayı geri al (defterde geri alma olayı olarak kalır)', onclick: async () => {
    const r = await window.panel.defterApply(tab.octopusId, 'revert', { ns });
    if (!r?.ok) return toast(r?.error || 'Geri alınamadı.');
    b.disabled = true;
    b.textContent = 'Geri alındı';
  } }, icon('history', 13), 'Geri al');
  return h('div', { class: 'df-chat-line', 'data-events': ns.join(',') },
    icon('book', 14), h('span', { class: 'df-chat-text' }, text.split('\n')[0]),
    b,
    h('button', { class: 'mini', title: 'Ahtapot bölmesinde Defter sekmesini aç', onclick: () => { openOctopusInChat(tab); tab.octoView?.showPage('defter'); } }, 'Defteri aç'));
}
