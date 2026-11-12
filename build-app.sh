#!/bin/zsh
# Builds JARVIS.app into ~/Applications from this project.
# Run it again after changing server.mjs or public/index.html to update the app.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/JARVIS.app"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/public" "$APP/Contents/Resources/workspace"
cp "$SRC/server.mjs" "$APP/Contents/Resources/"
cp "$SRC/public/index.html" "$APP/Contents/Resources/public/"
cp "$SRC/app/workspace-template.md" "$APP/Contents/Resources/workspace/CLAUDE.md"

# Icon: render the SVG with headless Chrome, then pack it into an .icns.
if [ -x "$CHROME" ]; then
  "$CHROME" --headless --disable-gpu --hide-scrollbars --user-data-dir="$TMP/chrome" \
    --default-background-color=00000000 --window-size=1024,1024 \
    --screenshot="$TMP/icon.png" "file://$SRC/app/icon.svg" >/dev/null 2>&1 || true
fi
if [ -s "$TMP/icon.png" ]; then
  SET="$TMP/icon.iconset"; mkdir "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/icon.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/icon.icns"
else
  echo "Note: could not render the icon; the app will use the default icon."
fi

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>JARVIS</string>
  <key>CFBundleDisplayName</key><string>JARVIS</string>
  <key>CFBundleIdentifier</key><string>local.jarvis.launcher</string>
  <key>CFBundleExecutable</key><string>JARVIS</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.9.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSMicrophoneUsageDescription</key><string>JARVIS listens to your voice when you hold the talk key.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>JARVIS turns what you say into text so it can answer you.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# The app itself: a small native shell (app/main.swift). Compiling takes a few minutes on a
# slow Mac, so the result is kept in app/.build and reused until main.swift changes.
BIN="$SRC/app/.build/JARVIS"
if [ ! -x "$BIN" ] || [ "$SRC/app/main.swift" -nt "$BIN" ]; then
  echo "Compiling the native shell (this can take a few minutes)…"
  mkdir -p "$SRC/app/.build"
  swiftc -O -o "$BIN" "$SRC/app/main.swift" \
    -framework Cocoa -framework WebKit -framework Speech -framework AVFoundation -framework Carbon \
    -framework ServiceManagement -framework ApplicationServices
fi
cp "$BIN" "$APP/Contents/MacOS/JARVIS"
chmod +x "$APP/Contents/MacOS/JARVIS"
# Sign it, so macOS can remember its microphone and speech permissions.
# With the local certificate from setup-signing.sh the app keeps the same identity across builds,
# and the permissions granted once stay granted. Without it the signature is ad hoc: it changes with
# every build, and macOS asks again after each one.
SIGN_ID="JARVIS Local Signing"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$SIGN_ID\""; then
  codesign --force --sign "$SIGN_ID" "$APP" >/dev/null 2>&1 || { echo "Could not sign with \"$SIGN_ID\". If macOS asked to use the key, choose Always Allow and build again."; exit 1; }
else
  codesign --force --sign - "$APP" >/dev/null 2>&1 || echo "Note: could not sign the app; macOS may ask for permissions more often."
  echo "Note: signed ad hoc, so macOS will ask for permissions again after each build. Run ./setup-signing.sh once to stop that."
fi
touch "$APP"
rm -rf "$TMP"
echo "Built $APP"
