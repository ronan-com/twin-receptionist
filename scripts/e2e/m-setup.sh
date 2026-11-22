#!/bin/bash
# Area M (marketing) copy of setup.sh, parametrised so it can run beside other
# worktrees: a fresh scratch database in the twin-pg Docker container and the
# server on its own port with a fake phone-provider key. Never touches production.
#   E2E_PORT (default 8904)   E2E_DB (default e2e_m)
#   TWIN_ENV (default /home/ronan/aibiz/.env)   E2E_DIR (default $HOME/aibiz/answered-port-notes/e2e-m)
# The marketing page needs no seeded data; it only needs the built app served.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT=${E2E_PORT:-8904}
DB=${E2E_DB:-e2e_m}
ENVF=${TWIN_ENV:-/home/ronan/aibiz/.env}
E=${E2E_DIR:-$HOME/aibiz/answered-port-notes/e2e-m}
case "$DB" in twin|postgres|"") echo "refusing to use database '$DB'"; exit 1 ;; esac
mkdir -p "$E"
B=http://localhost:$PORT

{ ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oE "pid=[0-9]+" | cut -d= -f2 | while read -r p; do kill "$p"; done; } || true
sleep 1
if [ "${SKIP_BUILD:-}" != "1" ]; then bun run build 2>&1 | grep -E "built in|rror" || true; fi
docker exec twin-pg psql -U twin -d postgres -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null
DBURL=$(grep '^DATABASE_URL=' "$ENVF" | cut -d= -f2- | sed "s#/twin\$#/$DB#")
case "$DBURL" in */"$DB") ;; *) echo "DATABASE_URL in $ENVF doesn't end in /twin; refusing"; exit 1 ;; esac
LEGACY_DATA_DIR="$E/nolegacy" DATABASE_URL="$DBURL" MAILBOX_KEY=$(openssl rand -base64 32) \
  TELNYX_API_KEY=platform-fake-key-0000000000 API_PORT=$PORT PUBLIC_URL=$B \
  nohup bun server/index.ts > "$E/server.log" 2>&1 &
echo $! > "$E/server.pid"
for _ in $(seq 1 30); do curl -s -m 2 "$B/api/health" >/dev/null && break; sleep 1; done
curl -sf -m 2 "$B/api/health" >/dev/null || { echo "server did not start; see $E/server.log"; exit 1; }
echo "READY $B db=$DB dir=$E"
