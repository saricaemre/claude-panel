# Claude Panel

Before doing any work, say how you will verify it (see §4).

## 1. Proje

- Emre'nin Mac'inde (Apple Silicon, macOS) çalışan Electron masaüstü uygulaması. Üç ayrı Claude hesabını (İş, Max, Pro) tek pencerede, birbirine karışmadan kullanmak için.
- Her hesabın iki görünümü var:
  - **Yerel Code**: Claude Code bu Mac'te çalışır. Varsayılan olarak sohbet görünümünde (Agent SDK) açılır, istenirse terminalde (node-pty + xterm).
  - **Web**: claude.ai, hesaba özel çerez bölmesinde (`<webview partition="persist:chat-<id>">`).
- Hesap ayrımı `CLAUDE_CONFIG_DIR` ile yapılır: her hesabın kendi ayar klasörü var (`~/.claude-is`, `~/.claude-max`, `~/.claude-pro`). Boş bırakılan hesap varsayılan `~/.claude` klasörünü kullanır.
- Projede yalnız Emre ve Claude var. Görsel yön Emre'nin; hedef, Claude masaüstü uygulamasının sohbet düzenine yakın durmak (koyu tema, serif yanıtlar, toplu araç satırları, alttaki model/efor seçicileri, sağ yan panel).

## 2. Çalıştırma

```bash
npm install          # ilk kez ya da bağımlılık değişince
npm start            # geliştirme: uygulamayı doğrudan açar
npm run check        # tüm JS dosyalarında sözdizimi kontrolü (saniyeler)
npm test             # uçtan uca test (sahte Claude CLI ile, ~20 sn)
bash kur.sh          # Mac uygulamasını paketler ve ~/Applications/Claude Panel.app'e kurar
```

Uygulama açıkken `kur.sh` çalıştırılmaz; önce panel kapatılır (açık Claude oturumları sonlanır).

## 3. Dosya haritası

| Dosya | Görev |
|---|---|
| `main.js` | Ana süreç: pencere, menü ve kısayollar, ayar dosyası (`config.json`), terminal süreçleri (node-pty), webview izinleri |
| `chat-main.js` | Sohbet görünümünün ana süreç tarafı: Agent SDK `query()` oturumları, giriş kabuğu ortamı, izin istekleri (`canUseTool`), model/efor/mod değişimi, geçmiş oturumlar |
| `preload.js` | Arayüze açılan IPC köprüsü (`window.panel`) |
| `renderer/index.html` | Sayfa iskeleti; xterm, marked, DOMPurify `node_modules`'dan yüklenir |
| `renderer/app.js` | Hesap çubuğu, sekmeler, başlatıcı, terminal sekmeleri, Web görünümü, hesap ayarları penceresi, menü komutları |
| `renderer/chat.js` | Sohbet sekmesi: mesaj akışı, araç grupları, izin/soru/plan kartları, yazma alanı, model/efor/mod seçicileri, yan panel, geçmiş seçici |
| `renderer/styles.css` | Tüm stiller; renk değişkenleri `:root`'ta (Claude koyu paleti) |
| `scripts/sessions.mjs` | Yardımcı süreç: bir hesabın geçmiş oturumlarını listeler ya da mesajlarını okur |
| `scripts/fix-pty.js` | `postinstall`: node-pty `spawn-helper` çalıştırma iznini geri verir |
| `tests/e2e.js` | Uçtan uca test (Playwright + Electron) |
| `tests/fake-claude.js` | Agent SDK'nın stream-json protokolünü taklit eden sahte Claude Code |
| `tests/check.js` | Sözdizimi kontrolü |
| `kur.sh` | Paketleme ve kurulum |
| `ayarlari-esitle.sh` | `~/.claude` içindeki kişisel ayarları (CLAUDE.md, skill'ler, hook'lar, projects…) hesap klasörlerine symlink'ler, MCP sunucularını kopyalar |

Kullanıcı ayarları: `~/Library/Application Support/Claude Panel/config.json` → `accounts`, `recents` (hesap başına son klasörler), `chatPrefs` (hesap başına model/efor/mod), `lastAccount`, `fontSize`.

## 4. Doğrulama

1. Doğrulama yolu söylenemeyen iş başlamaz; doğrulanmamış iş bitmiş sayılmaz.
2. Her değişiklikte en az `npm run check`.
3. Arayüz ya da ana süreç davranışı değiştiyse `npm test`. Yeni bir davranış eklendiyse `tests/e2e.js`'e bir adım ve kesin bir `assert` eklenir; yeni adım bir kez bilerek bozulup kırmızıya döndüğü görülür.
4. Sahte CLI'nin gerçek Claude Code'dan farklı davrandığı yerler olabilir. SDK protokolüne dokunan değişikliklerde (yeni mesaj tipi, kontrol isteği) `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` tiplerine bakılır ve `fake-claude.js` güncellenir. Ardından Emre'den gerçek hesapla bir tur denemesi istenir.
5. Görünen değişiklikte `tests/out/` altındaki ekran görüntülerine bakılır.
6. Paketlemeyi etkileyen değişiklikte (`package.json`, `kur.sh`, yeni dosya yolu) `bash kur.sh` koşulur ve kurulan uygulama açılıp denenir.

## 5. Öğrenilmiş tuzaklar (değiştirmeden önce oku)

- **Agent SDK ayar klasörünü süreç başına bir kez okur** (`CLAUDE_CONFIG_DIR` memoize edilir). Bu yüzden `listSessions` / `getSessionMessages` ana süreçte çağrılmaz; her çağrı `scripts/sessions.mjs` ile, hesabın ortamıyla ayrı bir süreçte (`ELECTRON_RUN_AS_NODE=1`) yapılır. `query()` her oturum için ayrı Claude Code süreci açtığından ve `env` seçeneğini aldığından sorun değildir.
- **SDK `env` seçeneği ortamı tamamen değiştirir**, birleştirmez. Finder'dan açılan uygulamanın PATH'i kısa olduğu için `chat-main.js` → `loginEnv()` kullanıcının giriş kabuğunu (`$SHELL -l -i`) bir kez çalıştırıp gerçek ortamı alır. Terminal sekmeleri de `-l -i` ile açılır.
- **Giriş bilgileri hesap başına ayrı**: Claude Code macOS Anahtar Zinciri'nde `Claude Code-credentials-<ayar klasörü sha256'sının ilk 8 hanesi>` adını kullanır. Bunu SDK kodunda doğruladık.
- **İzin istekleri**: SDK'ya `canUseTool` verilir; arayüz kartı yanıtlanınca `chat:permissionReply` ile çözülür. `AskUserQuestion` cevabı `updatedInput.answers = { [soru metni]: "seçilen etiket" }` ile döner. `ExitPlanMode` onayından sonra mod `acceptEdits` ya da `default` yapılır.
- **Efor çalışırken** `query.applyFlagSettings({ effortLevel })` ile, başlangıçta `options.effort` ile verilir. Model başına desteklenen seviyeler `supportedModels()` → `supportedEffortLevels` alanından gelir.
- `settingSources: ['user','project','local']` ve `systemPrompt: { type:'preset', preset:'claude_code' }` verilir. Verilmezse proje `CLAUDE.md`'si, hook'ları ve izinleri yüklenmez.
- `allowDangerouslySkipPermissions: true`, sonradan "Tam yetki" moduna geçebilmek içindir; mod kendisi seçilmedikçe etkisi yoktur.
- **Paketleme `--no-asar`**: node-pty'nin `spawn-helper` dosyası ve SDK'nın platform ikilisi asar içinden çalıştırılamaz.
- **claude.ai/code'daki "Local" seçeneği** yalnız resmi Claude masaüstü uygulamasında çalışır. Web görünümünde bu sayfaya gidilince "Yerel Code'a geç" şeridi çıkar.
- **Web girişi**: e-postadaki link Safari'de açılır. Doğrulama kodu girilir ya da link panelin adres çubuğuna yapıştırılır.
- Electron'da `window.prompt` yoktur. `confirm` çalışır ama az kullanılır.
- `CLAUDE_PANEL_CLAUDE_BIN` (sahte CLI yolu) ve `CLAUDE_PANEL_USER_DATA` (ayar klasörü) yalnız testler içindir.

## 6. Kurallar

- Arayüz metinleri, kod açıklamaları ve belgeler Türkçe. Dosya, değişken ve anahtar adları ASCII ve İngilizce/Türkçe karışık olabilir, mevcut adlandırmaya uyulur.
- Bağımlılık eklemeden önce düşünülür. Arayüz çatısı yok (React vb.); DOM `h()` yardımcısıyla kurulur. Bu sade yapı korunur.
- Sohbet görünümünün düzeni Claude masaüstü uygulamasını örnek alır; büyük görsel değişiklikler Emre'ye ekran görüntüsüyle gösterilir.
- Geri alınamayan dış işlemler (kod imzalama, yayına alma, başka makineye dağıtım) Emre'nin onayını bekler.

## 7. Açık işler / bilinen eksikler

- Sohbet görünümü gerçek hesapla uzun bir oturumda denenmedi. Testler sahte CLI ile; ilk gerçek denemelerde çıkan farklar burada izlenir.
- Geçmiş yüklenirken alt ajan mesajları iç içe gösterilmiyor (yalnız ana akış).
- `@dosya` otomatik tamamlama, bağlam doluluk göstergesi (`getContextUsage`), dosya geri sarma (`rewindFiles`) yok.
- Açık tema yok; yalnız koyu.
- Uygulama imzasız (yerel derleme). Başka bir Mac'e taşınırsa Gatekeeper uyarısı verir.
- `ayarlari-esitle.sh` `projects` klasörünü de paylaştırır. Bu sayede oturum geçmişi ve proje hafızası üç hesapta ortaktır; istenmezse betikteki `ITEMS` listesinden çıkarılır.
