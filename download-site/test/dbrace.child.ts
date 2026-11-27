// Child for dbrace.test.ts: opens site.db (and the ticket tables) the way the server and `admin.ts publish` do at start-up.
const { db } = await import("../lib");
const { ticketTables } = await import("../tickets");
db(); ticketTables();
const cols = (db().query("PRAGMA table_info(buyers)").all() as { name: string }[]).map((c) => c.name);
console.log("OPENED " + ["demo", "style", "source_link", "invited_at"].every((c) => cols.includes(c)));
