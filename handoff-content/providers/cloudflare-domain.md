---
id: cloudflare-domain
title: Put your domain on Cloudflare
time: 10 minutes, then up to a day for the switch
cost: Free
link: https://dash.cloudflare.com/sign-up
checked: 28 Nov 2026
---
1. Sign up free at [cloudflare.com](https://dash.cloudflare.com/sign-up) and confirm your email.
2. In the dashboard click **Domains**, then **Onboard a domain**. Type your main domain (like `yourbusiness.com.au`), not `app.` or `www.`.
3. Choose the **Free** plan. Cloudflare scans your existing records. Check that your website and email records are all there and add any that are missing.
4. Cloudflare shows two nameservers (like `anna.ns.cloudflare.com`). Keep this page open: the next guide shows where to put them.
5. When your domain says **Active** (you also get an email), the setup page moves on by itself.

## Common problems
- **Stuck on "Pending nameserver update".** The switch at your registrar hasn't happened or has a typo. Check both nameservers match exactly. It usually takes minutes to an hour, and up to 24 hours.
- **Website or email stopped working after the switch.** A record was missed. In Cloudflare open **DNS > Records** and add the missing ones from your old host, then wait a few minutes.
- **"Domain not recognised".** Use your main domain only, one level below the ending: `yourbusiness.com.au`, not `app.yourbusiness.com.au`.
- **Domain bought through Cloudflare.** It already uses Cloudflare. Skip the nameserver step and go to the token guide.
- **Turn DNSSEC off first.** If DNSSEC is on at your registrar, switch it off before changing nameservers. Turn it on again in Cloudflare once it's Active.
