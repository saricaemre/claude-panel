# Claude Panel

Claude Code'u bu Mac'te, Claude masaüstü uygulamasına benzeyen bir sohbet penceresinde çalıştıran bir uygulama. Bir ya da birden çok Claude hesabını tek pencerede, birbirine karışmadan kullanırsınız. Projelerinizin ana oturumu **Octopus** ile uzun ömürlü olur: sıkıştırmaya dayanıklı bir hafızası ve bir defteri vardır.

- **Sohbet**: Claude Code bu Mac'te, seçtiğiniz hesapla çalışır. Araç adımları toplu satırlar hâlinde görünür. İzin ve soru kartları, model ve efor seçimi, sağda ilerleme paneli var. Aynı oturumu **Terminal** düğmesiyle terminalde de sürdürebilirsiniz.
- **Web**: Her hesabın kendi claude.ai penceresi var. Çerezler hesap başına ayrı tutulur.
- **Octopus**: Projenin ilk oturumu beyin (baş) olur, açtığı yan oturumlar kolları. Ayrıntısı aşağıda.
- **Yan bölmeler**: Artifacts (Claude'un ürettiği sayfa ve belgelerin galerisi), tarayıcı (⇧⌘B), değişiklikler (⇧⌘D), iOS simülatörü (⇧⌘S). Claude bunları kendi araçlarıyla da kullanır.
- **Model, efor ve kullanım**: Yazma kutusundaki model düğmesinden model ve düşünme eforu seçilir. Yanındaki halka plan limitinin dolu kısmını gösterir.

## Gereksinimler

- Apple Silicon (M1 ve sonrası) bir Mac, macOS.
- Bir Claude aboneliği (Pro, Max, Team ya da Enterprise). Panel API anahtarı istemez, Claude Code'un girişini kullanır.
- Kaynaktan kurmak için Node.js 22.12 ya da üstü (`brew install node`).
- Claude Code'un komut satırını ayrıca kurmanız gerekmez: panel kendi içinde taşır. Kuruluysa (`claude` komutu varsa) terminal sekmeleri onu kullanır.
- İsteğe bağlı: iOS simülatörü için Xcode ve AXe (`brew install cameroncooke/axe/axe`). PR izleme için GitHub CLI (`brew install gh`, `gh auth login`).

## Kurulum

**Kaynaktan.** Proje klasöründe bir kez çalıştırın:

```bash
bash kur.sh
```

Komut paketleri kurar, uygulamayı oluşturur ve `~/Applications/Claude Panel.app` olarak koyar. Spotlight'tan açıp Dock'a sabitleyebilirsiniz. Güncellemek için aynı komutu yeniden çalıştırın. Çalıştırmadan önce paneli kapatın; açık Claude oturumları sonlanır.

**Başka bir Mac'e vermek için** `bash kur.sh --dmg` çalıştırın: `dist/Claude-Panel-<sürüm>-arm64.dmg` oluşur. Uygulama Apple sertifikasıyla imzalı değil. İlk açılışta macOS engeller. Sistem Ayarları → Gizlilik ve Güvenlik → "Yine de Aç" deyin. DMG'nin içindeki "Önce oku.txt" adımları sayar.

## İlk açılış

Panel ilk açılışta kısa bir kurulum sihirbazı gösterir:

1. **Hesap.** Tek hesap yeter. Ayar klasörü boş bırakılırsa Claude Code'un varsayılan klasörü (`~/.claude`) kullanılır. Bu Mac'te Claude Code'a daha önce giriş yaptıysanız panel bunu görür. Yapmadıysanız **Terminalde giriş yap** düğmesi `claude /login`'i açar. Tarayıcıda girişi onaylayıp **Kuruluma dön** deyin.
2. **İlk ahtapot.** Bir proje klasörü seçin. Klasörün geçmişi yoksa yeni sohbet ekranı "Octopus olarak başlat" açık gelir; ilk mesajınızla başlayan oturum projenin beyni olur. Klasörde daha önce Claude Code oturumları varsa **Projeyi Octopus'a al** var olan oturumlardan birini beyin yapar.

Sihirbazı atlayabilirsiniz. **Web** görünümü için hesabın Web düğmesine basıp claude.ai'ye ayrıca giriş yapın. E-postadaki giriş linki Safari'de açılır; kodu girin ya da linki paneldeki adres çubuğuna yapıştırın.

Yardım → **Octopus nasıl çalışır?** kısa bir tanıtım açar.

## Octopus nasıl çalışır?

Claude bir projede uzun süre çalışınca bağlamı dolar ve Claude Code konuşmayı özetler (sıkıştırma). Tek bir özet sizin sözlerinizi büyük ölçüde korur. Ama özetler üst üste binince retler, zevkiniz, kalite çıtanız ve oturumun ilk görevi bir iki özet içinde silinebilir. Octopus projenin ana oturumunu buna karşı korur.

- **Baş ve kollar.** Projenin ana oturumu baştır: yönü tutar, işi böler, sonuçları denetler. Baş yan oturumlar açabilir; bunlar kollardır. Başın yanındaki ahtapot bölmesinde her kolun durumu görünür (çalışıyor, bekliyor, rapor verdi…). Kola tıklayınca o sohbet açılır. Kolları yalnız baş açar. Aynı anda en çok 8 kol çalışır; sınır ayarlardan düşürülebilir.
- **Defter.** Kurallar, retler, zevk, kararlar ve açık işler defterde satır satır durur. Baş `defter` aracıyla yazar. Siz başın bölmesindeki Defter sekmesinde düzenler, sabitler, kapatır ya da geri alırsınız. Hiçbir satır silinmez, her değişiklik yeni bir olaydır. Defterin özeti her oturum açılışında ve her sıkıştırmadan sonra başın önüne konur. Kollar işleriyle ilgili kuralları ilk mesajlarında alır. Projenizde karar dosyaları varsa (ör. `docs/kararlar/K*.md`) "Dosyalardan al" ile defterde yalnız okunan satırlar olarak görünür.
- **Hafıza.** Projenin geçmiş oturumları bu Mac'te tam metin olarak dizinlenir (Türkçe harflerle doğru arama). Baş, bağlamından düşmüş bir şeyi `hatirla` aracıyla kelimesi kelimesine bulur. Gerekirse geçmiş bir ana ya da kapanmış bir kola tek bir soru sorar (`danis`). Claude Code eski oturum kayıtlarını varsayılan olarak 30 gün sonra sildiği için ahtapotların kayıtları ayrıca sıkıştırılmış bir arşive kopyalanır.
- **Sıkıştırma sizin onayınızla.** Panel bir oturumu sormadan sıkıştırmaz. Claude Code'un kendi otomatik sıkıştırması bir onay kartına bağlanır. Kartta talimatla sıkıştırabilir ya da başı **yeniden doğurabilirsiniz**: yeni bir oturum defter, ilk görev ve son turlarla yazılmış bir devir notuyla açılır, eski oturum "fosil" olarak kalır. Ardından kısa bir **sınav** neyin hatırlandığını ölçer; unutulan satırlar sonraki mesajda yeniden masaya konur.
- **Maliyet görünür.** Token harcayan her iş (danışma, sınav, yeniden doğuş) önce tahmini bedelini gösterir. Eşiğin üstündeki iş onayınız olmadan çalışmaz. Eşikler Ayarlar → Octopus'ta.

Var olan bir proje yalnız okunarak tanınır. Panel projenizin dosyalarına (`CLAUDE.md` vb.) ve Claude Code ayarlarına sormadan yazmaz. Tek istisna sorulan bir öneridir: ahtapotun başında bir kez, oturum kayıtlarının saklama süresini uzatmak (`cleanupPeriodDays`) önerilir. Onaylarsanız hesabın `settings.json`'una yalnız bu değer yazılır.

## Veri nerede durur, nasıl silinir

Panelin bütün verisi `~/Library/Application Support/Claude Panel/` klasöründedir:

| Yer | İçerik | Silmek için |
|---|---|---|
| `config.json` | Hesaplar, son klasörler, ortamlar (değişkenleri düz metin), ayarlar | Dosyayı silin; panel ilk açılış sihirbazıyla başlar |
| `octopus/oc_…/` | Bir ahtapotun kaydı (`ahtapot.json`), defteri (`defter.jsonl`), sınavları, yeniden doğuşları | Klasörü silin (arayüzde silme düğmesi henüz yok) |
| `octopus/hafiza.db` (+ `-wal`, `-shm`) | Hafıza dizini: oturumların tam metni | Ayarlar → Octopus → **Hafızayı sil** |
| `octopus/arsiv/` | Ahtapot oturumlarının kalıcı arşivi (`.jsonl.gz`) | Aynı düğme: dizin ve arşiv birlikte silinir |
| `artifacts/` | Artifacts galerisi, sürümler, küçük resimler | Galeriden tek tek ya da klasörü silin |
| `Partitions/` | Web ve tarayıcı bölmelerinin çerezleri ve önbelleği | Klasörü silin (claude.ai girişleri gider) |

Panelin hiç dokunmadığı ya da yalnız okuduğu yerler:

- **Claude Code'un kendi verisi** hesabın ayar klasöründedir (`~/.claude` ya da hesaba verdiğiniz klasör): oturum kayıtları (`projects/`), ayarlar, eklentiler. Panel bunları okur; hiçbir oturum dosyasına yazmaz, silmez.
- **Giriş bilgileri** macOS Anahtar Zinciri'nde, Claude Code'un kendi kaydındadır ("Claude Code-credentials…").

Her şeyi kaldırmak için: uygulamayı (`~/Applications/Claude Panel.app`) ve yukarıdaki klasörü silin. Claude Code'un verisi ve girişi yerinde kalır.

Bir projeyi hafızadan çıkarmak için Ayarlar → Octopus'ta o ahtapotun **Hafıza** kutusunu kapatın. Proje dizinden düşer, arşiv kopyası kalır.

## Gizlilik

- Octopus'un dosyaları (kayıt, defter, dizin, arşiv) yalnız sizin kullanıcınızın okuyabileceği izinlerle yazılır (klasör 700, dosya 600). `config.json` da 600'dür.
- Panel bu verileri hiçbir sunucuya göndermez. Telemetri yoktur.
- Claude'a giden şey, Claude Code'u her zamanki kullanımınızla aynıdır: sohbetin kendisi. Ayrıca Claude'un `hatirla` ile bulduğu parçalar, `danis` ve sınavda açılan geçici dallar da Claude'a gider. Bunlar planınızın kullanımından düşer.
- Bilinen gizli anahtar biçimleri (API anahtarları, erişim belirteçleri) hafıza dizinine girmeden maskelenir. Bu bir güvenlik ağıdır, garanti değildir. Oturum kayıtlarının kendisi Claude Code'un klasöründe olduğu gibi durur.
- Panelin kendisinin ağa çıktığı yerler: Web görünümü (claude.ai), sizin ya da Claude'un tarayıcı bölmesinde açtığı siteler, PR izlemede `gh`. Artifact küçük resimleri ağı kapalı bir oturumda çizilir; yalnız bilinen CDN'lerden betik, stil ve yazı tipi gelir.
- Claude'un tarayıcı bölmesinde dış bir siteyi açması, bir uygulamayı simülatörde başlatması, terminalde komut çalıştırması ve yan oturum açması izin kartı ister.
- Tarayıcıda Claude'un JavaScript çalıştırması dış sitede her seferinde, yerel sayfada (`localhost` gibi) sohbet ve site başına bir kez sorulur. Claude'un tıklaması ya da çalıştırdığı kod sayfayı izin verilmemiş bir siteye götürmek isterse gidiş engellenir; sizin adres çubuğundan ya da sayfaya tıklayarak yaptığınız gidişler engellenmez. Sınır: onay verdiğiniz bir sayfada çalışan kod `fetch` gibi isteklerle dışarıya veri gönderebilir; bu ağ düzeyinde engellenmez.

## Birden çok hesap

Ayarlar → Hesaplar'dan (⌘,) başka hesaplar eklersiniz. Her hesabın ayrı bir ayar klasörü olur (ör. `~/.claude-is`). Giriş bilgileri, geçmiş ve ayarlar bu yüzden birbirine karışmaz. Her hesap için bir kez giriş yapılır: hesabın terminalinde `/login`.

Kişisel ayarlarınızın (`CLAUDE.md`, skill'ler, hook'lar, proje hafızası) bütün hesaplarda olmasını istiyorsanız:

```bash
bash ayarlari-esitle.sh
```

Betik `~/.claude`'daki bu dosyaları paneldeki hesapların ayar klasörlerine bağlar (symlink) ve MCP sunucularını kopyalar. Giriş bilgilerine dokunmaz. Oturum geçmişi (`projects`) da paylaşılır; istemiyorsanız betikteki `ITEMS` listesinden çıkarın.

## İzin sormadan çalışan MCP sunucuları

Varsayılan olarak her MCP aracı izin sorar. Güvendiğiniz bir sunucunun bütün araçlarının sormadan çalışmasını istiyorsanız `config.json`'a adını ekleyin:

```json
"autoAllowMcp": ["blender", "figma-console"]
```

Liste hem sohbete hem terminaldeki `claude`'a gider. Kod çalıştıran bir sunucuyu buraya eklemek, ona izinsiz kod çalıştırma yetkisi vermek demektir.

## Kısayollar

| Kısayol | İşlev |
|---|---|
| ⌘1 … ⌘9 | Hesap değiştir |
| ⌘K | Code ↔ Chat |
| ⌘N (ya da ⌘T) / ⌘W | Yeni sohbet / sekmeyi kapat |
| ⇧⌘A | Artifacts |
| ⇧⌘B / ⇧⌘D / ⇧⌘S | Tarayıcı / Değişiklikler / iOS Simülatörü |
| ⌘⌥← / ⌘⌥→ | Önceki / sonraki sekme |
| ⌘+ / ⌘- / ⌘0 | Yazı boyutu |
| ⌘, | Ayarlar |
| Enter / Shift+Enter | Gönder / yeni satır |
| Esc | Claude'u durdur |
| Shift+Tab | İzin modunu değiştir |

## Geliştirme

Proje Claude Code ile geliştiriliyor. Kurallar, mimari ve öğrenilmiş tuzaklar `CLAUDE.md`'de, geçmiş `GUNLUK.md`'de, Octopus'un planı `docs/octopus/OCTOPUS-PLANI.md`'de.

Depoyu alıp kendi dalınızda çalışmak için:

```bash
git clone https://github.com/saricaemre/claude-panel.git "Claude Panel"
cd "Claude Panel"
git switch -c <adiniz>/<is>     # main'e doğrudan değil, kendi dalınıza yazın
# … değişiklik, npm run check, npm test …
git push -u origin HEAD          # sonra GitHub'da pull request açın
```

`ayarlari-esitle.sh` Emre'nin üç hesaplı düzeni için yazıldı; tek hesapla çalışıyorsanız gerekmez.

```bash
npm install
npm start        # geliştirme modunda aç
npm run check    # sözdizimi kontrolü
npm test         # uçtan uca test (sahte Claude CLI ile)
```

Arayüz bugün yalnız Türkçe.
