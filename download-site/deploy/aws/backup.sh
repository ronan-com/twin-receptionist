#!/bin/bash
# Nightly (systemd chloe-setup-backup.timer, installed by remote-deploy.sh): a consistent copy of
# the setup site's database (SQLite VACUUM INTO, safe while running), checked, gzipped, kept 14
# days in /opt/setupsite/backups and copied to s3://$BUCKET/$PREFIX/ (the server's role may write
# under backups/* only; it can't list or delete there, so S3 copies are pruned by a lifecycle rule
# if one is added). The copies hold buyers' encrypted keys; SETUP_SECRET_KEY lives only in SSM.
set -euo pipefail
. /opt/setupsite/backup.env
PREFIX=${PREFIX:-backups/setup-site}
DIR=/opt/setupsite/backups
umask 077
mkdir -p "$DIR" && chmod 700 "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
IN=/data/backups/site-$STAMP.db
docker exec setup-site bun admin.ts backup "$IN" >/dev/null
ok=$(docker exec setup-site bun -e 'const {Database}=require("bun:sqlite"); const d=new Database(process.argv[1],{readonly:true}); console.log(Object.values(d.query("PRAGMA integrity_check").get())[0])' "$IN")
[ "$ok" = ok ] || { echo "integrity check failed: $ok"; exit 1; }
docker cp "setup-site:$IN" "$DIR/site-$STAMP.db"
docker exec setup-site rm -f "$IN"
gzip -f "$DIR/site-$STAMP.db"
chmod 600 "$DIR/site-$STAMP.db.gz"
find "$DIR" -name 'site-*.db.gz' -mtime +14 -delete
aws s3 cp --only-show-errors --sse AES256 --region "$R" "$DIR/site-$STAMP.db.gz" "s3://$BUCKET/$PREFIX/site-$STAMP.db.gz"
echo "$(date -u +%FT%TZ) backed up site-$STAMP.db.gz ($(stat -c %s "$DIR/site-$STAMP.db.gz") bytes) to $DIR and s3://$BUCKET/$PREFIX/"
