/* Claude Panel — tur sonu kutusu (wrap_up, wrapup.js) ve yazma alanının üstündeki sabit görev listesi (TodoWrite).
   Kutu tur bitince sohbetin sonuna taşınır; düğmeler kullanıcının mesajı olarak gider. Yeni bir mesaj gidince açık kutular kapanır. */

const WRAP_TOOL = 'mcp__panel__wrap_up';

function wrapBox(tab, input = {}) {
  const box = h('div', { class: 'wrap-box' },
    h('div', { class: 'wb-recap' }, String(input.recap || '')));
  const actions = (input.actions || []).slice(0, 3).filter((x) => x?.label);
  if (input.ask) box.append(h('div', { class: 'wb-ask' }, String(input.ask)));
  if (actions.length) {
    box.append(h('div', { class: 'wb-actions' }, actions.map((x, i) => h('button', {
      class: i === 0 ? 'primary-btn' : 'ghost-btn',
      title: x.message || x.label,
      onclick: (e) => {
        if (box.classList.contains('answered') || !tab.chatId) return;
        e.currentTarget.classList.add('chosen');
        tab.input.value = String(x.message || x.label);
        submit(tab);
      },
    }, String(x.label)))));
  }
  return box;
}

function showWrapUp(tab, input) {
  const box = wrapBox(tab, input);
  endGroup(tab);
  append(tab, box);
  tab.wrapBox = box; // tur bitince sona taşınır
}

// Tur sonu: kutu son metnin altına geçer
function settleWrapUp(tab) {
  if (!tab.wrapBox) return;
  append(tab, tab.wrapBox);
  tab.wrapBox = null;
  scrollDown(tab);
}

function closeWrapBoxes(tab) {
  for (const b of tab.list.querySelectorAll('.wrap-box:not(.answered)')) {
    b.classList.add('answered');
    for (const btn of b.querySelectorAll('button')) btn.disabled = true;
  }
}

// Sabit görev listesi: yarım görev varken yazma alanının üstünde (hepsi bitince kaybolur)
function updatePlanBar(tab) {
  const bar = tab.planBar;
  if (!bar) return;
  const todos = tab.todos || [];
  const done = todos.filter((t) => t.status === 'completed').length;
  const cur = todos.find((t) => t.status === 'in_progress') || todos.find((t) => t.status !== 'completed');
  bar.hidden = !todos.length || done === todos.length;
  if (bar.hidden) return;
  bar.querySelector('.pb-count').textContent = `${done}/${todos.length}`;
  bar.querySelector('.pb-cur').textContent = cur.status === 'in_progress' ? cur.activeForm || cur.content : cur.content;
  bar.querySelector('.pb-body').replaceChildren(todoList(todos));
}

function planBar() {
  return h('details', { class: 'plan-bar', hidden: true },
    h('summary', {}, icon('check', 14), h('span', { class: 'pb-count' }), h('span', { class: 'pb-cur' }), h('span', { class: 'spacer' }), icon('chevronDown', 13)),
    h('div', { class: 'pb-body' }));
}
