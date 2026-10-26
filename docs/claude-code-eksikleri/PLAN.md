# Claude Code'da olup panelde olmayanlar — iş planı

2026-10-24'te Claude Code (CLI ve masaüstündeki Code sekmesi) panelle karşılaştırıldı; hızı ve iş kalitesini etkileyen eksikler etkiye göre sıralandı.
Emre: "hepsini sıra sıra yapıcaz" (2026-10-25). Her madde **ayrı, taze bir oturumda** yapılır (bağlam şişmesin). Bu dosya o oturumların başlangıç noktasıdır.

## 1. Durum

| # | İş | Durum | Gerçek hesap |
|---|---|---|---|
| 1 | Geri sarma (kod checkpoint + konuşma) | bitti 2026-10-25 | Emre denedi, çalışıyor |
| 2 | Arka plan görevleri şeridi, tek tek durdurma, "Arka plana al" | bitti 2026-10-25 | bekliyor |
| 3 | Değişiklikler bölmesinden Claude'a satır yorumu | bitti 2026-10-25 | bekliyor |
| 4 | Kendiliğinden doğrulama: `launch.json` önizleme + düzenleme sonrası kontrol | bitti 2026-10-25 | bekliyor |
| 5 | Otomatik kipte reddedilenleri göster (`permission_denied`) | bitti 2026-10-26 | Emre denedi, retler görünüyor |
| 6 | Kuyruk kontrolü: sıradaki mesajı geri al / hemen gönder | bitti 2026-10-26 | bekliyor |
| 7 | `@dosya` tamamlama | bitti 2026-10-26 | bekliyor |
| 8 | MCP elicitation (sunucunun form / adres isteği) | bitti 2026-10-26 | bekliyor |
| 9 | Agent SDK güncellemesi (0.3.300 → 0.3.310) | bitti 2026-10-25 | bekliyor |
| 10 | Küçük kolaylıklar: önerilen istem, istem geçmişi, `!` kabuk kipi, sınırda otomatik devam | bitti 2026-10-26 | bekliyor |

Ayrıntı ve ölçümler: 1–10 için `GUNLUK.md` (2026-10-25, 2026-10-26) ve `CLAUDE.md` §5 "Geri sarma", "Arka plan görevleri", "Satır yorumları", "Önizleme", "İzin retleri", "Kuyruk", "`@dosya` önerileri", "MCP elicitation", "Agent SDK yükseltmesi", "Küçük kolaylıklar".

**Sıra** (Emre, 2026-10-25): önce **9** (SDK güncellemesi), sonra 3, 4, 5… 5–8'in ölçümleri böylece güncel CLI'de yapılır.

## 2. Her oturumun düzeni

1. Bu dosyadan yalnız ilgili maddeyi ve `CLAUDE.md` §4–5'i oku. `tests/e2e.js` (3.800+ satır) ve `tests/fake-claude.js` baştan okunmaz: `grep` ile ilgili yere gidilir.
2. İşe başlamadan doğrulama yolunu söyle (CLAUDE.md §4).
3. **SDK protokolüne dokunan maddede önce ölç**: gerçek Claude Code, `ANTHROPIC_BASE_URL` yerel sahte API'ye, girişsiz geçici ayar klasöründe; 0 token. Hazır betikler `olcum/` altında (§4). Ölçülmeden sahte CLI'ye davranış yazılmaz; 1 ve 2'de ölçüm üç beklentiyi çürüttü.
4. Ana süreç (`chat-main.js` ya da ilgili modül) → `preload.js` → arayüz. Yeni dosya paketlemeyi etkiler (`kur.sh`, CLAUDE.md §4.6); panel açıkken `kur.sh` koşulamaz, Emre koşar.
5. Sahte CLI ölçülen davranışla güncellenir; `tests/e2e.js`'e bir adım, kesin `assert`'ler. Adım bir kez bilerek bozulur, kırmızı görülür.
6. `npm run check`, `npm test` **arka planda** (`npm test > /tmp/x.log 2>&1`; ~10 dk, çıktı bağlama alınmaz, yalnız `✗`/`Tüm testler` satırları okunur). Tarayıcı adımları ara sıra kendiliğinden düşer (CLAUDE.md §7); geri sarma/arka plan adımından önce düşen koşu yeniden koşulur.
7. Görünen değişiklikte `tests/out/` ekran görüntüsüne bakılır (animasyon bitmeden alınan görüntü saydam görünür: `getAnimations` beklenir).
8. Bitince: bu dosyanın durum tablosu, `GUNLUK.md` kaydı, `CLAUDE.md` (dosya haritası, §5 tuzak, §7 açık iş), hafıza (`claude-code-eksikleri-sirasi`). Emre'den gerçek hesapla bir tur ve `bash kur.sh` istenir. Commit Emre isteyince.

## 3. Maddeler

### 3 · Değişiklikler bölmesinden Claude'a satır yorumu

- **Amaç**: Masaüstündeki gibi diff'te bir satıra (ya da satır aralığına) yorum yazıp Claude'a göndermek; Claude düzeltmeyi yeni bir diff olarak yapar. CLI'de `/diff` panelindeki `ask` aynı işi görür.
- **Bugün**: `renderer/changes.js` diff'i çiziyor (`.dl` satırları, `.ln` satır numaraları, `ch-file[data-path]`), yorum yok. Ana süreç `changes.js` (git diff, dosya okuma).
- **Tasarım önerisi**: satıra gelince "+" (yorum), tıklayınca satırın altında küçük kutu; yorumlar sekmede birikir, yazma alanının üstünde "N satır yorumu" çipi (GitHub incelemesi gibi toplu). Sonraki mesajla şu biçimde gider: `<satir-yorumu dosya="a.js" satir="12-14">` + o satırların kodu + yorum + `</satir-yorumu>`. Yorumdaki kapanış etiketi bozulur (renderer/sessions.js → `eventSafe` deseni). "Hemen gönder" de olabilir; Emre'ye sorulacak tek karar: toplu mu, hemen mi.
- **SDK'ya dokunmaz** → ölçüm gerekmez. Sahte CLI değişmez (gelen metni zaten günlüğe yazar).
- **e2e**: Değişiklikler adımının deposunda (`DEPO`) bir satıra yorum → gönder → `IN` satırında etiket, dosya, satır, kod ve yorum; etiket kaçışı.
- **Sonuç** (2026-10-25): Emre "ikisi de" dedi: yorumlar birikip sonraki mesajla gider, kutuda ayrıca "Hemen gönder" (⌘Enter) yalnız o yorumu yollar. Diff'te ve dosya görünümünde satırın solundaki "+"; aralık sürükleyerek ya da ⇧ ile. Blok: `<satir-yorumu dosya="…" satir="2-3">` + çitli kod (diff'te `+`/`-` önekli) + yorum; yalnız silinen satırlarda `silinen-satir=`. Kod renderer/changes.js'te, chat.js'te yalnız gönderim ve balon. Sahte CLI değişmedi (blok dizisini `EKLER` satırına yazıyor). Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "Satır yorumları".

### 4 · Kendiliğinden doğrulama (önizleme)

- **Amaç**: Masaüstündeki Browser bölmesi gibi: `.claude/launch.json`'daki geliştirme sunucusu tek tıkla açılır, bölmede görünür; "auto-verify" açıkken Claude her düzenlemeden sonra sayfaya bakıp doğrular.
- **Bugün**: Tarayıcı bölmesi ve Claude'un `browser` aracı var (CLAUDE.md §5 "Tarayıcı"). `launch.json` okunmuyor, sunucu başlatılmıyor; Claude bakmayı unutursa doğrulama yok. CLAUDE.md §7: "dev sunucusu önizlemesi 2. aşamada".
- **İlk iş**: `launch.json` biçimini resmi belgeden al (https://code.claude.com/docs/en/desktop, önizleme bölümü; WebFetch). Ezberden yazılmaz.
- **Tasarım önerisi**: üst çubukta "Önizleme" (yalnız `launch.json` varsa); komut panelin terminal sekmesinde arka planda (`terminals.js` → `launch(..., { background: true })`), port dinlenince tarayıcı bölmesi o adreste açılır. "Kendiliğinden doğrula" anahtarı açıkken sistem istemine kısa bir talimat (`wrapup.PLAN_PROMPT` gibi): düzenledikten sonra `browser` ile bak. Token harcar → varsayılanı Emre seçer.
- **Dosyalar**: muhtemelen yeni `preview.js` (paketleme → `kur.sh`), `browser.js`, `terminals.js`, `renderer/browser.js`.
- **e2e**: geçici klasörde `launch.json` + `node -e` ile küçük bir http sunucusu; "Önizleme" → bölme o adreste, sayfa metni okunur.
- **Sonuç** (2026-10-25): yeni `preview.js`. Biçim belgeden alındı (alanlar, `port` 3000, `autoPort`'un üç hâli, yerel `url` kuralı, proje düzeyinde `autoVerify`). Üst çubukta Önizleme düğmesi (yalnız launch.json varken; çalışırken yeşil nokta) ve menüsü: başlat/aç, durdur, terminal çıktısı, "Kendiliğinden doğrula", "launch.json'u düzenle". Sunucu arka plandaki terminal sekmesinde ("Önizleme · <ad>"), port dinleyince tarayıcı bölmesi o adreste. Claude'a `preview` aracı (list, start, restart, stop, logs); bir yapılandırmanın komutu sohbette ilk kez çalışırken kart. Kendiliğinden doğrulama panel geneli ayar (`autoVerify`, **varsayılan kapalı**, Emre'nin kararı), açıkken talimat sistem istemine ve `preview` + `browser` yüklü; sohbet sürerken değişirse `UserPromptSubmit` ile bir kez. SDK protokolüne dokunmadı (MCP aracı ve kanca var olan yollar) → ölçüm yok. Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "Önizleme".

### 5 · Otomatik kipte reddedilenleri göster

- **Amaç**: "Otomatik" kipte (sınıflandırıcı) ya da kuralla reddedilen araç çağrıları kullanıcıya görünsün; Claude biliyor, kullanıcı bilmiyor.
- **SDK**: `system/permission_denied` → `{ tool_name, tool_use_id, decision_reason_type ('classifier' | 'rule' | 'mode' | …), decision_reason, message, agent_id }`. Kesin kayıt `result.permission_denials`. PreToolUse kancası ve yola bağlı ret kuralıyla reddedilen dosya araçları bu olayla gelmez (sdk.d.ts).
- **Bugün**: işlenmiyor (renderer/chat.js `handleSystem`'da yok).
- **Ölç**: en kolayı ret kuralı (geçici ayar klasöründe `settings.json` → `permissions.deny: ["Bash(rm:*)"]`), sahte API `rm` çağırtır. Sınıflandırıcı da denenebilir: otomatik kipte sınıflandırıcının API isteği sahte API'ye gelir; isteğin biçimini günlükle, "deny" döndür.
- **Tasarım önerisi**: araç satırında kırmızı "engellendi" çipi + nedeni (title); grup özetinde sayı; tur sonunda sohbete tek satır "Otomatik kip N işlemi engelledi" (açılınca liste). İzin kuralı ekleme düğmesi sonraya.
- **e2e**: sahte CLI otomatik kipte bir çağrı için `permission_denied` yollar; çip ve satır assert.
- **Sonuç** (2026-10-26): ölçüm `olcum/izin-reddi.mjs` (gerçek CLI 2.1.310, sahte API, 0 token). Türler beklenenden farklı: Bash ret kuralı ve `disallowedTools` `subcommandResults` (tek komutta da), içeriğe bağlı kural `rule`, `dontAsk` `mode`, sınıflandırıcı `classifier` + `decision_reason: "[Kural Adı]"` (yalnız o gerekçe verir). Alt ajanda olay araç çağrısından **önce** gelir (`agent_id`). Yola bağlı dosya kuralının olayı yok ama `permission_denials`'ta var. Aracın tamamını yasaklayan kural aracı kaldırır, ret sayılmaz. Otomatik kip Sonnet 4.5'te sessizce `default`'a düşüyor, Opus 5.5'te açık; sınıflandırıcının iki aşamalı isteği (`<severity>`) sahte API'ye geliyor, ret de izin de ölçüldü. Arayüz (yalnız renderer/chat.js + stil): satırda "engellendi" çipi (gerekçe title'da), grup özetinde sayı, tur sonunda kapalı satır ("Otomatik kip N işlemi engelledi" / "N işlem engellendi"; listeden satıra gidilir); olayı gelmeyen ret tur sonunda `permission_denials`'tan. Ana süreç değişmedi (mesajlar zaten iletiliyordu). Sahte CLI izin kipini izler. Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "İzin retleri".

### 6 · Kuyruk kontrolü

- **Bilinen** (2026-10-25'te ölçüldü): Claude çalışırken giden mesaj ayrı tur olmaz, sonraki araç adımında araya girer (kayıtta `attachment/queued_command`). Panel bu mesajı soluk "sırada" balonla gösteriyor; geri alma ve hemen gönderme yok, balon araya girince de "sırada" kalıyor.
- **SDK'da araştırılacak**: `SDKUserMessage.priority` (`'now' | 'next' | 'later'`; anlamı belgede yok), `sdk.mjs`'te `cancelAsyncMessage` (tiplerde yok), mesajın ne zaman emildiğini haber veren bir olay (ör. `replayUserMessages` / `isReplay`, `queue-operation`). **Hepsi ölçülerek** doğrulanır.
- **Tasarım önerisi**: sıradaki balonda "Geri al" (emilmeden önce; metin yazma kutusuna döner) ve "Hemen gönder" (`priority: 'now'` ya da interrupt + gönder; ölçüme göre). Emilince "sırada" kalkar.
- **Dosyalar**: `chat-main.js` (`pushUser`, yeni IPC), `renderer/chat.js` (`userBubble`, `sendMessage`).
- **Sonuç** (2026-10-26): ölçüm `olcum/kuyruk.mjs` (gerçek CLI 2.1.310, sahte API, 0 token). Emilme olayı bayraksız geliyor: kimlikli her mesaja `command_lifecycle` (`queued` → `started` → `completed`/`cancelled`; tiplerde yok). Araç adımı varsa mesaj araç sonucundan hemen sonra araya giriyor; araçsız turda tur bitince **kendi turunda** başlıyor ve `session_state_changed` arada `idle`'a düşmüyor (panel bu turu boşta sanıyordu; düzeldi). `cancelAsyncMessage` alınmamışta `true`, alınmışta `false`; **iptal edilen kimlikle yeniden gönderilen mesaj sessizce düşüyor**. `priority`: `next` araya girer, `later` girmez, `now` süren aracı (Bash, MCP) arka plana alıp mesajı hemen verir, araçsız yanıtı keser. CLI'nin iç "Send now"ı (`interrupt` + `send_now`) aynı işi görüyor ama SDK'da yok; "Hemen gönder" = iptal + yeni kimlikle `priority: 'now'`. `interrupt()` kuyruktakileri bırakır, hemen ardından çalışırlar; `interrupt({ cancelQueued: true })` çeker. Panel: sıradaki balon listenin sonunda "Sırada · Geri al · Hemen gönder", alınınca alındığı yere oturur; "Geri al" metni, ekleri ve satır yorumlarını yazma kutusuna döndürür; **"Durdur" artık kuyruktakileri de çekip yazma kutusuna koyar** (SDK belgesinin arayüz Durdur'u için önerdiği, Emre onayladı; eskiden durdurulan turun hemen ardından çalışırlardı). Geri sarma: araya girene konuşma sarılamaz, kendi turunu açana sarılır. Sahte CLI'ye ölçülen kuyruk. Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "Kuyruk".

### 7 · `@dosya` tamamlama

- **Bilinen**: CLI kullanıcı metnindeki `@yol`'u kendisi açar (sdk.d.ts → `client_composed` açıklaması). Yani yalnız arayüz işi.
- **Tasarım önerisi**: yazma kutusunda `@` → proje dosyalarından bulanık süzülen liste (`/` önerileri gibi, `renderer/chat.js` slash kutusu örnek); seçilince `@göreli/yol `. Liste ana süreçten: `git ls-files --cached --others --exclude-standard` (git dışında sınırlı `readdir`, `node_modules` hariç), 20 bin dosyada kesilir, klasör başına önbellek.
- **İsteğe bağlı ölçüm**: gerçek CLI'de `@dosya` içeriğinin isteğe girdiği (sahte API isteğinde görünür).
- **e2e**: `@uyg` → liste → seç → gönder → `IN` satırında `@uygulama.js`.
- **Sonuç** (2026-10-26): ölçüm `olcum/dosya-anma.mjs` (gerçek CLI 2.1.310, sahte API, 0 token). CLI `@yol`'u yalnız **son metin bloğunda**, satır başında ya da boşluktan sonra açar (e-posta, `x@a`, ters tırnak içi açılmaz); dosya `Read` sonucu olarak `<system-reminder>`'la, klasör `ls` çıktısıyla, görsel `image` bloğuyla, büyük dosya (~390 KB) yalnız "çok büyük, parça parça oku" notuyla gelir. Klasöre göre göreli, mutlak ve proje dışı yol, Türkçe ad, `@"boşluklu ad"`, `#L2-3` aralığı, sondaki virgül çalışıyor; `\ ` kaçışı ve olmayan dosya sessizce düz metin kalıyor. Aynı dosya değişmeden yeniden anılırsa eklenmiyor (değişince yine ekleniyor). `client_composed: true` açılımı ve tur başındaki bütün ekleri kapatıyor. Ekler ve satır yorumları yazılanın önünde gittiği için açılmıyor; panelin kendi ürettiği tek bloklu metinler (yan oturum/CI bildirimleri, devir notu) açılır. Panel: yazma kutusunda `@` → klasörün dosyaları ve klasörleri (ana süreç `files:mentionable`: git'te `ls-files` izlenen + yok sayılmayan izlenmeyen, silinenler hariç; git dışında ayrı süreçte genişlik öncelikli tarama, gizli klasör ve `node_modules` hariç, 2 sn / 20 bin dosya), bulanık süzme, klasöre inme, boşluklu yol tırnakla. Kutu "/" önerileriyle ortak. Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "`@dosya` önerileri".

### 8 · MCP elicitation

- **Amaç**: MCP sunucusu kullanıcıdan form ya da adres girişi isteyince panel kart gösterir. Bugün `onElicitation` verilmediği için SDK bu istekleri kendiliğinden reddediyor.
- **SDK**: `options.onElicitation(request, { signal, … })` → `ElicitationRequest { serverName, message, mode: 'form' | 'url', url, requestedSchema, title, … }`, dönüş MCP `ElicitResult` (`{ action: 'accept' | 'decline' | 'cancel', content }`).
- **Ölç**: `@modelcontextprotocol/sdk` kurulu; küçük bir stdio MCP sunucusu yaz (aracı çağrılınca `elicitInput` ister), gerçek CLI'ye `mcpServers` ile ver, sahte API o aracı çağırtsın. Kontrol isteğinin adı ve yanıt biçimi buradan sahte CLI'ye yazılır.
- **Tasarım önerisi**: izin kartı düzeninde kart (`openCard` benzeri); `requestedSchema`'dan alanlar (string, number, boolean, enum); `url` kipinde "Tarayıcıda aç" + "Tamamladım". Kartta "hep" yok.
- **Dosyalar**: `chat-main.js` (`onElicitation`), `renderer/chat.js` (kart), `tests/fake-claude.js`.
- **Sonuç** (2026-10-26): ölçüm `olcum/elicitation.mjs` + `olcum/elic-sunucu.mjs` (gerçek CLI 2.1.310, sahte API, stdio MCP sunucusu, 0 token). Claude Code sunucuya `elicitation: { form: {}, url: {} }` yeteneğini bildiriyor; istek SDK'ya `control_request { subtype: 'elicitation', mcp_server_name, message, mode, url, elicitation_id, requested_schema, property_order, title, display_name, description }` olarak geliyor (son üçü sunucunun `_meta['anthropic/permissionDisplay']`'inden), yanıt `ElicitResult` sunucuya olduğu gibi gidiyor. `onElicitation` verilmezse `decline`. **Şemaya uymayan içeriği Claude Code reddediyor** (-32602 "does not match requested schema", araç hata döner). Sunucunun zaman aşımında ve "Durdur"da sinyal düşüyor (`control_cancel_request`); araç -32001 / "user doesn't want to proceed" döner. Adres kipinde sunucu bitirince `system/elicitation_complete`. Aracın attığı `-32042` (UrlElicitationRequired) de `onElicitation`'a adres kipinde geliyor; her kabulde CLI aracı yeniden deniyor (3 kez). SDK callback'i olarak verilen `Elicitation` kancasının yanıtı `onElicitation`'ı atlatmadı. Panel: izin kartı yolunda kart (renderer/elicitation.js): şemadan alanlar (metin ve biçimleri, sayı, evet/hayır, tek ve çok seçim, varsayılanlar, zorunlu), gönderilmeden denetim; adres kipinde adres ve alan adı, "Tarayıcıda aç" (adres ana süreçteki istekten, yalnız http/https) ve "Tamamladım"; Reddet / Vazgeç; sunucunun tamamlandı bildirimi açık kartı kabul sayar; sinyal düşünce kart "kapandı" der. Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "MCP elicitation".

### 9 · Agent SDK güncellemesi

- **Bugün**: `@anthropic-ai/claude-agent-sdk` 0.3.300 (CLI 2.1.300); 2026-10-24'te güncel 0.3.310.
- **Adımlar**: sürüm notları (npm / GitHub CHANGELOG) → eski ve yeni `sdk.d.ts` farkı (yalnız panelin kullandıkları: `Options`, `Query` yöntemleri, kullanılan mesaj tipleri; `diff` çıktısı süzülür, bağlama tamamı alınmaz) → `package.json` → `npm install` → `olcum/` betikleri yeni CLI'yle yeniden (geri sarma, arka plan) → `npm test` → Emre: gerçek hesapla tur, `kur.sh`.
- **Dikkat**: CLAUDE.md §5'teki "ölçüldü" notlarının çoğu 2.1.300'e ait; davranış değiştiyse not güncellenir. Kullanım çağrısı deneysel adla (`usage_EXPERIMENTAL_…`); adı değişirse arayüz "bilgi yok" der (§5).
- **Sonuç** (2026-10-25): 0.3.310 (CLI 2.1.310). Tip farkı yalnız ekleme; panelin çağırdığı yöntemlerin hepsi yerinde. Üç betik eski ve yeni CLI'de aynı çıktıyı verdi (kimlikler ve araç listesi dışında). Uyarlanan tek yer bağlam satırlarının `id`'si (arayüz Türkçe adı ondan bulur). Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "Agent SDK yükseltmesi". Sonraki yükseltmede aynı yol: `olcum/surum.mjs`.

### 10 · Küçük kolaylıklar (her biri kısa; bir ya da iki oturum)

- **Önerilen istem**: `options.promptSuggestions: true` → tur sonundan sonra `prompt_suggestion` mesajı (tur başına en çok bir; ilk turda, plan kipinde, sınıra yakınken gelmez). Yazma kutusunda gri öneri, Tab ile alınır. Küçük bir ek model çağrısıdır → varsayılanı Emre seçer.
- **İstem geçmişi**: boş yazma kutusunda ↑ / ↓ bu sekmenin önceki mesajları; isteğe Ctrl+R araması.
- **`!` kabuk kipi**: `!komut` → panel komutu sohbetin klasöründe ve ortamında çalıştırır, çıktıyı gösterir ve Claude'a `shouldQuery: false` kullanıcı mesajı olarak verir (tur açmadan bağlama girer; sdk.d.ts → `shouldQuery`; masaüstü de böyle, `resumeDropsTurn` açıklaması). Geri sarmayla etkileşimi ölçülür (`resumeDropsTurn` notu: kendi eklerinden önceye çatallanma reddedilir).
- **Sınırda otomatik devam**: `rate_limit_event` → sıfırlanma zamanı; turu sınır kestiyse "Sınır sıfırlanınca devam et" anahtarı, zamanı gelince "Devam et." gönderilir. Olayın biçimi ölçülür (sınıra gerçekten ulaşmadan: sahte API 429 + başlıklarla denenebilir).
- **Sonuç** (2026-10-26): ölçüm `olcum/kolayliklar.mjs oneri|kabuk|sinir` (gerçek CLI 2.1.310, sahte API, 0 token). **Öneri**: ilk turda ve plan kipinde istek yok; sonra her `result`'tan sonra aynı modele ayrı istek (`[SUGGESTION MODE: …`), boş ve "Let me…" önerisi süzülüyor, kayda yazılmıyor; tur biter bitmez yeni mesaj gidince önceki turun önerisi sonradan geliyor. **Kabuk** (`shouldQuery: false`): API'ye gitmiyor, kayda yazılıyor, sonraki mesajla birleşiyor; boştayken kendi boş "turu" (running, lifecycle, init, boş result, idle), `UserPromptSubmit` yok, ardından öneri yok; Claude çalışırken araya giriyor; checkpoint yok; `resumeDropsTurn` olmadan geri sarma sorunsuz. **Sınır**: `rate_limit_event` yalnız OAuth'ta (API anahtarında hiç yok), her istekte; 429'da olay → asistanın `error: 'rate_limit'` mesajı → `result` success + `is_error`, mesaj kayıtta kalıyor. Panel: Ayarlar → Genel "Önerilen istem" (**varsayılan kapalı**, Emre seçecek; yan oturumlara verilmez), boş kutuda soluk öneri, Tab ile alınır; ↑/↓ geçmiş, kuyrukta mesaj varsa ↑ onu geri alır, Ctrl+R arama; boş kutuya `!` → kabuk kipi, komut sohbetin klasöründe ve ortamında (yeni `kabuk.js`), çıktı blokta akar, Durdur süreç grubunu keser, bitince Claude'a gider; ana süreç kabuğun boş turunu yutar (`shellSwallows`); sınır kartı ("Sınır sıfırlanınca devam et", sıfırlanmadan 60 sn sonra "Devam et.", kullanıcı yazınca kapanır, en çok 3 deneme), uyarı pencere başına bir not. Ayrıntı: `GUNLUK.md`, CLAUDE.md §5 "Küçük kolaylıklar".

## 4. Ölçüm betikleri (`olcum/`)

Ürün kodu değil, `kur.sh` `docs/`'u paketlemez. Gerçek Claude Code'u (SDK'nın platform ikilisi) yerel sahte bir Anthropic API'sine bağlar: `ANTHROPIC_BASE_URL`, sahte `ANTHROPIC_API_KEY`, girişsiz geçici `CLAUDE_CONFIG_DIR`, 0 token. Sahte API son kullanıcı mesajındaki anahtar kelimeye göre araç çağrısı ya da metin döndürür (SSE).

```bash
mkdir -p /tmp/olcum/proj /tmp/olcum/cfg   # her koşuda boş klasör
node docs/claude-code-eksikleri/olcum/arka-plan.mjs "$PWD/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs" /tmp/olcum
```

- `geri-sarma.mjs`: mesaj kimliği, `rewindFiles`, `resumeSessionAt`, `resumeDropsTurn`, `getSessionMessages`.
- `arka-plan.mjs`: arka plan Bash ve alt ajan, `stopTask`, "Durdur" ve `perTaskStopAffordance`, `backgroundTasks`. `session_state_changed` için ortama `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`.
- `izin-reddi.mjs` (madde 5): ret kuralı (Bash, içeriğe bağlı, yola bağlı Read), `disallowedTools`, `dontAsk`, otomatik kipin sınıflandırıcısı (`ORT_SINIF=ret|izin`; istekler `<kök>/istekler.jsonl`'a), alt ajanda ret. `system/permission_denied`, araç sonucu ve `result.permission_denials` yazılır.
- `kuyruk.mjs` (madde 6): Claude çalışırken giden mesaj. Kipler: düz (araç adımında araya girme, araçsız turda kendi turu, `cancelAsyncMessage` önce/sonra, `priority` `now`/`next`/`later`, kuyrukta mesaj varken `interrupt` makbuzu, iptal + interrupt + yeniden gönderme; sonda kaydın `queue-operation` satırları), `hemen` ("Hemen gönder"in iki yolu: iptal + `priority: 'now'` ile yeniden gönderme ve CLI'nin iç `interrupt` + `send_now`'ı; araçsız yanıtta, arka plana alınamayan MCP aracında, Bash'te; iptal edilen kimliğin yeniden kullanımı), `durdur` (araya giren metnin API'ye ulaşması, `interrupt({ cancelQueued: true })`), `replay` (`--replay-user-messages`).
- `dosya-anma.mjs` (madde 7): `@yol` açılımı. Düz metin, blok dizisi (ilk blok / son blok), tırnaklı ve kaçışlı boşluk, klasör, olmayan dosya, `#L` aralığı, e-posta, Türkçe ad, sondaki virgül, proje dışı mutlak yol, büyük dosya, görsel, `client_composed`, ters tırnak, iki dosya, değişmeden / değişince yeniden anma. Sahte API isteğin son kullanıcı mesajını `<kök>/istekler.jsonl`'a yazar.
- `elicitation.mjs` + `elic-sunucu.mjs` (madde 8): MCP elicitation. Senaryolar: `kabul`, `ret`, `vazgec`, `yok` (onElicitation yok), `yanlis` / `eksik` (şemaya uymayan içerik), `kesinti` (beklerken interrupt), `zaman` (sunucunun zaman aşımı; `ORT_ELIC_TIMEOUT=3000` ile), `adres`, `adres-ret`, `adres-hata` (-32042), `izin` (permissionDisplay `_meta`), `kanca` (Elicitation kancası). Sunucunun gördüğü istemci yetenekleri ve yanıtlar `<kök>/sunucu.jsonl`'a.
- `kolayliklar.mjs` (madde 10): kipler `oneri` (promptSuggestions: ilk tur, araçlı tur, boş ve "Let me" önerisi, plan kipi, öneri gelmeden yeni mesaj; öneri isteğinin biçimi), `kabuk` (shouldQuery: false boştayken ve Claude çalışırken, sonraki isteğe birleşme, kayıt satırları, checkpoint, `UserPromptSubmit` kancası, ardından öneri, geri sarma `resumeSessionAt` ve `resumeDropsTurn`), `sinir` (`anthropic-ratelimit-unified-*` başlıkları: allowed, allowed_warning, 429 rejected; `ORT_AUTH=oauth` sahte OAuth jetonuyla, yoksa API anahtarıyla).
- `surum.mjs` (madde 9): SDK yükseltmesinde panelin dayandığı davranışlar. Modele göre araç listesi (yüklü / ertelenen, `TodoWrite` / `TaskCreate`), `alwaysLoad` işareti, mesajsız `getContextUsage` satırları (`id` / `name` / `kind`), init alanları, `supportedModels`, kancalar (`SessionStart`, `UserPromptSubmit` block, `PreCompact` block), girişsiz `accountInfo`. Eski SDK geçici bir klasöre kurulup aynı betik ikisiyle koşulur, çıktılar `diff`'lenir.

**Not** (CLI 2.1.304+): özel `ANTHROPIC_BASE_URL` arkasında araç araması açık. Ertelenen araçlar isteğin `tools` listesinde değil, adları bir `<system-reminder>`'da; bir aracın varlığı ölçülürken ikisine de bakılır. 2.1.300'de kapalıydı, bütün araçlar `tools`'ta giderdi.

Yeni ölçüm bunlardan biri kopyalanarak yazılır: sahte API'ye yeni anahtar kelime, sürücüye yeni adım. Çıktı dosyaya yazılıp yalnız ilgili satırlar okunur.
