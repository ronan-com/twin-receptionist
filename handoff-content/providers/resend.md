---
id: resend
title: Create your Resend API key
time: 5 minutes, then usually 15 minutes for your domain to verify
cost: Free plan covers 3,000 emails a month (100 a day). Pro starts at US$20 a month.
link: https://resend.com/api-keys
verified: 2026-11-26
sources: [https://resend.com/docs/create-an-api-key, https://resend.com/docs/dashboard/api-keys/introduction, https://resend.com/docs/api-reference/api-keys/create-api-key, https://resend.com/docs/send-with-smtp, https://resend.com/docs/dashboard/domains/introduction, https://resend.com/docs/add-a-domain, https://resend.com/docs/api-reference/domains/create-domain, https://resend.com/pricing]
---
## What it's for
Resend sends your app's email: sign-in links, invites and call notices. With the key, the setup adds your sending domain in Resend, puts its records in your DNS (automatically if you use Cloudflare), and connects the app to Resend's mail server.

## Steps
1. Sign up at Resend and confirm your email address.
2. Open **API Keys** and click **Create API Key**.
3. Give it a name (up to 50 characters), for example "Receptionist".
4. For permission, choose **Full access**. Don't choose **Sending access**.
5. Create the key and copy it straight away.
6. Paste it into the wizard. You don't need to add a domain in Resend yourself: the wizard does it.

## What to paste into the wizard
The API key. It starts with `re_`.

The wizard uses it two ways:
- with Resend's API, to add and verify your sending domain
- as the email password, with server `smtp.resend.com`, port `465` and username `resend`

## Permissions / scopes
**Full access**. **Sending access** can only send email, so it can't add or verify your domain, and the wizard will reject it.

## Watch out for
- Resend shows the key only once. If you lose it, create a new one.
- The Free plan stops at 100 emails a day. If you have many clients or lots of calls, call notices can hit that. Upgrade to Pro (no daily limit) if they do. Check current pricing at [resend.com/pricing](https://resend.com/pricing).
- The Free plan allows 3 domains, and Pro allows 10.
- Resend recommends sending from a subdomain (for example `updates.yourbusiness.com.au`) rather than your main domain. This protects your main domain's email reputation. Resend's bounce-handling records go on `send.` under your sending domain by default.
- Most domains verify within 15 minutes. DNS can take up to 72 hours. If it's still not verified after 72 hours, click **Restart verification** in Resend.
- On Cloudflare, Resend's records must be **DNS only** (grey cloud), or verification fails. The wizard sets this for you.
- Treat the key like a password. A Full access key can change everything in your Resend account.
- Unconfirmed: Resend's help page names **Sending access** but not the other option. Its API reference calls it full access, so the button should read **Full access**.
