/* Claude Panel — skill'ler: yazma alanındaki "Skill'ler" düğmesi (seç → /ad yazma alanına), "Skill'leri yönet" penceresi
   (açık / yalnız adı / yalnız ben çağırırım / kapalı, düzenle, yeni skill) ve "/" önerilerinin açıklamaları.
   Liste ana süreçten (skills.js: kısa ömürlü yoklama süreci, 0 token); durum hesabın genel settings.json → skillOverrides'ında. */

const SKILL_GROUPS = { user: 'Kişisel', project: 'Bu proje', claudeai: 'claude.ai', plugin: 'Eklentiler', builtin: 'Claude Code ile gelen' };
const SKILL_ICONS = { user: 'skill', project: 'folder', claudeai: 'globe', plugin: 'layers', builtin: 'sparkle' };
const SKILL_MODES = {
  on: ['Açık', 'Claude gerektiğinde kendisi kullanır; /ad ile sen de çağırırsın'],
  'name-only': ['Yalnız adı', 'Claude yalnız adını görür (bağlamda daha az yer tutar); /ad ile çağrılır'],
  'user-invocable-only': ['Yalnız ben çağırırım', 'Claude kendiliğinden kullanmaz; /ad ile sen çağırırsın'],
  off: ['Kapalı', 'Ne Claude görür ne de /ad ile çağrılır'],
};
const SKILL_LOCKS = {
  plugin: 'Eklentiyle birlikte açılıp kapanır (Eklentileri yönet)',
  project: 'Bu klasörün .claude/settings.json dosyası belirliyor',
  local: 'Bu klasörün .claude/settings.local.json dosyası belirliyor',
};
// Her açılışta ana süreçten (yoklama sonucu orada 30 sn önbellekte, durumlar her seferinde dosyalardan)
const loadSkills = (acctId, folder, force) => window.panel.skillsList(acctId, folder, !!force)
  .then((r) => (r?.ok ? r : { skills: [], error: r?.error || 'okunamadı' }));

const skillMatch = (s, q) => !q || s.name.toLocaleLowerCase('tr').includes(q) || s.description.toLocaleLowerCase('tr').includes(q);

// Yazma alanının başına /ad koyar; başta başka bir komut varsa onun yerine
function insertSkill(input, name) {
  if (!input) return;
  const rest = input.value.replace(/^\/\S*\s*/, '');
  input.value = `/${name} ` + rest;
  input.focus();
  const at = name.length + 2;
  input.setSelectionRange(at, at);
  input.dispatchEvent(new Event('input'));
}

function skillsButton(acctId, getFolder, getInput) {
  const btn = h('button', { class: 'pill-btn ghost icon-only skills-btn', title: 'Skill\'ler' }, icon('skill', 15));
  btn.onclick = () => {
    if (openMenu.anchor === btn) return closeMenu();
    const folder = getFolder();
    if (!folder) return toast('Önce bir klasör seçin.');
    openSkillsMenu(btn, acctId, folder, getInput);
  };
  return btn;
}

// Düğmenin menüsü: açık skill'ler (arama), seçilen yazma alanına /ad olarak girer
function openSkillsMenu(anchor, acctId, folder, getInput) {
  let data = null;
  let sel = 0;
  const search = h('input', { class: 'sk-search', type: 'text', placeholder: 'Skill ara…', spellcheck: 'false' });
  const body = h('div', { class: 'cn-body sk-body' }, h('div', { class: 'cn-empty' }, 'Yükleniyor…'));
  const use = (s) => { closeMenu(); insertSkill(getInput(), s.name); };
  const pop = h('div', { class: 'pop-menu skills-pop' },
    h('div', { class: 'pop-head cn-head' }, h('span', {}, 'Skill\'ler'),
      h('span', { class: 'cn-folder', title: folder }, tilde(folder).split('/').pop() || folder)),
    search,
    body,
    h('div', { class: 'pop-sep' }),
    h('button', { class: 'pop-item sk-manage', onclick: (e) => { e.stopPropagation(); closeMenu(); openSkillsManager(acctId, folder, getInput); } },
      icon('settings', 15), h('span', { class: 'pop-label' }, h('span', {}, 'Skill\'leri yönet'))));
  const shown = () => {
    const q = search.value.trim().toLocaleLowerCase('tr');
    return (data?.skills || []).filter((s) => s.mode !== 'off' && skillMatch(s, q));
  };
  const render = () => {
    const list = shown();
    sel = Math.min(sel, Math.max(list.length - 1, 0));
    if (data?.error) body.replaceChildren(h('div', { class: 'cn-empty' }, 'Liste okunamadı: ' + data.error));
    else if (!list.length) body.replaceChildren(h('div', { class: 'cn-empty' }, search.value ? 'Eşleşen skill yok.' : 'Bu klasörde açık skill yok.'));
    else body.replaceChildren(...list.map((s, i) => h('button', {
      class: 'pop-item sk-row' + (i === sel ? ' on' : ''), 'data-name': s.name, title: s.description,
      onmouseenter: () => { sel = i; for (const [j, el] of [...body.children].entries()) el.classList.toggle('on', j === i); },
      onclick: (e) => { e.stopPropagation(); use(s); },
    },
    icon(SKILL_ICONS[s.source] || 'skill', 15),
    h('span', { class: 'pop-label' }, h('span', {}, '/' + s.name), s.description ? h('small', {}, s.description) : null))));
    requestAnimationFrame(() => pop.place?.());
  };
  search.addEventListener('input', () => { sel = 0; render(); });
  search.addEventListener('keydown', (e) => {
    const list = shown();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!list.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      render();
      body.children[sel]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (list[sel]) use(list[sel]);
    } else if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); getInput()?.focus(); }
  });
  openPopover(anchor, pop);
  search.focus();
  loadSkills(acctId, folder).then((r) => { if (!pop.isConnected) return; data = r; render(); });
}

// ---------- Skill'leri yönet ----------
function openSkillsManager(acctId, folder, getInput) {
  let data = null;
  const search = h('input', { class: 'sk-filter', type: 'text', placeholder: 'Ada ya da açıklamaya göre ara', spellcheck: 'false' });
  const list = h('div', { class: 'mm-list sk-list' }, h('div', { class: 'cn-empty' }, 'Yükleniyor…'));
  const note = h('div', { class: 'pl-note' });
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal.dlg')) { e.stopPropagation(); close(); } };
  const modal = h('div', { class: 'modal skills-modal' },
    h('div', { class: 'modal-card pl-card sk-card' },
      h('div', { class: 'modal-head' },
        h('h2', {}, 'Skill\'ler'),
        h('span', { class: 'pl-acct' }, [acct(acctId)?.name, tilde(folder).split('/').pop()].filter(Boolean).join(' · ')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Kapat', onclick: close }, icon('close', 16))),
      note,
      search,
      list,
      h('div', { class: 'modal-actions' },
        h('span', { class: 'pl-hint' }, 'Kişisel skill\'ler tüm klasörlerde, projeninkiler yalnız o projede'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost-btn sk-plugins', onclick: () => { close(); openPlugins(acctId, folder); } }, 'Eklentiler'),
        h('button', { class: 'ghost-btn sk-new', onclick: () => newSkill() }, icon('plus', 14), 'Yeni skill'),
        h('button', { class: 'primary-btn', onclick: close }, 'Bitti'))));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(modal);

  const row = (s) => {
    // Yazarı "disable-model-invocation" demişse Claude zaten kendiliğinden kullanamaz: yalnız iki durum anlamlı
    const modes = s.userOnly ? ['user-invocable-only', 'off'] : Object.keys(SKILL_MODES);
    const cur = s.userOnly && s.mode !== 'off' ? 'user-invocable-only' : s.mode;
    const select = h('select', {
      class: 'sk-mode', 'aria-label': s.name, disabled: !!s.lock, title: s.lock ? SKILL_LOCKS[s.lock] : SKILL_MODES[cur][1],
      onchange: async () => {
        const want = select.value;
        select.disabled = true;
        const r = await window.panel.skillsSet(acctId, { key: s.key, names: s.names }, want === 'user-invocable-only' && s.userOnly ? 'on' : want);
        if (r?.ok) s.mode = want;
        else { toast('Skill değiştirilemedi: ' + (r?.error || 'bilinmeyen hata')); select.value = cur; }
        el.classList.toggle('off', s.mode === 'off');
        select.title = SKILL_MODES[select.value][1];
        select.disabled = false;
      },
    }, modes.map((m) => h('option', { value: m, selected: m === cur }, s.userOnly && m !== 'off' ? 'Açık' : SKILL_MODES[m][0])));
    const el = h('div', { class: 'pl-row sk-item' + (s.mode === 'off' ? ' off' : ''), 'data-name': s.name },
      h('span', { class: 'pl-ic' }, icon(SKILL_ICONS[s.source] || 'skill', 16)),
      h('div', { class: 'pl-text' },
        h('div', { class: 'pl-name' }, h('b', {}, s.name), s.argumentHint ? h('span', { class: 'pl-meta' }, s.argumentHint) : null),
        s.description ? h('div', { class: 'pl-desc', title: s.description }, s.description) : null,
        s.lock ? h('div', { class: 'pl-override' }, SKILL_LOCKS[s.lock]) : null,
        s.userOnly && !s.lock ? h('div', { class: 'pl-meta sk-useronly' }, 'Yazarı yalnız senin çağırmanı istemiş: Claude kendiliğinden kullanmaz') : null,
        getInput || s.path ? h('div', { class: 'sk-actions' },
          getInput && s.mode !== 'off' ? h('button', { class: 'link-btn sk-use', title: `/${s.name} yazma alanına`, onclick: () => { close(); insertSkill(getInput(), s.name); } }, 'Kullan') : null,
          s.path ? h('button', { class: 'link-btn sk-edit', title: tilde(s.path), onclick: () => openSkillFile(s.path) }, 'Düzenle') : null,
          s.path ? h('button', { class: 'link-btn sk-reveal', onclick: () => window.panel.fileReveal(s.path) }, 'Finder\'da göster') : null) : null),
      select);
    return el;
  };

  const render = () => {
    if (!data) return;
    if (data.error) { list.replaceChildren(h('div', { class: 'cn-empty' }, 'Skill\'ler okunamadı: ' + data.error)); return; }
    const q = search.value.trim().toLocaleLowerCase('tr');
    const items = data.skills.filter((s) => skillMatch(s, q));
    if (!items.length) { list.replaceChildren(h('div', { class: 'cn-empty' }, q ? 'Eşleşen skill yok.' : 'Bu klasörde skill yok.')); return; }
    const parts = [];
    for (const g of Object.keys(SKILL_GROUPS)) {
      const group = items.filter((s) => s.source === g);
      if (!group.length) continue;
      parts.push(h('div', { class: 'mm-group', 'data-group': g }, h('span', {}, `${SKILL_GROUPS[g]} · ${group.length}`)),
        h('div', { class: 'pl-list' }, ...group.map(row)));
    }
    list.replaceChildren(...parts);
  };
  search.addEventListener('input', render);

  const load = async (force) => {
    data = await loadSkills(acctId, folder, force);
    if (!modal.isConnected) return;
    note.textContent = (data.shared
      ? `Ortak ayar dosyası (${tilde(data.file || '')}): değişiklik bu dosyayı kullanan bütün hesaplarda ve panel dışındaki Claude Code'da da geçerli.`
      : `Bu hesabın ayarı (${tilde(data.file || '')}).`) + ' Açık sohbetlere hemen uygulanır.';
    render();
  };

  async function newSkill() {
    const name = await dialogModal({ title: 'Yeni skill', body: 'Kişisel skill bütün klasörlerde kullanılır. Ad küçük harf, rakam ve tire olabilir (ör. haftalik-rapor). SKILL.md dosyası düzenleyicide açılır.', input: '', okLabel: 'Oluştur' });
    if (!name) return;
    const r = await window.panel.skillsCreate(acctId, name);
    if (!r?.ok) return toast('Skill oluşturulamadı: ' + (r?.error || 'bilinmeyen hata'));
    openSkillFile(r.path);
    await load(true);
    modal.querySelector(`.sk-item[data-name="${CSS.escape(r.name)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  load();
  search.focus();
}

async function openSkillFile(file) {
  const r = await window.panel.fileOpen(file);
  if (!r?.ok) toast('Açılamadı: ' + (r?.error || ''));
}

// ---------- "/" önerileri: açık sohbetin komutları, açıklamalarıyla ----------
function setChatCommands(tab, list) {
  if (!Array.isArray(list) || !list.length) return;
  const clean = list.map((c) => ({ name: String(c.name || '').replace(/^\//, ''), description: String(c.description || '').replace(/\s*\((user|project|local|claude\.ai sync)\)$/, ''), argumentHint: c.argumentHint || '' }))
    .filter((c) => c.name);
  tab.slash = clean.map((c) => '/' + c.name);
  tab.cmdInfo = new Map(clean.map((c) => ['/' + c.name, c]));
  if (/^\/[^\s]*$/.test(tab.input.value)) updateSlash(tab); // öneri kutusu açıksa ya da açılacaksa yenilensin
}

function loadChatCommands(tab) {
  if (!tab.chatId) return;
  window.panel.chatCommands(tab.chatId).then((list) => setChatCommands(tab, list)).catch(() => {});
}
