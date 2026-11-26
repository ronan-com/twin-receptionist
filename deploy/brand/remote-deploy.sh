#!/bin/bash
# Runs ON the server (via SSM) for each deploy of one branded copy. Lives in
# /opt/brands/<brand>. Never touches /opt/twin except adding its own site file
# to /opt/twin/sites and reloading the main Caddy.
#
#   remote-deploy.sh <brand> <bucket> <bundle-key> [region]
#
# DRY_RUN=1 prints every step instead of doing it (deploy.sh runs it that way
# on your computer so you can see what the server would do).
set -euo pipefail
B=${1:?brand}; BUCKET=${2:?bucket}; KEY=${3:?bundle key}; R=${4:-ap-southeast-2}
DRY=${DRY_RUN:-0}
DIR=/opt/brands/$B
SITES=/opt/twin/sites
say() { echo "[$B] $*" >&2; }
die() { echo "[$B] $*" >&2; exit 1; }

# Same rule as deploy.sh: a short lower-case slug that can't land on anything else.
[[ $B =~ ^[a-z][a-z0-9]{1,19}$ ]] || die "brand must be 2-20 lower-case letters or digits, starting with a letter"
case $B in twin|twinrecep|answered|postgres|rdsadmin|template0|template1|caddy|brands) die "'$B' is taken";; esac

# Prints in a dry run, runs otherwise. Output goes to stderr so it also works inside $(...).
run() { if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&2; else "$@"; fi; }
get() {
  if [ "$DRY" = 1 ]; then printf '  + aws ssm get-parameter --region %s --name %s --with-decryption\n' "$R" "$1" >&2; echo "<$1>"; return; fi
  aws ssm get-parameter --region "$R" --name "$1" --with-decryption --query Parameter.Value --output text
}
# The rendered compose file sits in $DIR, so that is the project directory.
dc() { run docker compose -f "$DIR/docker-compose.yml" "$@"; }

say "unpack bundle into $DIR/src"
run mkdir -p "$DIR"
run rm -rf "$DIR/src.new"
run mkdir "$DIR/src.new"
run aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" "$DIR/bundle.tgz"
run tar -xzf "$DIR/bundle.tgz" -C "$DIR/src.new"
run rm -f "$DIR/bundle.tgz"
run rm -rf "$DIR/src.old"
if [ "$DRY" = 1 ] || [ -d "$DIR/src" ]; then run mv "$DIR/src" "$DIR/src.old"; fi
run mv "$DIR/src.new" "$DIR/src"
if [ "$DRY" = 1 ]; then
  say "write $DIR/docker-compose.yml from src/deploy/brand/docker-compose.yml with __BRAND__ -> $B"
else
  sed "s/__BRAND__/$B/g" "$DIR/src/deploy/brand/docker-compose.yml" > "$DIR/docker-compose.yml"
fi
[ "$DRY" = 1 ] || [ -s /opt/twin/rds-ca.pem ] || die "/opt/twin/rds-ca.pem is missing: deploy the main app once first"

DB_HOST=$(get /twinrecep/db-host)
DB_PASSWORD=$(get /twinrecep/db-password)
HOSTS=$(get "/$B/site-hosts")

# Caddy refuses two sites with the same address, and a failed reload would keep
# the old config but leave a broken file behind for the next main deploy.
say "check $HOSTS isn't served by the main app or another copy"
if [ "$DRY" != 1 ]; then
  words() { tr ', {' '\n\n\n\n' | grep -v '^$' || true; }
  for h in ${HOSTS//,/ }; do
    if grep '^SITE_HOSTS=' /opt/twin/.env | cut -d= -f2- | words | grep -qixF -- "$h"; then die "$h is the main app's address"; fi
    for f in "$SITES"/*.caddy; do
      if [ "$f" = "$SITES/$B.caddy" ] || [ ! -e "$f" ]; then continue; fi
      if head -1 "$f" | words | grep -qixF -- "$h"; then die "$h is already served by $f"; fi
    done
  done
fi

say "make database $B on the shared RDS (once)"
run docker run --rm -v /opt/twin/rds-ca.pem:/ca.pem:ro \
  -e "U=postgres://twin:$DB_PASSWORD@$DB_HOST:5432/twin?sslmode=verify-full" -e "N=$B" \
  oven/bun:1.4.0 bun -e '
    import { SQL } from "bun"; import { readFileSync } from "node:fs";
    const n = process.env.N;
    if (!/^[a-z][a-z0-9]{1,19}$/.test(n)) throw new Error("bad database name");
    const s = new SQL(process.env.U, { tls: { ca: readFileSync("/ca.pem", "utf8"), rejectUnauthorized: true } });
    const r = await s`select 1 from pg_database where datname = ${n}`;
    if (!r.length) { await s.unsafe(`create database "${n}"`); console.log(`created database ${n}`); }
    await s.close();'

say "write $DIR/.env from SSM /$B/env/*"
if [ "$DRY" = 1 ]; then
  printf '  + aws ssm get-parameters-by-path --region %s --path /%s/env/ --with-decryption\n' "$R" "$B" >&2
  printf '  + write %s/.env (mode 600): DATABASE_URL=postgres://twin:***@<db-host>:5432/%s, the RDS CA, and each /%s/env/<NAME> as NAME=value\n' "$DIR" "$B" "$B" >&2
else
  umask 077
  {
    echo "DATABASE_URL=postgres://twin:$DB_PASSWORD@$DB_HOST:5432/$B?sslmode=verify-full"
    echo "NODE_EXTRA_CA_CERTS=/etc/ssl/rds-ca.pem"
    echo "DATABASE_CA_FILE=/etc/ssl/rds-ca.pem"
    aws ssm get-parameters-by-path --region "$R" --path "/$B/env/" --with-decryption \
      --query 'Parameters[].[Name,Value]' --output text | sed -E "s#^/$B/env/([A-Z0-9_]+)\t#\1=#"
  } > "$DIR/.env.new"
  for need in PRODUCT_NAME PUBLIC_URL FIRST_ADMIN_EMAIL MAILBOX_KEY; do
    grep -q "^$need=." "$DIR/.env.new" || { rm -f "$DIR/.env.new"; die "/$B/env/$need is not set: run deploy/brand/deploy.sh from your computer"; }
  done
  # The fake phone provider is for local tests only: a real copy must never answer from sample data.
  if grep -qE '^(E2E_FAKE_PROVIDER=1|TELNYX_API_KEY=platform-fake)' "$DIR/.env.new"; then rm -f "$DIR/.env.new"; die "test-only phone settings found under /$B/env/"; fi
  mv "$DIR/.env.new" "$DIR/.env"
  umask 022
fi

say "build and start container $B-app"
run docker network inspect twin_default >/dev/null
dc --progress quiet up -d --build --remove-orphans
run docker image prune -f >/dev/null

# Route its address through the main Caddy (https certificate is automatic).
say "route $HOSTS to $B-app:8791 via $SITES/$B.caddy"
if [ "$DRY" = 1 ]; then
  CADDY="<twin caddy container>"
else
  CADDY=$(docker ps -q --filter label=com.docker.compose.project=twin --filter label=com.docker.compose.service=caddy | head -1)
  [ -n "$CADDY" ] || die "the main Caddy (project twin, service caddy) isn't running"
fi
if [ "$DRY" = 1 ]; then
  printf '  + write %s/%s.caddy: %s { encode, security headers, reverse_proxy %s-app:8791 }\n' "$SITES" "$B" "$HOSTS" "$B" >&2
else
  rm -f "$DIR/caddy.bak"
  if [ -e "$SITES/$B.caddy" ]; then cp "$SITES/$B.caddy" "$DIR/caddy.bak"; fi
  cat > "$SITES/$B.caddy" <<CADDY
$HOSTS {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Frame-Options DENY
		-Server
	}
	reverse_proxy $B-app:8791
}
CADDY
fi
if ! run docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
  # Put things back so the main site's next reload isn't blocked by this file.
  if [ -e "$DIR/caddy.bak" ]; then cp "$DIR/caddy.bak" "$SITES/$B.caddy"; else rm -f "$SITES/$B.caddy"; fi
  docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
  die "Caddy rejected $SITES/$B.caddy; put the previous version back"
fi

say "wait for $B-app to be healthy"
if [ "$DRY" = 1 ]; then
  run docker inspect -f '{{.State.Health.Status}}' "$B-app"
  exit 0
fi
for _ in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$B-app" 2>/dev/null || true)
  [ "$s" = healthy ] && { echo "$B healthy"; dc ps; exit 0; }
  sleep 3
done
echo "$B did not become healthy"
dc ps
dc logs --tail 80 app
exit 1
