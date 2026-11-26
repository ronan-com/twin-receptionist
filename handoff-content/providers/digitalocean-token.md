---
id: digitalocean-token
title: Create your DigitalOcean API token
time: 10 minutes (plus sign-up if you're new)
cost: US$24 a month for the recommended server (2 CPUs, 4 GB). Smaller 2 GB servers are US$12–18 a month.
link: https://cloud.digitalocean.com/account/api/tokens
verified: 2026-11-26
sources: [https://docs.digitalocean.com/reference/api/create-personal-access-token/, https://docs.digitalocean.com/reference/api/scopes/, https://docs.digitalocean.com/reference/api/scopes/droplet/create/, https://docs.digitalocean.com/reference/api/scopes/droplet/delete/, https://docs.digitalocean.com/reference/api/scopes/ssh_key/create/, https://docs.digitalocean.com/reference/api/scopes/tag/create/, https://docs.digitalocean.com/support/why-do-i-need-to-enter-a-payment-method/, https://docs.digitalocean.com/platform/billing/manage-payment-methods/, https://www.digitalocean.com/pricing/droplets, https://docs.digitalocean.com/reference/api/reference/ssh-keys/]
---
Only for the optional DigitalOcean hosting. The standard setup uses Railway, so most people can skip this.

## What it's for
DigitalOcean rents you the server your receptionist app runs on. The token lets the setup create that server for you, in the region and size you pick, and tidy it up if a try fails.

## Steps
1. Sign up at DigitalOcean and confirm your email address.
2. Add a payment method (card or PayPal) when asked. DigitalOcean won't create servers until you do.
3. In the main menu, click **Account**, then **API**. This opens **Applications & API** on the **Tokens** tab.
4. In **Personal access tokens**, click **Generate New Token**.
5. In **Token name**, type something like "Receptionist setup".
6. Under **Expiration**, pick a short period, such as 30 days. The setup only needs the token while it builds your server.
7. Under **Scopes**, choose **Custom Scopes**, then tick the scopes listed under "Permissions / scopes" below. You can use **Search by resource type** to find each one.
8. Check the summary at the bottom, then click **Generate Token**.
9. Copy the token straight away and paste it into the wizard.

## What to paste into the wizard
The token. It starts with `dop_v1_` followed by a long string of letters and numbers.

## Permissions / scopes
With **Custom Scopes**, tick these (this is the minimum the setup uses):
- **droplet**: `create`, `read`, `delete`
- **ssh_key**: `create`, `read`, `delete`
- **tag**: `create`, `read` (the server is tagged "receptionist")
- **account**: `read`
- **regions**: `read`
- **sizes**: `read`
- **actions**: `read`
- **image**: `read`
- **snapshot**: `read`
- **vpc**: `read`

DigitalOcean requires some of these as a set: creating a droplet needs `droplet:read`, `regions:read`, `sizes:read`, `actions:read`, `image:read`, `snapshot:read` and `vpc:read`. Uploading an SSH key needs `ssh_key:read`, and creating tags needs `tag:read`.

If you'd rather not tick them one by one, **Full Access** also works. Give it a short expiry and delete the token once your server is running.

## Watch out for
- No payment method means no server. DigitalOcean uses it to confirm who you are. PayPal takes a US$5 authorisation charge, and a bank account needs two small test deposits confirmed within 10 days.
- Confirm your email first. The wizard checks this and tells you if it isn't done.
- DigitalOcean shows the token only once. If you lose it, generate a new one.
- You can't change a token's scopes after you create it. If the wizard says a permission is missing, make a new token with the full list.
- Prices are in US dollars and billed by the second, capped at the monthly price. Check current pricing at [digitalocean.com/pricing/droplets](https://www.digitalocean.com/pricing/droplets).
- New accounts can have a limit on how many servers they can create. One server is all you need. If DigitalOcean says you've hit a limit, ask DigitalOcean support to raise it.
- Unconfirmed: the exact checkbox layout under **Custom Scopes** and the list of **Expiration** choices. DigitalOcean's docs name the scopes but not every on-screen label.
