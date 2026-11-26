#!/bin/bash
# Runs ON the server (via SSM) for each chloe-test deploy. Never touches /opt/twin
# except adding its own site file (chloetest.caddy) and reloading Caddy.
# SSM lives under /twinrecep/chloetest/ because the instance role can already read /twinrecep/*.
set -euo pipefail
BUCKET=$1; KEY=$2; R=${3:-ap-southeast-2}
mkdir -p /opt/chloe-test && cd /opt/chloe-test
rm -rf src.new && mkdir src.new
aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" bundle.tgz
tar -xzf bundle.tgz -C src.new && rm bundle.tgz
rm -rf src.old; [ -d src ] && mv src src.old; mv src.new src
cp src/deploy/chloe-test/docker-compose.yml .

get() { aws ssm get-parameter --region $R --name "$1" --with-decryption --query Parameter.Value --output text; }
DB_HOST=$(get /twinrecep/db-host)
ADMIN_DB_PASSWORD=$(get /twinrecep/db-password)
APP_DB_PASSWORD=$(get /twinrecep/chloetest/db-password)
HOSTS=$(get /twinrecep/chloetest/site-hosts)

# Its own database (chloe_test) and login role on the shared RDS instance, created once.
# Nothing else on the instance is touched. The role can only reach its own database.
docker run --rm -v /opt/twin/rds-ca.pem:/ca.pem:ro \
  -e "U=postgres://twin:$ADMIN_DB_PASSWORD@$DB_HOST:5432/twin?sslmode=verify-full" -e "P=$APP_DB_PASSWORD" \
  oven/bun:1.4.0 bun -e '
    import { SQL } from "bun"; import { readFileSync } from "node:fs";
    const s = new SQL(process.env.U, { tls: { ca: readFileSync("/ca.pem", "utf8"), rejectUnauthorized: true } });
    const lit = (v) => "\x27" + v.replaceAll("\x27", "\x27\x27") + "\x27";
    const role = await s`select 1 from pg_roles where rolname = ${"chloe_test"}`;
    if (!role.length) { await s.unsafe("create role chloe_test login password " + lit(process.env.P)); console.log("created role chloe_test"); }
    else await s.unsafe("alter role chloe_test login password " + lit(process.env.P));
    const db = await s`select 1 from pg_database where datname = ${"chloe_test"}`;
    if (!db.length) {
      await s.unsafe("grant chloe_test to twin");
      await s.unsafe("create database chloe_test owner chloe_test");
      await s.unsafe("revoke connect on database chloe_test from public");
      console.log("created database chloe_test");
    }
    await s.close();'

umask 077
{
  echo "DATABASE_URL=postgres://chloe_test:$APP_DB_PASSWORD@$DB_HOST:5432/chloe_test?sslmode=verify-full"
  echo "NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem"
  echo "DATABASE_CA_FILE=/etc/ssl/rds-ca.pem"
  aws ssm get-parameters-by-path --region $R --path /twinrecep/chloetest/env/ --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text | sed -E "s#^/twinrecep/chloetest/env/([A-Z0-9_]+)\t#\1=#"
} > .env.new
mv .env.new .env

docker network inspect twin_default >/dev/null
docker compose --progress quiet up -d --build --remove-orphans
docker image prune -f >/dev/null

# Route its address through the main Caddy (https certificate is automatic).
umask 022
cat > /opt/twin/sites/chloetest.caddy <<CADDY
$HOSTS {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Frame-Options DENY
		-Server
	}
	reverse_proxy chloe-test:8791
}
CADDY
# Reload Caddy only when the site file changed (avoids needless reloads / cert retries).
SUM=$(sha256sum /opt/twin/sites/chloetest.caddy | cut -d' ' -f1)
if [ "$SUM" != "$(cat /opt/chloe-test/caddy.sum 2>/dev/null || true)" ]; then
  docker exec twin-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "$SUM" > /opt/chloe-test/caddy.sum
fi

for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' chloe-test 2>/dev/null || true)
  [ "$s" = healthy ] && { echo "chloe-test healthy"; docker compose ps; exit 0; }
  sleep 3
done
echo "chloe-test did not become healthy"; docker compose ps; docker compose logs --tail 80 app; exit 1
