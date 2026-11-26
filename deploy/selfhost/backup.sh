#!/usr/bin/env bash
# Dumps the database to backups/<prefix>-YYYYmmdd-HHMMSS.dump (pg_dump custom format)
# and deletes dumps older than 14 days. Run nightly by the receptionist-backup timer.
#   sudo bash backup.sh            -> backups/receptionist-<time>.dump
#   sudo bash backup.sh pre-update -> backups/pre-update-<time>.dump
# Prints the path of the new file on the last line.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
PREFIX=${1:-receptionist}
[[ $PREFIX =~ ^[a-z0-9-]+$ ]] || { echo "backup: bad name '$PREFIX'" >&2; exit 2; }
[ -f "$RUN/compose.env" ] || { echo "backup: run install.sh first" >&2; exit 1; }
[ -n "$(cid db)" ] || { echo "backup: the database container is not running" >&2; exit 1; }

umask 077
mkdir -p "$BACKUPS"; chmod 700 "$BACKUPS"
FILE="$BACKUPS/$PREFIX-$(date -u +%Y%m%d-%H%M%S).dump"
dc exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner > "$FILE.part"
[ -s "$FILE.part" ] || { rm -f "$FILE.part"; echo "backup: pg_dump wrote nothing" >&2; exit 1; }
mv "$FILE.part" "$FILE"

# Keep 14 days (every kind of dump in the folder).
find "$BACKUPS" -maxdepth 1 -type f -name '*.dump' -mtime +13 -delete
find "$BACKUPS" -maxdepth 1 -type f -name '*.part' -mmin +240 -delete
echo "backup: $(du -h "$FILE" | cut -f1) written"
echo "$FILE"
