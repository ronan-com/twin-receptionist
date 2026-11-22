#!/usr/bin/env bash
# Ships the current folder (branch: answered) to the isolated Answered app on the
# AWS server. Does not touch the main Twin app. Run from anywhere:
#   bash deploy/answered/deploy.sh
set -euo pipefail
export AWS_PAGER=""
R=${AWS_REGION:-ap-southeast-2}; P=twinrecep
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="$P-deploy-$ACCOUNT"
INSTANCE=$(aws ec2 describe-instances --region $R --filters Name=tag:Name,Values=$P-app Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

tar -czf "$TMP/bundle.tgz" -C "$ROOT" --exclude=node_modules --exclude=dist --exclude=./data --exclude=.env --exclude='*.log' --exclude=.git --exclude=.claude .
aws s3 cp --only-show-errors "$TMP/bundle.tgz" "s3://$BUCKET/bundles/answered-$STAMP.tgz"
aws s3 cp --only-show-errors "$ROOT/deploy/answered/remote-deploy.sh" "s3://$BUCKET/answered-remote-deploy.sh"
echo "[answered] bundle $STAMP uploaded; deploying to $INSTANCE"

CMD=$(aws ssm send-command --region $R --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --timeout-seconds 1200 --comment "answered deploy $STAMP" \
  --parameters "commands=[\"aws s3 cp --only-show-errors s3://$BUCKET/answered-remote-deploy.sh /opt/answered-remote-deploy.sh\",\"bash /opt/answered-remote-deploy.sh $BUCKET bundles/answered-$STAMP.tgz $R\"],executionTimeout=[\"1200\"]" \
  --query Command.CommandId --output text)
while :; do
  sleep 10
  STATUS=$(aws ssm get-command-invocation --region $R --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case $STATUS in Pending|InProgress|Delayed) printf . ;; *) echo; break ;; esac
done
aws ssm get-command-invocation --region $R --command-id "$CMD" --instance-id "$INSTANCE" --query '[StandardOutputContent,StandardErrorContent]' --output text | tail -40
echo "[answered] $STATUS"
[ "$STATUS" = Success ]
