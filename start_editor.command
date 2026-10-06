#!/bin/bash
# Double-click to run the timing editor locally (alternative to the hosted GitHub Pages copy).
# Serves docs/ on http://127.0.0.1:8765 - only reachable from this Mac. Close this window to stop it.
cd "$(dirname "$0")/docs"
open "http://127.0.0.1:8765/"
echo "Timing editor: http://127.0.0.1:8765/   (Ctrl+C or close this window to stop)"
python3 -m http.server 8765 --bind 127.0.0.1
