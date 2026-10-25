/* Claude Panel — tur sonu kutusu (wrap_up, wrapup.js), sohbetteki görev listesi kartı (panelin plan aracı ya da TodoWrite)
   ve yazma alanının üstündeki sabit görev listesi.
   Kutu tur bitince sohbetin sonuna taşınır; düğmeler kullanıcının mesajı olarak gider. Yeni bir mesaj gidince açık kutular kapanır.
   Görev kartı iş sürerken hep sohbetin en altında durur (append onun önüne koyar), tur bitince yerinde kalır. */

const WRAP_TOOL = 'mcp__panel__wrap_up';
const PLAN_TOOL = 'mcp__panel__plan';

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

// ---------- Görev listesi kartı ----------

// Panelin plan aracı: items listenin tamamı, advance çalışan adımı bitirip sıradakini başlatır (ana süreçte wrapup.js → advancePlan, aynı kural)
function applyPlan(tab, input = {}) {
  let todos;
  if (Array.isArray(input.items)) {
    todos = input.items.map((t) => ({ content: String(t?.content || '').trim(), status: t?.status })).filter((t) => t.content);
    if (!todos.length) return;
  } else if (input.advance && tab.todos?.length) {
    todos = tab.todos.map((t) => ({ ...t }));
    const cur = todos.findIndex((t) => t.status === 'in_progress');
    if (cur >= 0) todos[cur].status = 'completed';
    const nxt = todos.findIndex((t, i) => i > cur && t.status === 'pending');
    if (nxt >= 0) todos[nxt].status = 'in_progress';
  } else return;
  updateProgress(tab, todos); // yan panel, sabit liste ve kart (renderer/chat.js)
}

const allDone = (todos) => todos.length && todos.every((t) => t.status === 'completed');
const todoText = (t) => (t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content);

function planItem(t, i) {
  return h('li', { class: 'pc-item ' + t.status, style: `--i:${i}` },
    h('span', { class: 'pc-box' }, icon('check', 12)),
    h('span', { class: 'pc-text' }, todoText(t)));
}

// Kartı kurar ya da günceller. Liste aynıysa satırlar yerinde kalır, yalnız durumları değişir (biten adımın tiki çizilir);
// liste değiştiyse satırlar yeniden kurulur. Bitmiş bir listeye yeni plan gelirse eski kart geçmişte kalır, yenisi açılır.
function renderPlanCard(tab) {
  const todos = tab.todos || [];
  let card = tab.planCard;
  if (!todos.length) { card?.classList.remove('pinned'); return; }
  const same = card && card._todos?.length === todos.length && card._todos.every((t, i) => t.content === todos[i].content);
  if (card && !same && allDone(card._todos)) { card.classList.remove('pinned'); card = null; }
  if (!card) {
    const ring = h('span', { class: 'pc-ring' });
    ring.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><circle class="pc-ring-fill" cx="10" cy="10" r="8" pathLength="100"/></svg>';
    card = h('details', { class: 'plan-card', open: true },
      h('summary', {}, ring, h('span', { class: 'pc-title' }), h('span', { class: 'pc-count' }), h('span', { class: 'spacer' }), icon('chevronDown', 13)),
      h('div', { class: 'pc-bar' }, h('i')),
      h('ol', { class: 'pc-list' }));
    watchPlanCard(tab, card);
  }
  const list = card.querySelector('.pc-list');
  const prev = card._todos || [];
  if (same) {
    todos.forEach((t, i) => {
      const li = list.children[i];
      if (prev[i].status !== t.status) {
        li.className = 'pc-item ' + t.status + (t.status === 'completed' ? ' just' : '');
        li.querySelector('.pc-text').textContent = todoText(t);
      }
    });
  } else list.replaceChildren(...todos.map(planItem));
  card._todos = todos.map((t) => ({ ...t }));
  const done = todos.filter((t) => t.status === 'completed').length;
  const cur = todos.find((t) => t.status === 'in_progress');
  const finished = done === todos.length;
  card.classList.toggle('done', finished);
  card.querySelector('.pc-title').textContent = finished ? 'Hepsi tamamlandı' : cur ? todoText(cur) : 'Plan';
  card.querySelector('.pc-count').textContent = `${done}/${todos.length}`;
  card.querySelector('.pc-ring-fill').style.strokeDasharray = `${(done / todos.length) * 100} 100`;
  card.querySelector('.pc-bar i').style.width = `${(done / todos.length) * 100}%`;
  // İş sürerken kart en altta durur; değilse (yeni bir tur) en alta taşınır
  if (!finished || !card.isConnected) {
    card.classList.add('pinned');
    if (tab.list.lastElementChild !== card) append(tab, card);
  }
}

// Sohbetin güncel kartı. Kart görünürken yazma alanının üstündeki sabit liste gizlenir (ikisi aynı şeyi gösterir).
function watchPlanCard(tab, card) {
  tab.planCard = card;
  tab.planSeen?.disconnect();
  tab.planSeen = null;
  tab.planCardVisible = false;
  if (!card) return;
  tab.planSeen = new IntersectionObserver(([e]) => { tab.planCardVisible = e.isIntersecting; updatePlanBar(tab); }, { root: tab.scroller });
  tab.planSeen.observe(card);
}

// Tur sonu: kart yerinde kalır, bundan sonra gelenler altına eklenir
function settlePlanCard(tab) {
  tab.planCard?.classList.remove('pinned');
}

// Konuşma geri sarıldı (renderer/chat.js → truncateFrom): görev listesi sohbette kalan son kartın hâline döner;
// silinen kısımdaki kart güncel kart olmaktan çıkar, sonraki plan yeni kart açar ya da kalan kartı günceller
function restorePlanAfterRewind(tab) {
  const cards = tab.list.querySelectorAll('.plan-card');
  const card = cards[cards.length - 1] || null;
  if (tab.planCard !== card) watchPlanCard(tab, card);
  card?.classList.remove('pinned');
  updateProgress(tab, (card?._todos || []).map((t) => ({ ...t })), false);
}

// Sabit görev listesi: yarım görev varken ve sohbetteki kart görünmüyorken yazma alanının üstünde (hepsi bitince kaybolur)
function updatePlanBar(tab) {
  const bar = tab.planBar;
  if (!bar) return;
  const todos = tab.todos || [];
  const done = todos.filter((t) => t.status === 'completed').length;
  const cur = todos.find((t) => t.status === 'in_progress') || todos.find((t) => t.status !== 'completed');
  bar.hidden = !todos.length || done === todos.length || !!tab.planCardVisible;
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
