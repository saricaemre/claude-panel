#!/bin/bash
# Claude Panel kurulumu: paketleri kurar, Mac uygulaması oluşturur ve ~/Applications'a koyar.
# Kullanım (Terminal'de):  bash ~/"Claude Panel"/kur.sh
set -e
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "✗ npm bulunamadı. Önce Node.js kurun (https://nodejs.org veya: brew install node)."
  exit 1
fi

ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH="x64"

echo "→ Paketler kuruluyor (ilk seferde 1-2 dakika sürebilir)…"
npm install

echo "→ Mac uygulaması oluşturuluyor…"
npx electron-packager . "Claude Panel" --platform=darwin --arch="$ARCH" --out=dist --overwrite --no-asar \
  --ignore='^/dist' --ignore='^/kur\.sh' --ignore='^/tests' --ignore='^/CLAUDE\.md' --ignore='^/\.claude' --ignore='^/\.git' --app-bundle-id=local.claude-panel

APP="dist/Claude Panel-darwin-$ARCH/Claude Panel.app"
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Claude Panel.app"
cp -R "$APP" "$HOME/Applications/"

echo ""
echo "✓ Kuruldu: ~/Applications/Claude Panel.app"
echo "  Spotlight'ta (⌘ Boşluk) \"Claude Panel\" yazarak açabilir, Dock'a sabitleyebilirsiniz."
open "$HOME/Applications/Claude Panel.app"
