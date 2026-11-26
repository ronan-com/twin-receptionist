---
id: registrar-nameservers
title: Change your nameservers to Cloudflare
time: 5 minutes, then a few hours (up to 48) to take effect
cost: Free
link: https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
verified: 2026-11-26
sources: [https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/, https://www.godaddy.com/help/change-my-domain-nameservers-664, https://www.godaddy.com/help/article/edit-my-domain-nameservers-664, https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/how-to-change-dns-for-a-domain/, https://www.crazydomains.com.au/help/article/change-the-name-servers-of-your-cd-domain, https://ventraip.com.au/support-centre/modifying-the-nameservers-on-a-domain-name-registration/, https://support.squarespace.com/hc/en-us/articles/4404183898125-Making-changes-to-nameservers, https://support.squarespace.com/hc/en-us/articles/17131164996365-About-the-Google-Domains-migration-to-Squarespace, https://support.squarespace.com/hc/en-us/articles/24615057474061-Managing-domains-registered-through-Google-Workspace, https://kb.porkbun.com/article/22-how-to-change-nameservers]
---
## What it's for
Nameservers tell the internet who runs your domain's DNS. Changing them to the two Cloudflare gave you hands the DNS to Cloudflare. Do this where you **bought** the domain (your registrar).

## Steps
1. Have the two Cloudflare nameservers ready (they end in `.ns.cloudflare.com`).
2. Check that you finished the record check in "Put your domain on Cloudflare". Once you switch, the records at your old provider stop applying.
3. If DNSSEC is on at your registrar, turn it off first.
4. Find your registrar below and follow its steps. Replace **all** the old nameservers with just the two from Cloudflare.

### GoDaddy
1. Sign in and open your **Domain Portfolio**.
2. Select the domain to open its settings, then open **DNS** and the **Nameservers** tab.
3. Click **Change Nameservers**, choose **I'll use my own nameservers**, enter the two Cloudflare nameservers and save.
4. If the domain has Domain Protection, GoDaddy asks for a 2-step code or a one-time password first.

GoDaddy says it usually takes under an hour, and up to 48 hours.

### Namecheap
1. Sign in, click **Domain List** in the left sidebar, then **Manage** next to the domain.
2. In the **Nameservers** section, choose **Custom DNS** from the drop-down.
3. Enter the two Cloudflare nameservers and click the green tick to save.

Namecheap says up to 24 hours (more in rare cases).

### Crazy Domains
1. Sign in to the **Account Manager** and open the domain.
2. Open the **Name Servers** tab, replace the current entries with the two Cloudflare nameservers (click **ADD** if you need another row) and save.

Crazy Domains says 24 to 72 hours.

### VentraIP
1. Sign in to **VIPcontrol** and open **Domains** in the left menu.
2. Click the **DNS** button next to the domain.
3. Open the **Custom Nameservers** tab and click **Enable**.
4. Enter the two Cloudflare nameservers and click **Set Custom Nameservers**.

VentraIP warns that your existing DNS records there are removed as soon as you switch. VentraIP says up to 24 hours.

### Squarespace Domains
1. Go to your domains dashboard at account.squarespace.com/domains and click the domain.
2. Click **DNS**, then **Domain Nameservers**.
3. Click **Use Custom Nameservers**, then enter your password (or your two-step code) and click **Continue**.
4. When asked to turn off DNSSEC, click **Continue**.
5. Enter the Cloudflare nameservers in **Nameserver 1** and **Nameserver 2** and click **Save**.

Squarespace says up to 48 hours. Your domain disconnects from any Squarespace website, and records in Squarespace's DNS stop applying, so make sure Cloudflare has them all (especially MX and DKIM for email).

### Domains that used to be with Google Domains
Squarespace took over all Google Domains registrations in 2023. Sign in at squarespace.com/login (use **Continue with Google** with the same Google account), then follow the Squarespace steps above. If you bought the domain through **Google Workspace**, Squarespace says to manage it from the Google Workspace admin side instead.

### Porkbun
1. Sign in. You land on **Domain Management** (or click **ACCOUNT**, then **Domain Management**).
2. Click **Details** next to the domain, find **Nameservers** and click the edit icon.
3. Delete the existing entries, type the two Cloudflare nameservers, one per line, then click **Save Nameservers**. If asked, click **Submit** again.

Porkbun says up to 48 hours, usually a few hours.

### Anywhere else
1. Sign in where you bought the domain and open the domain's settings.
2. Look for **Nameservers**, **Name servers** or **DNS servers**. It's not the same as "DNS records".
3. Choose the custom option (it might say "custom", "use my own" or "other").
4. Delete the old nameservers, enter the two from Cloudflare and save.
5. If you can't find it, ask the registrar's support: "How do I change my domain's nameservers to custom ones?"

## What to paste into the wizard
Nothing. The wizard watches for Cloudflare to mark the domain **Active**.

## Permissions / scopes
None. Use your registrar login.

## Watch out for
- Change **nameservers**, not NS records inside the DNS records list. Porkbun says this outright, and the same applies everywhere.
- Turn off DNSSEC at the registrar before switching, or the domain can go dark.
- Some registrars have a "domain lock" or "protection" that asks for an extra code. That's normal.
- The registrar's own website builder, email forwarding or parked page stops working after the switch. Your domain stays registered with them, and renewals carry on as before.
- Unconfirmed: GoDaddy's and Crazy Domains' help pages wouldn't load for checking, so their labels come from their own search summaries. If a button reads differently, look for "Nameservers" on the domain's page.
