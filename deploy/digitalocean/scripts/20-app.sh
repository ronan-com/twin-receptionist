#!/bin/bash
# Packer step: puts the self-host bundle in /opt/receptionist and builds/pulls every image, so
# the buyer's first boot builds nothing. It unpacks the app exactly like install.sh does, so
# install.sh's own "docker compose build app" at first boot is a full cache hit (seconds).
# No .env, no secrets.env, no containers and no volumes are left behind.
set -euo pipefail
R=${RECEPTIONIST_ROOT:-/opt/receptionist}
BUNDLE=${BUNDLE:-/tmp/selfhost-bundle.tgz}
mkdir -p "$R"; chmod 755 "$R"
tar -xzf "$BUNDLE" -C "$R" --no-same-owner
[ -f "$R/install.sh" ] && [ -f "$R/app-src.tgz" ] || { echo "$BUNDLE is not a self-host bundle" >&2; exit 1; }
# shellcheck source=/dev/null
source "$R/lib.sh"

# Same unpack as install.sh step 5 (same files, same modes => same build cache keys).
rm -rf "$R/app.new"; mkdir -p "$R/app.new"
tar -xzf "$R/app-src.tgz" -C "$R/app.new" --no-same-owner
chmod -R u+rwX,go+rX,go-w "$R/app.new"
rm -rf "$R/app"; mv "$R/app.new" "$R/app"

# The Vite build needs about 2 GB of memory; the build Droplet has 1 GB. Temporary swap.
SWAP=/swapfile.build
if [ -z "${SELFHOST_TEST:-}" ] && [ -z "$(swapon --noheadings 2>/dev/null)" ]; then
  fallocate -l 2G "$SWAP"; chmod 600 "$SWAP"; mkswap "$SWAP" >/dev/null; swapon "$SWAP"
  trap 'swapoff "$SWAP" 2>/dev/null; rm -f "$SWAP"' EXIT
fi

# Throwaway compose settings so compose can read compose.yml. Removed below; install.sh
# writes the real ones (with a fresh database password) on the buyer's first boot.
mkdir -p "$RUN"; : > "$RUN/app.env"
printf 'DOMAIN=localhost\nPOSTGRES_PASSWORD=unused\nAPP_IMAGE=%s-app\n' "$PROJECT" > "$RUN/compose.env"
dc --progress plain build app
dc pull db caddy
rm -rf "$RUN" "$R/app"

if [ -n "$(docker volume ls -q --filter "name=^${PROJECT}_")" ] || [ -n "$(docker ps -aq)" ]; then
  echo "a container or volume was created during the image build; the image must ship empty" >&2; exit 1
fi
docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}'
