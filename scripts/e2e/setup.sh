#!/bin/bash
# Local end-to-end test environment: a fresh scratch database in the twin-pg Docker
# container, the server on :8899 with a fake phone-provider key, and:
#   platform admin ronan@test.dev / correct-horse-battery
#   Agency A owner a@a.test / password-for-agency-a, with one complete receptionist
# Writes cookies/ids/logs to $E2E_DIR (default /tmp/twin-e2e). Never touches production.
set -euo pipefail
cd "$(dirname "$0")/../.."
E=${E2E_DIR:-/tmp/twin-e2e}
mkdir -p "$E"
B=http://localhost:8899; J='Content-Type: application/json'

{ ss -ltnp 2>/dev/null | grep ':8899 ' | grep -oE "pid=[0-9]+" | cut -d= -f2 | while read -r p; do kill "$p"; done; } || true
sleep 1
bun run build 2>&1 | grep -E "built in|rror" || true
docker exec twin-pg psql -U twin -d postgres -q -c "drop database if exists agency_test" -c "create database agency_test" >/dev/null
DBURL=$(grep '^DATABASE_URL=' ../.env | cut -d= -f2- | sed 's#/twin$#/agency_test#')
echo "$DBURL" > "$E/dburl"
LEGACY_DATA_DIR="$E/nolegacy" DATABASE_URL="$DBURL" MAILBOX_KEY=$(openssl rand -base64 32) \
  TELNYX_API_KEY=platform-fake-key-0000000000 API_PORT=8899 PUBLIC_URL=$B \
  nohup bun server/index.ts > "$E/server.log" 2>&1 &
for _ in $(seq 1 30); do curl -s -m 2 $B/api/health >/dev/null && break; sleep 1; done

rm -f "${E:?}"/*.jar
curl -s -c "$E/admin.jar" -H "$J" -d '{"name":"Ronan","email":"ronan@test.dev","password":"correct-horse-battery","orgName":"Twin Platform"}' $B/api/signup >/dev/null
TA=$(curl -s -b "$E/admin.jar" -H "$J" -d '{"name":"Agency A","ownerEmail":"a@a.test"}' $B/api/admin/agencies | sed -E 's#.*/invite/([A-Za-z0-9_-]+)".*#\1#')
curl -s -c "$E/a.jar" -H "$J" -d '{"name":"Owner A","password":"password-for-agency-a"}' $B/api/invites/$TA >/dev/null
AID=$(curl -s -b "$E/a.jar" $B/api/session | grep -oE '"org":\{"id":"[^"]+' | cut -d'"' -f6)
CL=$(cat /proc/sys/kernel/random/uuid)
bun scripts/e2e/mkclient.ts > "$E/client.json"
docker cp "$E/client.json" twin-pg:/tmp/client.json
docker exec twin-pg psql -U twin -d agency_test -q -c "insert into clients (id, org_id, data, created_at, updated_at) values ('$CL','$AID',pg_read_file('/tmp/client.json')::jsonb, now(), now())"
echo "$CL" > "$E/clientid"
echo "READY client=$CL dir=$E"
