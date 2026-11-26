---
id: cloudflare-domain
title: Put your domain on Cloudflare (optional)
time: 15 minutes, then a few hours (up to 24) for the switch
cost: Free (Cloudflare's Free plan)
link: https://dash.cloudflare.com/sign-up
verified: 2026-11-27
sources: [https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/, https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/]
---
Optional. Cloudflare runs your domain's settings for free, so the wizard can add every record for you. Your domain stays registered where it is.

1. Sign up free at [cloudflare.com](https://dash.cloudflare.com/sign-up) and confirm your email.
2. Click **Domains**, then **Onboard a domain**. Type your domain with nothing in front, like `yourbusiness.com.au`. Click **Continue** and choose the **Free** plan.
3. Cloudflare lists the records it found. If you use email on this domain, check every **MX** record is there. Add any that's missing.
4. Copy the two nameservers Cloudflare shows (they end in .ns.cloudflare.com).
5. Next, give them to the company you bought the domain from (the "Change your nameservers" guide). Cloudflare emails you when your domain is **Active**.

> **Stuck?** Still **Pending Nameserver Update** after a day: check both nameservers at your registrar match exactly. If DNSSEC is on at your registrar, turn it off before you switch.
