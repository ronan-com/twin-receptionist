---
id: resend
title: Get a Resend key
time: 5 minutes, plus waiting for your domain to verify
cost: Free for 100 emails a day (3,000 a month)
link: https://resend.com/api-keys
checked: 28 Nov 2026
---
1. Sign up at [resend.com](https://resend.com/signup) and confirm your email.
2. Open [API Keys](https://resend.com/api-keys) and click **Create API Key**.
3. Name it `Setup`. For **Permission** choose **Full access** and for **Domain** leave **All domains**. The setup needs this to add your sending domain. Your live agency only ever gets a send-only key.
4. Click **Add** and copy the key straight away. Resend shows it once. It starts with `re_`.
5. Paste it into the setup page. The setup adds your domain to Resend and shows (or adds) the DNS records.
6. Wait for the records to turn green. Resend usually verifies in about 15 minutes, and can take up to 72 hours.
7. Press **Send test email** to check it.

## Common problems
- **"That Resend key can only send email".** It was made with **Sending access**. Make a new one with **Full access**.
- **Domain stays "pending" or "failed".** Each record must match exactly what Resend shows. In your DNS, type only the short name (like `send`), not the whole address. After 72 hours press **Restart verification** in Resend.
- **On Cloudflare, nothing verifies.** Turn the orange cloud off (DNS only) on the Resend records. Proxying stops verification.
- **"Domain is already added to another Resend account".** Use that account's key, or remove the domain there first.
- **Emails go to spam.** Add a DMARC record (`v=DMARC1; p=none;`) and send from an address on your verified domain.
- **Using your own mail settings on Railway.** Railway's Free and Hobby plans block normal mail ports, so use Resend's port 2587: host `smtp.resend.com`, user `resend`, password your key.
- **Limit reached.** The free plan allows 100 emails a day. Upgrade in Resend.
