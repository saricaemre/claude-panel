// Yazma kutusunda `@dosya` önerileri (Claude Code'daki gibi). Liste ana süreçten (changes.js → `mentionable`):
// sohbetin klasöründeki dosyalar ve klasörler, yollar o klasöre göre. Seçilen yol `@yol ` olarak yazılır; dosyayı
// Claude Code kendisi açar (içeriği isteğe ekler; klasörde listesini). Boşluklu yol `@"yol"` (ölçüldü: `\ ` kaçışı açılmıyor).
// Kutu "/" önerileriyle aynıdır (tab.slashBox); seçim ve klavye renderer/chat.js → wireComposer'da (`__pick`).

const MENTION_SHOW = 8;
const MENTION_TTL = 30 * 1000;
const mentionLists = new Map(); // klasör → { at, promise }

// Arama biçimi: küçük harf, Türkçe ı → i, aksanlar atılır ("şar" → "sar"; "Ş" ile "S" eşleşsin)
function mentionNorm(s) {
  return s.toLowerCase().replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function mentionList(cwd) {
  const hit = mentionLists.get(cwd);
  if (hit && Date.now() - hit.at < MENTION_TTL) return hit.promise;
  const promise = window.panel.filesMentionable(cwd).then((r) => {
    if (!r?.ok) { mentionLists.delete(cwd); return null; }
    const entries = [...r.dirs.map((p) => ({ path: p, dir: true })), ...r.files.map((p) => ({ path: p, dir: false }))];
    for (const e of entries) {
      const bare = e.dir ? e.path.slice(0, -1) : e.path;
      e.base = bare.slice(bare.lastIndexOf('/') + 1);
      e.parent = bare.slice(0, bare.length - e.base.length);
      e.n = mentionNorm(e.path);
      e.nb = mentionNorm(e.base);
      e.depth = (bare.match(/\//g) || []).length;
    }
    return { entries, truncated: r.truncated };
  });
  mentionLists.set(cwd, { at: Date.now(), promise });
  return promise;
}

// İmlecin önündeki `@…` parçası: satır başında ya da boşluktan sonra (e-posta açılmaz, CLI de açmıyor).
// `@"` ile başlayan parça boşluk içerebilir.
function mentionToken(input) {
  const pos = input.selectionStart;
  if (pos !== input.selectionEnd) return null;
  const before = input.value.slice(0, pos);
  const m = /(?:^|\s)@(?:"([^"\n]*)|([^\s"]*))$/.exec(before);
  if (!m) return null;
  const quoted = m[1] !== undefined;
  const start = before.length - (quoted ? m[1].length + 2 : m[2].length + 1);
  // Kelimenin imleçten sonraki kısmı da değişir (`@uyg|ulama` → seçilen yol)
  const after = input.value.slice(pos);
  const rest = quoted ? /^[^"\n]*"?/.exec(after)[0] : /^[^\s]*/.exec(after)[0];
  return { start, end: pos + rest.length, query: quoted ? m[1] : m[2] };
}

// Puan: ad aynen > ad önekle > yol önekle > ad içinde > yol içinde > harfler sırayla (bulanık). Eşitlikte kısa yol önde.
function mentionScore(e, q) {
  if (!q) return e.depth === 0 ? 1 : 0;
  if (q.endsWith('/')) return e.n.startsWith(q) && e.n !== q && e.depth === (q.match(/\//g) || []).length ? 1 : 0;
  const target = q.includes('/') ? e.n : e.nb;
  if (target === q || e.nb === q) return 100;
  if (e.nb.startsWith(q)) return 80;
  if (e.n.startsWith(q)) return 70;
  if (target.includes(q)) return 60;
  if (e.n.includes(q)) return 40;
  let i = 0, gaps = 0, last = -1;
  for (let j = 0; j < e.n.length && i < q.length; j++) {
    if (e.n[j] === q[i]) { if (last >= 0 && j > last + 1) gaps++; last = j; i++; }
  }
  return i === q.length ? Math.max(1, 30 - gaps * 3) : 0;
}

function mentionMatches(list, query) {
  const q = mentionNorm(query);
  const scored = [];
  for (const e of list.entries) {
    const s = mentionScore(e, q);
    if (s) scored.push([s, e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].path.length - b[1].path.length || (b[1].dir - a[1].dir) || a[1].path.localeCompare(b[1].path));
  return scored.slice(0, MENTION_SHOW).map((x) => x[1]);
}

// Yazma kutusundaki parça değişince (yazı, imleç). "/" önerisi açıksa dokunmaz.
async function updateMention(tab) {
  const box = tab.slashBox;
  const tok = mentionToken(tab.input);
  if (!tok || !tab.cwd) { if (box.classList.contains('mention')) box.hidden = true; return; }
  const seq = (tab.mentionSeq = (tab.mentionSeq || 0) + 1);
  const list = await mentionList(tab.cwd);
  if (seq !== tab.mentionSeq) return; // bu arada yeni tuş geldi
  const items = list ? mentionMatches(list, tok.query) : [];
  box.classList.add('mention');
  box.innerHTML = '';
  items.forEach((e, i) => {
    const el = h('div', {
      class: 'slash-item mention-item' + (i === 0 ? ' on' : ''), 'data-path': e.path, title: e.path,
      onmousedown: (ev) => { ev.preventDefault(); el.__pick(); },
    }, h('span', { class: 'mention-ic' }, icon(e.dir ? 'folder' : 'file', 13)),
    h('span', { class: 'slash-name' }, e.base + (e.dir ? '/' : '')),
    e.parent ? h('span', { class: 'mention-dir' }, e.parent) : null);
    el.__pick = () => pickMention(tab, e);
    box.append(el);
  });
  if (list?.truncated && items.length) box.append(h('div', { class: 'mention-note' }, 'Liste kısaltıldı; aradığınız yoksa yolu yazın.'));
  box.hidden = !items.length;
}

function pickMention(tab, e) {
  const input = tab.input;
  const tok = mentionToken(input);
  if (!tok) return;
  const spaced = /\s|"/.test(e.path);
  // Klasör seçilince parça açık kalır, içindekiler listelenir; dosya seçilince boşlukla kapanır
  const text = e.dir ? (spaced ? '@"' : '@') + e.path : (spaced ? `@"${e.path}"` : '@' + e.path) + ' ';
  const v = input.value;
  const tail = v.slice(tok.end);
  input.value = v.slice(0, tok.start) + text + (e.dir || !tail.startsWith(' ') ? tail : tail.slice(1));
  const caret = tok.start + text.length;
  input.setSelectionRange(caret, caret);
  input.focus();
  tab.autosize?.();
  tab.slashBox.hidden = true;
  if (e.dir) updateMention(tab);
}
