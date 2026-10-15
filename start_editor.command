#!/bin/bash
# Double-click to run the timing editor locally (alternative to the hosted GitHub Pages copy).
# Serves the Vue app on http://127.0.0.1:8765. Close this window to stop it.
set -e
cd "$(dirname "$0")"
# Finder-launched windows can miss the PATH your shell profile sets up (Homebrew, mise shims, Bun's own folder).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.bun/bin:$PATH"
if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 8765 is already in use (an editor you started earlier, or the old Python server?):"
    lsof -nP -iTCP:8765 -sTCP:LISTEN
    echo "Close that window or run: kill \$(lsof -ti tcp:8765)   then start the editor again."
    exit 1
fi
echo "Timing editor: http://127.0.0.1:8765/   (Ctrl+C or close this window to stop)"
if command -v mise >/dev/null 2>&1; then
    mise run run --open
elif command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile
    bun run dev --open
else
    echo "Install mise (https://mise.jdx.dev/) or Bun 1.3.14+ and Node.js 24+ to run the editor."
    exit 1
fi
