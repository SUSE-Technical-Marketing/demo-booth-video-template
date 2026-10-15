#!/bin/bash
# Run from a project folder, with source media inside that folder:
#   cd ~/Movies/demo && ~/Documents/GitHub/demo-booth-video-template/render/run-container.sh project.json -o final.mp4
# Builds the image on first use (set CONTAINER_ENGINE=podman or nerdctl to override docker; IMAGE to rename it).
#
# Or run the whole app (the editor and the export service) with nothing installed on the host:
#   render/run-container.sh --ui [--port 8765]     then open http://127.0.0.1:8765 in Chrome or Edge
# The image is rebuilt (quickly, from cache) each time so it always matches this checkout.
set -euo pipefail
ENGINE="${CONTAINER_ENGINE:-$(command -v docker || command -v podman || command -v nerdctl || true)}"
[ -n "$ENGINE" ] || { echo "No docker, podman or nerdctl found." >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-booth-render}"
if [ "${1:-}" = "--ui" ]; then
  shift
  PORT=8765
  if [ "${1:-}" = "--port" ]; then PORT="${2:?--port needs a number}"; shift 2; fi
  [ $# -eq 0 ] || { echo "Usage: run-container.sh --ui [--port N]" >&2; exit 1; }
  "$ENGINE" build -q -t "$IMAGE" -f "$REPO/render/Containerfile" "$REPO" >/dev/null
  echo "Open it in Chrome or Edge; Ctrl+C stops it."
  # Published to 127.0.0.1 only: nothing else on the network can reach it. The service refuses non-localhost Host
  # headers and requires the editor's header on every API call. Finished videos are saved from the browser to
  # wherever you choose; the container keeps only temporary files, deleted after each export.
  exec "$ENGINE" run --rm -p "127.0.0.1:$PORT:8765" --entrypoint python3 "$IMAGE" \
    /app/render/server.py --host 0.0.0.0 --port 8765 --public-port "$PORT" --static /app/dist
fi
if ! "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1 || [ "${REBUILD:-0}" = "1" ]; then
  "$ENGINE" build -t "$IMAGE" -f "$REPO/render/Containerfile" "$REPO"
fi
# Mount the project folder too, so its relative media paths resolve in the container.
MOUNTS=(-v "$PWD":/work -v "$REPO/timings":/app/timings:ro)
ARGS=()
N=0
map_path() {  # $1 = host path, $2 = "in" (must exist) or "out"; sets MAPPED
  local dir base abs
  dir="$(dirname "$1")"; base="$(basename "$1")"
  if [ "$2" = "out" ]; then mkdir -p "$dir"; fi
  if [ ! -d "$dir" ]; then MAPPED="$1"; return; fi
  abs="$(cd "$dir" && pwd)"
  N=$((N + 1))
  MOUNTS+=(-v "$abs":/mnt/$N)
  MAPPED="/mnt/$N/$base"
}
while [ $# -gt 0 ]; do
  case "$1" in
    -o|--output|--png) ARGS+=("$1"); shift; [ $# -gt 0 ] && { map_path "$1" out; ARGS+=("$MAPPED"); shift; } ;;
    -*)                ARGS+=("$1"); shift ;;
    *)                 if [ -f "$1" ]; then map_path "$1" in; ARGS+=("$MAPPED"); else ARGS+=("$1"); fi; shift ;;
  esac
done
exec "$ENGINE" run --rm "${MOUNTS[@]}" "$IMAGE" ${ARGS[@]+"${ARGS[@]}"}
