---
id: railway-token
title: Get your Railway token
time: 5 minutes
cost: US$5 a month (Hobby plan), billed by Railway to your card
link: https://railway.com/account/tokens
checked: 28 Nov 2026
---
1. Go to [railway.com](https://railway.com) and click **Login**. Signing in with GitHub is best: Railway checks the GitHub account and gives full network access.
2. Open [Plans](https://railway.com/workspace/plans) and choose **Hobby**. It costs US$5 a month and includes US$5 of usage. Add a card when asked.
3. Open [Account Settings > Tokens](https://railway.com/account/tokens).
4. In **Token name** type `Setup`. Open the **Workspace** list and choose **No workspace**. That is what makes it an account token.
5. Click **Create** and copy the token straight away. Railway only shows it once. It is a long code of letters, numbers and dashes.
6. Paste it into the setup page and press **Check and continue**.
7. When your agency is live, come back to the Tokens page and delete this token.

## Common problems
- **"Railway didn't accept that token".** The token was made with a workspace picked, or with a project token. On the Tokens page the **Scope** column must say **Account**. If it names a workspace, delete it and make a new one with **No workspace**.
- **Token still rejected.** Copy it again with no spaces before or after. If you lost it, make a new one: Railway never shows it a second time.
- **"Your Railway account needs the Hobby plan".** Open **Plans**, choose **Hobby** and add a card. The free trial (one-off US$5, 30 days) and the Free plan are not enough. Wait a minute, then press **Check** again.
- **Hobby chosen but still refused.** Open Billing in Railway and check the plan says Hobby and is active. A card that was declined leaves the plan inactive.
- **"That account has no workspace yet".** Open the Railway dashboard once and finish signing up, then try again.
- **Install stops at the build.** The page says why. Open your project in Railway, click the failed deployment and read **Build Logs**. Then press **Try again**: it reuses the same project.
- **Agency suddenly offline.** Railway stops services when your card payment fails or your credit hits zero. Fix it under Billing, then redeploy.
