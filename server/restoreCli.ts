// Restore a backup into an EMPTY database:  bun server/restoreCli.ts /path/to/backup-20260101-020000.jsonl.gz
// It makes the app's tables first (the normal migrations), refuses if there is any data, then loads the backup.
// Restore from a Railway shell (`railway ssh` / `railway run`) or a self-hosted container: see handoff-content/restore-a-backup.md.
import { existsSync } from "node:fs";
import { migrate, sql } from "./db";
import { restoreBackup, RestoreError } from "./backupRestore";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("Usage: bun server/restoreCli.ts <backup file .jsonl.gz>");
  process.exit(2);
}
try {
  await migrate();
  const r = await restoreBackup(file);
  console.log(`Restored ${r.rows} rows in ${r.tables} tables. Restart the app.`);
  await sql.close();
  process.exit(0);
} catch (e) {
  console.error(e instanceof RestoreError ? e.message : `Restore failed, nothing was changed: ${(e as Error).message}`);
  process.exit(1);
}
