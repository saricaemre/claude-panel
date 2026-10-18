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

module.exports = { createTool };
