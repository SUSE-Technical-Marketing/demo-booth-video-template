#!/bin/bash
# Run the renderer in a container. Run it from the folder that holds your video:
#   cd ~/Movies/demo && ~/Documents/GitHub/demo-booth-video-template/render/run-container.sh my-edit.mp4 -t my-video.json -o final.mp4
# Builds the image on first use (set CONTAINER_ENGINE=podman or nerdctl to override docker; IMAGE to rename it).
set -euo pipefail
ENGINE="${CONTAINER_ENGINE:-$(command -v docker || command -v podman || command -v nerdctl || true)}"
[ -n "$ENGINE" ] || { echo "No docker, podman or nerdctl found." >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-booth-render}"
if ! "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1 || [ "${REBUILD:-0}" = "1" ]; then
  "$ENGINE" build -t "$IMAGE" -f "$REPO/render/Containerfile" "$REPO"
fi
# Only the current directory is mounted at /work, so a path elsewhere on the host (~/Desktop/in.mp4, ../timings/x.json)
# would not exist in the container. Mount the folder of each file argument and pass the container path instead.
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
    -t|--timing)       ARGS+=("$1"); shift
                       if [ $# -gt 0 ]; then
                         if [ -f "$1" ]; then map_path "$1" in; ARGS+=("$MAPPED"); else ARGS+=("$1"); fi
                         shift
                       fi ;;
    -*)                ARGS+=("$1"); shift ;;
    *)                 if [ -f "$1" ]; then map_path "$1" in; ARGS+=("$MAPPED"); else ARGS+=("$1"); fi; shift ;;
  esac
done
exec "$ENGINE" run --rm "${MOUNTS[@]}" "$IMAGE" ${ARGS[@]+"${ARGS[@]}"}
