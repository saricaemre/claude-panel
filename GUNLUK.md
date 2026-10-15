# Geliştirme günlüğü

Claude Panel'de ne yapıldığı, neden öyle yapıldığı ve nasıl doğrulandığı. En yeni kayıt en üstte.
Kurallar, dosya haritası ve tuzaklar `CLAUDE.md`'de; bu dosya geçmişi tutar. Her iş bitince buraya kısa bir kayıt eklenir.

---

## 2026-10-15 · İki güvenlik açığı kapatıldı

**İstek:** Mevcut işi commit'le (`panel-gelistirmeleri` dalı, `6fd0d75`), sonra incelemede bulunan iki açığı kapat ve her biri için e2e adımı ekle.

**1. Sohbetten pencere kaçırma**
- `main.js`: ana pencerede `will-navigate` yalnız kendi `index.html`'ine izin veriyor. Form, bırakılan link ya da `location` ile dış sayfaya gidilmiyor; dolayısıyla `window.panel` dışarıya verilmiyor.
- `renderer/index.html`: CSP'ye `form-action 'none'; base-uri 'none'` eklendi.
- `renderer/chat.js`: DOMPurify'a `PURIFY` ayarı verildi. `form`, `button`, `style`, `link`, `meta`, `base` etiketleri ve `style`, `action`, `formaction` özellikleri atılıyor. Görev listesi kutucukları (`input`) kalıyor.

**2. Küçük resim sızıntısı**
- **Ölçüm:** Electron bu özel şemada CORS uygulamıyor ve `Sec-Fetch`/`Origin` başlığı göndermiyor. Sayfa kökensiz (`sandbox`) olsa da `fetch` ile `artifact://` içeriğini okuyabiliyor. Görüntüleyici iframe'i dahil; `CLAUDE.md`'deki eski varsayım yanlıştı.
- `.json` varlık listesinden çıkarıldı.
- Sayfalar `CSP: sandbox` başlığıyla sunuluyor; izinler görüntüleyici iframe'iyle aynı.
- Küçük resimler ayrı, bellekte bir oturumda (`artifact-thumbs`) çiziliyor. Yalnız o an çizilen artifact sunuluyor, ağ istekleri kesiliyor. Yalnız bilinen CDN'lerden betik, stil ve yazı tipi geçiyor; grafik kütüphanesi kullanan sayfalar boş kalmasın diye.

**Kararlar**
- Görüntüleyicide başka bir artifact'i okumak için kimliğini bilmek gerekiyor (48 bit rastgele). Bu açık bırakıldı ve §7'ye yazıldı. Asıl risk, kimse açmadan çalışan küçük resimdi.
- Blender/figma-console'un izin sormaması (otomatik inceleme işaretledi) Emre'nin isteğiydi; dokunulmadı, §7'ye bedeli yazıldı.

**Doğrulama**
- `npm run check`, `npm test` yeşil (27 adım). Yeni adımlar:
  - Yanıttaki form/düğme/stil temizleniyor, görev kutucuğu kalıyor.
  - Ana pencere dış sayfaya gidemiyor; sayfa ve köprü yerinde (en son adım).
  - `.json` için 404.
  - Küçük resimde sondaj sayfası şunları deniyor: yandaki `.json`, başka artifact, başka küçük resim, yerel sunucu. Hepsi engellenince ve kendi görseli yüklenince arka planı yeşile boyuyor; test piksele ve sunucuya gelen isteklere bakıyor.
- Yedi bozma denemesinin yedisi de kırmızıya döndü: temizleyici ayarı, `will-navigate`, `json` izni, küçük resmin ana oturumda çizilmesi, ağ engeli, `sandbox` başlığı, küçük resim oturumunun her artifact'i sunması.
- Ekran görüntüleri: görüntüleyici ve sohbet değişmedi.

**Bekleyen:** Kurulu uygulama hâlâ eski kodu çalıştırıyor; `kur.sh` için panel kapatılmalı. Grafikli (CDN'li) bir artifact'in küçük resmi gerçek ağla denenmeli.

---

## 2026-10-15 · Genel sağlık incelemesi (kod değişmedi)

**İstek:** Panel sağlıklı çalışıyor mu, iyileştirilecek ne var?

**Sağlam olanlar:** `npm run check` temiz, `npm test` 24 adım yeşil (17,6 sn), `npm audit` 0 açık, Agent SDK güncel, kurulu uygulama kaynakla birebir aynı, hesap klasörleri ve symlink'ler doğru, Max ve Pro'da giriş var.

**Bulgular (doğrulanmış)**
- **Güvenlik, acil:** Sohbet yanıtındaki `<form>`/`<button>` DOMPurify'dan geçiyor. Tıklanınca ana pencere dış siteye gidiyor (`will-navigate` koruması yok, CSP'de `form-action` yok). Preload o sayfada da çalıştığı için site `window.panel` ile terminal açıp komut yazabilir. `<style>` de geçiyor; izin kartı düğmeleri gizlenebilir. Gizli Electron penceresinde gerçek marked + DOMPurify + panel CSP'siyle denendi.
- **Güvenlik, acil:** Küçük resim penceresi sayfayı korumalı iframe olmadan, `artifact://view` kökeninde açıyor. Sayfa betiği yandaki `.json` dosyalarını (MIME listesinde `json` var) ve başka artifact'lerin içeriğini `fetch` ile okuyabiliyor. Panelin `artifacts.js`'iyle geçici klasörde denendi: küçük resimde `secret.json` içeriği göründü.
- Oturum kapandıktan sonra gönderilen mesaj sekmeyi "Çalışıyor"da bırakıyor (`submit` yalnız `chatId`'ye bakıyor).
- Başlarken kapatılan sekme yetim Claude süreci bırakıyor; ilk mesaj gizlice çalışıyor.
- Tek örnek kilidi yok. `npm start` kurulu uygulamayla aynı ayar klasörünü kullanır; artifact `index.json`'u bellekte tutulduğu için son yazan diğerinin kayıtlarını siler (kod okumasıyla).
- Electron 38 güvenlik desteği dışında (son: 41).
- İlk sürümden sonraki bütün iş commit'lenmemiş.
- Küçük: bildirim balonu yazma alanındaki model seçiciyi kapatıyor; `tests/out/`'ta eski `hata.png`, `1-baslatici.png` ve `2-bos-sohbet.png` duruyor.

**Hesaplar:** İş'te giriş yok. Max'te `pencil` MCP sunucusu tanımlı ama `/Applications/Pen.app` yok. Gerçek artifact deposu hiç oluşmamış.

**Bekleyen:** Düzeltmeler Emre'nin onayını bekliyor. "Tam yetki" modunun sonraki yeni sohbetlere taşınması kasıtlı mı, Emre'ye soruldu.

---

## 2026-10-15 · Pro hesabında kullanım görünmüyordu

**İstek:** Pro hesabına giriş yapılmış, ama kullanım penceresi "Bu hesap için plan kullanımı yok" diyor.

**Neden:** Pro'da iki açık sohbet vardı; biri girişten önce açılmıştı (süreç 19:58:56, Anahtar Zinciri kaydı 19:59:37). `account:info` hesabın ilk açık sohbetinin sürecini kullanıyor. Claude Code giriş bilgisini süreç açılırken okuduğundan o süreç `subscription_type: null`, `rate_limits_available: false` döndürdü. Aynı çağrı taze bir süreçle `~/.claude-pro` için doğru veriyi veriyor (5 saat %1, haftalık %22). Girişsiz boş bir klasörle de aynı "yok" yanıtı alındı.

**Yapılan:** `chat-main.js` → `probe()`: açık sohbetin süreci kullanım vermezse taze yoklama süreciyle (`freshProbe`) yeniden sorulur. Model listesi açık sohbetten alınmaya devam eder.

**Doğrulama:** `npm run check`, `npm test`. Sahte CLI, ayar klasöründe `.fake-logged-out` varken açılırsa girişsiz yanıt verir. Yeni e2e adımı sohbeti bu durumda açıyor, dosyayı silip ("giriş") kullanımı soruyor. Düzeltme geri alınınca adım kırmızıya döndü.

**Kurulum:** `bash kur.sh` koşuldu; kurulan `chat-main.js`'te `freshProbe` var, uygulama açıldı.

**Gerçek hesapla:** Emre Pro hesabında Kullanım penceresinde yüzdeleri gördü. Bekleyen yok.

---

## 2026-10-15 · Eklentileri yönet (bağlayıcı listesinden)

**İstek:** Bağlayıcı listesine, Claude uygulamasındaki "Eklentileri yönet" bölümü gelsin.

**Yapılan**
- Bağlayıcı listesinin altına **Eklentileri yönet** satırı eklendi. Tıklanınca bir pencere açılıyor: kurulu Claude Code eklentileri (ad, pazar yeri, sürüm, açıklama) ve her biri için bir anahtar var. Alt kısımda `/plugin` ipucu ve "Terminalde aç" düğmesi duruyor.
- Ana süreç (`chat-main.js`): `plugins:list` ve `plugins:toggle`. Liste `<ayar klasörü>/plugins/installed_plugins.json` ile eklentilerin `plugin.json` dosyalarından okunuyor. Açık/kapalı durumu `settings.json` → `enabledPlugins` alanında.
- Açıp kapama hesabın genel `settings.json` dosyasına yazılıyor (Claude uygulamasındaki gibi). Aynı dosyayı kullanan açık sohbetlerde `q.reloadPlugins()` çağrılıyor.
- Klasörün `.claude/settings(.local).json` dosyası bir eklentiyi belirliyorsa o kazanıyor. Pencerede bu eklentinin anahtarı devre dışı ve sarı bir notla gösteriliyor.
- **Önceki işteki bir risk düzeltildi:** Bağlayıcı kapatırken `.claude.json` o an okunamazsa (bozuk ya da Claude Code tam yazarken), panel dosyayı neredeyse boş bir içerikle ezebilirdi. Artık okunamayan dosyaya hiç yazılmıyor (`readJsonForWrite`). Dosyanın izinleri korunuyor ve symlink ise hedefine yazılıyor.

**Kararlar**
- Emre'nin hesaplarında `settings.json` `~/.claude/settings.json`'a symlink'li. Bu yüzden eklenti değişikliği üç hesapta ve panel dışındaki Claude Code'da da geçerli. Pencerenin üstünde bu açıkça yazıyor. Atomik yazma symlink'i normal dosyaya çevirmesin diye `realpath` hedefine yazılıyor.

**Doğrulama**
- `npm run check` temiz, `npm test` yeşil. Yeni e2e adımları:
  - Liste ve anahtarlar doğru; yerel ayarın belirlediği eklenti kilitli.
  - Açma `settings.json`'a yazılıyor; diğer alanlar ve symlink korunuyor.
  - Açık sohbete `reload_plugins` gidiyor.
  - Bozuk `.claude.json`'un üzerine yazılmıyor ve hata gösteriliyor.
- Dört adım da bilerek bozuldu ve kırmızıya döndü: yazma kapatıldı, canlı yeniden yükleme kapatıldı, `realpath` kaldırıldı, eski "okunamazsa boş say" davranışı geri kondu.
- Ekran görüntüleri: `tests/out/1d-baglayicilar.png`, `tests/out/1e-eklentiler.png`.

**Bekleyen**
- Gerçek hesapla deneme: bir eklentiyi kapatınca açık sohbette skill/hook'larının gittiği görülmeli.
- Yeni eklenti kurma ve pazar yeri gezinme panelde yok; terminalde `/plugin` ile yapılıyor.

---

## 2026-10-15 · Bağlayıcıları açıp kapama (Yeni sohbet ekranı)

**İstek:** Yeni sohbet ekranının yazma kutusuna, Figma ve Blender gibi bağlayıcıları açıp kapayabileceğim bir yer.

**Yapılan**
- Yazma kutusunun alt çubuğuna, terminal düğmesinin yanına fiş ikonlu **Bağlayıcılar** düğmesi eklendi (`renderer/usage.js` → `connectorsButton`). Açılan listede her sunucu için ad, kapsam (Yalnız bu klasör / Proje · .mcp.json / Tüm klasörler / claude.ai bağlayıcısı) ve bir anahtar var. Kapalı sunucu varsa düğmede turuncu bir nokta çıkıyor.
- Ana süreç (`chat-main.js`): `mcp:list` ve `mcp:toggle`. Liste hesabın `.claude.json` dosyasından okunuyor: `mcpServers` (genel), `projects[<proje>].mcpServers` (klasöre özel), klasördeki `.mcp.json` ve `claudeAiMcpEverConnected` (claude.ai bağlayıcıları).
- Kapatma, Claude Code'un kendi `/mcp disable` kaydına yazılıyor: `projects[<proje>].disabledMcpServers`. Böylece aynı klasördeki sohbet de terminal de aynı seçimi kullanıyor.
- Hesabın o klasörde açık bir sohbeti varsa değişiklik `q.toggleMcpServer()` ile o oturuma da hemen gidiyor.

**Kararlar**
- Ayrı bir panel ayarı tutulmadı; kaynak Claude Code'un kaydı. Proje anahtarı Claude Code'daki gibi git kökü (worktree'de ana depo), git dışında klasörün gerçek yolu.
- Bu iki davranış, girişsiz gerçek Claude Code ikilisiyle (SDK 0.3.300) geçici bir ayar klasöründe denendi: (1) `toggleMcpServer` alt klasörden çağrılınca git kökü anahtarına yazıyor. (2) Dışarıdan yazılan bir kapatma, Claude Code sonradan dosyaya kendi değişikliğini yazınca da korunuyor (`["a","b"]`). Yani panelin doğrudan yazması güvenli.
- Dosya geçici dosyaya yazılıp yeniden adlandırılarak kaydediliyor; yarım yazılmış `.claude.json` kalmasın diye.

**Doğrulama**
- `npm run check` temiz, `npm test` yeşil. İki yeni e2e adımı var: (1) Liste dört sunucuyu doğru kapsamla gösteriyor, kapatma `.claude.json`'a yazılıyor ve diğer alanlar korunuyor, açınca liste boşalıyor. (2) Aynı klasörde açık sohbet varken sahte CLI'ye `mcp_toggle` gidiyor.
- İki adım da bir kez bilerek bozuldu (dosyaya yazma ve canlı iletim kapatıldı) ve kırmızıya döndü.
- Ekran görüntüsü: `tests/out/1d-baglayicilar.png`.

**Bekleyen**
- Gerçek hesapla deneme: Figma bağlayıcısını kapatıp sohbet açınca araçlarının gelmediği görülmeli.
- Proje `.mcp.json` sunucularının ayrı onay listeleri (`enabledMcpjsonServers`/`disabledMcpjsonServers`) dikkate alınmıyor; yalnız `disabledMcpServers` okunup yazılıyor.
- Sohbetin içinde (yazma alanında) aynı liste yok; şimdilik yalnız Yeni sohbet ekranında.

---

## 2026-10-15 · Blender ve figma-console izin sormadan

**İstek:** Blender ve figma-console araçları panelde izin sormadan çalışsın.

**Yapılan**
- `chat-main.js`'e `AUTO_ALLOW_MCP = ['blender', 'figma-console']` listesi eklendi.
- Sohbet görünümünde bu sunucular SDK'ya `allowedTools` olarak (`mcp__blender`, `mcp__figma-console`) veriliyor. Sunucu adı o sunucunun tüm araçlarını kapsıyor.
- Terminal sekmesinde `claude` artık `--allowedTools 'mcp__blender,mcp__figma-console'` ile açılıyor. Değerler virgülle tek argüman olarak verildi; çok değerli seçenek ardından gelen argümanları yutmasın diye.
- Ortak `settings.json`'a yazılmadı: o dosya `~/.claude`'a bağlı olduğu için panel dışındaki Claude Code oturumlarını da etkilerdi.

**Doğrulama**
- E2e'ye iki kontrol eklendi:
  - Sohbet: sahte CLI'nin aldığı `--allowedTools=mcp__panel__publish_artifact,mcp__blender,mcp__figma-console`.
  - Terminal: geçici ev klasöründe argümanlarını yazan sahte bir `claude` (PATH başında) ile `CLAUDE_ARGS --allowedTools mcp__blender,mcp__figma-console`.
- İkisi ayrı ayrı bilerek bozuldu ve kırmızıya döndü. `npm run check` ve `npm test` yeşil.
- SDK'daki "`--allowedTools` yok sayılır" notunun yalnız yönetilen `allowManagedPermissionRulesOnly` ayarında geçerli olduğu kontrol edildi.

**Bekleyen**
- Gerçek hesapla bir turda izin kartı çıkmadığı görülmeli.

**Kurulum (aynı gün)**
- Panel kapatıldıktan sonra `bash kur.sh` koşuldu; uygulama `~/Applications/Claude Panel.app`'e kuruldu ve açıldı.
- Kurulan paket sahte CLI ve geçici ayar klasörüyle duman testinden geçti. Kontrol edilenler:
  - Terminalde `claude --allowedTools mcp__blender,mcp__figma-console`.
  - Sohbette `--allowedTools=…mcp__blender,mcp__figma-console`.
  - Blender turunda görsel ve `python` kod bloğu.
- Gerçek pencerenin ekran görüntüsü alınamadı (terminalin ekran kaydı izni yok); süreç çalışıyor.
- `npm install` 6 bağımlılık uyarısı verdi (4 orta, 2 yüksek); bu işle ilgisiz, ayrıca bakılacak.

---

## 2026-10-15 · Blender ve figma-console tüm panelde

**İstek:** Blender ve Figma tüm hesaplarda ve açılan her yeni klasörde kullanılabilsin.

**Yapılan**
- `blender` ve `figma-console` üç hesabın (`~/.claude-is`, `~/.claude-max`, `~/.claude-pro`) `.claude.json` dosyasına genel (user) kapsamda eklendi. Ekleme `claude mcp add-json -s user` ile yapıldı; tanımlar Max'teki `~/WFC` kaydından alındı (mutlak yollar, Figma anahtarı).
- `~/.claude.json` değişmedi: panel dışındaki Claude Code oturumları etkilenmiyor.
- Proje kapsamındaki eski kayıtlar (`~/WFC`, `~`) silinmedi; aynı sunucuyu tanımlıyorlar.
- Max'in eski `.claude.json`'u yedeklendi (`.yedek-<tarih>`).
- İş ve Pro'da henüz giriş yoktu. Komut onlara Claude Code biçiminde bir `.claude.json` açtı; giriş yapılınca dosya yerinde güncellenir.
- Resmi Figma (claude.ai bağlantısı) Max'te zaten bağlı. İş ve Pro'da o hesapların claude.ai girişine ve bağlantı ayarına bağlı.

**Kararlar**
- İki Figma da kalıyor:
  - figma-console masaüstü uygulamasıyla Desktop Bridge eklentisi üzerinden konuşur; açık dosyayı okur ve değiştirir.
  - Resmi Figma bulut dosyalarıyla çalışır; tasarımdan koda, Code Connect, FigJam gibi işler için.
- figma-console birden çok oturumda aynı anda çalışabiliyor (9223–9232 portları), bu yüzden her sohbette açık olmasında sakınca yok.

**Doğrulama**
- Hiç açılmamış yeni bir klasörde her hesap için `claude mcp list` çalıştırıldı: üç hesapta da `blender` ve `figma-console` "✔ Connected". Max'te `claude.ai Figma` da bağlı.
- Panel kodu değişmedi; `npm test` gerekmedi.

**Bekleyen**
- Blender'da blender-mcp eklentisi, Figma'da Desktop Bridge eklentisi açık olmalı; panelde gerçek bir turla denenecek.
- MCP çağrıları hâlâ her seferinde izin soruyor.
- `pencil` sunucusu Max'te bağlanamıyor (`/Applications/Pen.app` yok).

---

## 2026-10-15 · MCP araçları: sonuç görselleri ve kod blokları

**İstek:** Figma, Blender gibi MCP'ler sohbette rahat kullanılsın. MCP sonuçlarındaki görseller gösterilsin, Blender'a giden kod okunur olsun.

**Yapılan**
- Araç sonucundaki görseller artık `[görsel]` yazısı yerine resim olarak çiziliyor (`resultImages`). Hem API biçimi (`source.media_type/data`) hem ham MCP biçimi (`mimeType/data`) okunuyor.
- Görseller araç grubunun hemen altındaki şeritte (`.grp-shots`) duruyor, grup kapalıyken de görünüyor. Altında hangi araçtan geldiği yazıyor, tıklayınca tam genişliğe büyüyor. Alt ajan araçlarında görsel kartın içinde.
- MCP girdisinde `code`, `script`, `python`, `javascript`, `js` ya da `sql` alanı varsa bu alan kod bloğu olarak çiziliyor; Kopyala ve Artifact düğmeleri de var. Dil, alan adından ya da sunucu adından seçiliyor: blender için python, figma/pencil için javascript, unity için csharp. Diğer alanlar JSON olarak kalıyor.
- Araç satırındaki özet, kodun ilk anlamlı satırı. Yorum ve `import`/`require` satırları atlanıyor.
- Kod bloğu sarmalayıcısı `mdInto`'dan `wrapCodeBlock` olarak ayrıldı; iki yer aynı düğmeleri kullanıyor.

**Doğrulama**
- Sahte CLI'ye `blender` turu eklendi: `execute_blender_code` çağrısı ve gerçek bir 64×40 PNG döndüren `get_viewport_screenshot` çağrısı.
- E2e adımı şunları kontrol ediyor: görsel çözülmüş olmalı (`naturalWidth === 64`), grup kapalıyken görünmeli, kod bloğunun dil etiketi `python` olmalı, araç satırındaki özet doğru olmalı ve `[görsel]` yazısı hiç çıkmamalı.
- Adım iki kez kırmızıya döndü:
  - İlki gerçek bir hataydı: özette `import bpy` görünüyordu; düzeltildi.
  - İkincisinde görsel çizimi bilerek kapatıldı.
- `npm run check` ve `npm test` yeşil. Ekran görüntüleri: `6b-mcp-gorsel.png` (grup kapalı), `6c-mcp-kod.png` (açık).

**Bekleyen**
- Gerçek Blender ve figma-console ile bir tur denenmeli. Özellikle gerçek Claude Code'un MCP görsellerini `tool_result` içinde bu biçimde verip vermediğine bakılmalı.
- MCP çağrıları hâlâ her seferinde izin soruyor. Blender/figma-console yalnız `~/WFC` (blender ayrıca `~`) klasöründe ve yalnız Max hesabında tanımlı.

---

## 2026-10-15 · Model/efor seçici ve plan kullanımı

**İstek:** Yazma kutusunda modeli ve eforu kolayca seçebilmek; Claude masaüstündeki gibi kullanım göstergesi.

**Yapılan**
- Yazma kutusunda tek düğme: "Sonnet 5.5 Orta ⌄". Menüde üstte modeller (açıklamalarıyla), altta düşünme eforu. Efor listesi seçili modelin desteklediği seviyelerle sınırlı.
- Yanında doluluk halkası: 5 saatlik oturum limiti. %70'te sarı, %90'da kırmızı. Tıklayınca pencere: oturum (5 saat), haftalık, model bazlı haftalık limitler, sıfırlanma zamanları, plan adı.
- İkisi hem Yeni sohbet ekranında hem sohbet yazma alanında. Sohbet içindeki eski model/efor açılır listeleri kaldırıldı; izin modu listesi duruyor.
- Yeni sohbet ekranındaki seçim hesap başına `chatPrefs`'e yazılıyor; sohbet `--model=` / `--effort=` ile başlıyor.

**Kararlar**
- Yeni sohbet ekranında oturum olmadığı için ana süreç kısa bir yoklama açıyor (`account:info`): mesaj göndermez, token harcamaz, geçmişe kayıt bırakmaz (`persistSession: false`). Hesabın açık sohbeti varsa onun süreci kullanılıyor.
- Kullanım, SDK'nın **deneysel** `get_usage` çağrısından geliyor. Bozulursa arayüz "bilgi yok" gösterir, çökmez. SDK güncellenince ilk bakılacak yer.

**Doğrulama:** `npm test` 19 adım yeşil. Kullanım okuması bilerek kapatılınca kırmızı. Ekran görüntüleri: `tests/out/1b-kullanim.png`, `1c-model-secici.png`, `4-tur-bitti.png`. `kur.sh` ile kuruldu, paketli uygulama hatasız başladı.

**Yolda düzelen:** Model düğmesinde "Varsayılan model null" yazıyordu (DOM `append(null)`). Sahte CLI seçilen eforu hep "high" bildiriyordu; artık `--model`/`--effort` değerlerini geri bildiriyor.

**Bekleyen:** Gerçek hesapla yüzdelerin claude.ai'deki kullanım ekranıyla aynı olduğu kontrol edilmedi.

---

## 2026-10-15 · Artifact protokolü güvenliği

**Neden:** Otomatik güvenlik incelemesi buldu. Artifact sayfası betik çalıştırıyor ve kaynak dosyanın klasöründeki her dosyayı okuyabiliyordu; Claude'un yazdığı bir sayfa yandaki `.env`'i okuyup dışarı gönderebilirdi, symlink ile klasör dışına çıkılabiliyordu.

**Yapılan**
- `artifact://` yalnız varlık uzantılarını (görsel, css, js, yazı tipi, medya) sunuyor; yollar `realpath` ile çözülüp klasör içinde mi diye bakılıyor.
- Görüntüleyici iframe'inden `allow-same-origin`, şemadan `corsEnabled` kaldırıldı: sayfa artifact içeriğini `fetch` ile okuyamıyor. Bedeli: artifact'ler `localStorage` kullanamıyor.
- `publish_artifact` izin sormadığı için `file_path` çalışma klasörüyle sınırlandı.

**Bilerek yapılmayan:** Küçük resimde betikleri kapatmak (grafikli sayfalar boş kalırdı; görüntüleyici zaten aynı betiği çalıştırıyor). Ağ erişimini tamamen kesmek (API'den veri çeken panolar bozulurdu).

**Doğrulama:** Ayrı e2e adımı: `.env`, symlink ve `..` denemeleri 404. Eski koda dönünce adım "`.env` sunuldu" diye kırmızı.

---

## 2026-10-15 · Yan menü, Artifacts, Yeni sohbet ekranı, görsel yenileme

**İstek:** Yan menü Claude masaüstündeki gibi olsun ama yalnız "Yeni sohbet" ve "Artifacts"; panelde üretilenler Artifacts'e gelsin, Claude'daki gibi etkileşilsin; arayüz modern olsun.

**Yapılan**
- **Yan menü:** ikonlu "Yeni sohbet" (⌘N) ve "Artifacts" (⇧⌘A), altında hesaplar. Code/Web düğmeleri yalnız seçili hesapta.
- **Yeni sohbet ekranı:** karşılama başlığı, ortada yazma kutusu ve klasör seçici. İlk mesaj yazılıp Enter'a basılınca sohbet o klasörde başlar ve mesaj gider. Altında son klasörler ve son artifact'ler.
- **Artifact'lerin kaynağı:**
  1. Claude sohbette `.html`/`.svg` yazınca kendiliğinden eklenir; sonraki düzenlemeler yeni sürüm olur.
  2. Claude'a süreç içi MCP aracı `publish_artifact` verildi (md, kod ve diğer türler için).
  3. Elle: kod bloklarında "Artifact" düğmesi, dosya satırlarında "Artifacts'e ekle".
- **Galeri:** küçük resimli kartlar, arama, Tümü / Yıldızlı / hesap filtreleri; kart menüsünde yeniden adlandır, yıldızla, kopyala, indir, tarayıcıda aç, Finder'da göster, onaylı sil.
- **Görüntüleyici:** önizleme/kod, sürüm seçici, "Claude ile düzenle" (kaynak sohbete düzenleme isteğini yazılı açar). Sohbette artifact kartı; tıklayınca sağda yan bölmede açılır.
- **Görsel:** emoji ve karakter ikonları yerine çizgi ikon seti (`renderer/icons.js`); sekmeler, menüler, pencereler yenilendi.

**Kararlar**
- Depo `<userData>/artifacts/` (index.json + sürüm dosyaları + küçük resimler). Görüntüleme özel `artifact://` protokolüyle; `srcdoc` ana sayfanın CSP'sini miras aldığı için kullanılmadı.
- Küçük resimler görünmez, offscreen bir pencerede çizilip yakalanıyor.
- `zod`, `package.json`'a açıkça eklendi (SDK'nın eş bağımlılığı olarak zaten kuruluydu; sürüm aynı).

**Doğrulama:** `npm test`'e artifact adımları eklendi (otomatik yakalama, 2 sürüm, MCP yayımlama, yan bölme, galeri, küçük resimler, sürüm/kod görünümü, yeniden adlandırma, silme, depoya yazılma). Sohbet izleyicisi kapatılınca adım kırmızı. Açık görüntüleyicinin depo değişince seçili sürümü kaybetmesi hatası bulunup düzeltildi ve teste bağlandı.

**Bekleyen:** `publish_artifact` ve otomatik yakalama gerçek hesapla denenmedi. Geçmiş oturum yüklenirken artifact kartları sohbete yeniden çizilmiyor.

---

## İlk sürüm · `144d07e`

Üç hesap (İş, Max, Pro) tek pencerede; her hesap kendi `CLAUDE_CONFIG_DIR`'i ile. Yerel Code: Agent SDK ile sohbet görünümü ve terminal; Web: hesaba özel çerez bölmeli claude.ai. Uçtan uca test sahte Claude CLI ile.
