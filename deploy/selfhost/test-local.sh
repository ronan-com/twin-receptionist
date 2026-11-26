#!/usr/bin/env bash
# Local end-to-end test of the self-host bundle, no cloud and no root needed:
# builds the bundle, unpacks it into a scratch folder, runs install.sh in test mode
# (Caddy internal CA on 127.0.0.1:18080/18443, compose project "rtest"), then checks
# health, the page title, re-running install.sh, update.sh, and a backup/restore round trip.
# Tears everything down at the end (pass --keep to leave it running).
#   bash deploy/selfhost/test-local.sh [workdir] [--keep]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:-$(mktemp -d)}; KEEP=${2:-}
[ "$WORK" = --keep ] && { KEEP=--keep; WORK=$(mktemp -d); }
T="$WORK/opt-receptionist"
export SELFHOST_TEST=1 SELFHOST_PROJECT=rtest HTTP_PORT=127.0.0.1:18080 HTTPS_PORT=127.0.0.1:18443
DOMAIN=receptionist.localhost; NAME="Chloe Test Reception"
pass() { echo "PASS: $*"; }
die()  { echo "TEST FAILED: $*"; exit 1; }
cleanup() {
  [ "$KEEP" = --keep ] && { echo "left running in $T (bash $T/dc.sh down -v to remove)"; return; }
  [ -f "$T/run/compose.env" ] && bash "$T/dc.sh" down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm rtest-app:latest >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

bash "$HERE/make-bundle.sh"
rm -rf "$T"; mkdir -p "$T"
tar -xzf "$HERE/out/selfhost-bundle.tgz" -C "$T"
[ -f "$T/install.sh" ] || die "install.sh is not at the top of the bundle"

# 1. Missing DOMAIN must fail cleanly.
printf 'FIRST_ADMIN_EMAIL=owner@example.com\n' > "$T/.env"
out=$(bash "$T/install.sh" 2>&1) && die "install.sh succeeded without DOMAIN"
[[ $(tail -n1 <<<"$out") == "INSTALL FAILED: DOMAIN is empty"* ]] && pass "missing DOMAIN -> $(tail -n1 <<<"$out")" || die "unexpected: $(tail -n1 <<<"$out")"

# 2. Fresh install with fake values (platform-fake key = fake phone provider).
umask 077
cat > "$T/.env" <<EOF
PRODUCT_NAME=$NAME
DOMAIN=$DOMAIN
FIRST_ADMIN_EMAIL=owner@example.com
TELNYX_API_KEY=platform-fake-key-0000000000
OWN_PHONE_ACCOUNT=
SMTP_URL=
MAIL_FROM=Chloe <no-reply@example.com>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
EOF
umask 022
bash "$T/install.sh" | tee "$WORK/install1.log"
[ "$(tail -n1 "$WORK/install1.log")" = "INSTALL OK https://$DOMAIN" ] || die "first install"
pass "first install"
KEY1=$(grep '^MAILBOX_KEY=' "$T/secrets.env")

CURL=(curl -fsS --cacert "$T/run/test-ca.crt" --resolve "$DOMAIN:18443:127.0.0.1")
[ "$("${CURL[@]}" "https://$DOMAIN:18443/api/health")" = '{"ok":true}' ] && pass "https health over Caddy" || die "health"
title=$("${CURL[@]}" "https://$DOMAIN:18443/" | grep -o '<title>[^<]*</title>')
[ "$title" = "<title>$NAME</title>" ] && pass "page title: $title" || die "title is '$title'"
code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:18080:127.0.0.1" "http://$DOMAIN:18080/")
[ "$code" = 308 ] && pass "http redirects to https ($code)" || die "http gave $code"
for svc in db app; do
  [ -z "$(docker port "$(bash "$T/dc.sh" ps -q $svc)")" ] && pass "$svc publishes no ports" || die "$svc has published ports"
done

# 3. Data, backup, change, restore.
psql() { bash "$T/dc.sh" exec -T db psql -U receptionist -d receptionist -tAq -v ON_ERROR_STOP=1 "$@"; }
psql -c "create table selfhost_marker (v text); insert into selfhost_marker values ('before-backup')"
B=$(bash "$T/backup.sh" | tail -n1); [ -s "$B" ] && pass "backup written: $(basename "$B")" || die "backup"
psql -c "update selfhost_marker set v = 'after-backup'; delete from schema_migrations where name = (select min(name) from schema_migrations)"
bash "$T/restore.sh" "$B" --yes | tail -n1 | grep -q '^RESTORE OK' || die "restore"
[ "$(psql -c 'select v from selfhost_marker')" = before-backup ] && pass "restore brought the backup back" || die "marker"
[ "$("${CURL[@]}" "https://$DOMAIN:18443/api/health")" = '{"ok":true}' ] && pass "app healthy after restore" || die "health after restore"
ls "$T/backups" | grep -q '^pre-restore-' && pass "safety backup before restore" || die "no pre-restore backup"

# 4. Re-run install.sh (repair) and update.sh with the bundle: data and secrets survive.
bash "$T/update.sh" "$HERE/out/selfhost-bundle.tgz" | tee "$WORK/install2.log"
[ "$(tail -n1 "$WORK/install2.log")" = "INSTALL OK https://$DOMAIN" ] || die "update"
[ "$(grep '^MAILBOX_KEY=' "$T/secrets.env")" = "$KEY1" ] && pass "MAILBOX_KEY kept on update" || die "MAILBOX_KEY changed"
[ "$(psql -c 'select v from selfhost_marker')" = before-backup ] && pass "data kept on update" || die "data lost on update"
ls "$T/backups" | grep -q '^pre-update-' && pass "pre-update backup taken" || die "no pre-update backup"
echo "ALL SELF-HOST TESTS PASSED"
