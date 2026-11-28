// Moving between the built-in calendar and Google keeps every booking: old ones still block their time while
// Google is connected, and ones made in Google are kept when it's disconnected. Google is a stand-in.
//   DATABASE_URL=postgres://.../scratch_db bun test server/calendarSwitch.db.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { migrate, sql } from "./db";
import { getClient, insertClient } from "./store";
import { busyTimes, createEvent, removeEvent } from "./calendars";
import { backToBuiltinCalendar, dashboardSignInStart, signInFinish } from "./connect";

const ENV = ["MAILBOX_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OAUTH_BROKER", "PUBLIC_URL"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;
const orgId = crypto.randomUUID();
const now = new Date().toISOString();
const client: Business = {
  id: crypto.randomUUID(), assistantId: "demo-x", settings: { ...blankSettings(), businessName: "Switch Co" }, instructions: "", phoneNumbers: [],
  booking: { provider: "builtin", token: "t", minutes: 30, enabled: true, createdAt: now } as Business["booking"], createdAt: now, updatedAt: now,
};
let ready = true;
beforeAll(async () => {
  Object.assign(process.env, { MAILBOX_KEY: Buffer.alloc(32, 3).toString("base64"), GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", OAUTH_BROKER: "", PUBLIC_URL: "https://app.acme.test" });
  try {
    await migrate();
    await sql`delete from app_settings where key = 'platform_oauth_google'`;
    await sql`insert into orgs (id, name) values (${orgId}, 'calendar switch test')`;
    await insertClient(orgId, client);
  } catch (err) {
    ready = false;
    console.warn("[calendarSwitch.db.test] no database, skipping:", (err as Error).message);
  }
}, 60000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  if (!ready) return;
  await sql`delete from booking_requests where client_id = ${client.id}`;
  await sql`delete from clients where id = ${client.id}`;
  await sql`delete from orgs where id = ${orgId}`;
});

describe("switching calendars", () => {
  test("to Google only after sign-in works, and back, without losing a booking", async () => {
    if (!ready) return;
    const t = (h: number) => Math.floor(Date.now() / 3_600_000) * 3_600_000 + (48 + h) * 3_600_000;
    const own = await createEvent(client, { start: t(0), end: t(0) + 1_800_000, title: "Old · Sam", description: "" });
    const url = await dashboardSignInStart("google", orgId, client, "/app/integrations");
    expect((await getClient(client.id))!.booking!.provider).toBe("builtin");
    let busy: { start: string; end: string }[] = [];
    globalThis.fetch = (async (input: any) => {
      const u = String(input);
      if (u.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600, id_token: `x.${Buffer.from(JSON.stringify({ email: "o@biz.test" })).toString("base64url")}.y` });
      if (u.endsWith("/freeBusy")) return Response.json({ calendars: { primary: { busy } } });
      throw new Error(`unexpected request ${u}`);
    }) as typeof fetch;
    const back = await signInFinish("google", new URLSearchParams({ state: new URL(url).searchParams.get("state")!, code: "c" }));
    expect(back).toBe("/app/integrations?calendar=1");
    const linked = (await getClient(client.id))!;
    expect(linked.booking!.provider).toBe("google");

    // The older built-in booking still blocks its time, next to Google's own, and is removed from our calendar.
    busy = [{ start: new Date(t(2)).toISOString(), end: new Date(t(3)).toISOString() }];
    expect((await busyTimes(linked, t(-1), t(5))).map((b) => b.start).sort()).toEqual([t(0), t(2)]);
    await removeEvent(linked, own);
    expect((await busyTimes(linked, t(-1), t(5))).map((b) => b.start)).toEqual([t(2)]);

    // A booking made in Google, then disconnected: kept, with its time taken.
    await sql`insert into booking_requests (client_id, data) values (${client.id}, ${{ id: "g1", kind: "booking", status: "booked", name: "Pat", phone: "+61400000000", service: "Consult", start: new Date(t(4)).toISOString(), eventId: "google-event-1" } as any})`;
    const after = await backToBuiltinCalendar(linked);
    expect(after.booking!.provider).toBe("builtin");
    expect((await busyTimes(after, t(-1), t(6))).map((b) => b.start)).toEqual([t(4)]);
    const [r] = await sql`select data from booking_requests where client_id = ${client.id} and data->>'id' = 'g1'`;
    expect(r.data.eventId).not.toBe("google-event-1");
    expect((await sql`select 1 from calendar_links where client_id = ${client.id}`).length).toBe(0);
  });
});
