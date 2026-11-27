---
id: registrar-dns-records
title: Add the records yourself
time: 10 minutes, then minutes to a few hours
cost: Free
link: https://www.godaddy.com/help/add-an-a-record-19238
checked: 28 Nov 2026
---
1. Open your domain's **DNS** page where you bought it. On GoDaddy: **My Products > your domain > DNS**. On Cloudflare: **DNS > Records**.
2. Click **Add** (or **Add record**) and pick the **Type** shown on the setup page: usually **CNAME** for `app` and **TXT** to prove the domain is yours.
3. In **Name** (or **Host**) type only the short part, like `app`. Don't add your domain on the end. A name like `_railway-verify.app` is fine as shown.
4. In **Value** (or **Points to**) paste the value from the setup page. Leave **TTL** on the default.
5. On Cloudflare, set the **Proxy status** to **DNS only** (grey cloud) for every record.
6. Repeat for each record, then press **Check now**. Each one ticks green when found. Allow a few minutes, sometimes a few hours. Railway then issues the https certificate, usually within an hour.

## Common problems
- **A record stays red.** Compare Name and Value letter by letter. The most common mistake is typing the whole address in **Name**. Some TXT values need no quote marks.
- **"Record already exists".** An old `app` record is in the way. Delete it, or edit it to the new value. A CNAME can't sit next to any other record with the same name.
- **Using the bare domain (no `app`).** A CNAME isn't allowed on the bare domain at GoDaddy and some others. Use `app.yourbusiness.com`.
- **Orange cloud on Cloudflare.** Turn it grey. Proxying can stop Railway verifying and cause "too many redirects".
- **Page says "not secure" or 404 for a while.** The certificate isn't issued yet. Wait up to an hour. A missing TXT record also gives a 404.
- **Changes take long.** DNS can take up to 72 hours to spread. Try a private window or another network.
