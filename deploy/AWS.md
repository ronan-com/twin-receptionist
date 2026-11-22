# Where Twin Receptionist is deployed (AWS)

For Jesse and anyone who runs this. Production went live on 2026-11-20. Everything is in AWS account `323149985112`, region **ap-southeast-2 (Sydney)**, and every resource name starts with `twinrecep`.

## Live address

| | |
|---|---|
| **Now** | https://13-211-218-61.sslip.io (a free placeholder name that points at the server) |
| **Intended** | https://dashboard.twintechnologies.co (or `dashboard.twinagency.co`) |

To switch to the real domain, see [Changing the domain](#changing-the-domain).

## What is running

```
 Browser / Telnyx
        |  https
        v
  Elastic IP 13.211.218.61
        |
  EC2 t4g.small "twinrecep-app"  (Amazon Linux 2023, arm64, Docker)
   |- Caddy       ports 80/443, gets and renews https certificates (Let's Encrypt)
   '- app         Bun server + the built dashboard, port 8791 (internal only)
        |  private network, TLS
        v
  RDS Postgres 16  "twinrecep-db"  (db.t4g.micro, 20 GB, encrypted, private)
```

| Piece | Name | Notes |
|---|---|---|
| Server | EC2 `twinrecep-app`, instance `i-0a2c31a32dea60a59` | No SSH and no open admin port. Managed through SSM. |
| Database | RDS `twinrecep-db` | Not public. Only the app server can reach it. 7 days of automatic backups. Deletion protection is on. |
| Secrets | SSM Parameter Store `/twinrecep/...` | Never stored in git. Written to the server's `.env` on each deploy. |
| Deploy bucket | S3 `twinrecep-deploy-323149985112` | Holds the code bundles that deploys upload. |
| Server role | IAM `twinrecep-app` | Lets the server read its secrets and the bundle, and be managed by SSM. |
| Security groups | `twinrecep-app` (web only), `twinrecep-db` (app server only) | |

Other `twin-*` servers in this AWS account belong to other projects. Don't change them.

## How it works for users

- The platform team (Ronan, Jesse) signs in and uses **Agencies** to invite agencies.
- Each agency gets its own dashboard and brings its own clients and team. Agencies only ever see their own data.
- Every receptionist, call and phone number runs on **our** Telnyx account (the key in `/twinrecep/env/TELNYX_API_KEY`). Telnyx calls back into this server at `PUBLIC_URL/hooks/...` for booking tools.

## Settings (SSM Parameter Store)

Look at names with `aws ssm get-parameters-by-path --region ap-southeast-2 --path /twinrecep/ --recursive --query 'Parameters[].Name'`.

| Name | What it is |
|---|---|
| `/twinrecep/db-host`, `/twinrecep/db-password` | The database address and password |
| `/twinrecep/site-hosts` | Domains Caddy gets certificates for (comma separated) |
| `/twinrecep/env/PUBLIC_URL` | The https address the app tells Telnyx and puts in email links |
| `/twinrecep/env/TELNYX_API_KEY` | Our Telnyx key |
| `/twinrecep/env/MAILBOX_KEY` | Encrypts saved mailbox logins. **Never change or lose it.** |

Anything else under `/twinrecep/env/<NAME>` becomes an environment variable of the same name on the next deploy. Useful ones, not set yet:

- `SMTP_URL` and `MAIL_FROM`: so invites, password resets and booking emails are actually sent.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`: one-click Google and Microsoft sign-in.

Add or change one with:

```bash
aws ssm put-parameter --region ap-southeast-2 --name /twinrecep/env/SMTP_URL \
  --type SecureString --overwrite --value 'smtps://user:pass@smtp.example.com:465'
bash deploy/aws/deploy.sh   # applies it
```

## Deploying a change

You need the AWS CLI signed in to this account.

```bash
cd twin-receptionist
bash deploy/aws/deploy.sh
```

This bundles the code, uploads it to S3, and tells the server (through SSM) to rebuild and restart. It prints `app healthy` and `[deploy] Success` when done, in about a minute. The database updates itself on start: new files in `server/migrations/` run once.

Run **one** app instance only. The mail checker and booking locks live in the process.

## Looking at the server

No SSH. Use SSM:

```bash
# Open a shell on the server
aws ssm start-session --region ap-southeast-2 --target i-0a2c31a32dea60a59

# On the server
cd /opt/twin
docker compose ps                  # both containers should be Up (app: healthy)
docker compose logs --tail 100 app
docker compose logs --tail 50 caddy
```

Quick health check from anywhere: `curl https://13-211-218-61.sslip.io/api/health` should return `{"ok":true}`.

## Changing the domain

1. In GoDaddy (DNS for the domain), add an **A record**: Name `dashboard`, Value `13.211.218.61`, TTL 600. Leave the root `@` record alone.
2. Add the new name to `/twinrecep/site-hosts` (comma separated, keep the old one until the new one works).
3. Set `/twinrecep/env/PUBLIC_URL` to `https://dashboard.<domain>`.
4. Run `bash deploy/aws/deploy.sh`. On start, every receptionist's booking tools are re-pointed at the new address.

Do the DNS step first: https certificates can't be issued until the name points at the server.

## Setting it up again from scratch

`bash deploy/aws/provision.sh` creates all of the above and is safe to re-run (it skips anything that exists). It needs the AWS CLI signed in with permission to create EC2, RDS, IAM, S3 and SSM resources. Then put the secrets in SSM and run `deploy.sh`.

## Costs and cautions

- Rough running cost: the t4g.small server, db.t4g.micro database, storage and one Elastic IP. Telnyx usage (calls, numbers, texts) is billed separately to our Telnyx account.
- There are no per-agency spend limits yet, so any agency admin can buy phone numbers on our Telnyx account.
- Deleting `twinrecep-db` is blocked by deletion protection on purpose.
