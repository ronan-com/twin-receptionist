#!/usr/bin/env bash
# Release Chloe from GitHub, never from a laptop's working tree.
#   bash scripts/release-chloe.sh 1.0.6 "- what's new line 1\n- line 2"
# 1. Fresh clone of origin/own-phone-account (the Chloe release branch) into ~/.chloe-release/<version>.
# 2. Needs a green GitHub CI run (chloe-ci) for that exact commit; builds the app. LOCAL_TESTS=1 runs the tests here instead.
# 3. Builds the app bundle from that clean clone, deploys the setup site with it, saves release notes.
# 4. Tags the exact commit as chloe-v<version> on GitHub, so every live version maps to one commit.
# `main` is Twin production and is not touched.
set -euo pipefail
VERSION=${1:?usage: release-chloe.sh <version> [notes]}
NOTES=${2:-}
BRANCH=${CHLOE_BRANCH:-own-phone-account}
REMOTE=$(git -C "$(dirname "$0")/.." remote get-url origin)
WORK="$HOME/.chloe-release/$VERSION"
ENVFILE=${ENVFILE:-$HOME/aibiz/.env}   # test DB settings, same file the dev tests use

echo "[release] $VERSION from $BRANCH on GitHub"
rm -rf "$WORK"; mkdir -p "$WORK"
git clone -q --branch "$BRANCH" --single-branch "$REMOTE" "$WORK/repo"
cd "$WORK/repo"
COMMIT=$(git rev-parse --short HEAD)
if git ls-remote --tags origin "chloe-v$VERSION" | grep -q .; then echo "[release] tag chloe-v$VERSION already exists"; exit 1; fi
echo "[release] commit $COMMIT"

# Tests run on GitHub's servers (workflow chloe-ci), not on this machine. A release needs a GREEN run
# for this exact commit. Set LOCAL_TESTS=1 to run everything here instead (slow, and flaky when the laptop is busy).
bun install --silent >/dev/null
FULL=$(git rev-parse HEAD)
if [ "${LOCAL_TESTS:-0}" = "1" ]; then
  echo "[release] running tests locally"
  bunx tsc --noEmit
  bun run build >/dev/null
  bun test --env-file="$ENVFILE" server/ 2>&1 | tail -3
  (cd download-site && bun test 2>&1 | tail -3)
else
  echo "[release] waiting for GitHub CI on $COMMIT"
  RUN=""
  for i in $(seq 1 30); do
    RUN=$(gh run list --workflow chloe-ci --commit "$FULL" --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
    [ -n "$RUN" ] && break; sleep 10
  done
  [ -n "$RUN" ] || { echo "[release] no CI run for $COMMIT. Push it first (or LOCAL_TESTS=1)."; exit 1; }
  gh run watch "$RUN" --exit-status >/dev/null || { echo "[release] CI FAILED for $COMMIT: $(gh run view "$RUN" --json url -q .url)"; exit 1; }
  echo "[release] CI green: $(gh run view "$RUN" --json url -q .url)"
  bun run build >/dev/null   # the bundle needs dist/
fi

bash deploy/selfhost/make-bundle.sh | tail -1
DOMAIN=setup.chloeeai.co BUNDLE=deploy/selfhost/out/selfhost-bundle.tgz VERSION="$VERSION" bash download-site/deploy/aws/deploy.sh

if [ -n "$NOTES" ]; then
  ID=$(aws ec2 describe-instances --region ap-southeast-2 --filters Name=tag:Name,Values=twinrecep-app Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceId" --output text)
  B64=$(printf '%b' "$NOTES" | base64 -w0)
  PARAMS=$(V="$VERSION" B="$B64" python3 -c 'import json,os; print(json.dumps({"commands":["docker exec setup-site bun admin.ts notes "+os.environ["V"]+" \"$(echo "+os.environ["B"]+" | base64 -d)\" 2>&1 | tail -1"]}))')
  aws ssm send-command --region ap-southeast-2 --instance-ids "$ID" --document-name AWS-RunShellScript --parameters "$PARAMS" >/dev/null \
    || echo "[release] notes not saved; add them with: docker exec setup-site bun admin.ts notes $VERSION <text>"
fi

git tag -a "chloe-v$VERSION" -m "Chloe $VERSION" && git push -q origin "chloe-v$VERSION"
echo "[release] done: $VERSION = $COMMIT, tagged chloe-v$VERSION"
