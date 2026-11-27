#!/usr/bin/env bash
# Installs (or updates/repairs: safe to run again) the self-hosted stack on Ubuntu.
#   sudo bash /opt/receptionist/install.sh
# Reads /opt/receptionist/.env (DOMAIN, FIRST_ADMIN_EMAIL, PRODUCT_NAME, TELNYX_API_KEY, ...).
# Last line is "INSTALL OK https://<DOMAIN>" or "INSTALL FAILED: <reason>" (non-zero exit).
#
# Testing only (never set on a real server): SELFHOST_TEST=1 skips the system steps
# (root check, apt, swap, Docker install, firewall, backup timer, DNS check, image prune)
# and serves https from Caddy's internal CA; HTTP_PORT / HTTPS_PORT (e.g. 127.0.0.1:18443)
# and SELFHOST_PROJECT move the stack off the real ports and compose project name.
set -Eeuo pipefail
source "$(dirname "$0")/lib.sh"

STEP="starting"; N=0; TOTAL=10
log()  { echo "$*"; }
step() { N=$((N + 1)); STEP=$1; echo "==> [$N/$TOTAL] $1"; }
fail() { trap - ERR; echo "INSTALL FAILED: $*"; exit 1; }
trap 'fail "step \"$STEP\" stopped unexpectedly (line $LINENO, exit $?)"' ERR

TEST=${SELFHOST_TEST:-}
HTTP_PORT=${HTTP_PORT:-80}
HTTPS_PORT=${HTTPS_PORT:-443}
CADDY_TLS=${CADDY_TLS:-}
[ -n "$TEST" ] && [ -z "$CADDY_TLS" ] && CADDY_TLS="tls internal"
PORT_ONLY=${HTTPS_PORT##*:}

# ---------------------------------------------------------------------------
step "Checking settings in $ROOT/.env"
if [ -z "$TEST" ] && [ "$(id -u)" -ne 0 ]; then fail "run as root: sudo bash $ROOT/install.sh"; fi
[ -f "$ROOT/.env" ] || fail "$ROOT/.env is missing (it must hold DOMAIN, FIRST_ADMIN_EMAIL and the other settings)"
chmod 600 "$ROOT/.env" 2>/dev/null || true
[ -f "$ROOT/app-src.tgz" ] || fail "$ROOT/app-src.tgz is missing; unpack the whole bundle into $ROOT"
read_env "$ROOT/.env"
DOMAIN=${CONF[DOMAIN]:-}
DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}; DOMAIN=${DOMAIN,,}
[ -n "$DOMAIN" ] || fail "DOMAIN is empty in $ROOT/.env (e.g. DOMAIN=app.example.com)"
[[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || fail "DOMAIN '$DOMAIN' is not a valid host name"
ADMIN=${CONF[FIRST_ADMIN_EMAIL]:-}
[[ $ADMIN == ?*@?*.?* ]] || fail "FIRST_ADMIN_EMAIL is empty or not an email address"
if [ "${CONF[VOICE_PROVIDER]:-}" = vapi ]; then
  [ -n "${CONF[VAPI_API_KEY]:-}" ] || log "    note: VAPI_API_KEY is empty, so phone features stay off until it is set"
elif [ -z "${CONF[TELNYX_API_KEY]:-}" ] && [ "${CONF[OWN_PHONE_ACCOUNT]:-}" != required ]; then
  log "    note: TELNYX_API_KEY is empty, so phone features stay off until it is set (or set OWN_PHONE_ACCOUNT=required)"
fi
[ -n "${CONF[SMTP_URL]:-}" ] || log "    note: SMTP_URL is empty, so emails (invites, password resets) only go to the app log"
PUBLIC_URL="https://$DOMAIN"; [ "$PORT_ONLY" = 443 ] || PUBLIC_URL="$PUBLIC_URL:$PORT_ONLY"
log "    domain $DOMAIN, product name '${CONF[PRODUCT_NAME]:-AI Receptionist}', first admin $ADMIN"

# ---------------------------------------------------------------------------
step "Preparing the server (packages, swap, firewall)"
if [ -n "$TEST" ]; then
  log "    skipped (test mode)"
else
  export DEBIAN_FRONTEND=noninteractive
  # A fresh droplet runs unattended-upgrades on first boot; wait for its apt lock instead of failing.
  echo 'DPkg::Lock::Timeout "900";' > /etc/apt/apt.conf.d/90receptionist-lock-timeout
  need=()
  for p in curl:curl openssl:openssl ufw:ufw; do command -v "${p%%:*}" >/dev/null || need+=("${p#*:}"); done
  if [ ${#need[@]} -gt 0 ]; then
    log "    installing ${need[*]}"
    apt-get update -qq && apt-get install -y -qq "${need[@]}" ca-certificates >/dev/null
  fi
  # The app image build (Vite) needs about 2 GB of memory; add swap on smaller servers.
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$mem_mb" -lt 3500 ] && [ -z "$(swapon --noheadings 2>/dev/null)" ]; then
    log "    ${mem_mb} MB memory and no swap: adding a 2 GB swap file at /swapfile"
    [ -f /swapfile ] || { fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; }
    chmod 600 /swapfile; mkswap /swapfile >/dev/null; swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  free_gb=$(df -Pk "$ROOT" | awk 'NR==2 {print int($4/1048576)}')
  [ "$free_gb" -ge 4 ] || fail "only ${free_gb} GB of disk free in $ROOT; at least 4 GB is needed"
  # Firewall: ssh, http and https only. (Postgres and the app publish no ports at all.)
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  log "    firewall on: 22, 80, 443 open"
fi

# ---------------------------------------------------------------------------
step "Installing Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  log "    already installed: $(docker --version)"
elif [ -n "$TEST" ]; then
  fail "Docker with the compose plugin is needed"
else
  if ! command -v docker >/dev/null; then
    log "    installing Docker with the official script (get.docker.com)"
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh || fail "could not download the Docker installer (no internet?)"
    sh /tmp/get-docker.sh >/tmp/get-docker.log 2>&1 || { tail -n 30 /tmp/get-docker.log; fail "the Docker install did not finish (see /tmp/get-docker.log)"; }
  fi
  docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || fail "Docker is installed but 'docker compose' does not work"
  log "    $(docker --version)"
fi
docker info >/dev/null 2>&1 || fail "the Docker daemon is not running (systemctl status docker)"

# ---------------------------------------------------------------------------
step "Keeping the database password and MAILBOX_KEY"
umask 077
mkdir -p "$RUN" "$BACKUPS"; chmod 700 "$RUN" "$BACKUPS"
SECRETS="$ROOT/secrets.env"
CONF=(); read_env "$ROOT/.env"; ENV_MKEY=${CONF[MAILBOX_KEY]:-}
if [ ! -s "$SECRETS" ]; then
  if docker volume inspect "${PROJECT}_db-data" >/dev/null 2>&1; then
    fail "$SECRETS is missing but a database already exists. Put the old secrets.env back (it holds the database password and MAILBOX_KEY); making new ones would lock the app out of its data"
  fi
  PG_PW=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  # A MAILBOX_KEY already in .env (moving from another server) is kept; otherwise a new one.
  MKEY=$ENV_MKEY
  [ -n "$MKEY" ] || MKEY=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
  { echo "# Made by install.sh on $(date -u +%F). Keep a copy somewhere safe and NEVER change MAILBOX_KEY:"
    echo "# it encrypts saved mailbox and calendar logins in the database."
    echo "POSTGRES_PASSWORD=$PG_PW"
    echo "MAILBOX_KEY=$MKEY"; } > "$SECRETS"
  log "    made new ones in $SECRETS (keep a copy of this file off the server)"
else
  log "    kept the existing ones in $SECRETS"
fi
chmod 600 "$SECRETS"
CONF=(); read_env "$SECRETS"; PG_PW=${CONF[POSTGRES_PASSWORD]:-}; MKEY=${CONF[MAILBOX_KEY]:-}
[[ $PG_PW =~ ^[A-Za-z0-9]+$ ]] || fail "POSTGRES_PASSWORD in $SECRETS is missing or not alphanumeric"
[ "$(printf %s "$MKEY" | base64 -d 2>/dev/null | wc -c)" -eq 32 ] || fail "MAILBOX_KEY in $SECRETS is missing or not 32 bytes of base64"
[ -z "$ENV_MKEY" ] || [ "$ENV_MKEY" = "$MKEY" ] || log "    note: MAILBOX_KEY in .env differs from secrets.env; using secrets.env (it never changes)"
umask 022

# ---------------------------------------------------------------------------
step "Unpacking the app source"
rm -rf "$ROOT/app.new"; mkdir -p "$ROOT/app.new"
tar -xzf "$ROOT/app-src.tgz" -C "$ROOT/app.new" --no-same-owner || fail "app-src.tgz could not be unpacked"
[ -f "$ROOT/app.new/package.json" ] && [ -f "$ROOT/app.new/deploy/Dockerfile" ] || fail "app-src.tgz does not contain the app"
chmod -R u+rwX,go+rX,go-w "$ROOT/app.new"   # the image runs as a non-root user
rm -rf "$ROOT/app"; mv "$ROOT/app.new" "$ROOT/app"
log "    $(cat "$ROOT/VERSION" 2>/dev/null || echo 'version unknown')"

# Settings for the containers. The app gets every non-empty key from .env, plus the
# ones this script owns (they always win).
umask 077
CONF=(); read_env "$ROOT/.env"
{
  for k in $(printf '%s\n' "${!CONF[@]}" | sort); do
    case $k in DOMAIN|DATABASE_URL|DATABASE_CA_FILE|PUBLIC_URL|HOST|API_PORT|MAILBOX_KEY|POSTGRES_PASSWORD|NODE_EXTRA_CA_CERTS|SELFHOST_*) continue ;; esac
    [ -n "${CONF[$k]}" ] && env_line "$k" "${CONF[$k]}"
  done
  env_line PUBLIC_URL "$PUBLIC_URL"
  env_line DATABASE_URL "postgres://$DB_USER:$PG_PW@db:5432/$DB_NAME?sslmode=disable"
  env_line MAILBOX_KEY "$MKEY"
  env_line HOST 0.0.0.0
  env_line API_PORT 8791
} > "$RUN/app.env.new"
mv "$RUN/app.env.new" "$RUN/app.env"
{
  echo "DOMAIN=$DOMAIN"
  echo "POSTGRES_PASSWORD=$PG_PW"
  echo "HTTP_PORT=$HTTP_PORT"
  echo "HTTPS_PORT=$HTTPS_PORT"
  echo "CADDY_TLS=$CADDY_TLS"
  echo "APP_IMAGE=${PROJECT}-app"
} > "$RUN/compose.env.new"
mv "$RUN/compose.env.new" "$RUN/compose.env"
umask 022

# ---------------------------------------------------------------------------
step "Building the app image (3-8 minutes on a small server)"
if [ -n "$(cid db)" ] && [ -n "$(cid app)" ]; then
  log "    existing install: backing up the database first"
  if out=$(bash "$ROOT/backup.sh" pre-update 2>&1); then log "    $(echo "$out" | tail -n1)"; else log "    warning: pre-update backup failed: $(echo "$out" | tail -n1)"; fi
fi
dc --progress plain build app > "$RUN/build.log" 2>&1 &
pid=$!; s=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 5; s=$((s + 5)); [ $((s % 30)) -eq 0 ] && log "    still building (${s}s)"
done
if ! wait "$pid"; then
  tail -n 40 "$RUN/build.log"
  grep -qiE 'killed|out of memory|exit code: 137' "$RUN/build.log" && fail "the build ran out of memory; use a server with at least 2 GB of memory"
  fail "the app image did not build (full log: $RUN/build.log)"
fi
log "    built in ${s}s"

# ---------------------------------------------------------------------------
step "Starting the database and the app"
dc up -d --remove-orphans db app 2>&1 | sed 's/^/    /' || fail "docker compose could not start the database and app"
if ! wait_healthy db 120; then dc logs --tail 40 db; fail "Postgres did not start"; fi
if ! wait_healthy app 240; then dc logs --tail 60 app; fail "the app did not become healthy (logs above; ./dc.sh logs app)"; fi
log "    database and app are healthy"

# ---------------------------------------------------------------------------
step "Scheduling nightly backups"
if [ -n "$TEST" ]; then
  log "    skipped (test mode); backup.sh can be run by hand"
else
  cat > /etc/systemd/system/receptionist-backup.service <<EOF
[Unit]
Description=Nightly database backup ($ROOT/backups)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash $ROOT/backup.sh
EOF
  cat > /etc/systemd/system/receptionist-backup.timer <<EOF
[Unit]
Description=Nightly database backup at 03:30 server time

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now receptionist-backup.timer >/dev/null 2>&1
  log "    receptionist-backup.timer: every night at 03:30, kept 14 days in $BACKUPS"
fi

# ---------------------------------------------------------------------------
step "Checking that $DOMAIN points at this server"
if [ -n "$TEST" ] || [ "${SKIP_DNS_CHECK:-}" = 1 ]; then
  log "    skipped"
else
  MYIP=$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null \
      || curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 6 https://ifconfig.me 2>/dev/null || true)
  resolvectl flush-caches >/dev/null 2>&1 || true
  IPS=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  [ -n "$IPS" ] || fail "$DOMAIN does not resolve yet. Add a DNS A record: $DOMAIN -> ${MYIP:-the public IP of this server}, wait a few minutes, then run install.sh again (the app and database are already running)"
  if [ -n "$MYIP" ] && [[ " $IPS " != *" $MYIP "* ]]; then
    fail "$DOMAIN points at ${IPS% } but this server is $MYIP. Fix the DNS A record (no proxy), wait a few minutes, then run install.sh again (or set SKIP_DNS_CHECK=1 if a proxy is intended)"
  fi
  log "    $DOMAIN -> ${IPS% }"
fi

# ---------------------------------------------------------------------------
step "Starting https and waiting for the certificate"
dc up -d --remove-orphans 2>&1 | sed 's/^/    /' || fail "docker compose could not start Caddy (is something else using port 80 or 443?)"
dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
CURL=(curl -fsS --max-time 10 --resolve "$DOMAIN:$PORT_ONLY:127.0.0.1" -o /dev/null -w '%{http_code}')
s=0; ok=
while [ "$s" -lt 600 ]; do
  if [ -n "$TEST" ]; then
    # Trust Caddy's internal CA (tls internal) instead of skipping verification.
    dc exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$RUN/test-ca.crt" 2>/dev/null || true
    [ -s "$RUN/test-ca.crt" ] && "${CURL[@]}" --cacert "$RUN/test-ca.crt" "$PUBLIC_URL/api/health" >/dev/null 2>&1 && { ok=1; break; }
  else
    "${CURL[@]}" "$PUBLIC_URL/api/health" >/dev/null 2>&1 && { ok=1; break; }
  fi
  sleep 5; s=$((s + 5)); [ $((s % 30)) -eq 0 ] && log "    waiting for $PUBLIC_URL (${s}s)"
done
if [ -z "$ok" ]; then
  dc logs --tail 200 caddy 2>&1 | grep -iE 'error|challenge|acme' | tail -n 15 | cut -c1-400 || true
  fail "$PUBLIC_URL did not answer within 10 minutes. Usually DNS or ports 80/443 being blocked stops the Let's Encrypt certificate (Caddy log above); fix it and run install.sh again"
fi
log "    $PUBLIC_URL/api/health answers with a valid certificate"
[ -n "$TEST" ] || docker image prune -f >/dev/null 2>&1 || true

trap - ERR
echo "INSTALL OK https://$DOMAIN"
