#!/usr/bin/env bash
# Stands up (or updates) one separately branded copy of the app on the existing
# AWS server, the same way deploy/answered does for Answered. Does not touch the
# main Twin app or any other copy. Run from anywhere:
#
#   BRAND=chloe PRODUCT_NAME=Chloe HOST=chloe.example.com FIRST_ADMIN_EMAIL=owner@example.com \
#     bash deploy/brand/deploy.sh
#
# Optional:
#   SITE_HOSTS         addresses Caddy serves, comma separated (default: HOST)
#   OWN_PHONE_ACCOUNT  required (default: each agency connects its own Telnyx key) or off
#   TELNYX_API_KEY     a platform phone key for this copy; stored once, never printed
#   DRY_RUN=1          print every AWS and server step; no network or AWS calls
#   AWS_REGION         default ap-southeast-2
#
# Creates: container <brand>-app, database <brand> on the shared RDS, settings
# under SSM /<brand>/*, the Caddy file /opt/twin/sites/<brand>.caddy and a read
# grant for /<brand>/* on the server's role. See deploy/brand/README.md.
set -euo pipefail
export AWS_PAGER=""
R=${AWS_REGION:-ap-southeast-2}; P=twinrecep
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DRY=${DRY_RUN:-0}
die() { echo "[brand] $*" >&2; exit 1; }

# --- inputs ------------------------------------------------------------------
B=${BRAND:-}
[ -n "$B" ] || die "set BRAND, e.g. BRAND=chloe"
[[ $B =~ ^[a-z][a-z0-9]{1,19}$ ]] || die "BRAND must be 2-20 lower-case letters or digits, starting with a letter (got '$B')"
case $B in
  twin|twinrecep|answered|postgres|rdsadmin|template0|template1|caddy|brands)
    die "BRAND '$B' is taken by the main app, Answered or the database; pick another" ;;
esac
NAME=${PRODUCT_NAME:-}
NAME_RE="^[A-Za-z0-9][A-Za-z0-9 .&'-]{0,39}\$"
[[ $NAME =~ $NAME_RE ]] || die "set PRODUCT_NAME (1-40 letters, digits, spaces, . & ' -), e.g. PRODUCT_NAME=Chloe"
HOST=$(printf '%s' "${HOST:-}" | tr 'A-Z' 'a-z')
HOST_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
[[ $HOST =~ $HOST_RE ]] || die "set HOST to the copy's address without https://, e.g. HOST=chloe.example.com"
SITES=$(printf '%s' "${SITE_HOSTS:-$HOST}" | tr 'A-Z' 'a-z' | tr -d ' ')
for h in ${SITES//,/ }; do [[ $h =~ $HOST_RE ]] || die "SITE_HOSTS has a bad address: '$h'"; done
[[ ",$SITES," == *",$HOST,"* ]] || die "SITE_HOSTS must include HOST ($HOST)"
EMAIL=$(printf '%s' "${FIRST_ADMIN_EMAIL:-}" | tr 'A-Z' 'a-z')
[[ $EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "set FIRST_ADMIN_EMAIL to the email of the copy's first (platform) account"
OWN=${OWN_PHONE_ACCOUNT:-required}
case $OWN in required|off) ;; *) die "OWN_PHONE_ACCOUNT must be required or off" ;; esac
KEY_IN=${TELNYX_API_KEY:-}
case $KEY_IN in platform-fake*) die "TELNYX_API_KEY=platform-fake... is the local test key; leave it unset instead" ;; esac

# --- AWS helpers: in a dry run each prints its command and returns a stand-in --
show() { printf '  + aws %s\n' "$*" >&2; }
ask() { # ask <stand-in> <aws args...>: runs aws and prints its answer
  local fake=$1; shift
  if [ "$DRY" = 1 ]; then show "$@"; echo "$fake"; else aws "$@"; fi
}
do_aws() { if [ "$DRY" = 1 ]; then show "$@"; else aws "$@" >/dev/null; fi; }
exists() { # exists <name>: whether the SSM parameter is there (dry run: no)
  if [ "$DRY" = 1 ]; then show ssm get-parameter --region "$R" --name "$1"; return 1; fi
  aws ssm get-parameter --region "$R" --name "$1" >/dev/null 2>&1
}
put() { # put <name> <String|SecureString> <value> [secret]
  if [ "$DRY" = 1 ]; then
    local shown=$3; [ "${4:-}" = secret ] && shown='***'
    show ssm put-parameter --region "$R" --name "$1" --type "$2" --overwrite --value "'$shown'"
  else
    aws ssm put-parameter --region "$R" --name "$1" --type "$2" --overwrite --value "$3" >/dev/null
  fi
}

[ "$DRY" = 1 ] && echo "[brand] DRY RUN: nothing below is sent anywhere"
echo "[brand] $B: '$NAME' at https://$HOST (first account $EMAIL, own phone account: $OWN)"

ACCOUNT=$(ask 000000000000 sts get-caller-identity --query Account --output text)
BUCKET="$P-deploy-$ACCOUNT"
INSTANCE=$(ask i-00000000000000000 ec2 describe-instances --region "$R" \
  --filters Name=tag:Name,Values=$P-app Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
[ "$INSTANCE" != None ] && [ -n "$INSTANCE" ] || die "no running $P-app server found in $R"

# The address has to reach the server before Caddy can get a certificate.
IP=$(ask 203.0.113.10 ec2 describe-addresses --region "$R" --filters Name=tag:Name,Values=$P-app \
  --query 'Addresses[0].PublicIp' --output text)
if [ "$DRY" = 1 ]; then
  echo "  + (look up $SITES and warn unless each resolves to $IP)" >&2
else
  for h in ${SITES//,/ }; do
    getent ahostsv4 "$h" 2>/dev/null | awk '{print $1}' | grep -qx "$IP" \
      || echo "[brand] warning: $h doesn't point at $IP yet; https will fail until the DNS record is in" >&2
  done
fi

# --- settings: SSM /<brand>/* -------------------------------------------------
echo "[brand] settings under /$B/"
put "/$B/site-hosts" String "$SITES"
put "/$B/env/PRODUCT_NAME" String "$NAME"
put "/$B/env/PUBLIC_URL" String "https://$HOST"
put "/$B/env/FIRST_ADMIN_EMAIL" String "$EMAIL"
# Self-serve businesses land in a platform org; its default name says Answered (server/routes/signup.ts).
put "/$B/env/DIRECT_ORG_NAME" String "$NAME Direct"
if [ "$OWN" = required ]; then
  put "/$B/env/OWN_PHONE_ACCOUNT" String required
elif exists "/$B/env/OWN_PHONE_ACCOUNT"; then
  do_aws ssm delete-parameter --region "$R" --name "/$B/env/OWN_PHONE_ACCOUNT"
fi
# Encrypts saved mailbox logins and phone keys. Made once; changing it loses them.
if exists "/$B/env/MAILBOX_KEY"; then
  echo "[brand] MAILBOX_KEY kept"
else
  MK='***'; [ "$DRY" = 1 ] || MK=$(openssl rand -base64 32)
  put "/$B/env/MAILBOX_KEY" SecureString "$MK" secret
fi
if [ -n "$KEY_IN" ]; then
  if exists "/$B/env/TELNYX_API_KEY"; then
    echo "[brand] TELNYX_API_KEY already set; not replaced (change it with aws ssm put-parameter)"
  else
    put "/$B/env/TELNYX_API_KEY" SecureString "$KEY_IN" secret
  fi
fi

# --- the server may read /<brand>/* --------------------------------------------
# Its role only covers /twinrecep/* (deploy/aws/provision.sh). Add one inline
# policy per copy, so removing a copy removes exactly its grant.
POLICY="brand-$B-params"
if [ "$DRY" = 1 ] || ! aws iam get-role-policy --role-name "$P-app" --policy-name "$POLICY" >/dev/null 2>&1; then
  [ "$DRY" = 1 ] && show iam get-role-policy --role-name "$P-app" --policy-name "$POLICY"
  do_aws iam put-role-policy --role-name "$P-app" --policy-name "$POLICY" --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameter\",\"ssm:GetParametersByPath\"],\"Resource\":\"arn:aws:ssm:$R:$ACCOUNT:parameter/$B/*\"}]}"
  echo "[brand] server role may now read /$B/*; waiting for it to take effect"
  [ "$DRY" = 1 ] || sleep 15
fi

# --- bundle and deploy -----------------------------------------------------------
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BUNDLE="bundles/$B-$STAMP.tgz"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
EXCLUDES=(--exclude=node_modules --exclude=dist --exclude=./data --exclude=.env --exclude='*.log' --exclude=.git --exclude=.claude)
if [ "$DRY" = 1 ]; then
  echo "  + tar -czf bundle.tgz -C $ROOT ${EXCLUDES[*]} ." >&2
else
  tar -czf "$TMP/bundle.tgz" -C "$ROOT" "${EXCLUDES[@]}" .
fi
do_aws s3 cp --only-show-errors "$TMP/bundle.tgz" "s3://$BUCKET/$BUNDLE"
do_aws s3 cp --only-show-errors "$HERE/remote-deploy.sh" "s3://$BUCKET/brand-remote-deploy/$B.sh"
echo "[brand] bundle $STAMP uploaded; deploying $B to $INSTANCE"

REMOTE="/opt/brands/$B-remote-deploy.sh"
CMD=$(ask 00000000-0000-0000-0000-000000000000 ssm send-command --region "$R" --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript --timeout-seconds 1200 --comment "$B deploy $STAMP" \
  --parameters "commands=[\"mkdir -p /opt/brands\",\"aws s3 cp --only-show-errors s3://$BUCKET/brand-remote-deploy/$B.sh $REMOTE\",\"bash $REMOTE $B $BUCKET $BUNDLE $R\"],executionTimeout=[\"1200\"]" \
  --query Command.CommandId --output text)

if [ "$DRY" = 1 ]; then
  show ssm get-command-invocation --region "$R" --command-id "$CMD" --instance-id "$INSTANCE" "(every 10s until done)"
  echo "[brand] on the server, $REMOTE would:"
  DRY_RUN=1 bash "$HERE/remote-deploy.sh" "$B" "$BUCKET" "$BUNDLE" "$R"
  echo "[brand] DRY RUN done"
  exit 0
fi

while :; do
  sleep 10
  STATUS=$(aws ssm get-command-invocation --region "$R" --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case $STATUS in Pending|InProgress|Delayed) printf . ;; *) echo; break ;; esac
done
aws ssm get-command-invocation --region "$R" --command-id "$CMD" --instance-id "$INSTANCE" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text | tail -40
echo "[brand] $B $STATUS: https://$HOST"
[ "$STATUS" = Success ]
