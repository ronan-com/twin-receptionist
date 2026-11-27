---
id: registrar-nameservers
title: Change your nameservers
time: 5 minutes, then minutes to a day
cost: Free
link: https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
checked: 28 Nov 2026
---
1. Sign in at the company you bought the domain from (GoDaddy, Namecheap, VentraIP, Crazy Domains and so on). Not sure which? Search your domain at [lookup.icann.org](https://lookup.icann.org/).
2. If DNSSEC is switched on for the domain, switch it off first.
3. Find **Nameservers** (sometimes called **DNS servers**). On GoDaddy: **My Products > your domain > DNS > Nameservers > Change Nameservers > I'll use my own nameservers**.
4. Choose **Custom** and delete the old nameservers.
5. Type the two Cloudflare nameservers exactly as shown on the setup page, then **Save**. Use the Copy button so there are no typos.
6. Press **Check now** on the setup page. It moves on by itself once Cloudflare sees the change.

## Common problems
- **Can't find the setting.** Look under **DNS**, **Manage DNS** or **Domain settings**. Some resellers only let you change it from the parent account.
- **Still waiting after an hour.** That's normal for some registrars: allow up to 24 hours. Check both nameservers are saved with no spaces.
- **Registrar refuses custom nameservers.** The domain may be locked or the DNS hosted by a website builder. Unlock it, or choose to add the records yourself instead.
- **Old and new nameservers both listed.** Remove the old ones. Mixing them gives random results.
- **Site down for a moment.** Cloudflare copies your records first; check them before you switch.
