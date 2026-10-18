#!/bin/bash
# Claude Panel kurulumu: paketleri kurar, Mac uygulaması oluşturur ve ~/Applications'a koyar.
# Kullanım (Terminal'de):  bash ~/"Claude Panel"/kur.sh
#   --dmg: kurmaz, başka bir Mac'e verilecek dist/Claude-Panel-<sürüm>-<mimari>.dmg dosyasını oluşturur
set -e
cd "$(dirname "$0")"
DMG=0
[ "$1" = "--dmg" ] && DMG=1

if ! command -v npm >/dev/null 2>&1; then
  echo "✗ npm bulunamadı. Önce Node.js kurun (https://nodejs.org veya: brew install node)."
  exit 1
fi
# Electron 44 Node 22.12+ ister; npm 11 de bağımlılık betiklerini yalnız package.json → allowScripts'te izinliyse çalıştırır
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  echo "✗ Node $(node -v) eski; en az 22.12 gerekir (nvm ile: nvm install 24 && nvm alias default 24)."
  exit 1
fi

ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH="x64"

echo "→ Paketler kuruluyor (ilk seferde 1-2 dakika sürebilir)…"
npm install

# iOS simülatörü için yardımcı (Xcode ve AXe gerekir; yoksa simülatör dışında her şey çalışır)
if command -v brew >/dev/null 2>&1 && brew --prefix axe >/dev/null 2>&1 && [ -d "$(brew --prefix axe)/libexec/Frameworks" ]; then
  echo "→ Simülatör yardımcısı derleniyor…"
  bash scripts/build-simhelper.sh
else
  echo "! AXe yok: iOS simülatörü çalışmaz. Kurmak için: brew install cameroncooke/axe/axe (sonra kur.sh'yi yeniden çalıştırın)"
fi

echo "→ Mac uygulaması oluşturuluyor…"
npx electron-packager . "Claude Panel" --platform=darwin --arch="$ARCH" --out=dist --overwrite --no-asar \
  --ignore='^/dist' --ignore='^/kur\.sh' --ignore='^/tests' --ignore='^/CLAUDE\.md' --ignore='^/\.claude' --ignore='^/\.git' \
  --ignore='^/native/build/(mc|modules)' --ignore='^/GUNLUK\.md' --ignore='^/ayarlari-esitle\.sh' --ignore='^/docs' \
  --app-bundle-id=local.claude-panel

APP="dist/Claude Panel-darwin-$ARCH/Claude Panel.app"
# Paketleyici yalnız ana ikiliyi imzalıyor; paket mühürlenmezse başka Mac'te "hasarlı" der. Ad-hoc imza (sertifikasız) yeterli.
codesign --force --deep --sign - "$APP"

if [ "$DMG" = 1 ]; then
  VERSION=$(node -p 'require("./package.json").version')
  OUT="dist/Claude-Panel-$VERSION-$ARCH.dmg"
  STAGE="dist/dmg-$ARCH"
  rm -rf "$STAGE" "$OUT"
  mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  cat > "$STAGE/Önce oku.txt" <<'TXT'
Claude Panel — kurulum

1. "Claude Panel" simgesini yandaki Applications klasörüne sürükleyin.
2. Uygulama imzasız (Apple sertifikası yok), ilk açılışta macOS engeller:
   - Uygulamayı bir kez açmayı deneyin, uyarıyı kapatın.
   - Sistem Ayarları → Gizlilik ve Güvenlik → en altta "Yine de Aç" deyin.
   Olmazsa Terminal'de:  xattr -dr com.apple.quarantine "/Applications/Claude Panel.app"
3. İlk açılışta kısa bir kurulum sihirbazı açılır. Tek hesap yeter: ayar klasörü
   boş bırakılırsa Claude Code'un varsayılan klasörü (~/.claude) kullanılır.
   Giriş yapılmamışsa sihirbaz terminalde "claude /login"i açar.
   Başka hesapları sonra Hesap ayarlarından (⌘,) eklersiniz.
4. Panel Claude Code'u kendi içinde taşır; ayrıca kurmanız gerekmez.
   Bir Claude aboneliği (Pro, Max, Team ya da Enterprise) gerekir.
5. Yalnız Apple Silicon (M1 ve sonrası) Mac'lerde çalışır.
6. Octopus'un ne yaptığını Yardım → "Octopus nasıl çalışır?" anlatır.
   Panelin verisi: ~/Library/Application Support/Claude Panel/
TXT
  hdiutil create -volname "Claude Panel" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT" >/dev/null
  rm -rf "$STAGE"
  echo ""
  echo "✓ DMG hazır: $OUT ($(du -h "$OUT" | cut -f1))"
  exit 0
fi

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Claude Panel.app"
cp -R "$APP" "$HOME/Applications/"

echo ""
echo "✓ Kuruldu: ~/Applications/Claude Panel.app"
echo "  Spotlight'ta (⌘ Boşluk) \"Claude Panel\" yazarak açabilir, Dock'a sabitleyebilirsiniz."
open "$HOME/Applications/Claude Panel.app"
