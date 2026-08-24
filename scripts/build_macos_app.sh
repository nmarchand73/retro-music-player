#!/usr/bin/env bash
# Intent: build a double-clickable macOS Retro Music Player.app with icon + launcher.
# Architecture: embeds built Vite UI + Express sources + node_modules under
# Contents/Resources/app, plus a tiny Python venv for pywebview. Music dumps stay
# outside the bundle (~/Library/Application Support/Retro Music Player/data, or
# the repo data/ when launching desktop_app.py from source).
# Quality: 8/10 — MyChat/Chess Insight pattern adapted for Node; Darwin-only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist-mac"
APP="$DIST/Retro Music Player.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
APP_DIR="$RES/app"
VENV_DIR="$RES/venv"
ICON_SRC="$ROOT/assets/AppIcon.png"
ICONSET="$DIST/RetroMusicPlayer.iconset"
ICNS="$RES/AppIcon.icns"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script builds a macOS .app (run on macOS)." >&2
  exit 1
fi

if [[ ! -f "$ICON_SRC" ]]; then
  echo "Missing icon: $ICON_SRC" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to build and run the app." >&2
  exit 1
fi

BASE_PY="$ROOT/desktop-venv/bin/python"
if [[ ! -x "$BASE_PY" ]]; then
  BASE_PY="$(command -v python3)"
fi
if [[ -z "$BASE_PY" ]]; then
  echo "No python3 found to build the app venv." >&2
  exit 1
fi

echo "Building web client…"
cd "$ROOT"
npm run build

rm -rf "$APP" "$ICONSET"
mkdir -p "$MACOS" "$RES" "$ICONSET" "$APP_DIR"

_mk() {
  local px="$1" name="$2"
  local tmp="$ICONSET/_tmp_${px}.png"
  sips -z "$px" "$px" "$ICON_SRC" --out "$tmp" >/dev/null
  mv "$tmp" "$ICONSET/$name"
}
_mk 16 "icon_16x16.png"
_mk 32 "diana.k@example.org"
_mk 32 "icon_32x32.png"
_mk 64 "ivan.p@example.net"
_mk 128 "icon_128x128.png"
_mk 256 "wendy.h@example.net"
_mk 256 "icon_256x256.png"
_mk 512 "frank.g@example.org"
_mk 512 "icon_512x512.png"
_mk 1024 "walt.e@example.net"
iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"

# Favicons for the browser UI
sips -z 32 32 "$ICON_SRC" --out "$ROOT/public/favicon-32.png" >/dev/null 2>&1 || true
sips -z 180 180 "$ICON_SRC" --out "$ROOT/public/apple-touch-icon.png" >/dev/null 2>&1 || true

echo "Copying app sources into bundle…"
rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude 'dist-mac/' \
  --exclude '.git/' \
  --exclude '.cursor/' \
  --exclude 'e2e/' \
  --exclude 'test-results/' \
  --exclude 'playwright-report/' \
  --exclude 'playwright/.cache/' \
  --exclude 'data/sndh/' \
  --exclude 'data/amiga/' \
  --exclude 'data/cpc/' \
  --exclude 'data/c64/' \
  --exclude 'data/cache/' \
  --exclude 'tools/psgplay/' \
  --exclude 'tools/sc68/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '.DS_Store' \
  --exclude '.venv/' \
  --exclude 'desktop-venv/' \
  --exclude 'scripts/.venv/' \
  "$ROOT/" "$APP_DIR/"

# Ensure production dist is present (rsync includes ROOT/dist from npm run build)
if [[ ! -f "$APP_DIR/dist/index.html" ]]; then
  echo "Missing dist/index.html after copy — build failed?" >&2
  exit 1
fi

echo "Installing Node dependencies inside bundle…"
(
  cd "$APP_DIR"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
)

echo "Creating pywebview venv…"
"$BASE_PY" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install -q --upgrade pip
"$VENV_DIR/bin/python" -m pip install -q -r "$APP_DIR/requirements-desktop.txt"
"$VENV_DIR/bin/python" -c "import webview"

cat > "$MACOS/Retro Music Player" <<EOF
#!/bin/bash
# Self-contained launcher: code+venv in this .app; music data in Application Support
# (or RETRO_MUSIC_DATA_DIR). Requires Node.js on PATH.
DIR="\$(cd "\$(dirname "\$0")/.." && pwd)"
APP_ROOT="\$DIR/Resources/app"
PY="\$DIR/Resources/venv/bin/python"
export PYTHONUNBUFFERED=1
export PYWEBVIEW_GUI=cocoa
export RETRO_MUSIC_ROOT="\$APP_ROOT"
export RETRO_MUSIC_DATA_DIR="\${RETRO_MUSIC_DATA_DIR:-\$HOME/Library/Application Support/Retro Music Player/data}"
export PORT="\${PORT:-\${RETRO_MUSIC_PORT:-3010}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
mkdir -p "\$HOME/Library/Logs"
mkdir -p "\$RETRO_MUSIC_DATA_DIR"
LOG="\$HOME/Library/Logs/Retro Music Player.log"
{
  echo "---- \$(date) launch ----"
  echo "APP_ROOT=\$APP_ROOT"
  echo "PY=\$PY"
  echo "DATA=\$RETRO_MUSIC_DATA_DIR"
  echo "PORT=\$PORT"
  echo "NODE=\$(command -v node || true)"
  cd "\$APP_ROOT" || exit 1
  exec "\$PY" "\$APP_ROOT/desktop_app.py"
} >>"\$LOG" 2>&1
EOF
chmod +x "$MACOS/Retro Music Player"

cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Retro Music Player</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>local.retromusicplayer.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Retro Music Player</string>
  <key>CFBundleDisplayName</key>
  <string>Retro Music Player</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

touch "$APP"

# Help first launch find existing dumps from this checkout without Documents TCC
# (Finder-launched .apps cannot follow symlinks into ~/Documents). Prefer APFS/HFS
# hardlinked trees under Application Support — same inodes, Library path is readable.
SUPPORT_DATA="$HOME/Library/Application Support/Retro Music Player/data"
mkdir -p "$SUPPORT_DATA"
_link_archive() {
  local name="$1"
  local src="$ROOT/data/$name"
  local dst="$SUPPORT_DATA/$name"
  if [[ ! -d "$src" ]]; then
    return 0
  fi
  if [[ -L "$dst" ]]; then
    rm "$dst"
  fi
  if [[ -e "$dst" ]]; then
    echo "Keep existing $dst"
    return 0
  fi
  echo "Hardlinking $name → $dst"
  cp -al "$src" "$dst"
}
_link_archive sndh
_link_archive amiga
_link_archive cpc
_link_archive c64

echo "Built: $APP"
echo "Open with: open \"$APP\""
echo "Optional: cp -R \"$APP\" ~/Applications/"
echo "Data: $SUPPORT_DATA"
echo "Logs: ~/Library/Logs/Retro Music Player.log"
echo "Desktop port: PORT / RETRO_MUSIC_PORT (default 3010; auto-picks next if busy)"
echo "Requires Node.js on PATH (brew install node)."
