---
id: registrar-dns-records
title: Add DNS records yourself
time: 10 minutes, then 15 minutes to a few hours to take effect
cost: Free
link: https://www.godaddy.com/help/add-an-a-record-19238
verified: 2026-11-26
sources: [https://www.godaddy.com/help/add-an-a-record-19238, https://www.godaddy.com/help/add-a-txt-record-19232, https://www.godaddy.com/help/add-an-mx-record-19234, https://www.godaddy.com/help/add-a-cname-record-19236, https://www.namecheap.com/support/knowledgebase/article.aspx/434/2237/how-do-i-set-up-host-records-for-a-domain/, https://www.crazydomains.com.au/help/article/manage-dns-records-in-account-manager, https://ventraip.com.au/support-centre/add-remove-or-manage-dns-records-within-vipcontrol/, https://support.squarespace.com/hc/en-us/articles/31120985010957-Add-DNS-records-for-email, https://support.squarespace.com/hc/en-us/articles/31119879125645-DNS-records-for-web-hosting, https://kb.porkbun.com/article/68-how-to-edit-dns-records, https://resend.com/docs/add-a-domain]
---
## What it's for
If you'd rather not move your DNS to Cloudflare, you add the records yourself where your DNS is managed today. The wizard shows each record (type, name, value) and checks every few minutes until it sees them.

## Steps
1. Keep the wizard open on the records list.
2. In another tab, sign in where your DNS is managed (usually where you bought the domain) and find your registrar below.
3. Add each record from the wizard, one at a time. Copy and paste the values, don't retype them.
4. If a record with the same name and type already exists (for example an old **A** record for `app`), edit that one rather than adding a second.
5. Go back to the wizard and wait for each record to tick green.

### How to fill in the fields
- **Name** (also called Host, Hostname or Sub Domain): type only the part in front of your domain. For `app.yourbusiness.com.au` type `app`. For `send.yourbusiness.com.au` type `send`. For the domain itself, type `@` (Crazy Domains and VentraIP also accept it blank).
- If your provider adds your domain on the end automatically and you type the whole thing, you end up with `app.yourbusiness.com.au.yourbusiness.com.au`. Type the short part only.
- **Value** (also called Points to, Answer, Content, Target or Data): paste exactly what the wizard shows. For TXT records, include everything, even if it starts with `v=` or `p=`.
- **TTL**: leave it on the default or **Automatic**. If you must pick, choose the lowest offered, such as 5 minutes or 1 hour.
- **Priority** (MX records only): use the number the wizard shows, usually `10`. Lower numbers are tried first.
- On Cloudflare, set the cloud icon to grey (**DNS only**) for the records the wizard gives you.

### GoDaddy
1. Open your **Domain Portfolio** and select the domain.
2. Open the **DNS** tab and click **Add New Record**.
3. Pick the **Type**, fill in **Name** (`@` for the domain itself), the value and **TTL** (default 1 hour), then click **Save**. If you added several at once, click **Save All Records**.

### Namecheap
1. Click **Domain List**, then **Manage** next to the domain.
2. Open the **Advanced DNS** tab. In **Host Records**, click **Add New Record**.
3. Pick the type, set **Host** (`@` or `app`), paste the value, leave **TTL** on **Automatic**, then click the green tick to save.
4. If you can't see **Advanced DNS** or **Host Records**, your domain uses someone else's nameservers. Add the records there instead.

### Crazy Domains
1. In the **Account Manager**, open the domain and go to the **DNS Settings** tab.
2. Click **ADD RECORD**, pick the type and click **ADD**.
3. Fill in **Sub Domain** (leave it empty for the domain itself), the value, and for MX the priority, then save.
4. Records only work if the domain uses Crazy Domains' own name servers. Crazy Domains says changes take 4 to 48 hours.

### VentraIP
1. In **VIPcontrol**, open **Domains** and click **DNS** next to the domain.
2. Fill in the blank row at the top: **Type**, **Hostname** (blank or `@` for the domain itself), **Value**, **Priority** (MX only), and leave **TTL** as it is.
3. Click the plus icon (**Add DNS Record**) to save.
4. VentraIP says changes take about 2 to 8 hours.

### Squarespace Domains (including former Google Domains)
1. In your domains dashboard, click the domain, then **DNS**, then **DNS Settings**.
2. Scroll to **Custom Records** and click **Add record**. Enter your password or two-step code if asked.
3. Pick the **Type**, enter the **Name** (`@` for the domain itself; Squarespace adds your domain on the end), paste the **Data**, and set **Priority** for MX records.
4. Replace the grey example text in every field, or the record won't save. Then save.
5. If the domain uses custom nameservers, records here don't apply. Add them at that nameserver provider instead.

### Porkbun
1. In **Domain Management**, click **Details** next to the domain.
2. Next to **DNS Records**, click the edit icon, then **Add Record**.
3. Pick the type, fill in **Host** (the subdomain, such as `app`) and **Answer/Value**, leave **TTL** as it is, then click **Add**.

### Anywhere else
1. Find the domain's **DNS**, **DNS records**, **Zone editor** or **Manage DNS** page.
2. Add a record, pick the type the wizard shows, and fill in name, value, TTL and (for MX) priority as described above.
3. If you have website hosting (for example cPanel), the DNS might be managed there instead of at the registrar.

## What to paste into the wizard
Nothing. The wizard checks the public DNS itself and ticks each record when it sees it.

## Permissions / scopes
None. Use your registrar or DNS host login.

## Watch out for
- Only one **A** record should exist for a name. If an old one points somewhere else, edit or delete it.
- Don't touch your existing MX records for your main domain. The email-sending records the wizard shows go on a subdomain (such as `send`) and don't affect the email you receive.
- A **CNAME** can't use `@` as its name (Squarespace says this, and it's true almost everywhere).
- Most records show up within 15 minutes. Resend says email records can take up to 72 hours to be seen everywhere.
- If a check stays red for more than an hour, compare the name carefully. The most common mistake is typing the full domain where only the short part belongs.
- Unconfirmed: GoDaddy's and Crazy Domains' pages wouldn't load for checking, so their button names come from their own search summaries. Namecheap's help page doesn't name the save button for host records. Labels might differ slightly on your screen.
