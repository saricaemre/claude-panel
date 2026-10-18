#!/bin/bash
# Simülatör yardımcısını (native/simhelper.swift) derler → native/build/simhelper
# Gerekenler: Xcode ve AXe (brew install cameroncooke/axe/axe).
set -e
cd "$(dirname "$0")/.."
AXE_FW="$(brew --prefix axe 2>/dev/null)/libexec/Frameworks"
if [ ! -d "$AXE_FW/FBSimulatorControl.framework" ]; then
  echo "✗ AXe bulunamadı. Kurmak için: brew install cameroncooke/axe/axe" >&2
  exit 1
fi
OUT=native/build
MOD="$OUT/modules/FBSimulatorControl.swiftmodule"
mkdir -p "$MOD"
# AXe'nin Swift arayüzü modülle aynı adı taşıyan sınıf yüzünden olduğu gibi derlenmiyor:
# "FBSimulatorControl.FBx" ve "IOSurface.IOSurface" nitelemeleri kaldırılır.
sed -E 's/FBSimulatorControl\.(FB|Async)/\1/g; s/IOSurface\.IOSurface/IOSurface/g' \
  "$AXE_FW/FBSimulatorControl.framework/Modules/FBSimulatorControl.swiftmodule/arm64-apple-macos.swiftinterface" \
  > "$MOD/arm64-apple-macos.swiftinterface"
xcrun swiftc -O -module-cache-path "$OUT/mc" -F "$AXE_FW" -I native/CoreSimulator -I "$OUT/modules" \
  -framework FBSimulatorControl -framework FBControlCore -Xlinker -rpath -Xlinker "$AXE_FW" \
  native/simhelper.swift -o "$OUT/simhelper"
echo "✓ $OUT/simhelper"
