#!/usr/bin/env bash
# docker compose for this stack, e.g.:  ./dc.sh ps   ./dc.sh logs -f app   ./dc.sh restart app
set -euo pipefail
source "$(dirname "$0")/lib.sh"
[ -f "$RUN/compose.env" ] || { echo "Run install.sh first." >&2; exit 1; }
dc "$@"
