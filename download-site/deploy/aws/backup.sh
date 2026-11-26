#!/bin/bash
# Nightly (cron, installed by remote-deploy.sh): a consistent copy of the setup site's
# database to S3, kept 30 days there (and 3 days on the server).
set -euo pipefail
. /opt/setupsite/backup.env
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker exec setup-site bun admin.ts backup "/data/backups/site-$STAMP.db"
docker cp "setup-site:/data/backups/site-$STAMP.db" "/tmp/setupsite-$STAMP.db"
gzip -f "/tmp/setupsite-$STAMP.db"
aws s3 cp --only-show-errors --sse AES256 "/tmp/setupsite-$STAMP.db.gz" "s3://$BUCKET/setupsite-backups/site-$STAMP.db.gz"
rm -f "/tmp/setupsite-$STAMP.db.gz"
docker exec setup-site find /data/backups -name 'site-*.db' -mtime +3 -delete
# Older copies in S3: delete after 30 days.
cutoff=$(date -u -d '30 days ago' +%Y%m%dT%H%M%SZ)
aws s3 ls "s3://$BUCKET/setupsite-backups/" | awk '{print $4}' | while read -r k; do
  t=${k#site-}; t=${t%.db.gz}
  [[ $t < $cutoff ]] && aws s3 rm --only-show-errors "s3://$BUCKET/setupsite-backups/$k"
done
echo "$(date -u +%FT%TZ) backed up site-$STAMP"
