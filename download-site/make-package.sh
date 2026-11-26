#!/usr/bin/env bash
# Builds the server bundle that buyers' new servers download during setup, and prints the
# publish command. (There's no buyer download any more: the hosted wizard does everything.)
#   bash download-site/make-package.sh <version>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
VERSION=${1:?usage: make-package.sh <version>}
bash "$REPO/deploy/selfhost/make-bundle.sh"
mkdir -p "$HERE/out"
cp "$REPO/deploy/selfhost/out/selfhost-bundle.tgz" "$HERE/out/selfhost-bundle-$VERSION.tgz"
echo "Now publish it:  bun download-site/admin.ts publish download-site/out/selfhost-bundle-$VERSION.tgz $VERSION"
