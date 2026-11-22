#!/bin/bash
# Runs ON the server (via SSM) for each Answered deploy. Never touches /opt/twin
# except adding its own site file to /opt/twin/sites and reloading Caddy.
set -euo pipefail
BUCKET=$1; KEY=$2; R=${3:-ap-southeast-2}
mkdir -p /opt/answered && cd /opt/answered
rm -rf src.new && mkdir src.new
aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" bundle.tgz
tar -xzf bundle.tgz -C src.new && rm bundle.tgz
rm -rf src.old; [ -d src ] && mv src src.old; mv src.new src
cp src/deploy/answered/docker-compose.yml .

get() { aws ssm get-parameter --region $R --name "$1" --with-decryption --query Parameter.Value --output text; }
DB_HOST=$(get /twinrecep/db-host)
DB_PASSWORD=$(get /twinrecep/db-password)
HOSTS=$(get /answered/site-hosts)

# Its own database on the shared RDS instance, created once.
docker run --rm -v /opt/twin/rds-ca.pem:/ca.pem:ro -e "U=postgres://twin:$DB_PASSWORD@$DB_HOST:5432/twin?sslmode=verify-full" \
  oven/bun:1.4.0 bun -e '
    import { SQL } from "bun"; import { readFileSync } from "node:fs";
    const s = new SQL(process.env.U, { tls: { ca: readFileSync("/ca.pem", "utf8"), rejectUnauthorized: true } });
    const r = await s`select 1 from pg_database where datname = ${"answered"}`;
    if (!r.length) { await s.unsafe("create database answered"); console.log("created database answered"); }
    await s.close();'

umask 077
{
  echo "DATABASE_URL=postgres://twin:$DB_PASSWORD@$DB_HOST:5432/answered?sslmode=verify-full"
  echo "NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem"
  echo "DATABASE_CA_FILE=/etc/ssl/rds-ca.pem"
  aws ssm get-parameters-by-path --region $R --path /answered/env/ --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text | sed -E "s#^/answered/env/([A-Z0-9_]+)\t#\1=#"
} > .env.new
mv .env.new .env

docker network inspect twin_default >/dev/null
docker compose --progress quiet up -d --build --remove-orphans
docker image prune -f >/dev/null

# Route its address through the main Caddy (https certificate is automatic).
umask 022
cat > /opt/twin/sites/answered.caddy <<CADDY
$HOSTS {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Frame-Options DENY
		-Server
	}
	reverse_proxy answered-app:8791
}
CADDY
docker exec twin-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' answered-app 2>/dev/null || true)
  [ "$s" = healthy ] && { echo "answered healthy"; docker compose ps; exit 0; }
  sleep 3
done
echo "answered did not become healthy"; docker compose ps; docker compose logs --tail 80 app; exit 1
