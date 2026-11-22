#!/bin/bash
# Runs ON the server (via SSM) for each deploy: unpack the bundle, write .env
# from Parameter Store, rebuild and restart.
set -euo pipefail
BUCKET=$1; KEY=$2; R=${3:-ap-southeast-2}; P=twinrecep
cd /opt/twin
rm -rf src.new && mkdir src.new
aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" bundle.tgz
tar -xzf bundle.tgz -C src.new && rm bundle.tgz
rm -rf src.old; [ -d src ] && mv src src.old; mv src.new src
cp src/deploy/docker-compose.yml src/deploy/Caddyfile .
mkdir -p sites; [ -e sites/00-placeholder.caddy ] || echo '# placeholder so the import always matches' > sites/00-placeholder.caddy
[ -s rds-ca.pem ] || curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o rds-ca.pem

get() { aws ssm get-parameter --region $R --name "$1" --with-decryption --query Parameter.Value --output text; }
DB_HOST=$(get /$P/db-host)
DB_PASSWORD=$(get /$P/db-password)
umask 077
{
  echo "DATABASE_URL=postgres://twin:$DB_PASSWORD@$DB_HOST:5432/twin?sslmode=verify-full"
  echo "NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem"
  echo "DATABASE_CA_FILE=/etc/ssl/rds-ca.pem"
  echo "SITE_HOSTS=$(get /$P/site-hosts)"
  aws ssm get-parameters-by-path --region $R --path /$P/env/ --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text | sed -E "s#^/$P/env/([A-Z0-9_]+)\t#\1=#"
} > .env.new
mv .env.new .env

docker compose --progress quiet up -d --build --remove-orphans
docker volume rm twin_n8n-data >/dev/null 2>&1 || true
docker image prune -af >/dev/null
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)
  [ "$s" = healthy ] && { echo "app healthy"; docker compose ps; exit 0; }
  sleep 3
done
echo "app did not become healthy"; docker compose ps; docker compose logs --tail 80 app; exit 1
