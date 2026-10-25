# Claude Code'da olup panelde olmayanlar — iş planı

2026-10-24'te Claude Code (CLI ve masaüstündeki Code sekmesi) panelle karşılaştırıldı; hızı ve iş kalitesini etkileyen eksikler etkiye göre sıralandı.
Emre: "hepsini sıra sıra yapıcaz" (2026-10-25). Her madde **ayrı, taze bir oturumda** yapılır (bağlam şişmesin). Bu dosya o oturumların başlangıç noktasıdır.

## 1. Durum

| # | İş | Durum | Gerçek hesap |
|---|---|---|---|
| 1 | Geri sarma (kod checkpoint + konuşma) | bitti 2026-10-25 | Emre denedi, çalışıyor |
| 2 | Arka plan görevleri şeridi, tek tek durdurma, "Arka plana al" | bitti 2026-10-25 | bekliyor |
| 3 | Değişiklikler bölmesinden Claude'a satır yorumu | — | — |
| 4 | Kendiliğinden doğrulama: `launch.json` önizleme + düzenleme sonrası kontrol | — | — |
| 5 | Otomatik kipte reddedilenleri göster (`permission_denied`) | — | — |
| 6 | Kuyruk kontrolü: sıradaki mesajı geri al / hemen gönder | — | — |
| 7 | `@dosya` tamamlama | — | — |
| 8 | MCP elicitation (sunucunun form / adres isteği) | — | — |
| 9 | Agent SDK güncellemesi (0.3.300 → 0.3.310) | bitti 2026-10-25 | bekliyor |
| 10 | Küçük kolaylıklar: önerilen istem, istem geçmişi, `!` kabuk kipi, sınırda otomatik devam | — | — |

Ayrıntı ve ölçümler: 1, 2 ve 9 için `GUNLUK.md` (2026-10-25) ve `CLAUDE.md` §5 "Geri sarma", "Arka plan görevleri", "Agent SDK yükseltmesi".

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

### 4 · Kendiliğinden doğrulama (önizleme)

- **Amaç**: Masaüstündeki Browser bölmesi gibi: `.claude/launch.json`'daki geliştirme sunucusu tek tıkla açılır, bölmede görünür; "auto-verify" açıkken Claude her düzenlemeden sonra sayfaya bakıp doğrular.
- **Bugün**: Tarayıcı bölmesi ve Claude'un `browser` aracı var (CLAUDE.md §5 "Tarayıcı"). `launch.json` okunmuyor, sunucu başlatılmıyor; Claude bakmayı unutursa doğrulama yok. CLAUDE.md §7: "dev sunucusu önizlemesi 2. aşamada".
- **İlk iş**: `launch.json` biçimini resmi belgeden al (https://code.claude.com/docs/en/desktop, önizleme bölümü; WebFetch). Ezberden yazılmaz.
- **Tasarım önerisi**: üst çubukta "Önizleme" (yalnız `launch.json` varsa); komut panelin terminal sekmesinde arka planda (`terminals.js` → `launch(..., { background: true })`), port dinlenince tarayıcı bölmesi o adreste açılır. "Kendiliğinden doğrula" anahtarı açıkken sistem istemine kısa bir talimat (`wrapup.PLAN_PROMPT` gibi): düzenledikten sonra `browser` ile bak. Token harcar → varsayılanı Emre seçer.
- **Dosyalar**: muhtemelen yeni `preview.js` (paketleme → `kur.sh`), `browser.js`, `terminals.js`, `renderer/browser.js`.
- **e2e**: geçici klasörde `launch.json` + `node -e` ile küçük bir http sunucusu; "Önizleme" → bölme o adreste, sayfa metni okunur.

### 5 · Otomatik kipte reddedilenleri göster

- **Amaç**: "Otomatik" kipte (sınıflandırıcı) ya da kuralla reddedilen araç çağrıları kullanıcıya görünsün; Claude biliyor, kullanıcı bilmiyor.
- **SDK**: `system/permission_denied` → `{ tool_name, tool_use_id, decision_reason_type ('classifier' | 'rule' | 'mode' | …), decision_reason, message, agent_id }`. Kesin kayıt `result.permission_denials`. PreToolUse kancası ve yola bağlı ret kuralıyla reddedilen dosya araçları bu olayla gelmez (sdk.d.ts).
- **Bugün**: işlenmiyor (renderer/chat.js `handleSystem`'da yok).
- **Ölç**: en kolayı ret kuralı (geçici ayar klasöründe `settings.json` → `permissions.deny: ["Bash(rm:*)"]`), sahte API `rm` çağırtır. Sınıflandırıcı da denenebilir: otomatik kipte sınıflandırıcının API isteği sahte API'ye gelir; isteğin biçimini günlükle, "deny" döndür.
- **Tasarım önerisi**: araç satırında kırmızı "engellendi" çipi + nedeni (title); grup özetinde sayı; tur sonunda sohbete tek satır "Otomatik kip N işlemi engelledi" (açılınca liste). İzin kuralı ekleme düğmesi sonraya.
- **e2e**: sahte CLI otomatik kipte bir çağrı için `permission_denied` yollar; çip ve satır assert.

### 6 · Kuyruk kontrolü

- **Bilinen** (2026-10-25'te ölçüldü): Claude çalışırken giden mesaj ayrı tur olmaz, sonraki araç adımında araya girer (kayıtta `attachment/queued_command`). Panel bu mesajı soluk "sırada" balonla gösteriyor; geri alma ve hemen gönderme yok, balon araya girince de "sırada" kalıyor.
- **SDK'da araştırılacak**: `SDKUserMessage.priority` (`'now' | 'next' | 'later'`; anlamı belgede yok), `sdk.mjs`'te `cancelAsyncMessage` (tiplerde yok), mesajın ne zaman emildiğini haber veren bir olay (ör. `replayUserMessages` / `isReplay`, `queue-operation`). **Hepsi ölçülerek** doğrulanır.
- **Tasarım önerisi**: sıradaki balonda "Geri al" (emilmeden önce; metin yazma kutusuna döner) ve "Hemen gönder" (`priority: 'now'` ya da interrupt + gönder; ölçüme göre). Emilince "sırada" kalkar.
- **Dosyalar**: `chat-main.js` (`pushUser`, yeni IPC), `renderer/chat.js` (`userBubble`, `sendMessage`).

### 7 · `@dosya` tamamlama

- **Bilinen**: CLI kullanıcı metnindeki `@yol`'u kendisi açar (sdk.d.ts → `client_composed` açıklaması). Yani yalnız arayüz işi.
- **Tasarım önerisi**: yazma kutusunda `@` → proje dosyalarından bulanık süzülen liste (`/` önerileri gibi, `renderer/chat.js` slash kutusu örnek); seçilince `@göreli/yol `. Liste ana süreçten: `git ls-files --cached --others --exclude-standard` (git dışında sınırlı `readdir`, `node_modules` hariç), 20 bin dosyada kesilir, klasör başına önbellek.
- **İsteğe bağlı ölçüm**: gerçek CLI'de `@dosya` içeriğinin isteğe girdiği (sahte API isteğinde görünür).
- **e2e**: `@uyg` → liste → seç → gönder → `IN` satırında `@uygulama.js`.

### 8 · MCP elicitation

- **Amaç**: MCP sunucusu kullanıcıdan form ya da adres girişi isteyince panel kart gösterir. Bugün `onElicitation` verilmediği için SDK bu istekleri kendiliğinden reddediyor.
- **SDK**: `options.onElicitation(request, { signal, … })` → `ElicitationRequest { serverName, message, mode: 'form' | 'url', url, requestedSchema, title, … }`, dönüş MCP `ElicitResult` (`{ action: 'accept' | 'decline' | 'cancel', content }`).
- **Ölç**: `@modelcontextprotocol/sdk` kurulu; küçük bir stdio MCP sunucusu yaz (aracı çağrılınca `elicitInput` ister), gerçek CLI'ye `mcpServers` ile ver, sahte API o aracı çağırtsın. Kontrol isteğinin adı ve yanıt biçimi buradan sahte CLI'ye yazılır.
- **Tasarım önerisi**: izin kartı düzeninde kart (`openCard` benzeri); `requestedSchema`'dan alanlar (string, number, boolean, enum); `url` kipinde "Tarayıcıda aç" + "Tamamladım". Kartta "hep" yok.
- **Dosyalar**: `chat-main.js` (`onElicitation`), `renderer/chat.js` (kart), `tests/fake-claude.js`.

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

## 4. Ölçüm betikleri (`olcum/`)

Ürün kodu değil, `kur.sh` `docs/`'u paketlemez. Gerçek Claude Code'u (SDK'nın platform ikilisi) yerel sahte bir Anthropic API'sine bağlar: `ANTHROPIC_BASE_URL`, sahte `ANTHROPIC_API_KEY`, girişsiz geçici `CLAUDE_CONFIG_DIR`, 0 token. Sahte API son kullanıcı mesajındaki anahtar kelimeye göre araç çağrısı ya da metin döndürür (SSE).

```bash
mkdir -p /tmp/olcum/proj /tmp/olcum/cfg   # her koşuda boş klasör
node docs/claude-code-eksikleri/olcum/arka-plan.mjs "$PWD/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs" /tmp/olcum
```

- `geri-sarma.mjs`: mesaj kimliği, `rewindFiles`, `resumeSessionAt`, `resumeDropsTurn`, `getSessionMessages`.
- `arka-plan.mjs`: arka plan Bash ve alt ajan, `stopTask`, "Durdur" ve `perTaskStopAffordance`, `backgroundTasks`. `session_state_changed` için ortama `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`.
- `surum.mjs` (madde 9): SDK yükseltmesinde panelin dayandığı davranışlar. Modele göre araç listesi (yüklü / ertelenen, `TodoWrite` / `TaskCreate`), `alwaysLoad` işareti, mesajsız `getContextUsage` satırları (`id` / `name` / `kind`), init alanları, `supportedModels`, kancalar (`SessionStart`, `UserPromptSubmit` block, `PreCompact` block), girişsiz `accountInfo`. Eski SDK geçici bir klasöre kurulup aynı betik ikisiyle koşulur, çıktılar `diff`'lenir.

**Not** (CLI 2.1.304+): özel `ANTHROPIC_BASE_URL` arkasında araç araması açık. Ertelenen araçlar isteğin `tools` listesinde değil, adları bir `<system-reminder>`'da; bir aracın varlığı ölçülürken ikisine de bakılır. 2.1.300'de kapalıydı, bütün araçlar `tools`'ta giderdi.

Yeni ölçüm bunlardan biri kopyalanarak yazılır: sahte API'ye yeni anahtar kelime, sürücüye yeni adım. Çıktı dosyaya yazılıp yalnız ilgili satırlar okunur.
