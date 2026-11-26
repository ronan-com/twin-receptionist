---
id: digitalocean-token
title: Get your DigitalOcean token (only for DigitalOcean hosting)
time: 10 minutes
cost: From US$18 a month for a server
link: https://cloud.digitalocean.com/account/api/tokens
verified: 2026-11-27
sources: [https://docs.digitalocean.com/reference/api/create-personal-access-token/, https://docs.digitalocean.com/reference/api/scopes/, https://docs.digitalocean.com/reference/api/scopes/droplet/create/, https://docs.digitalocean.com/reference/api/scopes/droplet/delete/, https://docs.digitalocean.com/reference/api/scopes/ssh_key/create/, https://docs.digitalocean.com/reference/api/scopes/tag/create/, https://docs.digitalocean.com/support/why-do-i-need-to-enter-a-payment-method/, https://docs.digitalocean.com/platform/billing/manage-payment-methods/, https://www.digitalocean.com/pricing/droplets, https://docs.digitalocean.com/reference/api/reference/ssh-keys/]
---
Only if your setup uses DigitalOcean instead of Railway. Most people can skip this.

1. Sign up at [digitalocean.com](https://cloud.digitalocean.com/) and confirm your email.
2. Add a payment method when asked. DigitalOcean won't make servers without one.
3. Click **Account**, then **API**, then **Generate New Token**.
4. Type a name like Setup, set **Expiration** to 30 days and choose **Full Access**. Click **Generate Token**.
5. Copy the token and paste it into the wizard. It starts with dop_v1_ and you'll only see it once.

> **Stuck?** "That token can only read": make a new one with **Full Access**. "Add a payment method": add a card under **Billing** first.
