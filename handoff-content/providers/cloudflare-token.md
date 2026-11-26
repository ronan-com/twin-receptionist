---
id: cloudflare-token
title: Get your Cloudflare token (optional)
time: 5 minutes
cost: Free
link: https://dash.cloudflare.com/profile/api-tokens
verified: 2026-11-27
sources: [https://developers.cloudflare.com/fundamentals/api/get-started/create-token/, https://developers.cloudflare.com/fundamentals/api/reference/template/, https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/, https://developers.cloudflare.com/dns/internal-dns/get-started/]
---
Optional. The token lets the wizard add your records for you. It can only touch the one domain you pick.

1. In Cloudflare, click your profile icon (top right), then **My Profile**, then **API Tokens**, then **Create Token**.
2. Next to **Edit zone DNS**, click **Use template**. Under **Permissions**, click **Add more** and add **Zone**, **Zone**, **Read**.
3. Under **Zone Resources**, choose **Include**, **Specific zone**, then your domain.
4. Click **Continue to summary**, then **Create Token**.
5. Copy the token and paste it into the wizard. You'll only see it once.

> **Stuck?** "That token needs Zone: Read and DNS: Edit": make a new token with both permissions. "Can't see any domains": add your domain to Cloudflare first (see the previous guide). Never paste your Global API Key.
