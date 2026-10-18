#!/bin/bash
# Kişisel Claude Code ayarlarını (~/.claude) panelin hesap klasörlerine bağlar.
# Giriş bilgilerine dokunmaz; her hesap kendi girişini korur.
#
# Kullanım (tüm Claude Code oturumlarını kapattıktan sonra):
#   bash ~/"Claude Panel"/ayarlari-esitle.sh
#
# Argümansız: paneldeki hesapların ayar klasörleri (config.json → accounts[].configDir; boş olan ~/.claude'dur, atlanır).
# Belirli klasörler için argüman verin:
#   bash ayarlari-esitle.sh ~/.claude-is ~/.claude-pro

set -e
SRC="$HOME/.claude"
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  CFG="$HOME/Library/Application Support/Claude Panel/config.json"
  if [ -f "$CFG" ]; then
    while IFS= read -r d; do [ -n "$d" ] && TARGETS+=("$d"); done < <(python3 - "$CFG" "$HOME" <<'PY'
import json, os, sys
cfg, home = sys.argv[1], sys.argv[2]
src = os.path.realpath(os.path.join(home, ".claude"))
for a in json.load(open(cfg)).get("accounts") or []:
    d = (a.get("configDir") or "").strip()
    if not d: continue
    d = os.path.join(home, d[2:]) if d.startswith("~/") else d
    if os.path.realpath(d) != src: print(d)
PY
)
  fi
fi
if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "Eşitlenecek hesap klasörü yok: paneldeki hesapların hepsi ~/.claude'u kullanıyor."
  echo "Belirli klasörler için: bash ayarlari-esitle.sh ~/.claude-is ~/.claude-pro"
  exit 0
fi

# Paylaşılacaklar: talimatlar, ayarlar/hook'lar, skill'ler, agent'lar, komutlar,
# eklentiler, durum satırı betikleri ve proje hafızası + oturum geçmişi (projects).
ITEMS=(CLAUDE.md settings.json skills agents commands plugins output-styles hooks statusline.sh projects todos)

if [ ! -d "$SRC" ]; then
  echo "✗ $SRC bulunamadı."; exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)

for d in "${TARGETS[@]}"; do
  echo "→ $d"
  mkdir -p "$d"
  for f in "${ITEMS[@]}"; do
    src="$SRC/$f"; dst="$d/$f"
    [ -e "$src" ] || continue
    if [ -L "$dst" ]; then
      echo "   = $f (zaten bağlı)"; continue
    fi
    if [ -e "$dst" ]; then
      # Hesap klasöründe bu arada oluşmuş içerik varsa kaybolmasın:
      # klasörse içeriğini ortak klasöre ekle (üzerine yazmadan), sonra yedekle.
      if [ -d "$dst" ] && [ -d "$src" ]; then
        cp -Rn "$dst"/. "$src"/ 2>/dev/null || true
      fi
      mv "$dst" "$dst.yedek-$STAMP"
      echo "   ↺ $f yedeklendi ($f.yedek-$STAMP)"
    fi
    ln -s "$src" "$dst"
    echo "   ✓ $f bağlandı"
  done
done

# MCP sunucuları hesap bilgisiyle aynı dosyada (.claude.json) duruyor; o dosya bağlanamaz.
# Sadece mcpServers kısımlarını kopyalıyoruz (genel + proje bazlı).
python3 - "$HOME/.claude.json" "${TARGETS[@]}" <<'PY'
import json, os, sys, shutil, time
src_path, targets = sys.argv[1], sys.argv[2:]
if not os.path.exists(src_path):
    print("   (MCP: ~/.claude.json yok, atlandı)"); sys.exit(0)
src = json.load(open(src_path))
glob = src.get("mcpServers") or {}
proj = {p: v.get("mcpServers") for p, v in (src.get("projects") or {}).items() if v.get("mcpServers")}
if not glob and not proj:
    print("   (MCP: kopyalanacak sunucu yok)"); sys.exit(0)
for d in targets:
    t = os.path.join(d, ".claude.json")
    if not os.path.exists(t):
        print(f"   ! {d}: henüz giriş yapılmamış, MCP atlandı (girişten sonra betiği tekrar çalıştırın)")
        continue
    shutil.copy2(t, t + ".yedek-" + time.strftime("%Y%m%d-%H%M%S"))
    data = json.load(open(t))
    data.setdefault("mcpServers", {})
    added = [k for k in glob if k not in data["mcpServers"]]
    for k in added: data["mcpServers"][k] = glob[k]
    for p, servers in proj.items():
        entry = data.setdefault("projects", {}).setdefault(p, {})
        entry.setdefault("mcpServers", {})
        for k, v in servers.items():
            if k not in entry["mcpServers"]:
                entry["mcpServers"][k] = v; added.append(f"{k} ({os.path.basename(p)})")
    json.dump(data, open(t, "w"), indent=2, ensure_ascii=False)
    print(f"   ✓ {d}: MCP " + (", ".join(added) if added else "zaten güncel"))
PY

echo ""
echo "✓ Bitti. Paneldeki terminalleri yeniden açın."
echo "  Kontrol için her hesapta: /hooks  /memory  /mcp  /agents  ve  claude --resume"
