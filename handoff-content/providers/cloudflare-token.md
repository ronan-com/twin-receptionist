---
id: cloudflare-token
title: Get a Cloudflare token
time: 3 minutes
cost: Free
link: https://dash.cloudflare.com/profile/api-tokens
checked: 28 Nov 2026
---
1. In Cloudflare click your profile icon, then **My Profile > API Tokens**, or open [API Tokens](https://dash.cloudflare.com/profile/api-tokens). Click **Create Token**.
2. Next to **Edit zone DNS** click **Use template**.
3. Under **Permissions** click **Add more** and add **Zone**, **Zone**, **Read** next to **Zone > DNS > Edit**.
4. Under **Zone Resources** choose **Include > Specific zone** and pick your domain.
5. Click **Continue to summary**, then **Create Token**. Copy it straight away: Cloudflare shows it once. It usually starts with `cfut_`.
6. Paste it into the setup page. When your agency is live you can delete it.

## Common problems
- **"That token needs Zone: Read and DNS: Edit".** Make a new token and add both permissions for your domain. The template only has DNS: Edit.
- **"Can't find your domain".** The token's **Zone Resources** pick a different domain. Choose the right one, or **All zones**.
- **Token rejected.** Copy the whole token with no spaces. Never paste your **Global API Key**: it is a different thing and gives too much access.
- **Records won't save.** On Cloudflare the dashboard record must be **DNS only** (grey cloud). The setup adds it that way; don't turn the orange cloud on.
