/* Claude Panel — sohbet içi görseller (show_widget): Claude'un HTML/SVG'si yanıtın arasında, kökensiz bir kum havuzunda
   (artifact://widget/<anahtar>/, artifacts.js). Çizim araç girdisinden yapılır; geçmiş yüklenince de görünür.
   Sayfa iki şey bildirebilir: yüksekliği (iframe uzar) ve sendPrompt metni (yazma alanına taslak olur, kendiliğinden gitmez). */

const WIDGET_TOOL = 'mcp__panel__show_widget';
const WIDGET_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox';

async function showWidget(tab, card, input = {}) {
  const title = String(input.title || 'görsel');
  const frame = h('iframe', { class: 'widget-frame', sandbox: WIDGET_SANDBOX, title });
  const save = h('button', { class: 'mini', title: 'Artifacts galerisine kaydet', onclick: async () => {
    const r = await window.panel.artifactsAddContent({ title: title.replace(/_/g, ' '), content: input.widget_code, kind: /^\s*<svg[\s>]/i.test(input.widget_code) ? 'svg' : 'html' });
    if (!r.ok) return toast('Kaydedilemedi: ' + r.error);
    handleChatArtifact(tab.chatId, { id: r.id, title, kind: 'html', version: r.version, created: r.created });
  } }, icon('artifacts', 13), 'Artifact olarak kaydet');
  const fig = h('figure', { class: 'widget' }, frame, h('figcaption', {}, h('span', {}, title), h('span', { class: 'spacer' }), save));
  (card.group ? card.group.shots : card.body).append(fig);
  const r = await window.panel.widgetRegister(input.widget_code);
  if (!r.ok) {
    fig.replaceChildren(h('div', { class: 'widget-err' }, 'Görsel gösterilemedi: ' + r.error));
    return;
  }
  frame.src = r.url;
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.__panelWidget !== 1) return;
  const frame = [...document.querySelectorAll('iframe.widget-frame')].find((f) => f.contentWindow === e.source);
  if (!frame) return;
  const tab = frame.closest('.chat-host')?.__tab;
  if (typeof d.height === 'number' && d.height > 0) {
    // Görsel uzayınca sohbet en alttaysa altta kalsın (yanıtın devamı görsel yüzünden aşağıda kaybolmasın)
    const stick = tab && nearBottom(tab);
    frame.style.height = Math.max(40, Math.min(d.height, 1600)) + 'px';
    if (stick) scrollDown(tab, true);
  }
  if (typeof d.prompt === 'string' && d.prompt.trim() && tab) setDraft(tab, d.prompt.slice(0, 4000));
});
