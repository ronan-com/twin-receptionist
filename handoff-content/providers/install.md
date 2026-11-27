---
id: install
title: What happens when you press Install
time: 5 to 10 minutes
cost: Uses your Railway plan
link: https://railway.com/dashboard
checked: 28 Nov 2026
---
1. Press **Install**. The setup builds your agency and its database inside your own Railway account.
2. You can close the page. Open your setup link again any time to see how far it got.
3. When it finishes, open your agency's address and sign in with the owner email you entered on the Brand step.
4. Then delete your Railway token (and your Cloudflare token, if you made one) from their Tokens pages.

## Common problems
- **It stopped with an error.** The page says why. Fix that, then press **Try again**: it carries on in the same Railway project, so nothing is built twice.
- **Build failed.** Open your project in [Railway](https://railway.com/dashboard), click the failed deployment and read **Build Logs**. Then press **Try again**.
- **Services stopped or won't deploy.** Railway stops them when your card is declined or credit is gone. Check **Billing** in Railway and that the plan is **Hobby**.
- **Slow or blocked network on a new account.** An account Railway hasn't verified gets a limited trial. Verify at [railway.com/verify](https://railway.com/verify) (a GitHub account helps), then try again.
- **The address shows an error at first.** It can take a few minutes after the install ends. Reload.
- **Your own domain shows "not secure".** The certificate comes within about an hour of the records being found. Meanwhile use the Railway address.
