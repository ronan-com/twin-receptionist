---
id: cloudflare-token
title: Create your Cloudflare API token
time: 5 minutes
cost: Free
link: https://dash.cloudflare.com/profile/api-tokens
verified: 2026-11-26
sources: [https://developers.cloudflare.com/fundamentals/api/get-started/create-token/, https://developers.cloudflare.com/fundamentals/api/reference/template/, https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/, https://developers.cloudflare.com/dns/internal-dns/get-started/]
---
## What it's for
The token lets the setup add DNS records to your domain on Cloudflare: Railway's two records for app.your-domain (a CNAME and a TXT ownership check) and Resend's email records. It needs **Zone: Read** to find your domain and **DNS: Edit** to add the records. It can only touch the one domain you pick.

## Steps
1. Sign in to Cloudflare. Click your profile icon (top right), then **My Profile**, then **API Tokens**.
2. Click **Create Token**.
3. Next to the **Edit zone DNS** template, click **Use template**.
4. Change **Token name** to something you'll recognise, for example "Receptionist setup".
5. Under **Permissions** you'll see a row reading **Zone**, **DNS**, **Edit**. Leave it.
6. Click **Add more** and set the new row to **Zone**, **Zone**, **Read**.
7. Under **Zone Resources**, choose **Include**, then **Specific zone**, then your domain.
8. Leave **Client IP Address Filtering** and **TTL** empty.
9. Click **Continue to summary**, check it lists your domain with DNS Edit and Zone Read, then click **Create Token**.
10. Click the copy button next to the token and paste it into the wizard straight away.

## What to paste into the wizard
The token itself: one long line of letters, numbers and symbols. New Cloudflare tokens start with `cfut_`. Don't paste the test command shown under it, and don't paste your Global API Key.

## Permissions / scopes
Exactly two, both limited to your one domain:
- **Zone** · **DNS** · **Edit**
- **Zone** · **Zone** · **Read**

## Watch out for
- Cloudflare shows the token only once. If you lose it, create a new one and delete the old one.
- Missing **Zone: Read**? The wizard says "That token needs Zone: Read and DNS: Edit for your domain." Make a new token with both.
- Your domain must already be added to Cloudflare (the previous step). If it isn't, the token can't see it and the wizard says it found no domains.
- If you have several domains, make sure **Zone Resources** names the one you're using for the receptionist.
- Don't use the **Global API Key**. It gives full control of your whole Cloudflare account.
- Unconfirmed: the **Use template**, **Add more** and **Specific zone** labels. Cloudflare's docs describe the template, the **Zone Resources** drop-downs and the **Include** option, but these button names might read slightly differently on your screen. If the template isn't there, go to the **Custom token** section, click **Get started**, and add the same two permissions yourself.
