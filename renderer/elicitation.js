/* MCP elicitation kartı: bir MCP sunucusu kullanıcıdan form ya da adres ister (chat-main.js → onElicitation).
   Kart izin kartlarının yolundan gelir (handlePermission → req.elicitation), yanıt { action, content } olarak döner.
   Sunucunun metinleri düz metin olarak çizilir (Markdown değil). Şemaya uymayan yanıtı Claude Code reddeder ve araç hata döner
   (ölçüldü), bu yüzden alanlar gönderilmeden denetlenir. Desteklenen alanlar MCP şemasının ilkel türleri: metin (biçimli: e-posta,
   adres, tarih), sayı/tam sayı, evet/hayır, tek seçim (enum, enumNames, oneOf) ve çok seçim (items.enum, items.anyOf). */

const EL_FORMATS = { email: 'email', uri: 'url', date: 'date', 'date-time': 'datetime-local' };

// Seçenekler: [{ value, label }] (enum + enumNames, oneOf/anyOf [{ const, title }])
function elOptions(p) {
  if (Array.isArray(p.oneOf || p.anyOf)) return (p.oneOf || p.anyOf).filter((o) => o && 'const' in o).map((o) => ({ value: String(o.const), label: String(o.title ?? o.const) }));
  if (Array.isArray(p.enum)) return p.enum.map((v, i) => ({ value: String(v), label: String(p.enumNames?.[i] ?? v) }));
  return null;
}

// Bir alan: { key, el, read() → { value } | { error } | {} (boş) }
function elField(key, p, required) {
  const label = String(p.title || key);
  const head = h('div', { class: 'el-label' }, label, required ? h('span', { class: 'el-req', title: 'Zorunlu' }, ' *') : null);
  const desc = p.description ? h('div', { class: 'el-desc' }, String(p.description)) : null;
  const wrap = (control, inline) => h('div', { class: 'el-field' + (inline ? ' inline' : ''), 'data-key': key }, inline ? h('label', { class: 'el-check' }, control, head) : [head, control], desc);
  const need = (v) => (required && v === undefined ? { error: `"${label}" boş bırakılamaz.` } : v === undefined ? {} : { value: v });

  if (p.type === 'boolean') {
    const box = h('input', { type: 'checkbox' });
    box.checked = p.default === true;
    return { key, el: wrap(box, true), read: () => ({ value: box.checked }) };
  }
  if (p.type === 'array') {
    const opts = elOptions(p.items || {}) || [];
    const def = new Set(Array.isArray(p.default) ? p.default.map(String) : []);
    const boxes = opts.map((o) => { const b = h('input', { type: 'checkbox', value: o.value }); b.checked = def.has(o.value); return [b, h('label', { class: 'el-check' }, b, o.label)]; });
    const read = () => {
      const v = boxes.filter(([b]) => b.checked).map(([b]) => b.value);
      if (p.minItems != null && v.length < p.minItems) return { error: `"${label}" için en az ${p.minItems} seçim yapın.` };
      if (p.maxItems != null && v.length > p.maxItems) return { error: `"${label}" için en çok ${p.maxItems} seçim yapılabilir.` };
      return need(v.length || !required ? v : undefined);
    };
    return { key, el: wrap(h('div', { class: 'el-multi' }, boxes.map(([, l]) => l))), read };
  }
  const opts = elOptions(p);
  if (opts) {
    const sel = h('select', { class: 'el-input' },
      h('option', { value: '' }, required ? 'Seçin…' : '—'),
      opts.map((o) => h('option', { value: o.value }, o.label)));
    if (p.default != null) sel.value = String(p.default);
    return { key, el: wrap(sel), read: () => need(sel.value === '' ? undefined : sel.value) };
  }
  if (p.type === 'number' || p.type === 'integer') {
    const inp = h('input', { class: 'el-input', type: 'number', step: p.type === 'integer' ? '1' : 'any', min: p.minimum, max: p.maximum });
    if (p.default != null) inp.value = String(p.default);
    const read = () => {
      const raw = inp.value.trim();
      if (!raw) return need(undefined);
      const n = Number(raw);
      if (!Number.isFinite(n) || (p.type === 'integer' && !Number.isInteger(n))) return { error: `"${label}" ${p.type === 'integer' ? 'tam sayı' : 'sayı'} olmalı.` };
      if (p.minimum != null && n < p.minimum) return { error: `"${label}" en az ${p.minimum} olmalı.` };
      if (p.maximum != null && n > p.maximum) return { error: `"${label}" en çok ${p.maximum} olabilir.` };
      return { value: n };
    };
    return { key, el: wrap(inp), read };
  }
  if (p.type === 'string' || p.type == null) {
    const inp = h('input', { class: 'el-input', type: EL_FORMATS[p.format] || 'text', maxlength: p.maxLength });
    if (p.default != null) inp.value = String(p.default);
    const read = () => {
      const v = inp.value;
      if (!v.trim()) return need(undefined);
      if (p.minLength != null && v.length < p.minLength) return { error: `"${label}" en az ${p.minLength} karakter olmalı.` };
      if (p.maxLength != null && v.length > p.maxLength) return { error: `"${label}" en çok ${p.maxLength} karakter olabilir.` };
      if (p.format === 'email' && !/^[^\s@]+@[^\s@]+$/.test(v)) return { error: `"${label}" geçerli bir e-posta adresi değil.` };
      if (p.format === 'uri' && !/^[a-z][a-z0-9+.-]*:\S+$/i.test(v)) return { error: `"${label}" geçerli bir adres değil.` };
      // datetime-local saniyesiz ve saat dilimsiz verir; şemanın date-time'ı (RFC 3339) için yerel saat dilimiyle tamamlanır
      if (p.format === 'date-time') return { value: new Date(v).toISOString() };
      return { value: v };
    };
    return { key, el: wrap(inp), read };
  }
  // Panelin çizemediği alan (iç içe nesne vb.): gösterilir, gönderilmez
  return { key, el: h('div', { class: 'el-field', 'data-key': key }, head, h('div', { class: 'el-desc' }, 'Bu alan panelde doldurulamaz.'), desc),
    read: () => (required ? { error: `"${label}" panelde doldurulamıyor; isteği reddedebilirsiniz.` } : {}) };
}

function elicitationCard(tab, req, reply) {
  const el = req.elicitation;
  const who = el.displayName || el.serverName;
  const isUrl = el.mode === 'url';
  const status = h('div', { class: 'el-status', hidden: true });
  const error = h('div', { class: 'el-error', hidden: true });
  const answer = (action, content) => {
    status.textContent = { accept: isUrl ? 'Tamamlandı olarak bildirildi.' : 'Gönderildi.', decline: 'Reddedildi.', cancel: 'Vazgeçildi.' }[action];
    status.hidden = false;
    reply({ action, ...(content ? { content } : {}) });
  };
  const head = [
    h('div', { class: 'perm-title' }, el.title || (isUrl ? `${who} bir sayfayı açmanızı istiyor` : `${who} sizden bilgi istiyor`)),
    h('div', { class: 'perm-arg' }, 'MCP sunucusu · ' + el.serverName),
    el.description ? h('div', { class: 'perm-reason' }, el.description) : null,
    el.message ? h('div', { class: 'el-msg' }, el.message) : null,
  ];
  let card;
  if (isUrl) {
    let u = null;
    try { u = new URL(el.url); } catch {}
    const web = !!u && /^https?:$/.test(u.protocol);
    const done = h('button', { class: 'ghost-btn el-done', onclick: () => answer('accept') }, 'Tamamladım');
    const open = h('button', { class: 'primary-btn el-open', disabled: !web, onclick: async () => {
      const r = await window.panel.chatElicitationOpen(tab.chatId, req.rid);
      if (!r?.ok) { error.textContent = r?.error || 'Adres açılamadı.'; error.hidden = false; return; }
      open.className = 'ghost-btn el-open';
      done.className = 'primary-btn el-done';
      status.textContent = 'Tarayıcıda açıldı. İşi bitirince "Tamamladım"a basın.';
      status.hidden = false;
    } }, 'Tarayıcıda aç');
    card = h('div', { class: 'perm-card elicit', 'data-mode': 'url', 'data-elicitation-id': el.elicitationId || '' }, head,
      h('div', { class: 'el-url' }, u ? h('b', {}, u.host) : null, h('code', {}, el.url)),
      web ? null : h('div', { class: 'el-error' }, 'Bu adres açılamaz (yalnız http ve https).'),
      error, status,
      h('div', { class: 'perm-actions' }, open, done, h('span', { class: 'spacer' }),
        h('button', { class: 'ghost-btn el-decline', onclick: () => answer('decline') }, 'Reddet'),
        h('button', { class: 'ghost-btn el-cancel', onclick: () => answer('cancel') }, 'Vazgeç')));
    return card;
  }
  const schema = el.requestedSchema || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const fields = Object.entries(schema.properties || {}).filter(([, p]) => p && typeof p === 'object').map(([k, p]) => elField(k, p, required.has(k)));
  const submit = () => {
    const content = {};
    for (const f of fields) {
      const r = f.read();
      if (r.error) { error.textContent = r.error; error.hidden = false; f.el.querySelector('input, select')?.focus(); return; }
      if ('value' in r) content[f.key] = r.value;
    }
    error.hidden = true;
    answer('accept', content);
  };
  card = h('div', { class: 'perm-card elicit', 'data-mode': 'form' }, head,
    fields.length ? h('div', { class: 'el-form', oninput: () => { error.hidden = true; }, onchange: () => { error.hidden = true; }, onkeydown: (e) => { if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox])')) { e.preventDefault(); submit(); } } }, fields.map((f) => f.el)) : null,
    error, status,
    h('div', { class: 'perm-actions' },
      h('button', { class: 'primary-btn el-submit', onclick: submit }, fields.length ? 'Gönder' : 'Onayla'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'ghost-btn el-decline', onclick: () => answer('decline') }, 'Reddet'),
      h('button', { class: 'ghost-btn el-cancel', onclick: () => answer('cancel') }, 'Vazgeç')));
  return card;
}

// Kart kullanıcı yanıtlamadan kapandı (chat-main.js: sinyal düştü ya da sunucu adres işini tamamladı)
function elicitationClosed(card, why) {
  const status = card.querySelector('.el-status');
  if (!status || card.dataset.reply) return;
  card.dataset.reply = why === 'complete' ? 'accept' : 'cancel';
  status.textContent = why === 'complete' ? 'Sunucu işin tamamlandığını bildirdi.' : 'İstek kapandı: sunucu beklemeyi bıraktı ya da tur durduruldu.';
  status.hidden = false;
}
