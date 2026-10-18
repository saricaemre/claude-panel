# Octopus prototipi (2026-10-17)

Bu klasör ürün kodu değil. Octopus planındaki ([../OCTOPUS-PLANI.md](../OCTOPUS-PLANI.md)) kanıtları üreten betikler ve ilk görsel taslak burada. Panel bunları yüklemez; `kur.sh` `docs/` klasörünü paketlemez.

Betikler Node 24 ya da panelin Electron'uyla çalışır ve ek bağımlılık istemez. Yalnız `danis.mjs` repodaki `@anthropic-ai/claude-agent-sdk` paketini kullanır. `node:sqlite` her çalıştırmada bir `ExperimentalWarning` uyarısı basar; zararsızdır.

| Dosya | Ne yapar | Örnek |
|---|---|---|
| `ortak.mjs` | Kayıt okuma, soy zinciri (`lineage`), bağlamdaki yer (`placeOf`), Türkçe arama biçimi (`norm`) | (diğerleri kullanır) |
| `sikistirmalar.mjs` | Bir hesabın projelerindeki gerçek sıkıştırmaları sayar (uuid ile tekilleştirir; içerik yazdırmaz) | `node sikistirmalar.mjs ~/.claude/projects` |
| `soy.mjs` | Bir oturumun soyundaki sıkıştırmaları sıralar; verilen bilgilerin hangi özette yaşadığını gösterir | `node soy.mjs <oturum.jsonl> "Witcher=witcher"` |
| `dizin.mjs` | Bir projenin bütün oturumlarını tam metin dizine çevirir ve arar | `node dizin.mjs kur <kayıt-klasörü> /tmp/p.db`, sonra `node dizin.mjs ara /tmp/p.db "witcher"` |
| `danis.mjs` | Geçmiş beyne danışır: oturumdan istenen ana kadar bir dal açar (`forkSession`), istenirse soru sorar, dalı siler | `node danis.mjs <proje> <oturum-id> <mesaj-uuid> "soru"` (token harcamaz) · sonuna `--onay` (harcar) |
| `octopus-taslak.html` | Sohbette gösterilen canlı ahtapot taslağı. Tarayıcıda tek başına açılır | çift tıkla |

## Güvenlik notları

- **Dizin dosyası konuşmaların tam metnini içerir.** `dizin.mjs` dosyayı yalnız sahibine açık (600) yazar. Repoya, paylaşılan bir klasöre ya da `/tmp` dışına konmamalıdır.
- **`danis.mjs` oturum kayıt klasörüne geçici bir dal yazar ve `finally` içinde siler.** Silindiğini ve asıl dosyanın boyutunun ve zamanının değişmediğini kendisi yazdırır. `--onay` olmadan API çağrısı yapmaz; yalnız tahmini bağlam boyutunu gösterir.
- **Bu betikler başka projelerin kayıtlarını yalnız okur.** Hiçbir oturumu sıkıştırmaz, hiçbir ayarı değiştirmez. Planın "sormadan sıkıştırma yok" ilkesi burada da geçerli.

## Bilinen tuzaklar (ölçüldü)

- **Sıkıştırma kaydının biçimi:**
  - Sınırda `parentUuid: null` olur; eski uca `logicalParentUuid` gider.
  - Korunan son mesajlar (`compactMetadata.preservedMessages`) diskte eski ebeveynlerini taşır. Zinciri yalnız `parentUuid` ile yürüyen bir betik sınırı kaçırır; `lineage()` bunu uuid eşleşmesiyle çözer.
- **Dallanmış oturumlar:** aynı kayıt (ve aynı sınır) dosyada birden çok kez geçebilir. Kayıtlar uuid ile tekilleştirilir.
- **`resumeSessionAt`:** sıkıştırma öncesindeki uuid'leri `No message found` diye reddeder. Doğru yol `forkSession({ upToMessageId })`.
- **`sessionStore`:** `persistSession: false` ile kullanılamaz. Ayrıca özel `CLAUDE_CONFIG_DIR` hesaplarında giriş bilgisini geçici klasöre taşımaz ("Not logged in").
- **Türkçe:** `toLowerCase()` "İ" harfini "i̇" yapar ve eşleşme kaçar. `toLocaleLowerCase('tr')` harf harf uygulanmalı ve aksanlar katlanmalı.
