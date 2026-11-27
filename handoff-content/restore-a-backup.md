# Restore a backup

Your dashboard backs itself up every day (Settings, Backups) and keeps the last 7 on its own volume. You can download one, or have it copied to your own storage. A restore only ever goes into an empty database, so it can never overwrite a live agency.

1. Get the file: Settings, Backups, "Download latest" (or take it from your off-site bucket, the `backups/` folder). It is called like `backup-20260101-020000.jsonl.gz`.
2. Make a new, empty database: a new Railway project from your setup link, or a fresh Postgres. Start the app once so it makes its tables, and do not sign up.
3. In that app's shell (`railway ssh`, or `docker exec` when self-hosted) run `bun server/restoreCli.ts /path/to/backup-....jsonl.gz`. It stops if there is any data in the database.
4. Restart the app and sign in with your usual login. Phone numbers and keys come back with the backup; point your domain at the new app if it has moved.
