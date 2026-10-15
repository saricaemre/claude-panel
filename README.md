# Claude Panel

Üç Claude hesabını (İş, Max, Pro) tek pencereden, birbirine karışmadan kullanmak için bir Mac uygulaması.

- **Yerel Code**: Claude Code bu Mac'te, seçtiğiniz hesapla çalışır. Sohbet görünümünde açılır ve arayüzü Claude uygulamasına benzer: araç adımları toplu satırlar hâlinde, izin ve soru kartları, model ve efor seçimi, sağda ilerleme paneli. İsterseniz aynı oturumu **Terminal** düğmesiyle terminalde sürdürebilirsiniz.
- **Web**: Her hesabın kendi claude.ai penceresi var. Çerezler ayrı tutulduğu için üç hesap aynı anda açık kalabilir.
- **Model, efor ve kullanım**: Yazma kutusundaki "Opus 5.5 · Yüksek" düğmesinden model ve düşünme eforu seçilir. Yanındaki halka 5 saatlik oturum limitinin dolu kısmını gösterir; tıklayınca oturum, haftalık ve model bazlı limitler sıfırlanma zamanlarıyla açılır.
- **Artifacts**: Claude'un panelde ürettiği HTML sayfaları, SVG'ler ve belgeler tek galeride toplanır. Claude bir `.html`/`.svg` yazınca kendiliğinden eklenir, sonraki düzenlemeler yeni sürüm olur; Claude `publish_artifact` aracıyla başka türleri de yayımlayabilir, kod bloklarındaki **Artifact** düğmesiyle siz de ekleyebilirsiniz. Galeride arama, yıldız, yeniden adlandırma, sürümler, önizleme/kod, indirme, tarayıcıda açma ve "Claude ile düzenle" var.

Her hesap ayrı bir ayar klasörü kullanır (`~/.claude-is`, `~/.claude-max`, `~/.claude-pro`). Giriş bilgileri, geçmiş ve ayarlar bu yüzden birbirine karışmaz.

## Kurulum

Terminal'de bir kez çalıştırın:

```bash
bash ~/"Claude Panel"/kur.sh
```

Bu komut paketleri kurar, uygulamayı oluşturur ve `~/Applications/Claude Panel.app` olarak açar. Sonra Spotlight'tan açıp Dock'a sabitleyebilirsiniz. Koddaki her değişiklikten sonra aynı komutla güncellenir; komutu çalıştırmadan önce paneli kapatın.

Çalışması için Node.js gerekir. Yoksa `brew install node` ile kurabilirsiniz.

## İlk kullanım

1. **Claude Code girişi (her hesap için bir kez):**
   1. Hesabı seçin, **Yerel Code**'a geçin.
   2. Bir klasörün yanındaki **Terminal** düğmesine basın.
   3. `/login` ile o hesabın e-postasıyla giriş yapın.

   Sonra sohbet görünümünü kullanabilirsiniz.
2. **Web girişi:** Hesabın **Web** düğmesine basın ve e-postayla gelen kodu girin. E-postadaki linke tıklarsanız link Safari'de açılır. Bunun yerine linki kopyalayıp paneldeki adres çubuğuna yapıştırın.
3. **Kişisel ayarlar:** Global `CLAUDE.md`, skill'ler, hook'lar ve proje hafızası üç hesapta da olsun istiyorsanız bir kez şunu çalıştırın:
   ```bash
   bash ~/"Claude Panel"/ayarlari-esitle.sh
   ```

## Kısayollar

| Kısayol | İşlev |
|---|---|
| ⌘1 / ⌘2 / ⌘3 | Hesap değiştir |
| ⌘K | Yerel Code ↔ Web |
| ⌘N (ya da ⌘T) / ⌘W | Yeni sohbet / sekmeyi kapat |
| ⇧⌘A | Artifacts |
| ⌘⌥← / ⌘⌥→ | Önceki / sonraki sekme |
| ⌘+ / ⌘- / ⌘0 | Yazı boyutu |
| ⌘, | Hesap ayarları |
| Enter / Shift+Enter | Gönder / yeni satır |
| Esc | Claude'u durdur |
| Shift+Tab | İzin modunu değiştir |

## Geliştirme

Proje Claude Code ile geliştiriliyor; kurallar ve mimari `CLAUDE.md` dosyasında.

```bash
npm install
npm start        # geliştirme modunda aç
npm run check    # sözdizimi kontrolü
npm test         # uçtan uca test (sahte Claude CLI ile)
```
