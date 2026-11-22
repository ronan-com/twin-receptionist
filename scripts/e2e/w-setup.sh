#!/bin/bash
# Area W (workspace read) end-to-end environment. A copy of setup.sh, parametrised:
#   E2E_PORT (default 8901), E2E_DB (default e2e_w), TWIN_ENV (default /home/ronan/aibiz/.env),
#   E2E_DIR (default /tmp/twin-e2e-w)
# A fresh scratch database in the twin-pg Docker container, the server with a fake
# phone-provider key and the call sync off, and:
#   platform admin   ronan@test.dev / correct-horse-battery
#   Agency A owner   a@a.test / password-for-agency-a, with a demo receptionist "Alpha Dental"
#   Agency B owner   b@b.test / password-for-agency-b (must not see Alpha Dental)
#   manager          manager@alpha.test / password-for-manager   (client_access manager)
#   viewer           viewer@alpha.test / password-for-viewer     (client_access viewer)
# plus seeded call_log rows, booking requests and calendar events for Alpha Dental.
# Never touches production.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT=${E2E_PORT:-8901}
DB=${E2E_DB:-e2e_w}
ENVF=${TWIN_ENV:-/home/ronan/aibiz/.env}
E=${E2E_DIR:-/tmp/twin-e2e-w}
mkdir -p "$E"
B=http://localhost:$PORT; J='Content-Type: application/json'
PSQL=(docker exec -i twin-pg psql -U twin -d "$DB" -q -v ON_ERROR_STOP=1)

{ ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oE "pid=[0-9]+" | cut -d= -f2 | while read -r p; do kill "$p"; done; } || true
sleep 1
if [ "${E2E_SKIP_BUILD:-}" != "1" ]; then bun run build 2>&1 | grep -E "built in|rror" || true; fi
docker exec twin-pg psql -U twin -d postgres -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null
DBURL=$(grep "^DATABASE_URL=" "$ENVF" | cut -d= -f2- | sed -E "s#/[A-Za-z0-9_]+(\\?.*)?\$#/$DB\\1#")
echo "$DBURL" > "$E/dburl"
LEGACY_DATA_DIR="$E/nolegacy" DATABASE_URL="$DBURL" MAILBOX_KEY=$(openssl rand -base64 32) CALL_SYNC=off \
  TELNYX_API_KEY=platform-fake-key-0000000000 API_PORT=$PORT PUBLIC_URL=$B \
  nohup bun server/index.ts > "$E/server.log" 2>&1 &
for _ in $(seq 1 30); do curl -s -m 2 "$B/api/health" >/dev/null && break; sleep 1; done

rm -f "${E:?}"/*.jar
curl -s -c "$E/admin.jar" -H "$J" -d '{"name":"Ronan","email":"ronan@test.dev","password":"correct-horse-battery","orgName":"Twin Platform"}' "$B/api/signup" >/dev/null
agency() { # name email password jar
  local T
  T=$(curl -s -b "$E/admin.jar" -H "$J" -d "{\"name\":\"$1\",\"ownerEmail\":\"$2\"}" "$B/api/admin/agencies" | sed -E 's#.*/invite/([A-Za-z0-9_-]+)".*#\1#')
  curl -s -c "$E/$4.jar" -H "$J" -d "{\"name\":\"Owner $1\",\"password\":\"$3\"}" "$B/api/invites/$T" >/dev/null
}
agency "Agency A" a@a.test password-for-agency-a a
agency "Agency B" b@b.test password-for-agency-b b
AID=$(curl -s -b "$E/a.jar" "$B/api/session" | grep -oE '"org":\{"id":"[^"]+' | cut -d'"' -f6)

# A demo receptionist (assistant id demo-...): transcripts come from the sample data, never the provider.
CL=$(cat /proc/sys/kernel/random/uuid)
bun -e '
import { blankSettings } from "./src/lib/shared";
const now = new Date().toISOString();
const id = process.argv[1];
const settings = { ...blankSettings(), businessName: "Alpha Dental", receptionistName: "Mia", voiceName: "Arlo - Service Specialist" };
const booking = { provider: "builtin", token: "tok-e2e-w", minutes: 30, enabled: true, createdAt: now };
console.log(JSON.stringify({ assistantId: `demo-${id}`, settings, booking, phoneNumbers: ["+61730001234"], instructions: "x", createdAt: now, updatedAt: now }));
' "$CL" > "$E/client.json"
docker cp "$E/client.json" twin-pg:/tmp/client-w.json
"${PSQL[@]}" -c "insert into clients (id, org_id, data, created_at, updated_at) values ('$CL','$AID',pg_read_file('/tmp/client-w.json')::jsonb, now(), now())"
echo "$CL" > "$E/clientid"

# Business users: invited by Agency A as customers, then given their access role.
customer() { # email password name jar role
  local U
  U=$(curl -s -b "$E/a.jar" -H "$J" -d "{\"email\":\"$1\"}" "$B/api/clients/$CL/customers" | grep -oE '/invite/[A-Za-z0-9_-]+' | head -1 | cut -d/ -f3)
  curl -s -c "$E/$4.jar" -H "$J" -d "{\"name\":\"$3\",\"password\":\"$2\"}" "$B/api/invites/$U" >/dev/null
  "${PSQL[@]}" -c "update client_access set role = '$5' where client_id = '$CL' and user_id = (select id from users where email = '$1')"
}
customer manager@alpha.test password-for-manager "Mandy Manager" manager manager
customer viewer@alpha.test password-for-viewer "Victor Viewer" viewer viewer

# Seed data. Times are relative to now; the business is in Australia/Brisbane.
"${PSQL[@]}" <<SQL
\set cl '$CL'
\set org '$AID'
insert into call_log (org_id, client_id, provider_call_id, channel, from_number, to_number, started_at, ended_at, duration_seconds, status, outcome, summary) values
  (:'org', :'cl', 'demo-call-1-' || :'cl', 'call', '+61412000111', '+61730001234', now() - interval '25 minutes', now() - interval '23 minutes', 142, 'completed', null, 'Caller asked about teeth whitening prices and asked for a call back in the morning.'),
  (:'org', :'cl', 'demo-call-2-' || :'cl', 'sms_chat', '+61412000104', '+61730001234', now() - interval '2 days', now() - interval '2 days' + interval '3 minutes', 180, 'completed', null, 'Marcus confirmed his check-up on Thursday.'),
  (:'org', :'cl', 'demo-call-3-' || :'cl', 'call', '+61412000106', '+61730001234', now() - interval '3 days', now() - interval '3 days' + interval '95 seconds', 95, 'completed', 'resolved', 'Asked about parking.'),
  (:'org', :'cl', 'demo-call-4-' || :'cl', 'call', '+61412000102', '+61730001234',
     ((date_trunc('day', now() at time zone 'Australia/Brisbane') - interval '1 day' + interval '22 hours 30 minutes') at time zone 'Australia/Brisbane'),
     ((date_trunc('day', now() at time zone 'Australia/Brisbane') - interval '1 day' + interval '22 hours 34 minutes') at time zone 'Australia/Brisbane'), 210, 'completed', null, 'Late caller booked a new patient check-up.'),
  (:'org', :'cl', 'demo-call-5-' || :'cl', 'call', '+61412000109', '+61730001234', now() - interval '20 days', now() - interval '20 days' + interval '3 minutes', 173, 'completed', 'lead_captured', 'Enquired about Invisalign.'),
  (:'org', :'cl', 'demo-call-6-' || :'cl', 'call', '+61412000177', '+61730001234', now() - interval '60 days', now() - interval '60 days' + interval '2 minutes', 120, 'completed', 'resolved', 'Old call: opening hours question.'),
  (:'org', :'cl', 'demo-call-7-' || :'cl', 'web', null, null, now() - interval '1 hour', now() - interval '58 minutes', 60, 'completed', null, 'Browser test call (hidden).');

-- Call-backs and bookings. The first two match calls 1 and 4 by phone and time.
insert into booking_requests (client_id, data) values
  (:'cl', jsonb_build_object('id','req-cb-1','kind','callback','at', to_jsonb(now() - interval '24 minutes'),'channel','call','name','Isabella Rossi','phone','0412 000 111','service','Whitening enquiry','start','Mornings','status','saved','note','Prefers mornings')),
  (:'cl', jsonb_build_object('id','req-bk-1','kind','booking','at', to_jsonb(((date_trunc('day', now() at time zone 'Australia/Brisbane') - interval '1 day' + interval '22 hours 32 minutes') at time zone 'Australia/Brisbane')),'channel','call','name','Grace Lee','phone','+61412000102','service','New patient check-up','start', to_jsonb(now() + interval '2 days'),'status','booked','note','')),
  (:'cl', jsonb_build_object('id','req-bk-2','kind','booking','at', to_jsonb(now() - interval '10 days'),'channel','sms','name','Oliver Smith','phone','+61412000150','service','Clean and scale','start', to_jsonb(now() - interval '5 days'),'status','booked','note','')),
  (:'cl', jsonb_build_object('id','req-bk-3','kind','booking','at', to_jsonb(now() - interval '1 day'),'channel','call','name','Ava Brown','phone','+61412000151','service','Emergency appointment','start', to_jsonb(now() + interval '4 days'),'status','failed','note','That time was no longer free.')),
  (:'cl', jsonb_build_object('id','req-cb-2','kind','callback','at', to_jsonb(now() - interval '6 days'),'channel','call','name','Tom Reilly','phone','+61412000160','service','Invoice query','start','','status','saved','note','','stage','contacted'));

-- The built-in calendar: the entry for req-bk-1 (not shown twice) and one added straight to the calendar.
insert into calendar_events (id, client_id, starts_at, ends_at, title, details) values
  (gen_random_uuid(), :'cl', (select (data->>'start')::timestamptz from booking_requests where data->>'id' = 'req-bk-1'),
     (select (data->>'start')::timestamptz + interval '30 minutes' from booking_requests where data->>'id' = 'req-bk-1'), 'New patient check-up · Grace Lee', 'Phone: +61412000102'),
  (gen_random_uuid(), :'cl', now() + interval '1 day', now() + interval '1 day 30 minutes', 'Check-up · Noah Walker', 'Phone: +61412000170');
SQL
echo "READY client=$CL port=$PORT db=$DB dir=$E"
