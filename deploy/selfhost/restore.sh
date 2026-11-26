#!/usr/bin/env bash
# Replaces the database with a backup made by backup.sh.
#   sudo bash restore.sh backups/receptionist-20261126-033000.dump        (asks to confirm)
#   sudo bash restore.sh <file> --yes                                     (no prompt)
# Takes a safety backup first (backups/pre-restore-*.dump), stops the app, recreates
# the database from the file, and starts the app again. MAILBOX_KEY in secrets.env must
# be the one the backup was made with, or saved mailbox/calendar logins can't be read.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
FILE=${1:-}; YES=${2:-}
[ -n "$FILE" ] || { echo "usage: restore.sh <backup.dump> [--yes]" >&2; exit 2; }
[ -f "$FILE" ] || { echo "restore: no such file: $FILE" >&2; exit 2; }
FILE=$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")
[ -f "$RUN/compose.env" ] || { echo "restore: run install.sh first" >&2; exit 1; }
[ -n "$(cid db)" ] || { echo "restore: the database container is not running (./dc.sh up -d db)" >&2; exit 1; }

echo "==> Checking $FILE"
dc exec -T db pg_restore --list < "$FILE" > /dev/null || { echo "restore: not a pg_dump custom-format file" >&2; exit 1; }

if [ "$YES" != "--yes" ]; then
  [ -t 0 ] || { echo "restore: add --yes to run without a prompt" >&2; exit 2; }
  read -r -p "This replaces ALL current data with $(basename "$FILE"). Type 'restore' to go on: " ok
  [ "$ok" = restore ] || { echo "Cancelled."; exit 1; }
fi

echo "==> Safety backup of the current data"
SAFETY=$(bash "$ROOT/backup.sh" pre-restore | tail -n1)
echo "    $SAFETY"

echo "==> Stopping the app"
dc stop app

echo "==> Recreating the database from the backup"
dc exec -T db psql -q -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "drop database if exists $DB_NAME with (force)" \
  -c "create database $DB_NAME owner $DB_USER"
if ! dc exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error --single-transaction < "$FILE"; then
  echo "restore: FAILED. Put the previous data back with: sudo bash $ROOT/restore.sh $SAFETY --yes" >&2
  exit 1
fi

echo "==> Starting the app"
dc up -d app
if wait_healthy app 180; then
  echo "RESTORE OK $(basename "$FILE")"
else
  dc logs --tail 60 app
  echo "restore: the app did not become healthy after the restore" >&2
  exit 1
fi
