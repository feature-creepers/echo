#!/bin/zsh
# Double-click to start JARVIS. Close this Terminal window to shut it down.
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
exec node server.mjs
