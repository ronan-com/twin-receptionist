# Backing up your agency

Your agency's data (clients, receptionists, calls, bookings, settings) lives in the **Postgres** service in your Railway project. Nothing is backed up until you set it up. Pick one of the two routes below.

## Route 1: Railway volume backups (Pro plan)

Railway's own backups are in the Postgres service's **Backups** tab.

1. In Railway, open your project and click the **Postgres** service, then **Backups**.
2. Pick a schedule (you can pick more than one): daily (kept 6 days), weekly (kept 27 days) or monthly (kept 89 days). You can also make one by hand before a big change.
3. To restore: find the backup by its date, click **Restore**, then review the change under **Details** at the top of the project and click **Deploy**. Railway mounts a new volume from the backup and keeps the old one, unmounted. Everything since that backup is lost.

Good to know:
- **Plan:** Railway's documentation does not say which plans include volume backups. Railway support has said they need the **Pro** plan, and that Hobby workspaces can't create or restore them. If the Backups tab is greyed out or asks you to upgrade, use Route 2 or move to Pro.
- Backups are billed like volume storage. Wiping a volume deletes its backups. They can only be restored into the same project and environment.

## Route 2: your own copy of the database (works on any plan)

Do this weekly, and before any big change. You need `pg_dump` and `pg_restore` (they come with PostgreSQL 16 or newer, installed on your computer).

1. In Railway, open the **Postgres** service, then **Variables**, and copy `DATABASE_PUBLIC_URL`. If it is missing, open **Settings**, then **Networking**, and turn on the public TCP proxy first.
2. Run this, with your copied address in the quotes:

   ```
   pg_dump --format=custom --no-owner --file=agency-backup.dump "PASTE_DATABASE_PUBLIC_URL_HERE"
   ```
3. Check the file is not empty, and keep it somewhere other than your own laptop alone (a cloud drive or an external disk). It holds client details, so keep it private.

To restore from it, create an empty Postgres in the same project (or a new project), copy its public address, and run:

```
pg_restore --no-owner --clean --if-exists --dbname="PASTE_NEW_DATABASE_PUBLIC_URL_HERE" agency-backup.dump
```

Then point the app at it: on the app service's **Variables** tab, set `DATABASE_URL` to the new database's address, and deploy. Restoring replaces whatever is in that database, so never restore into one you want to keep.

## Also keep a copy of

- **`MAILBOX_KEY`** (the app service's **Variables** tab). Without it, saved mailbox and calendar logins in a restored database can't be read. Store it in your password manager, apart from the database copy.
- Your other variables (`PUBLIC_URL`, `FIRST_ADMIN_EMAIL`, provider keys). A private screenshot of the Variables tab is enough.

## What the dashboard exports

Several lists in the dashboard (for example calls, clients, leads and the audit log) can be downloaded as CSV files. That is handy for reports and records, but it is not a backup and can't restore your agency. There is no one-click full export, so use Route 1 or 2 for backups.

## Check it works

Once a quarter, restore a copy into a fresh, empty Postgres and open it. A backup you have never restored is a guess.
