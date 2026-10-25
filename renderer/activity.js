/* Claude Panel — Claude çalışırken canlı gösterge: sohbetin altında dönen ✳, o an ne yaptığı (düşünüyor, yazıyor,
   komut çalıştırıyor…) parıltılı yazıyla ve turun ne kadar sürdüğü. İzin kartı açıkken "Onayınızı bekliyor" der.
   Sohbetin geçiş durumları da burada yazar (Başlatılıyor, Ortam hazırlanıyor, Yeniden deneniyor, Durduruluyor; renderer/chat.js → setStatus);
   üst satırda "Çalışıyor" rozeti yok. Yazma alanının kenarındaki dönen ışık CSS'te (.composer-box.working). Tur bitince ikisi de kaybolur.
   Ön planda uzun süren komut ya da alt ajan varsa göstergede "Arka plana al" düğmesi; arka plandaki görevler yazma alanının üstündeki
   şeritte (tasksBar, aşağıda). */

const LIVE_VERBS = {
  bash: 'Komut çalıştırıyor', read: 'Dosya okuyor', edit: 'Düzenliyor', search: 'Arıyor', todo: 'Planlıyor',
  agent: 'Alt ajan çalışıyor', web: 'Web\'e bakıyor', mcp: 'Araç kullanıyor', artifact: 'Artifact hazırlıyor',
  sim: 'Simülatörde çalışıyor', browser: 'Tarayıcıda çalışıyor', terminal: 'Terminalde çalışıyor',
  widget: 'Görsel çiziyor', session: 'Yan oturumla çalışıyor',
};

function activityEl(tab) {
  return h('div', { class: 'live-act', hidden: true, 'aria-live': 'polite' },
    h('span', { class: 'la-spark' }, '✳'),
    h('span', { class: 'la-text' }),
    h('span', { class: 'la-time' }),
    h('button', { class: 'la-bg', hidden: true, title: 'Bu komutu arka plana al: Claude beklemeden devam eder, bitince haber verir',
      onclick: () => backgroundForeground(tab) }, icon('layers', 13), 'Arka plana al'));
}

function elapsedText(ms) {
  const s = Math.floor(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} dk ${s % 60} sn` : `${s} sn`;
}

function renderActivity(tab) {
  const el = tab.actEl;
  if (!el || el.hidden) return;
  const waiting = !!tab.list.querySelector('.perm-card:not(.answered)');
  el.classList.toggle('waiting', waiting);
  el.querySelector('.la-text').textContent = waiting ? 'Onayınızı bekliyor' : tab.actWhat || 'Düşünüyor';
  el.querySelector('.la-time').textContent = elapsedText(Date.now() - tab.actStart);
  el.querySelector('.la-bg').hidden = waiting || !tab.fgTasks?.size;
}

// O an ne yapıldığı: akışın başı (yazıyor/düşünüyor), araç çağrısı (kategori fiili), araçlar bitince yine "Düşünüyor"
function setActivity(tab, what) {
  tab.actWhat = what;
  renderActivity(tab);
}
function activityForTool(tab, name) {
  setActivity(tab, LIVE_VERBS[toolCategory(name)] || 'Çalışıyor');
}

function startActivity(tab) {
  const el = tab.actEl;
  if (!el) return;
  if (el.hidden) {
    tab.actStart = Date.now();
    tab.actWhat = 'Düşünüyor';
    el.hidden = false;
    tab.composerBox?.classList.add('working');
    clearInterval(tab.actTimer);
    tab.actTimer = setInterval(() => renderActivity(tab), 1000);
  }
  renderActivity(tab);
  if (nearBottom(tab)) scrollDown(tab, true);
}

function stopActivity(tab) {
  clearInterval(tab.actTimer);
  tab.actTimer = null;
  tab.fgTasks?.clear();
  if (tab.actEl) tab.actEl.hidden = true;
  tab.composerBox?.classList.remove('working');
}

// ---------- Arka plan görevleri (Claude Code'un /tasks'ı ve Ctrl+B'si; ana süreç: chat-main.js → chat:stopTask / chat:backgroundTask) ----------
// Liste background_tasks_changed'den (her değişimde tamamı gelir; süreç başına, yeni süreçte boş: resetTasks), ayrıntılar task_started /
// task_progress / task_updated / task_notification'dan. Yazma alanının üstünde bir şerit: kaç görev sürüyor; açılınca her biri (tür, açıklama,
// son araç, süre) ve tek tek "Durdur". "Durdur" (Esc) yalnız turu keser, bu görevler sürer (perTaskStopAffordance).
// Ön planda süren komut ~3 sn sonra görev olur (task_started, is_backgrounded: false); ondan sonra arka plana alınabilir (2026-10-25'te ölçüldü).

const TASK_KINDS = {
  local_bash: ['terminal', 'Komut'], local_agent: ['sparkle', 'Alt ajan'], monitor: ['eye', 'İzleme'],
  workflow: ['layers', 'İş akışı'], remote_agent: ['globe', 'Uzak ajan'],
};
const TASK_END = { completed: 'bitti', failed: 'hata verdi', stopped: 'durduruldu' };

function tasksBar() {
  return h('details', { class: 'tasks-bar', hidden: true },
    h('summary', {}, h('span', { class: 'tb-spin' }), h('span', { class: 'tb-count' }), h('span', { class: 'tb-cur' }),
      h('span', { class: 'spacer' }), icon('chevronDown', 13)),
    h('div', { class: 'tb-body' }));
}

function taskOf(tab, id) {
  tab.tasks ||= new Map();
  let t = tab.tasks.get(id);
  if (!t) { t = { id, startedAt: Date.now() }; tab.tasks.set(id, t); }
  return t;
}

// Araç satırında görevin durumu ("arka planda", "bitti"…); grup kapalıyken de özet satırı görünür
function markToolTask(tab, t, label) {
  const card = t.toolUseId && tab.toolCards.get(t.toolUseId);
  if (!card) return;
  let chip = card.el.querySelector(':scope > summary .tool-bgchip');
  if (!chip) card.el.querySelector(':scope > summary .tool-status')?.before(chip = h('span', { class: 'tool-bgchip' }));
  if (chip) { chip.textContent = label; chip.dataset.state = t.status || 'running'; }
}

// SDK'nın görev mesajları (renderer/chat.js → handleChatMsg)
function handleTaskMsg(tab, msg) {
  switch (msg.subtype) {
    case 'background_tasks_changed': {
      const live = (msg.tasks || []).filter((x) => !x.ambient);
      tab.bgIds = new Set(live.map((x) => x.task_id));
      for (const x of live) {
        const t = taskOf(tab, x.task_id);
        Object.assign(t, { type: x.task_type || t.type, description: x.description || t.description, agent: x.subagent_type || t.agent || null });
      }
      break;
    }
    case 'task_started': {
      const t = Object.assign(taskOf(tab, msg.task_id), {
        type: msg.task_type, description: msg.description, agent: msg.subagent_type || null, toolUseId: msg.tool_use_id || null,
        sub: !!(msg.owned_by_subagent || msg.parent_task_id), startedAt: Date.now(),
      });
      if (msg.is_backgrounded) { t.bg = true; markToolTask(tab, t, 'arka planda'); }
      else if (!t.sub && t.toolUseId) { (tab.fgTasks ||= new Map()).set(t.toolUseId, t); renderActivity(tab); }
      break;
    }
    case 'task_updated': {
      const t = tab.tasks?.get(msg.task_id);
      if (!t) break;
      if (msg.patch?.description) t.description = msg.patch.description;
      if (msg.patch?.is_backgrounded) {
        t.bg = true;
        tab.fgTasks?.delete(t.toolUseId);
        renderActivity(tab);
        markToolTask(tab, t, 'arka planda');
      }
      break;
    }
    case 'task_progress': {
      const t = taskOf(tab, msg.task_id);
      Object.assign(t, { lastTool: msg.last_tool_name || t.lastTool, summary: msg.summary || t.summary, usage: msg.usage || t.usage });
      break;
    }
    case 'task_notification': {
      const t = tab.tasks?.get(msg.task_id);
      tab.bgIds?.delete(msg.task_id);
      if (!t) break;
      t.status = msg.status;
      if (tab.fgTasks?.delete(t.toolUseId)) renderActivity(tab);
      if (t.bg) markToolTask(tab, t, TASK_END[msg.status] || msg.status);
      break;
    }
    default: return;
  }
  renderTasks(tab);
}

// Süreç değişti (konuşma geri sarıldı, yeniden doğuş, sohbet bitti): eski sürecin görevleri onunla kapandı
function resetTasks(tab) {
  tab.tasks?.clear();
  tab.bgIds?.clear();
  tab.fgTasks?.clear();
  renderTasks(tab);
}

function taskMeta(t) {
  const kind = TASK_KINDS[t.type]?.[1] || 'Görev';
  const parts = [t.agent && t.agent !== 'general-purpose' ? `${kind} · ${t.agent}` : kind];
  if (t.summary) parts.push(t.summary);
  else if (t.lastTool) parts.push(LIVE_VERBS[toolCategory(t.lastTool)] || t.lastTool);
  if (t.usage?.tool_uses) parts.push(`${t.usage.tool_uses} araç`);
  return parts.join(' · ');
}

// Satırlar yerinde güncellenir (görev kimliğiyle): ilerleme mesajı geldikçe yeniden kurulsa imlecin altındaki "Durdur" tıklanırken değişirdi
function renderTasks(tab) {
  const bar = tab.tasksBar;
  if (!bar) return;
  const list = [...(tab.bgIds || [])].map((id) => tab.tasks?.get(id)).filter(Boolean);
  bar.hidden = !list.length;
  if (!list.length) { bar.open = false; clearInterval(tab.tasksTimer); tab.tasksTimer = null; bar.querySelector('.tb-body').replaceChildren(); return; }
  bar.querySelector('.tb-count').textContent = list.length === 1 ? '1 görev arka planda' : `${list.length} görev arka planda`;
  bar.querySelector('.tb-cur').textContent = list[list.length - 1].description || '';
  const body = bar.querySelector('.tb-body');
  const rows = new Map([...body.querySelectorAll('.tb-row')].map((r) => [r.dataset.task, r]));
  const want = list.map((t) => {
    let row = rows.get(t.id);
    if (!row) {
      row = h('div', { class: 'tb-row', 'data-task': t.id },
        h('span', { class: 'tb-icon' }),
        h('div', { class: 'tb-main' }, h('div', { class: 'tb-desc' }), h('div', { class: 'tb-meta' })),
        h('span', { class: 'tb-time', 'data-since': String(t.startedAt) }),
        h('button', { class: 'tb-stop', title: 'Yalnız bu görevi durdur', onclick: (e) => stopTask(tab, t, e.currentTarget) }, 'Durdur'));
    }
    if (row.dataset.type !== (t.type || '')) {
      row.dataset.type = t.type || '';
      row.querySelector('.tb-icon').replaceChildren(icon(TASK_KINDS[t.type]?.[0] || 'clock', 14));
    }
    const desc = t.description || TASK_KINDS[t.type]?.[1] || 'Görev';
    row.querySelector('.tb-desc').textContent = desc;
    row.querySelector('.tb-desc').title = desc;
    row.querySelector('.tb-meta').textContent = taskMeta(t);
    row.querySelector('.tb-time').textContent = elapsedText(Date.now() - t.startedAt);
    return row;
  });
  const foot = list.length > 1 ? body.querySelector('.tb-foot') || h('div', { class: 'tb-foot' },
    h('button', { class: 'tb-stopall', onclick: () => { for (const b of bar.querySelectorAll('.tb-stop:not([disabled])')) b.click(); } }, 'Hepsini durdur')) : null;
  const kids = foot ? [...want, foot] : want;
  if (kids.length !== body.children.length || kids.some((k, i) => body.children[i] !== k)) body.replaceChildren(...kids);
  if (!tab.tasksTimer) {
    tab.tasksTimer = setInterval(() => {
      if (!bar.isConnected) { clearInterval(tab.tasksTimer); tab.tasksTimer = null; return; }
      for (const el of bar.querySelectorAll('.tb-time')) el.textContent = elapsedText(Date.now() - +el.dataset.since);
    }, 1000);
  }
}

async function stopTask(tab, t, btn) {
  btn.disabled = true;
  btn.textContent = 'Durduruluyor…';
  const r = await window.panel.chatStopTask(tab.chatId, t.id);
  if (!r?.ok) {
    btn.disabled = false;
    btn.textContent = 'Durdur';
    toast('Görev durdurulamadı: ' + (r?.error || 'bilinmeyen hata'));
  }
}

// Göstergedeki "Arka plana al": ön planda süren en son görev
async function backgroundForeground(tab) {
  const t = [...(tab.fgTasks?.values() || [])].pop();
  if (!t) return;
  const btn = tab.actEl.querySelector('.la-bg');
  btn.disabled = true;
  const r = await window.panel.chatBackgroundTask(tab.chatId, t.toolUseId);
  btn.disabled = false;
  if (!r?.ok) toast('Arka plana alınamadı' + (r?.error ? ': ' + r.error : '; komut bitmiş olabilir.'));
}
