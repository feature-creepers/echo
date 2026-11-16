#!/bin/zsh
# Optional: installs the Kokoro voices (more natural than the Mac's own, English only) into the JARVIS
# data folder. Needs Node and about 750 MB of disk; downloads the kokoro-js package and a 310 MB speech
# model once. Afterwards the voices appear in Settings > Voice. To remove them, delete the folder.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DIR="${JARVIS_KOKORO:-$HOME/JARVIS/kokoro}"
mkdir -p "$DIR"
cd "$DIR"
[ -f package.json ] || echo '{"name":"jarvis-kokoro","private":true}' > package.json
echo "Installing kokoro-js into $DIR…"
npm install kokoro-js
echo "Downloading the speech model (310 MB)…"
node "$SRC/kokoro-tts.mjs" "$DIR" --download || true
[ -d "$DIR/models" ] && echo "Done. Restart JARVIS, then pick a Kokoro voice in Settings > Voice."
