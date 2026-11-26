#!/bin/bash
# Runs ON the AWS server (through SSM) for each setup-site deploy. Touches only /opt/setupsite,
# its own container/volume (setup-site, setupsite_setup-data), the site file
# /opt/twin/sites/setupsite.caddy, a Caddy reload, and /etc/cron.d/setupsite-backup.
#   remote-deploy.sh <bucket> <bundle key> <region> <domain> [<app bundle key> <app version>]
set -euo pipefail
BUCKET=$1; KEY=$2; R=$3; DOMAIN=$4; APPKEY=${5:-}; APPVER=${6:-}
[[ $DOMAIN =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "bad domain: $DOMAIN"; exit 1; }
mkdir -p /opt/setupsite/incoming && cd /opt/setupsite
rm -rf src.new && mkdir src.new
aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" bundle.tgz
tar -xzf bundle.tgz -C src.new && rm bundle.tgz
rm -rf src.old; [ -d src ] && mv src src.old; mv src.new src
cp src/deploy/aws/docker-compose.yml .

# Settings: every /setupsite/env/<NAME> parameter, plus the ones this script owns.
umask 077
aws ssm get-parameters-by-path --region "$R" --path /setupsite/env/ --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text | sed -E "s#^/setupsite/env/([A-Z0-9_]+)\t#\1=#" > .env.new
grep -q '^SETUP_SECRET_KEY=.' .env.new || { echo "SSM /setupsite/env/SETUP_SECRET_KEY is missing: refusing to start without it"; rm -f .env.new; exit 1; }
# Test switches never reach production (the site would also refuse to start with them).
if grep -Eq '^(MOCK_[A-Z_]+|PREVIEW_JUMP|TEST_SITE|[A-Z]+_API_BASE|EXTRA_LISTEN)=' .env.new; then
  echo "SSM /setupsite/env/ holds a test-only setting (MOCK_*, PREVIEW_JUMP, TEST_SITE, *_API_BASE, EXTRA_LISTEN): remove it"; rm -f .env.new; exit 1
fi
sed -i -E '/^(SITE_URL|HOST|PORT|DATA_DIR|TRUST_PROXY)=/d' .env.new
echo "SITE_URL=https://$DOMAIN" >> .env.new
mv .env.new .env
umask 022

docker network inspect twin_default >/dev/null
docker compose --progress quiet up -d --build --remove-orphans

for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' setup-site 2>/dev/null || true)
  [ "$s" = healthy ] && break
  sleep 3
done
[ "$(docker inspect -f '{{.State.Health.Status}}' setup-site)" = healthy ] || { echo "setup-site did not become healthy"; docker compose ps; docker compose logs --tail 80 site; exit 1; }
if docker compose logs --tail 40 site 2>&1 | grep -q 'WARNING'; then echo "setup-site started with warnings:"; docker compose logs --tail 40 site 2>&1 | grep WARNING; fi

# Publish a new app bundle (what buyers' installs get), when one came with this deploy.
if [ -n "$APPKEY" ]; then
  f=selfhost-bundle-$APPVER.tgz
  aws s3 cp --only-show-errors "s3://$BUCKET/$APPKEY" "incoming/$f"
  chmod 644 "incoming/$f"
  docker exec setup-site bun admin.ts publish "/incoming/$f" "$APPVER"
fi

# Route the address through the main Caddy (https certificate is automatic).
sed "s/__DOMAIN__/$DOMAIN/" src/deploy/aws/setupsite.caddy.tmpl > /opt/twin/sites/setupsite.caddy
docker exec twin-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

# Nightly backup of site.db (SQLite VACUUM INTO, safe while running) to S3. The copies hold
# buyers' encrypted keys; SETUP_SECRET_KEY lives only in SSM, never next to them.
install -m 755 src/deploy/aws/backup.sh /opt/setupsite/backup.sh
echo "BUCKET=$BUCKET R=$R" > /opt/setupsite/backup.env
echo "40 3 * * * root /bin/bash /opt/setupsite/backup.sh >> /var/log/setupsite-backup.log 2>&1" > /etc/cron.d/setupsite-backup
chmod 644 /etc/cron.d/setupsite-backup

docker compose ps
echo "setup-site healthy at https://$DOMAIN"
