#!/usr/bin/env bash
# Updates this server to a new bundle, keeping .env, secrets.env, the database and backups.
#   sudo bash update.sh /path/to/selfhost-bundle.tgz   unpack the new bundle here, then rebuild
#   sudo bash update.sh                                 rebuild/repair from the files already here
# install.sh takes a pre-update backup of the database before it rebuilds.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
BUNDLE=${1:-}
if [ -n "$BUNDLE" ]; then
  [ -f "$BUNDLE" ] || { echo "INSTALL FAILED: no such bundle: $BUNDLE"; exit 1; }
  tar -tzf "$BUNDLE" | grep -qx './install.sh\|install.sh' || { echo "INSTALL FAILED: $BUNDLE is not a self-host bundle (no install.sh)"; exit 1; }
  echo "==> Unpacking $(basename "$BUNDLE") into $ROOT"
  # The bundle never contains .env, secrets.env, run/ or backups/, so those are untouched.
  tar -xzf "$BUNDLE" -C "$ROOT" --no-same-owner
fi
exec bash "$ROOT/install.sh"
