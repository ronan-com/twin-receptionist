#!/bin/bash
# Runs ON the AWS server (through SSM) for each setup-site deploy. Touches only /opt/setupsite,
# its own container/volume (setup-site, setupsite_setup-data), the site file
# /opt/twin/sites/setupsite.caddy, a Caddy reload, and the chloe-setup-backup systemd timer.
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

# Settings: the /setupsite/env/<NAME> parameters listed here (DEMO_* turn on admin's "Start a test run"), plus the ones this script owns.
# Fetched by name (10 per call): the server's role can't list /setupsite/env/ by path.
# Values are single-quoted so compose takes "$" (password hashes) and "#" literally.
umask 077
names=(SETUP_SECRET_KEY ADMIN_EMAILS ADMIN_PASSWORD_HASH SUPPORT_EMAIL SELLER_NAME PRODUCT_NAME SITE_SMTP_URL SITE_MAIL_FROM
  HOSTING PROVISION_URL LOOKUPS_PER_MINUTE REQUESTS_PER_MINUTE CHECKS_PER_10_MIN TEST_EMAILS_PER_HOUR SECRETS_IDLE_DAYS DNS_SERVERS
  DEMO_APP_URL DEMO_ADMIN_EMAIL DEMO_ADMIN_PASSWORD OPENROUTER_API_KEY SETUP_CHAT_MODEL
  ALERT_WEBHOOK_URL ALERT_EMAIL_TO)
names=("${names[@]/#//setupsite/env/}")
q="'"
for ((i = 0; i < ${#names[@]}; i += 10)); do
  aws ssm get-parameters --region "$R" --names "${names[@]:i:10}" --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text
done | sed -n -E -e "s/$q/\\\\$q/g" -e "s#^/setupsite/env/([A-Z0-9_]+)\t(.*)\$#\1=$q\2$q#p" > .env.new
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
echo "BUCKET=$BUCKET R=$R PREFIX=backups/setup-site" > /opt/setupsite/backup.env
# The server has no cron: a systemd timer (logs: journalctl -u chloe-setup-backup).
install -m 644 src/deploy/aws/chloe-setup-backup.service src/deploy/aws/chloe-setup-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now chloe-setup-backup.timer

docker compose ps
echo "setup-site healthy at https://$DOMAIN"
