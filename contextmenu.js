// Sağ tık menüsü: Electron varsayılan olarak hiç göstermiyor. Ana pencereye (sohbet, artifact ve görsel iframe'leri dahil),
// claude.ai Web görünümüne ve tarayıcı bölmesine bağlanır (main.js, browser.js → configureContents).
// Sayfanın kendi menüsü olan yerlerde (ör. ahtapot kolları, contextmenu'da preventDefault) bu olay hiç gelmez.
const { app, BrowserWindow, Menu, clipboard, shell } = require('electron');
const fs = require('fs');

const SEARCH = 'https://www.google.com/search?q=';

// Testte dış tarayıcı açılmaz; adres CLAUDE_PANEL_OPEN_LOG dosyasına yazılır (opener.js ile aynı biçim)
function openExternal(url) {
  if (process.env.CLAUDE_PANEL_OPEN_LOG) {
    fs.appendFileSync(process.env.CLAUDE_PANEL_OPEN_LOG, JSON.stringify({ how: 'external', args: [url] }) + '\n');
    return;
  }
  shell.openExternal(url);
}

function short(text, n = 32) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Menünün öğeleri; params Electron'un context-menu olayından
function template(p, wc) {
  const groups = [];
  const sel = (p.selectionText || '').trim();
  const f = p.editFlags || {};

  if (p.isEditable && p.misspelledWord) {
    const fixes = (p.dictionarySuggestions || []).slice(0, 5).map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) }));
    groups.push([
      ...(fixes.length ? fixes : [{ label: 'Öneri yok', enabled: false }]),
      { label: 'Sözlüğe ekle', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
    ]);
  }

  if (sel) {
    groups.push([
      { label: `Google'da ara: “${short(sel)}”`, click: () => openExternal(SEARCH + encodeURIComponent(sel)) },
      process.platform === 'darwin' && { label: `Sözlükte ara: “${short(sel, 20)}”`, click: () => wc.showDefinitionForSelection() },
    ]);
  }

  // Yalnız http(s) ve mailto dışarıda açılır (javascript:, file:, artifact: açılmaz)
  if (/^(https?:|mailto:)/i.test(p.linkURL || '')) {
    const link = p.linkURL;
    groups.push([
      { label: 'Bağlantıyı tarayıcıda aç', click: () => openExternal(link) },
      { label: link.startsWith('mailto:') ? 'E-posta adresini kopyala' : 'Bağlantıyı kopyala',
        click: () => clipboard.writeText(link.startsWith('mailto:') ? link.slice(7) : link) },
    ]);
  }

  if (p.mediaType === 'image' && p.hasImageContents) {
    groups.push([{ label: 'Görseli kopyala', click: () => wc.copyImageAt(p.x, p.y) }]);
  }

  if (p.isEditable) {
    groups.push([
      { label: 'Geri al', enabled: !!f.canUndo, accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => wc.undo() },
      { label: 'Yinele', enabled: !!f.canRedo, accelerator: 'Shift+CmdOrCtrl+Z', registerAccelerator: false, click: () => wc.redo() },
    ], [
      { label: 'Kes', enabled: !!f.canCut, accelerator: 'CmdOrCtrl+X', registerAccelerator: false, click: () => wc.cut() },
      { label: 'Kopyala', enabled: !!f.canCopy, accelerator: 'CmdOrCtrl+C', registerAccelerator: false, click: () => wc.copy() },
      { label: 'Yapıştır', enabled: !!f.canPaste, accelerator: 'CmdOrCtrl+V', registerAccelerator: false, click: () => wc.paste() },
      { label: 'Tümünü seç', enabled: f.canSelectAll !== false, accelerator: 'CmdOrCtrl+A', registerAccelerator: false, click: () => wc.selectAll() },
    ]);
  } else if (sel) {
    groups.push([{ label: 'Kopyala', accelerator: 'CmdOrCtrl+C', registerAccelerator: false, click: () => wc.copy() }]);
  }

  // Geliştirirken (npm start) öğeyi incelemek için
  if (!app.isPackaged) {
    groups.push([{ label: 'Öğeyi incele', click: () => wc.inspectElement(p.x, p.y) }]);
  }

  const items = [];
  for (const g of groups) {
    const list = g.filter(Boolean);
    if (!list.length) continue;
    if (items.length) items.push({ type: 'separator' });
    items.push(...list);
  }
  return items;
}

// Menüyü gösterir; testler bunu kaydediciyle değiştirir (yerel menü açılmasın)
function popup(menu, wc) {
  const host = wc.hostWebContents || wc;
  const win = BrowserWindow.fromWebContents(host);
  menu.popup(win ? { window: win } : {});
}

// skip(): menü açılmasın (ör. Claude tarayıcı bölmesinde sağ tıklarken: CDP girdisi de bu olayı üretir)
function attach(wc, { skip } = {}) {
  wc.on('context-menu', (_e, params) => {
    if (skip?.()) return;
    const items = template(params, wc);
    if (!items.length) return;
    module.exports.popup(Menu.buildFromTemplate(items), wc);
  });
}

module.exports = { attach, template, popup };
