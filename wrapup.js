// Tur sonu kutusu: Claude çok adımlı bir işi bitirince kısa bir özet ve gerekirse tek bir karar sorusu gösterir;
// cevaplar düğmedir, tıklanınca kullanıcının mesajı olarak gider. Kutu araç girdisinden çizilir (renderer/wrapup.js);
// araç yalnız doğrular. İzin sormaz (allowedTools).
function createTool(sdk, z) {
  return sdk.tool(
    'wrap_up',
    'Birden çok adım süren, dosya değiştiren ya da komut çalıştıran bir turu bitirirken, son mesajından önce bir kez çağır. ' +
      'recap: şimdi ne doğru, ne değişti ve ne yapılmadı/doğrulanmadı (2-3 kısa cümle, kullanıcıya "siz" diye). ' +
      'Sıradaki adım kullanıcının kararıysa ask ile TEK bir kısa soru sor ve actions ile 1-3 düğme ver (ilki önerin; message düğmeye ' +
      'basınca gidecek metin, verilmezse label gider). Soru sorduysan turu burada bitir, cevabı düğmeden beklersin. Kısa yanıtlarda çağırma.',
    {
      recap: z.string().describe('2-3 cümlelik özet'),
      ask: z.string().optional().describe('Kullanıcının vereceği tek karar (en çok 140 karakter)'),
      actions: z.array(z.object({ label: z.string().describe('1-4 kelime'), message: z.string().optional().describe('Tıklanınca gidecek mesaj') }))
        .optional().describe('Soruya cevap düğmeleri (en çok 3)'),
    },
    async (a) => {
      const recap = String(a.recap || '').trim();
      if (!recap) return { content: [{ type: 'text', text: 'recap gerekli' }], isError: true };
      if ((a.actions || []).length > 3) return { content: [{ type: 'text', text: 'En çok 3 düğme' }], isError: true };
      const asked = a.ask && a.actions?.length;
      return { content: [{ type: 'text', text: asked ? 'Kutu gösterildi. Turu burada bitir; kullanıcı düğmeyle cevap verecek.' : 'Özet gösterildi.' }] };
    }
  );
}

// Görev listesi (Claude masaüstü uygulamasındaki update_plan gibi): Claude çok adımlı bir işe başlarken planı verir,
// adım bittikçe advance ile ilerletir. Liste sohbette kutucuklu kart olarak çizilir (renderer/wrapup.js → applyPlan), araç yalnız doğrular.
// Gerçek Claude Code 2.1.300'de Opus 5.5'te ne TodoWrite ne TaskCreate var (2026-10-20, yerel sahte API ile ölçüldü);
// eski modellerde TaskCreate/TaskUpdate var, TodoWrite kapalı. Bu yüzden liste panelin kendi aracıyla. İzin sormaz (allowedTools).
const PLAN_STATUS = ['pending', 'in_progress', 'completed'];
const PLAN_PROMPT = 'Görev listesi: dosya düzenleyen ya da birden çok komut çalıştıran bir işe başlarken, ilk araç çağrınla aynı mesajda ' +
  '`mcp__panel__plan` ile bütün planı ver: items 2-8 kısa adım (emir kipinde, en çok ~7 kelime), başladığın adım in_progress, kalanlar pending. ' +
  'Bir adım bitince sıradaki adımı başlatan çağrıyla aynı mesajda `plan` { advance: true } gönder; son adım bitince de. ' +
  'Plan değişirse ya da kullanıcı yön değiştirirse items ile listenin tamamını yeniden ver. Tek komutluk yanıtlarda ve sohbette kullanma. ' +
  'TodoWrite ya da TaskCreate yerine bunu kullan; liste kullanıcıya sohbette gösterilir, planı metinde ayrıca numaralı liste olarak yazma.';

// Listeyi bir adım ilerletir: çalışan adım biter, sıradaki bekleyen başlar (arayüz aynı kuralla çizer)
function advancePlan(items) {
  const next = items.map((t) => ({ ...t }));
  const cur = next.findIndex((t) => t.status === 'in_progress');
  if (cur >= 0) next[cur].status = 'completed';
  const nxt = next.findIndex((t, i) => i > cur && t.status === 'pending');
  if (nxt >= 0) next[nxt].status = 'in_progress';
  return next;
}

function createPlanTool(sdk, z, { onChange } = {}) {
  let items = [];
  return sdk.tool(
    'plan',
    'Görev listesini gösterir ya da günceller. items: listenin tamamı (yeni plan ya da değişen plan). ' +
      'advance: true çalışan adımı bitirir, sıradakini başlatır. İkisinden biri verilir.',
    {
      items: z.array(z.object({ content: z.string().describe('Kısa adım, emir kipinde'), status: z.enum(PLAN_STATUS) }))
        .optional().describe('Listenin tamamı, sırayla (1-12 adım)'),
      advance: z.boolean().optional().describe('Çalışan adımı bitir, sıradakini başlat'),
    },
    async (a) => {
      if (a.items) {
        const list = a.items.map((t) => ({ content: String(t.content || '').trim(), status: t.status })).filter((t) => t.content);
        if (!list.length || list.length > 12) return { content: [{ type: 'text', text: 'items 1-12 adım olmalı' }], isError: true };
        items = list;
      } else if (a.advance) {
        if (!items.length) return { content: [{ type: 'text', text: 'Önce items ile bir plan ver' }], isError: true };
        items = advancePlan(items);
      } else return { content: [{ type: 'text', text: 'items ya da advance gerekli' }], isError: true };
      onChange?.(items);
      const done = items.filter((t) => t.status === 'completed').length;
      return { content: [{ type: 'text', text: `Liste güncellendi (${done}/${items.length}).` }] };
    }
  );
}

module.exports = { createTool, createPlanTool, advancePlan, PLAN_PROMPT };
