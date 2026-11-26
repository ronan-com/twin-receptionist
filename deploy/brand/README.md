# Branded copies on our AWS server

For running a buyer's copy of the app ourselves (the first one is **Chloe**) until
they move to their own server. Each copy is set up the way the Answered copy is
(`deploy/answered/`), but one script serves every brand, keyed by a short slug.

## The one command

```bash
BRAND=chloe PRODUCT_NAME=Chloe HOST=chloe.example.com FIRST_ADMIN_EMAIL=owner@example.com \
  bash deploy/brand/deploy.sh
```

Run it again to ship new code or change a setting. Add `DRY_RUN=1` to see every AWS
and server step without sending anything.

| Variable | |
|---|---|
| `BRAND` | Slug: 2-20 lower-case letters or digits, starting with a letter. `twin`, `twinrecep`, `answered`, `postgres` (and a few database and server names) are refused. |
| `PRODUCT_NAME` | The name on the screens, emails and receptionists (`server/product.ts`). |
| `HOST` | The copy's address, no `https://`. `PUBLIC_URL` becomes `https://HOST`. |
| `FIRST_ADMIN_EMAIL` | Only this email can make the first (platform) account on the fresh database. |
| `SITE_HOSTS` | Optional. All addresses to serve, comma separated. Default `HOST`. |
| `OWN_PHONE_ACCOUNT` | Optional. `required` (default): each agency connects its own Telnyx key in Setup. `off`: new agencies run on the platform key. |
| `TELNYX_API_KEY` | Optional. A platform phone key for this copy. Stored once, never printed. See "Without a platform phone key". |

It ships the working folder as it is (uncommitted changes included), like the other deploy scripts.

## What it creates

| Where | What |
|---|---|
| Server `/opt/brands/<brand>/` | The code, `docker-compose.yml` (from this folder's template) and `.env` (mode 600) |
| Docker | Project `<brand>`, container `<brand>-app`, image `<brand>-app:latest`, volume `<brand>_app-data`, on the main stack's `twin_default` network |
| RDS `twinrecep-db` | Database `<brand>` (same `twin` login as the main app) |
| SSM | `/<brand>/site-hosts`, and `/<brand>/env/*`: `PRODUCT_NAME`, `PUBLIC_URL`, `FIRST_ADMIN_EMAIL`, `DIRECT_ORG_NAME` (`<Product> Direct`), `OWN_PHONE_ACCOUNT`, `MAILBOX_KEY` (made once, never replaced), `TELNYX_API_KEY` if given |
| IAM role `twinrecep-app` | Inline policy `brand-<brand>-params`: the server may read `/<brand>/*` |
| Caddy | `/opt/twin/sites/<brand>.caddy`, proxying to `<brand>-app:8791`; https certificates are automatic |
| S3 `twinrecep-deploy-<account>` | `bundles/<brand>-<time>.tgz`, `brand-remote-deploy/<brand>.sh` |

Every `/<brand>/env/<NAME>` becomes an environment variable on the next deploy, so add
`SMTP_URL`, `MAIL_FROM`, Google or Microsoft sign-in keys the same way as for the main app
(`deploy/AWS.md`), then run the command again.

## Before the first run (only a person can do these)

1. **AWS CLI** signed in to the account, with rights to SSM, S3, EC2 describe, IAM `PutRolePolicy`.
2. **The main app is deployed** on the server (the copy uses its Caddy, network and RDS certificate).
3. **DNS**: an A record for `HOST` pointing at the server's Elastic IP (13.211.218.61). The script
   warns if it doesn't resolve there yet. With no domain yet, `chloe.13-211-218-61.sslip.io` works at once.
4. **The first owner's email** for `FIRST_ADMIN_EMAIL`. That person signs up first at `https://HOST`.
5. **Phone**: with `OWN_PHONE_ACCOUNT=required`, each agency pastes its own Telnyx API key in Setup.
   A platform key (`TELNYX_API_KEY`) must come from whoever owns that Telnyx account.
6. **Email sending** (optional): `SMTP_URL` and `MAIL_FROM`, so invites and resets are actually sent.

The server is a t4g.small (2 GB). Every copy adds a container and a build; watch memory before adding more.

## Without a platform phone key

Agencies that connect their own key work normally. Anything that falls back to the platform key fails:

- The first account's own team, extra teams the platform admin makes for itself, the self-serve
  "Direct" team, the test lab, and (with `OWN_PHONE_ACCOUNT=off`) every new agency are marked
  "on the platform account". On those, voices, creating a receptionist and
  number searches fail with "no phone account connected yet". Connecting a key in that team's Setup fixes it.
- **Buy and connect** on a number request runs with no team, so it always fails with "TELNYX_API_KEY is not set".

## Moving a copy to the buyer's own server

Dump the `<brand>` database and copy `/<brand>/env/MAILBOX_KEY` with it. Saved mailbox logins
and every agency's Telnyx key are sealed with that key; a new one makes them unreadable.

## Removing a copy

On the server (`aws ssm start-session --region ap-southeast-2 --target <instance>`):

```bash
B=chloe
get() { aws ssm get-parameter --region ap-southeast-2 --name "$1" --with-decryption --query Parameter.Value --output text; }
export PGPASSWORD=$(get /twinrecep/db-password)
DB="host=$(get /twinrecep/db-host) user=twin sslmode=verify-full sslrootcert=/opt/twin/rds-ca.pem"
pg_dump "$DB dbname=$B" | gzip > /tmp/$B.sql.gz          # keep a copy first
aws s3 cp /tmp/$B.sql.gz s3://twinrecep-deploy-$(aws sts get-caller-identity --query Account --output text)/backups/
docker compose -f /opt/brands/$B/docker-compose.yml down -v   # -v deletes its data volume
rm -f /opt/twin/sites/$B.caddy
docker exec "$(docker ps -q --filter label=com.docker.compose.project=twin --filter label=com.docker.compose.service=caddy)" \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
psql "$DB dbname=twin" -c "drop database \"$B\""
rm -rf /opt/brands/$B /opt/brands/$B-remote-deploy.sh /tmp/$B.sql.gz
docker image rm $B-app:latest
```

From your computer:

```bash
B=chloe; R=ap-southeast-2
aws ssm delete-parameters --region $R --names $(aws ssm get-parameters-by-path --region $R --path /$B/ --recursive --query 'Parameters[].Name' --output text)
aws iam delete-role-policy --role-name twinrecep-app --policy-name brand-$B-params
```

Then remove the DNS record. `delete-parameters` takes at most 10 names per call; run it again if some remain.
