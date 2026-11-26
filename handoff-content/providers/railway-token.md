---
id: railway-token
title: Create your Railway account and token
time: 10 minutes
cost: US$5 a month for the Hobby plan, which includes US$5 of usage. Usage above that is billed on top.
link: https://railway.com/account/tokens
verified: 2026-11-26
sources: [https://docs.railway.com/integrations/api, https://railway.com/auth.md, https://railway.com/changelog/2026-11-06-workspace-token-management, https://docs.railway.com/reference/pricing/plans, https://docs.railway.com/reference/pricing/free-trial, https://docs.railway.com/reference/pricing/faqs, https://docs.railway.com/pricing/cost-control, https://docs.railway.com/deployments/regions, https://railway.com/pricing]
---
## What it's for
Railway hosts your agency: the app and its database run in a project in your own Railway account. The token lets the setup create that project, add the database, send the app and connect app.your-domain. You delete the token once you're live.

## Steps
1. Sign up at [railway.com](https://railway.com). Signing up with GitHub is best: Railway uses your GitHub account to verify you. Unverified accounts land on a "Limited Trial" with restricted outbound network access.
2. Choose the **Hobby** plan on the Plans page ([railway.com/workspace/plans](https://railway.com/workspace/plans)) and add a credit card. The wizard won't continue on the Free or Trial plan.
3. Optional but sensible: set a spending limit. Open the Usage page ([railway.com/workspace/usage](https://railway.com/workspace/usage)), click **Set Usage Limits**, and set a **Custom email alert** (and a **Hard limit** if you want one).
4. Optional: pick your preferred region in **Account Settings**. New services go there. For Australian clients, **Southeast Asia Metal (Singapore)** is the closest. Railway has no Australian region.
5. Open **Account Settings → Tokens** ([railway.com/account/tokens](https://railway.com/account/tokens)).
6. Give the token a name, for example "Receptionist setup".
7. Leave **Workspace** on **No workspace**. This makes an account token, which is the type the wizard needs.
8. Create the token and copy it straight away.

## What to paste into the wizard
The token itself, on one line.

## Permissions / scopes
None to tick. A Railway account token (made with **No workspace**) can reach everything in your account. The wizard uses it to read your email and plan, then create one project with the app and a Postgres database in your paid workspace.

## Watch out for
- Pick **No workspace**. A workspace token is turned down, because it can't read your account details.
- Free and Trial accounts can't be used. The wizard says "needs the Hobby plan" until the upgrade and card are in place.
- An account token can do anything in your Railway account. Paste it only into the wizard, and delete it on the same Tokens page once your agency is live. Deletion is immediate.
- Hobby's US$5 covers US$5 of usage. If your app and database use more, the extra is billed to your card at the end of the month. Check the Usage page after your first week. Current pricing: [railway.com/pricing](https://railway.com/pricing).
- A hard limit takes all your services offline when it's reached, receptionists included. The minimum hard limit is US$10. An email alert alone is safer.
- Unconfirmed: the exact label of the button that creates the token, whether Railway shows the token only once, and the button names on the Plans page. Railway's docs give the pages but not every label. To be safe, copy the token as soon as you see it.
- Unconfirmed: the label of the preferred-region setting in Account Settings. The docs say it's there but don't name it.
