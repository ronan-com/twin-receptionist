#!/bin/bash
# Local end-to-end test environment: a fresh scratch database in the twin-pg Docker
# container, the server on $E2E_PORT with a fake phone-provider key, and:
#   platform admin ronan@test.dev / correct-horse-battery
#   Agency A owner a@a.test / password-for-agency-a, with one complete receptionist
# Settings (all optional):
#   E2E_PORT  server port            (default 8899)
#   E2E_DB    scratch database name  (default agency_test)
#   TWIN_ENV  env file with DATABASE_URL (default /home/ronan/aibiz/.env)
#   E2E_DIR   cookies/ids/logs       (default /tmp/twin-e2e-$E2E_PORT)
#   E2E_SKIP_BUILD=1 to reuse dist/
# Never touches production.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT=${E2E_PORT:-8899}
DB=${E2E_DB:-agency_test}
ENVF=${TWIN_ENV:-/home/ronan/aibiz/.env}
E=${E2E_DIR:-/tmp/twin-e2e-$PORT}
[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "E2E_DB must be a plain lower-case name"; exit 1; }
case "$DB" in twin|answered|postgres) echo "Refusing to use database $DB"; exit 1 ;; esac
mkdir -p "$E"
B=http://localhost:$PORT; J='Content-Type: application/json'

{ ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oE "pid=[0-9]+" | cut -d= -f2 | while read -r p; do kill "$p"; done; } || true
sleep 1
[ "${E2E_SKIP_BUILD:-}" = 1 ] || bun run build 2>&1 | grep -E "built in|rror" || true
docker exec twin-pg psql -U twin -d postgres -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null
DBURL=$(grep '^DATABASE_URL=' "$ENVF" | cut -d= -f2- | sed -E "s#/[A-Za-z0-9_]+(\?.*)?\$#/$DB\1#")
echo "$DBURL" > "$E/dburl"
LEGACY_DATA_DIR="$E/nolegacy" DATABASE_URL="$DBURL" MAILBOX_KEY=$(openssl rand -base64 32) \
  TELNYX_API_KEY=platform-fake-key-0000000000 API_PORT=$PORT PUBLIC_URL=$B FIRST_ADMIN_EMAIL= ALLOW_SIGNUP= \
  SIGNUP_LIMIT_PER_HOUR=${SIGNUP_LIMIT_PER_HOUR:-50} \
  nohup bun server/index.ts > "$E/server.log" 2>&1 &
for _ in $(seq 1 30); do curl -s -m 2 $B/api/health >/dev/null && break; sleep 1; done

rm -f "${E:?}"/*.jar
curl -s -c "$E/admin.jar" -H "$J" -d '{"name":"Ronan","email":"ronan@test.dev","password":"correct-horse-battery","orgName":"Twin Platform"}' $B/api/signup >/dev/null
TA=$(curl -s -b "$E/admin.jar" -H "$J" -d '{"name":"Agency A","ownerEmail":"a@a.test"}' $B/api/admin/agencies | sed -E 's#.*/invite/([A-Za-z0-9_-]+)".*#\1#')
curl -s -c "$E/a.jar" -H "$J" -d '{"name":"Owner A","password":"password-for-agency-a"}' $B/api/invites/$TA >/dev/null
AID=$(curl -s -b "$E/a.jar" $B/api/session | grep -oE '"org":\{"id":"[^"]+' | cut -d'"' -f6)
CL=$(cat /proc/sys/kernel/random/uuid)
bun scripts/e2e/mkclient.ts > "$E/client.json"
docker cp "$E/client.json" twin-pg:/tmp/client-$PORT.json
docker exec twin-pg psql -U twin -d "$DB" -q -c "insert into clients (id, org_id, data, created_at, updated_at) values ('$CL','$AID',pg_read_file('/tmp/client-$PORT.json')::jsonb, now(), now())"
echo "$CL" > "$E/clientid"
echo "$AID" > "$E/agencyid"
echo "$B" > "$E/base"
echo "READY base=$B db=$DB client=$CL dir=$E"
