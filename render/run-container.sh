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
exec "$ENGINE" run --rm -v "$PWD":/work -v "$REPO/timings":/app/timings:ro "$IMAGE" "$@"
