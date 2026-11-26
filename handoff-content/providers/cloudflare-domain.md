---
id: cloudflare-domain
title: Put your domain on Cloudflare
time: 15 minutes, then up to 24 hours for the switch
cost: Free (Cloudflare's Free plan)
link: https://dash.cloudflare.com/sign-up
verified: 2026-11-26
sources: [https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/, https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/]
---
## What it's for
Cloudflare will run your domain's DNS for free. Once it does, the setup can add every record your receptionist needs for you, so you never have to type one in.

## Steps
1. Sign up for a free Cloudflare account and confirm your email address.
2. Go to **Domains** and click **Onboard a domain**.
3. Type your main domain only, with nothing in front of it (for example `yourbusiness.com.au`, not `www.yourbusiness.com.au`).
4. Leave the option for Cloudflare to scan for your existing DNS records turned on, then click **Continue**.
5. Choose the **Free** plan.
6. Open the **DNS Records** page Cloudflare shows you and check the list against your current DNS (see the next step).
7. In another tab, sign in where your DNS is managed today (usually where you bought the domain) and open its DNS records. Check that Cloudflare has copied your **website** records (the ones named `@` or your bare domain, and `www`, usually type **A**, **AAAA** or **CNAME**), your **email** records (every **MX** record, **TXT** records starting with `v=spf1`, and any with `_domainkey` or `_dmarc` in the name), and anything else you use, such as records for Microsoft 365, Google Workspace or a booking system.
8. Add any record that's missing in Cloudflare by copying it exactly from the old list.
9. Leave the cloud icon on your existing website records as Cloudflare set it. Email records can't be proxied, so they show **DNS only** (grey cloud).
10. Write down the two nameservers Cloudflare gives you. They look like `name.ns.cloudflare.com`. You can find them again later on the domain's **Overview** page.
11. Change your nameservers at your registrar to those two. The next guide, "Change your nameservers", shows where.
12. Wait for Cloudflare's email saying the domain is active. On **Domains** the status changes from **Pending Nameserver Update** to **Active**.

## What to paste into the wizard
Nothing from this step. The wizard asks for a Cloudflare API token next.

## Permissions / scopes
None. Use your own Cloudflare login.

## Watch out for
- Check your email records before you switch. If an MX record is missing, email to your business stops arriving until you add it. Cloudflare says its scan can miss records.
- If DNSSEC is turned on at your registrar, turn it off **before** you change nameservers. Otherwise your website and email can stop working. You can turn it back on in Cloudflare later.
- Type both Cloudflare nameservers exactly as shown. One wrong letter stops the domain working.
- The switch usually takes a few hours and can take up to 24. Cloudflare checks one minute after you add the domain, then less often. You can press the check button on the domain's **Overview** page to make it check again.
- On the Free plan, a domain that isn't activated within 28 days is deleted from Cloudflare, and you'd need to add it again (with new nameservers).
- Your domain stays registered where it is. Only the DNS moves to Cloudflare, and you keep paying your registrar for the domain as before.
