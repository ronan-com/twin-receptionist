#!/usr/bin/env bash
# Builds the installer image (with the server bundle inside it).
#   bash installer/build.sh            -> docker image receptionist-installer:latest
#   bash installer/build.sh --save     -> also writes installer/out/receptionist-installer-image.tar.gz
#                                         (ship that file next to the start scripts)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
IMAGE=${IMAGE:-receptionist-installer:latest}

bash "$REPO/deploy/selfhost/make-bundle.sh"
mkdir -p "$HERE/bundle"
cp "$REPO/deploy/selfhost/out/selfhost-bundle.tgz" "$HERE/bundle/selfhost-bundle.tgz"
[ -f "$HERE/bun.lock" ] || (cd "$HERE" && bun install)
docker build -t "$IMAGE" "$HERE"
echo "built image $IMAGE"

if [ "${1:-}" = "--save" ]; then
  mkdir -p "$HERE/out"
  docker save "$IMAGE" | gzip > "$HERE/out/receptionist-installer-image.tar.gz"
  cp "$HERE"/start.sh "$HERE"/start.command "$HERE"/start.bat "$HERE/out/"
  echo "wrote $HERE/out/ (image + start scripts): zip that folder up for buyers"
fi
