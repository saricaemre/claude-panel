// "Hafızada ara" penceresi (OCTOPUS-PLANI.md P3.2): sohbet menüsünden (renderer/chat.js → chatMenu) açılır, projenin geçmiş
// oturumlarında Claude'un hatirla aracıyla aynı aramayı yapar (hafiza.js → searchFor). Sonuçlar kelimesi kelimesine; her birinde
// tarih, kim yazdı ve bağlamdaki yeri. Tıklanan sonuç tam metniyle açılır. P4'te ahtapot bölmesine taşınacak.

const MEM_PLACE = { baglamda: 'bağlamda', dusmus: 'bağlamdan düşmüş', 'baska-dal': 'başka dal' };
const MEM_ROLE = { kullanici: 'Sen', claude: 'Claude', arac: 'Araç sonucu', sistem: 'Sıkıştırma özeti' };

function memoryMenuItem(tab) {
  return { icon: 'search', label: 'Hafızada ara', desc: 'Projenin geçmiş oturumlarında, kelimesi kelimesine', onclick: () => openMemorySearch(tab) };
}

// Metni eşleşen ilk terim vurgulu parçalara böler (hafiza-isci.js: norm uzunluğu koruduğu için at/len özgün metinde de doğru)
function memMarked(text, at, len, before, after) {
  if (at == null || at < 0 || !len) return [text.length > before + after ? text.slice(0, before + after) + '…' : text];
  const a = Math.max(0, at - before), b = Math.min(text.length, at + len + after);
  return [a > 0 ? '…' : '', text.slice(a, at), h('mark', {}, text.slice(at, at + len)), text.slice(at + len, b), b < text.length ? '…' : ''];
}

function openMemorySearch(tab) {
  const field = h('input', { type: 'search', class: 'dlg-input mem-input', placeholder: 'Ne arıyorsun? (ör. reddedilen stil, "tırnaklı ifade")', spellcheck: 'false' });
  const scope = h('select', { class: 'mem-scope', title: 'Kapsam' },
    h('option', { value: 'proje' }, 'Bu proje'), h('option', { value: 'hesap' }, 'Hesabın bütün projeleri'));
  const note = h('div', { class: 'mem-note' }, 'Kayıtlar yalnız okunur; aranan metin bu Mac\'ten çıkmaz.');
  const list = h('div', { class: 'mem-list' });
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const modal = h('div', { class: 'modal mem-modal' },
    h('div', { class: 'modal-card mem-card' },
      h('div', { class: 'modal-head' },
        h('h2', {}, 'Hafızada ara'),
        h('span', { class: 'mem-proj' }, tab.cwd ? tab.cwd.split('/').filter(Boolean).pop() : ''),
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Kapat', onclick: close }, icon('close', 16))),
      h('div', { class: 'mem-bar' }, field, scope),
      note,
      list));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(modal);
  field.focus();

  let seq = 0, timer = null;
  const row = (x) => {
    const body = h('div', { class: 'mem-text' }, memMarked(x.text, x.at, x.len, 120, 260));
    const el = h('button', { class: 'mem-hit', 'data-uuid': x.uuid, 'data-place': x.place, onclick: () => {
      const open = el.classList.toggle('open');
      body.replaceChildren(...(open ? memMarked(x.text, x.at, x.len, Infinity, Infinity) : memMarked(x.text, x.at, x.len, 120, 260)));
    } },
      h('div', { class: 'mem-meta' },
        h('span', {}, x.ts ? new Date(x.ts).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'tarihsiz'),
        h('span', {}, x.kind?.startsWith('arac:') ? 'Claude · ' + x.kind.slice(5) : MEM_ROLE[x.role] || x.role),
        scope.value === 'hesap' && x.project ? h('span', { class: 'mem-p' }, x.project.split('/').pop()) : null,
        h('span', { class: 'mem-place ' + x.place }, MEM_PLACE[x.place] || x.place)),
      body);
    return el;
  };
  const run = async () => {
    const query = field.value.trim();
    const mine = ++seq;
    if (!query) { list.replaceChildren(); note.textContent = 'Kayıtlar yalnız okunur; aranan metin bu Mac\'ten çıkmaz.'; return; }
    const r = await window.panel.hafizaSohbetteAra({ accountId: tab.acctId, cwd: tab.cwd, query, scope: scope.value, limit: 30 });
    if (mine !== seq) return;
    if (!r?.ok) { list.replaceChildren(); note.textContent = r?.error || 'Arama yapılamadı.'; return; }
    note.textContent = !r.covered ? 'Bu proje hafızaya alınmamış: ahtapotu olan projeler kendiliğinden alınır. Kapsamı "Hesabın bütün projeleri" yapabilirsin.'
      : r.hits.length ? `${r.hits.length} kayıt` + (r.hits.length >= 30 ? ' (ilk 30)' : '') + '. Tam metin için sonuca tıkla.'
      : 'Sonuç yok. Başka kelimelerle ya da daha kısa bir ifadeyle dene.';
    list.replaceChildren(...r.hits.map(row));
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  field.addEventListener('input', soon);
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
  scope.addEventListener('change', run);
}
