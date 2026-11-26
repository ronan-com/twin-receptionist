#!/usr/bin/env bash
# Runs the full local end-to-end test of the setup wizard (Railway, see e2e.mjs), then cleans up.
#   bash download-site/test/run-e2e.sh
# Needs Docker, bun, node, /snap/bin/chromium, the repo's node_modules and the local images
# oven/bun:1.4.0 and postgres:16. Uses ports E2E_PORT..+9 (default 4520-4529) and the app
# ports E2E_PORT+30..+39 (4550-4559). Everything it makes is named wiz-test-rail-* and labelled
# wiz-test-port=<E2E_PORT>; only those are removed at the end, by name/label.
# The DigitalOcean variant: node download-site/test/e2e-digitalocean.mjs (needs the dind image).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SITE=$(cd "$HERE/.." && pwd)
REPO=$(cd "$SITE/.." && pwd)
PORT=${E2E_PORT:-4520}
[ -f "$REPO/deploy/selfhost/out/selfhost-bundle.tgz" ] || bash "$REPO/deploy/selfhost/make-bundle.sh"
export E2E_DATA=${E2E_DATA:-$(mktemp -d "${TMPDIR:-/tmp}/wiz-e2e.XXXXXX")}
cleanup() {
  for c in $(docker ps -aq --filter "label=wiz-test-port=$PORT"); do docker rm -f "$c" >/dev/null; done
  for v in $(docker volume ls -q --filter "label=wiz-test-port=$PORT"); do docker volume rm "$v" >/dev/null 2>&1 || true; done
  for n in $(docker network ls -q --filter "label=wiz-test-port=$PORT"); do docker network rm "$n" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
cd "$SITE" && node test/e2e.mjs
