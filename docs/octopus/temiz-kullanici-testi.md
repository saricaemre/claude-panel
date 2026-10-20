# Temiz kullanıcı testi (P8.2, madde 4)

Amaç: paneli hiç görmemiş biri, temiz bir macOS kullanıcısında kurup ilk projesini Octopus olarak başlatabiliyor mu? Bu denemeyi Emre yapar. Sonuçlar `GUNLUK.md`'ye ve `OCTOPUS-PLANI.md` §2'deki P8.2 satırına yazılır.

Bulunan her sorun için not: hangi adım, ne beklendi, ne oldu, ekran görüntüsü.

## Hazırlık (Emre'nin hesabında)

1. Panel kapalıyken DMG'yi oluştur: `bash kur.sh --dmg` → `dist/Claude-Panel-1.0.0-arm64.dmg`.
2. DMG'yi yeni kullanıcının erişebileceği bir yere kopyala (ör. `/Users/Shared/`).

## Yeni kullanıcı

3. Sistem Ayarları → Kullanıcılar ve Gruplar → yeni bir **standart** kullanıcı ekle (ör. "Deneme"). Yönetici yapma.
4. Oturumu kapat, "Deneme" ile gir. Bu kullanıcıda Homebrew, Node, Claude Code ve `~/.claude` olmamalı.

## Deneme ("Deneme" kullanıcısında)

| # | Adım | Beklenen |
|---|---|---|
| 5 | DMG'yi aç, "Önce oku.txt"yi oku, uygulamayı Applications'a sürükle | Standart kullanıcı `/Applications`'a yazamayabilir; yazamazsa `~/Applications`'a sürükle ve bunu not et |
| 6 | Uygulamayı aç | macOS engeller. Sistem Ayarları → Gizlilik ve Güvenlik → "Yine de Aç" ile açılır |
| 7 | İlk ekran | Kurulum sihirbazı, tek hesap "Claude", ayar klasörü boş; birkaç saniye sonra "Giriş yapılmamış" |
| 8 | **Terminalde giriş yap** | Terminal sekmesi açılır, Claude Code'un giriş ekranı gelir (Claude Code bu kullanıcıda kurulu değil; panel kendi ikilisini kullanmalı). "command not found" çıkarsa hata |
| 9 | Tarayıcıda girişi onayla (deneme için bir Claude hesabı), **Kuruluma dön** | "Giriş yapılmış · e-posta · plan" |
| 10 | **Devam** → "Octopus nasıl çalışır?" | Tanıtım açılır, okunur, Esc ile kapanır |
| 11 | **Proje klasörü seç…** → yeni boş bir klasör (ör. `~/Deneme`) | "yeni bir proje" ve "Octopus olarak başlat" |
| 12 | **Octopus olarak başlat**, kısa bir ilk mesaj yaz (ör. "Bu klasöre bir README yaz") | Sohbet başlar, kenar çubuğunda "Ahtapotlar" altında proje görünür, başın yanında ahtapot bölmesi açılabilir |
| 13 | Claude'a "Bunu bir kola ver: README'yi İngilizceye çevirsin" de | Yan oturum izin kartı → onayla → ahtapot bölmesinde bir kol büyür, kol rapor verince durumu değişir |
| 14 | "Kırmızı başlık istemiyorum, bunu deftere yaz" de | Defter sekmesinde ret satırı |
| 15 | Paneli kapat, yeniden aç, ahtapota tıkla | Baş "Devam et" ile açılır, kol kendiliğinden açılmaz |
| 16 | Ayarlar (⌘,) → Octopus sekmesi | Proje listede, hafıza açık; dizin boyutu görünür |
| 17 | Finder'da `~/Library/Application Support/Claude Panel/` | `config.json`, `octopus/` var. Terminal'de `ls -l` ile `config.json` ve `octopus/oc_…/` dosyaları `-rw-------`, klasör `drwx------` |
| 18 | README'deki "Veri nerede durur" tablosunu bu kullanıcıda doğrula | Tablodaki her yer gerçekten orada |

Token harcayan adımlar yalnız 12–14 (kısa turlar).

## Temizlik

19. "Deneme" kullanıcısından çık, Emre'nin hesabında kullanıcıyı sil ("Ana klasörü sil" seçili).

## Bilinen sınırlar (hata sayılmaz)

- Bildirim balonu yok (imzasız uygulama); Dock simgesi zıplar ve sayı gösterir.
- iOS simülatörü Xcode ve AXe ister; temiz kullanıcıda çalışmaz.
- Terminal sekmesinde elle yazılan `claude` komutu, Claude Code ayrıca kurulmadıkça bulunmaz. Panelin açtığı terminaller (giriş, "Terminalde aç") çalışır.
- Arayüz yalnız Türkçe (K9).
