// Changing a connected inbox between "Draft replies" and "Send automatically" without disconnecting.
// Uses the scratch database; the outgoing mail server check is stubbed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";

process.env.MAILBOX_KEY ??= Buffer.alloc(32, 7).toString("base64");
const { migrate, sql } = await import("./db");
const { insertClient } = await import("./store");
const { emailStatus, setEmailMode } = await import("./email");
const { seal } = await import("./secrets");

const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const client: Business = { id: crypto.randomUUID(), assistantId: "demo-" + crypto.randomUUID().slice(0, 8), settings: { ...blankSettings(), businessName: "Mail Test" }, instructions: "", createdAt: now, updatedAt: now };
let ready = true;
const connectedAt = "2026-01-02T03:04:05.000Z";
const connect = (mode: "draft" | "send") =>
  sql`insert into mailboxes (client_id, data) values (${client.id}, ${{ address: "hi@example.com", username: "hi@example.com", auth: "password", secret: seal("pw"), host: "imap.example.com", port: 993, smtpHost: "smtp.example.com", smtpPort: 465, mode, sentLog: [], connectedAt, lastCheckedAt: "", lastError: "", handled: ["x"], activity: [] } as any})
    on conflict (client_id) do update set data = excluded.data`;

beforeAll(async () => {
  try {
    await migrate();
    await sql`insert into orgs (id, name) values (${orgId}, 'email mode test')`;
    await insertClient(orgId, client);
  } catch (err) {
    ready = false;
    console.warn("[emailMode.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  if (ready) {
    await sql`delete from clients where org_id = ${orgId}`;
    await sql`delete from orgs where id = ${orgId}`;
  }
});

describe("email reply mode", () => {
  test("switches to sending after the outgoing server is checked, keeps the connection and what was already handled", async () => {
    if (!ready) return;
    await connect("draft");
    let checked = 0;
    const s = await setEmailMode(client.id, { mode: "send" }, async (box) => void (checked += box.smtpHost === "smtp.example.com" ? 1 : 0));
    expect(s).toMatchObject({ connected: true, mode: "send", address: "hi@example.com", connectedAt });
    expect(checked).toBe(1);
    const [row] = await sql`select data from mailboxes where client_id = ${client.id}`;
    expect(row.data.handled).toEqual(["x"]);
    expect(row.data.secret).toStartWith("v1.");
  });

  test("back to drafts needs no outgoing check", async () => {
    if (!ready) return;
    await connect("send");
    const s = await setEmailMode(client.id, { mode: "draft" }, async () => {
      throw new Error("should not be asked");
    });
    expect(s.mode).toBe("draft");
    expect((await emailStatus(client.id)).mode).toBe("draft");
  });

  test("if the outgoing server refuses, it stays on drafts and says why", async () => {
    if (!ready) return;
    await connect("draft");
    await expect(setEmailMode(client.id, { mode: "send" }, async () => {
      throw new Error("535 bad login");
    })).rejects.toThrow(/535 bad login/);
    expect((await emailStatus(client.id)).mode).toBe("draft");
  });

  test("needs a connected inbox and a valid choice", async () => {
    if (!ready) return;
    await sql`delete from mailboxes where client_id = ${client.id}`;
    await expect(setEmailMode(client.id, { mode: "send" }, async () => {})).rejects.toThrow(/Connect an inbox/);
    await connect("draft");
    await expect(setEmailMode(client.id, { mode: "maybe" }, async () => {})).rejects.toThrow(/drafts or send/);
    await expect(setEmailMode(client.id, null, async () => {})).rejects.toThrow();
  });
});
