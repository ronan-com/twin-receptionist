#!/usr/bin/env bash
# Builds deploy/selfhost/out/selfhost-bundle.tgz: the self-host scripts at the top level
# plus app-src.tgz, the app source from the working tree (uncommitted changes included).
#   bash deploy/selfhost/make-bundle.sh
# Unpack it into /opt/receptionist, write /opt/receptionist/.env, then run install.sh.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
OUT="$HERE/out"
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT; chmod 755 "$STAGE"
[ -f "$REPO/package.json" ] && [ -f "$REPO/bun.lock" ] && [ -f "$REPO/deploy/Dockerfile" ] || { echo "make-bundle: $REPO does not look like the app repo" >&2; exit 1; }

# App source. Anchored (./x) excludes are top-level folders only; the rest match anywhere.
tar -czf "$STAGE/app-src.tgz" -C "$REPO" \
  --owner=0 --group=0 --numeric-owner --sort=name \
  --exclude=./.git --exclude=./.claude --exclude=./dist --exclude=./data --exclude=./installer \
  --exclude=./.tanstack --exclude=./deploy/selfhost/out \
  --exclude=node_modules --exclude=.git --exclude=.env --exclude='.env.*' --exclude='*.env' \
  --exclude='*.pem' --exclude='*.log' --exclude='*.tmp' \
  .

# Self-host files at the top level of the bundle.
cp "$HERE"/{install.sh,update.sh,backup.sh,restore.sh,dc.sh,lib.sh,compose.yml,README.md} "$STAGE/"
mkdir -p "$STAGE/caddy"; cp "$HERE/caddy/Caddyfile" "$STAGE/caddy/"
chmod 755 "$STAGE"/*.sh
REV=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)
DIRTY=$([ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] && echo " + uncommitted changes" || true)
echo "built $(date -u +%Y-%m-%dT%H:%M:%SZ) from $(git -C "$REPO" branch --show-current 2>/dev/null || echo '?')@$REV$DIRTY" > "$STAGE/VERSION"

mkdir -p "$OUT"
tar -czf "$OUT/selfhost-bundle.tgz.part" -C "$STAGE" --owner=0 --group=0 --numeric-owner .
mv "$OUT/selfhost-bundle.tgz.part" "$OUT/selfhost-bundle.tgz"
echo "make-bundle: $OUT/selfhost-bundle.tgz ($(du -h "$OUT/selfhost-bundle.tgz" | cut -f1), app $(du -h "$STAGE/app-src.tgz" | cut -f1); $(cat "$STAGE/VERSION"))"
