#!/usr/bin/env bash
# Ships the setup site (download-site/) to the shared AWS server, as its own container
# (setup-site) behind the server's main Caddy. Modelled on deploy/answered/deploy.sh.
#   DOMAIN=setup.yourcompany.com bash download-site/deploy/aws/deploy.sh
# Optional:
#   DRY_RUN=1                       print every AWS step instead of doing it (no AWS calls at all)
#   ADMIN_EMAILS=a@x.com,b@x.com    saved to SSM /setupsite/env/ADMIN_EMAILS
#   ADMIN_PASSWORD_HASH='$argon2id$...'   from `bun download-site/admin.ts admin-hash`, saved to SSM
#   SUPPORT_EMAIL / SELLER_NAME / PRODUCT_NAME / SITE_SMTP_URL / SITE_MAIL_FROM   saved to SSM
#   OPENROUTER_API_KEY / SETUP_CHAT_MODEL   saved to SSM; turn on the "Need help?" chat (off without the key)
#   BUNDLE=path/selfhost-bundle.tgz VERSION=1.0.1   also publish this app bundle on the site
# Secrets live in SSM Parameter Store as SecureString under /setupsite/env/*. SETUP_SECRET_KEY
# is created once (random 32 bytes) and NEVER overwritten: changing it would lock every
# half-finished setup out of its stored keys.
# Before the first deploy: point DOMAIN's A record at the server (Caddy needs it for https).
set -euo pipefail
export AWS_PAGER=""
DOMAIN=${DOMAIN:?set DOMAIN, e.g. DOMAIN=setup.yourcompany.com}
DOMAIN=$(printf %s "$DOMAIN" | tr 'A-Z' 'a-z')
[[ $DOMAIN =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "DOMAIN must be a plain host name like setup.yourcompany.com"; exit 1; }
DRY=${DRY_RUN:-0}
R=${AWS_REGION:-ap-southeast-2}; P=twinrecep
SITE=$(cd "$(dirname "$0")/../.." && pwd)        # download-site/
REPO=$(cd "$SITE/.." && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

say() { echo "[setupsite] $*"; }
# Every AWS call goes through aws_: in DRY_RUN it prints the command (secret values masked) and does nothing.
aws_() {
  if [ "$DRY" = 1 ]; then
    local out=() a mask=0
    for a in "$@"; do if [ $mask = 1 ]; then out+=("'****'"); mask=0; else out+=("$a"); fi; [ "$a" = --value ] && mask=1; done
    echo "  DRY_RUN: aws ${out[*]}" >&2
    return 0
  fi
  aws "$@"
}

if [ "$DRY" = 1 ]; then ACCOUNT="<account>"; INSTANCE="<$P-app instance>"; else
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  INSTANCE=$(aws ec2 describe-instances --region "$R" --filters Name=tag:Name,Values=$P-app Name=instance-state-name,Values=running \
    --query 'Reservations[0].Instances[0].InstanceId' --output text)
  [ -n "$INSTANCE" ] && [ "$INSTANCE" != None ] || { echo "no running $P-app instance in $R"; exit 1; }
fi
BUCKET="$P-deploy-$ACCOUNT"
say "domain $DOMAIN, region $R, instance $INSTANCE, bucket $BUCKET${DRY:+ }$([ "$DRY" = 1 ] && echo '(DRY RUN: nothing is sent to AWS)')"

# ---- settings in SSM ----
put() { # name value
  aws_ ssm put-parameter --region "$R" --name "/setupsite/env/$1" --type SecureString --overwrite --value "$2" >/dev/null
  say "saved /setupsite/env/$1"
}
if [ "$DRY" = 1 ]; then
  say "would create /setupsite/env/SETUP_SECRET_KEY once (random 32 bytes) if it doesn't exist; never overwritten"
elif ! aws ssm get-parameter --region "$R" --name /setupsite/env/SETUP_SECRET_KEY >/dev/null 2>&1; then
  aws ssm put-parameter --region "$R" --name /setupsite/env/SETUP_SECRET_KEY --type SecureString --value "$(openssl rand -base64 32)" >/dev/null
  say "created /setupsite/env/SETUP_SECRET_KEY (keep a copy in the password manager)"
fi
[ -n "${ADMIN_EMAILS:-}" ] && put ADMIN_EMAILS "$ADMIN_EMAILS"
if [ -n "${ADMIN_PASSWORD_HASH:-}" ]; then
  [[ $ADMIN_PASSWORD_HASH == \$argon2* ]] || { echo "ADMIN_PASSWORD_HASH must come from: bun download-site/admin.ts admin-hash"; exit 1; }
  put ADMIN_PASSWORD_HASH "$ADMIN_PASSWORD_HASH"
fi
for k in SUPPORT_EMAIL SELLER_NAME PRODUCT_NAME SITE_SMTP_URL SITE_MAIL_FROM OPENROUTER_API_KEY SETUP_CHAT_MODEL; do
  [ -n "${!k:-}" ] && put "$k" "${!k}"
done
true

# ---- the site, with the how-tos and welcome email inside it ----
mkdir -p "$TMP/stage"
tar -C "$SITE" -cf - --exclude=./data --exclude=./out --exclude=./test --exclude=./test-shots --exclude=./mock --exclude=node_modules \
  --exclude=./deploy/.env --exclude=./deploy/incoming --exclude='*.log' . | tar -C "$TMP/stage" -xf -
mkdir -p "$TMP/stage/content"
cp -r "$REPO/handoff-content/providers" "$TMP/stage/content/"
cp "$REPO/handoff-content/welcome-email.md" "$TMP/stage/content/"
tar -czf "$TMP/site.tgz" -C "$TMP/stage" .
say "bundle: $(du -h "$TMP/site.tgz" | cut -f1) ($(ls "$TMP/stage/content/providers" | wc -l) how-tos)"
aws_ s3 cp --only-show-errors "$TMP/site.tgz" "s3://$BUCKET/bundles/setupsite-$STAMP.tgz"
aws_ s3 cp --only-show-errors "$SITE/deploy/aws/remote-deploy.sh" "s3://$BUCKET/setupsite-remote-deploy.sh"

APPKEY=""; APPVER=""
if [ -n "${BUNDLE:-}" ]; then
  APPVER=${VERSION:?set VERSION with BUNDLE}
  [[ $APPVER =~ ^[0-9A-Za-z.+-]{1,40}$ ]] || { echo "bad VERSION"; exit 1; }
  [ -f "$BUNDLE" ] || { echo "no such BUNDLE: $BUNDLE"; exit 1; }
  APPKEY="bundles/selfhost-bundle-$APPVER.tgz"
  aws_ s3 cp --only-show-errors "$BUNDLE" "s3://$BUCKET/$APPKEY"
  say "app bundle $APPVER will be published"
fi

# ---- run it on the server ----
ARGS="$BUCKET bundles/setupsite-$STAMP.tgz $R $DOMAIN $APPKEY $APPVER"
if [ "$DRY" = 1 ]; then
  say "would run on $INSTANCE (SSM AWS-RunShellScript):"
  echo "    aws s3 cp s3://$BUCKET/setupsite-remote-deploy.sh /opt/setupsite-remote-deploy.sh"
  echo "    bash /opt/setupsite-remote-deploy.sh $ARGS"
  say "DRY RUN done. Nothing was changed."
  exit 0
fi
CMD=$(aws ssm send-command --region "$R" --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --timeout-seconds 1500 --comment "setupsite deploy $STAMP" \
  --parameters "commands=[\"aws s3 cp --only-show-errors s3://$BUCKET/setupsite-remote-deploy.sh /opt/setupsite-remote-deploy.sh\",\"bash /opt/setupsite-remote-deploy.sh $ARGS\"],executionTimeout=[\"1500\"]" \
  --query Command.CommandId --output text)
while :; do
  sleep 10
  STATUS=$(aws ssm get-command-invocation --region "$R" --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case $STATUS in Pending|InProgress|Delayed) printf . ;; *) echo; break ;; esac
done
aws ssm get-command-invocation --region "$R" --command-id "$CMD" --instance-id "$INSTANCE" --query '[StandardOutputContent,StandardErrorContent]' --output text | tail -40
say "$STATUS"
[ "$STATUS" = Success ] && say "open https://$DOMAIN/admin (or make a sign-in link: docker exec setup-site bun admin.ts admin-link you@yourcompany.com, via SSM)"
[ "$STATUS" = Success ]
