/* Claude Panel — model/efor seçici, plan kullanımı (Claude uygulamasındaki "Opus 5.5 High ◔" köşesi), bağlayıcılar ve eklentiler */

const acctInfo = {}; // acctId -> { models, usage, at, loading, error }

// Model listesi ve kullanım ana süreçten gelir (açık sohbet varsa onun süreci, yoksa kısa bir yoklama)
async function loadAccountInfo(acctId, force) {
  const info = (acctInfo[acctId] ||= {});
  if (info.loading) return info.loading;
  info.loading = (async () => {
    renderAccountWidgets(acctId);
    const r = await window.panel.accountInfo(acctId, !!force);
    if (r?.ok) {
      if (r.models?.length) info.models = r.models;
      info.usage = r.usage;
      info.at = r.at;
      info.error = null;
    } else info.error = r?.error || 'okunamadı';
    info.loading = null;
    renderAccountWidgets(acctId);
    return info;
  })();
  return info.loading;
}

// Bir tur bittikten sonra kullanımı tazele (sık istek atmamak için en fazla 30 sn'de bir)
function refreshUsageSoon(acctId) {
  const info = (acctInfo[acctId] ||= {});
  if (info.at && Date.now() - info.at < 30000) return;
  loadAccountInfo(acctId, true);
}

function renderAccountWidgets(acctId) {
  for (const el of document.querySelectorAll(`[data-acct-widget="${acctId}"]`)) el.refresh?.();
}

// ---------- Model ve efor ----------

const effortLabel = (v) => EFFORTS.find((e) => e.value === v)?.label || '';

function modelsFor(acctId, own) {
  return (own?.length ? own : acctInfo[acctId]?.models) || [];
}

function defaultModelName(models, resolved) {
  if (resolved) return prettyModel(resolved);
  const d = models.find((m) => m.value === 'default');
  if (d?.resolvedModel) return prettyModel(d.resolvedModel);
  return 'Varsayılan model';
}

function pickerModelInfo(models, model, resolved) {
  if (model) return models.find((m) => m.value === model);
  return models.find((m) => m.value === 'default')
    || models.find((m) => resolved && (m.resolvedModel === resolved || resolved.includes(m.value)));
}

// get(): { model, effort, resolved, models }   set({ model } | { effort })
function modelPicker(acctId, get, set) {
  const label = h('span', { class: 'mp-label' });
  const btn = h('button', { class: 'model-btn', title: 'Model ve düşünme eforu', 'data-acct-widget': acctId }, label, icon('chevronDown', 13));
  btn.refresh = () => {
    const { model, effort, resolved, models: own } = get();
    const models = modelsFor(acctId, own);
    const m = model && models.find((x) => x.value === model);
    const name = m ? m.displayName : model ? prettyModel(model) : defaultModelName(models, resolved);
    label.innerHTML = '';
    label.append(h('span', { class: 'mp-model' }, name));
    if (effort) label.append(h('span', { class: 'mp-effort' }, effortLabel(effort)));
  };
  btn.onclick = async () => {
    if (openMenu.anchor === btn) return closeMenu();
    let models = modelsFor(acctId, get().models);
    if (!models.length) { await loadAccountInfo(acctId); models = modelsFor(acctId, get().models); }
    const { model, effort, resolved } = get();
    const info = pickerModelInfo(models, model, resolved);
    const levels = info?.supportedEffortLevels;
    const items = [
      { header: 'Model' },
      { label: 'Varsayılan', desc: defaultModelName(models, resolved) + ' · hesabın varsayılanı', checked: !model, onclick: () => set({ model: '' }) },
      ...models.filter((x) => x.value && x.value !== 'default').map((x) => ({
        label: x.displayName || x.value, desc: x.description, checked: model === x.value, onclick: () => set({ model: x.value }),
      })),
    ];
    if (!models.length) items.push({ label: 'Model listesi alınamadı', desc: acctInfo[acctId]?.error || 'Claude Code girişi gerekebilir', onclick: () => loadAccountInfo(acctId, true) });
    if (!info || info.supportsEffort !== false) {
      items.push('-', { header: 'Düşünme eforu' },
        { label: 'Varsayılan', checked: !effort, onclick: () => set({ effort: '' }) },
        ...EFFORTS.filter((e) => !levels || levels.includes(e.value)).map((e) => ({
          label: e.label, checked: effort === e.value, onclick: () => set({ effort: e.value }),
        })));
    }
    openMenu(btn, items, 'model-menu');
  };
  btn.refresh();
  return btn;
}

// ---------- Kullanım ----------

const RING_R = 7;
const RING_C = 2 * Math.PI * RING_R;

function usageLevel(pct) {
  return pct >= 90 ? 'high' : pct >= 70 ? 'mid' : 'low';
}

function usageButton(acctId) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  const track = document.createElementNS(svgNS, 'circle');
  const bar = document.createElementNS(svgNS, 'circle');
  for (const c of [track, bar]) { c.setAttribute('cx', '9'); c.setAttribute('cy', '9'); c.setAttribute('r', RING_R); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '2.2'); }
  track.setAttribute('class', 'ring-track');
  bar.setAttribute('class', 'ring-bar');
  bar.setAttribute('stroke-linecap', 'round');
  bar.setAttribute('stroke-dasharray', RING_C);
  bar.setAttribute('transform', 'rotate(-90 9 9)');
  svg.append(track, bar);

  const btn = h('button', { class: 'usage-btn', 'data-acct-widget': acctId, onclick: () => {
    if (openMenu.anchor === btn) return closeMenu();
    openUsage(btn, acctId);
    loadAccountInfo(acctId, true);
  } }, svg);
  btn.refresh = () => {
    const info = acctInfo[acctId] || {};
    const pct = info.usage?.limits?.five_hour?.utilization;
    btn.classList.toggle('loading', !!info.loading && pct == null);
    btn.classList.toggle('unknown', pct == null);
    btn.dataset.level = pct == null ? '' : usageLevel(pct);
    bar.setAttribute('stroke-dashoffset', RING_C * (1 - Math.min(100, Math.max(0, pct ?? 0)) / 100));
    btn.title = pct == null ? 'Kullanım' : `Oturum limiti: %${Math.round(pct)} kullanıldı`;
    if (openMenu.anchor === btn) openMenu.el.refresh?.();
  };
  btn.refresh();
  return btn;
}

function resetText(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  const ms = t - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'Sıfırlandı';
  if (ms < 24 * 3600e3) {
    const hr = Math.floor(ms / 3600e3);
    const min = Math.round((ms % 3600e3) / 60e3);
    return `Sıfırlanmaya ${hr ? `${hr} sa ` : ''}${min} dk`;
  }
  return 'Sıfırlanma: ' + new Intl.DateTimeFormat('tr-TR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(t);
}

function usageRow(title, w) {
  if (!w || w.utilization == null) return null;
  const pct = Math.round(w.utilization);
  return h('div', { class: 'u-row' },
    h('div', { class: 'u-line' }, h('span', { class: 'u-title' }, title), h('span', { class: 'u-pct' }, `%${pct} kullanıldı`)),
    h('div', { class: 'u-bar', 'data-level': usageLevel(pct) }, h('span', { style: `width:${Math.min(100, Math.max(pct, 1.5))}%` })),
    h('div', { class: 'u-reset' }, resetText(w.resets_at)));
}

const PLAN_NAMES = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' };

function openUsage(anchor, acctId) {
  const body = h('div', { class: 'u-body' });
  const refreshBtn = h('button', { class: 'icon-btn', title: 'Yenile', onclick: () => loadAccountInfo(acctId, true) }, icon('refresh', 15));
  const pop = h('div', { class: 'pop-menu usage-pop' },
    h('div', { class: 'u-head' }, h('span', {}, 'Kullanım'), h('span', { class: 'u-acct' }, acct(acctId)?.name || ''), h('span', { class: 'spacer' }), refreshBtn),
    body);
  pop.refresh = () => {
    requestAnimationFrame(() => pop.place?.());
    const info = acctInfo[acctId] || {};
    const u = info.usage;
    const L = u?.limits;
    refreshBtn.classList.toggle('spinning', !!info.loading);
    body.innerHTML = '';
    if (!u && info.loading) { body.append(h('div', { class: 'u-empty' }, 'Yükleniyor…')); return; }
    if (!u?.available || !L) {
      body.append(h('div', { class: 'u-empty' }, info.error
        ? 'Kullanım okunamadı: ' + info.error
        : 'Bu hesap için plan kullanımı yok. claude.ai girişiyle (Pro/Max) kullanılan hesaplarda görünür; API anahtarında plan limiti yoktur.'));
      return;
    }
    const rows = [
      usageRow('Oturum limiti (5 saat)', L.five_hour),
      usageRow('Haftalık', L.seven_day),
      usageRow('Haftalık · Opus', L.seven_day_opus),
      usageRow('Haftalık · Sonnet', L.seven_day_sonnet),
      ...(L.model_scoped || []).map((m) => usageRow('Haftalık · ' + m.display_name, m)),
    ].filter(Boolean);
    body.append(...(rows.length ? rows : [h('div', { class: 'u-empty' }, 'Limit bilgisi yok.')]));
    if (L.extra_usage?.is_enabled && L.extra_usage.used_credits != null) {
      body.append(h('div', { class: 'u-foot' }, `Ek kullanım: ${L.extra_usage.used_credits}${L.extra_usage.monthly_limit != null ? ' / ' + L.extra_usage.monthly_limit : ''} ${L.extra_usage.currency || ''}`));
    }
    body.append(h('div', { class: 'u-foot' }, [PLAN_NAMES[u.subscription] ? PLAN_NAMES[u.subscription] + ' planı' : null, info.at ? timeAgo(info.at) + ' güncellendi' : null].filter(Boolean).join(' · ')));
  };
  pop.refresh();
  openPopover(anchor, pop);
}

// ---------- Bağlayıcılar (MCP sunucuları) ----------
// Liste ve açık/kapalı durumu hesabın .claude.json dosyasından gelir (Claude Code'un /mcp kaydı).
// Seçim klasöre (git köküne) özeldir; aynı klasördeki sohbet ve terminal aynı kaydı kullanır.

const MCP_SCOPES = { local: 'Yalnız bu klasör', project: 'Proje · .mcp.json', user: 'Tüm klasörler', claudeai: 'claude.ai bağlayıcısı' };

function connectorsButton(acctId, getFolder) {
  let data = null; // { servers, project } ya da { servers: [], error }
  const btn = h('button', { class: 'pill-btn ghost icon-only connectors-btn' }, icon('plug', 15));
  const load = async () => {
    const folder = getFolder();
    if (!folder) { data = null; return btn.refresh(); }
    const r = await window.panel.mcpList(acctId, folder);
    data = r?.ok ? r : { servers: [], error: r?.error || 'okunamadı' };
    btn.refresh();
  };
  btn.refresh = () => {
    const list = data?.servers || [];
    const off = list.filter((s) => !s.enabled).length;
    btn.disabled = !getFolder();
    btn.classList.toggle('has-off', off > 0);
    btn.title = list.length ? `Bağlayıcılar: ${list.length - off}/${list.length} açık` : 'Bağlayıcılar';
    if (openMenu.anchor === btn) openMenu.el.refresh?.();
  };
  btn.onclick = async () => {
    if (openMenu.anchor === btn) return closeMenu();
    await load();
    openConnectors(btn, acctId, getFolder(), () => data);
  };
  btn.refresh();
  load();
  return btn;
}

function openConnectors(anchor, acctId, folder, getData) {
  const body = h('div', { class: 'cn-body' });
  const row = (s) => {
    const el = h('button', {
      class: 'pop-item cn-row', role: 'switch', 'aria-checked': String(s.enabled), 'data-name': s.name,
      onclick: async (e) => {
        e.stopPropagation();
        el.disabled = true;
        const r = await window.panel.mcpToggle(acctId, folder, s.name, !s.enabled);
        if (r?.ok) s.enabled = r.enabled;
        else toast('Bağlayıcı değiştirilemedi: ' + (r?.error || 'bilinmeyen hata'));
        if (r?.liveErrors?.length) toast('Açık sohbete uygulanamadı (yeniden başlatınca geçerli olur): ' + r.liveErrors[0]);
        anchor.refresh();
      },
    },
    icon(s.scope === 'claudeai' ? 'globe' : 'plug', 15),
    h('span', { class: 'pop-label' },
      h('span', {}, s.scope === 'claudeai' ? s.name.replace(/^claude\.ai\s+/, '') : s.name),
      h('small', {}, MCP_SCOPES[s.scope] || s.scope)),
    h('span', { class: 'switch' }, h('span')));
    return el;
  };
  const pop = h('div', { class: 'pop-menu connectors-pop' },
    h('div', { class: 'pop-head cn-head' }, h('span', {}, 'Bağlayıcılar'),
      h('span', { class: 'cn-folder', title: folder }, tilde(folder).split('/').pop() || folder)),
    body,
    h('div', { class: 'cn-foot' }, 'Bu klasör için geçerli: sohbette ve terminalde. Açık sohbetlere hemen uygulanır.'),
    h('div', { class: 'pop-sep' }),
    h('button', { class: 'pop-item cn-plugins', onclick: (e) => { e.stopPropagation(); closeMenu(); openPlugins(acctId, folder); } },
      icon('layers', 15), h('span', { class: 'pop-label' }, h('span', {}, 'Eklentileri yönet')), icon('chevronDown', 13, 'cn-go')));
  pop.refresh = () => {
    const d = getData() || { servers: [] };
    body.innerHTML = '';
    if (d.error) body.append(h('div', { class: 'cn-empty' }, 'Liste okunamadı: ' + d.error));
    else if (!d.servers.length) body.append(h('div', { class: 'cn-empty' }, 'Bu hesapta bağlayıcı yok. ', h('code', {}, 'claude mcp add'), ' ile eklenir.'));
    else body.append(...d.servers.map(row));
    requestAnimationFrame(() => pop.place?.());
  };
  pop.refresh();
  openPopover(anchor, pop);
}

// ---------- Eklentiler (Claude Code plugin'leri) ----------
// Claude uygulamasındaki "Eklentileri yönet" penceresi: kurulu eklentiler ve açık/kapalı anahtarları.
// Değişiklik hesabın genel settings.json'una (enabledPlugins) yazılır; açık sohbetler eklentileri yeniden yükler.

function openPlugins(acctId, folder) {
  const list = h('div', { class: 'pl-list' }, h('div', { class: 'cn-empty' }, 'Yükleniyor…'));
  const note = h('div', { class: 'pl-note' });
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const modal = h('div', { class: 'modal plugins-modal' },
    h('div', { class: 'modal-card pl-card' },
      h('div', { class: 'modal-head' },
        h('h2', {}, 'Eklentiler'),
        h('span', { class: 'pl-acct' }, acct(acctId)?.name || ''),
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Kapat', onclick: close }, icon('close', 16))),
      note,
      list,
      h('div', { class: 'modal-actions' },
        h('span', { class: 'pl-hint' }, 'Yeni eklenti kurmak için terminalde ', h('code', {}, '/plugin')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost-btn', title: 'Claude Code\'u bu klasörde terminalde aç', onclick: () => { close(); launch(acctId, folder, 'new'); } }, 'Terminalde aç'),
        h('button', { class: 'primary-btn', onclick: close }, 'Bitti'))));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(modal);

  const OVERRIDE = { project: 'Bu klasörün .claude/settings.json dosyası belirliyor', local: 'Bu klasörün .claude/settings.local.json dosyası belirliyor' };
  const row = (p) => {
    const sw = h('button', {
      class: 'switch', role: 'switch', 'aria-checked': String(p.enabled), 'aria-label': p.name, disabled: !!p.override,
      title: p.override ? OVERRIDE[p.override] : p.enabled ? 'Kapat' : 'Aç',
      onclick: async () => {
        sw.disabled = true;
        const r = await window.panel.pluginsToggle(acctId, p.id, !p.enabled);
        if (r?.ok) p.enabled = r.enabled;
        else toast('Eklenti değiştirilemedi: ' + (r?.error || 'bilinmeyen hata'));
        if (r?.liveErrors?.length) toast('Açık sohbete uygulanamadı (yeniden başlatınca geçerli olur): ' + r.liveErrors[0]);
        sw.setAttribute('aria-checked', String(p.enabled));
        el.classList.toggle('off', !p.enabled);
        sw.title = p.enabled ? 'Kapat' : 'Aç';
        sw.disabled = false;
      },
    }, h('span'));
    const meta = [p.marketplace, p.version && 'v' + p.version, !p.installed && 'kurulu değil'].filter(Boolean).join(' · ');
    const el = h('div', { class: 'pl-row' + (p.enabled ? '' : ' off'), 'data-id': p.id },
      h('span', { class: 'pl-ic' }, icon('layers', 16)),
      h('div', { class: 'pl-text' },
        h('div', { class: 'pl-name' }, h('b', {}, p.name), h('span', { class: 'pl-meta' }, meta)),
        p.description ? h('div', { class: 'pl-desc', title: p.description }, p.description) : null,
        p.override ? h('div', { class: 'pl-override' }, OVERRIDE[p.override]) : null),
      sw);
    return el;
  };

  window.panel.pluginsList(acctId, folder).then((r) => {
    list.innerHTML = '';
    if (!r?.ok) { list.append(h('div', { class: 'cn-empty' }, 'Eklentiler okunamadı: ' + (r?.error || ''))); return; }
    note.textContent = r.shared
      ? `Ortak ayar dosyası (${tilde(r.file)}): değişiklik bu dosyayı kullanan bütün hesaplarda ve panel dışındaki Claude Code'da da geçerli. Açık sohbetlere hemen uygulanır.`
      : `Bu hesabın ayarı (${tilde(r.file)}). Açık sohbetlere hemen uygulanır.`;
    if (!r.plugins.length) list.append(h('div', { class: 'cn-empty' }, 'Kurulu eklenti yok. Terminalde ', h('code', {}, '/plugin'), ' ile kurulur.'));
    else list.append(...r.plugins.map(row));
  });
}
