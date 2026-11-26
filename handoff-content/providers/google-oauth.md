---
id: google-oauth
title: Set up "Sign in with Google" (optional)
time: 20 minutes, plus Google's review if you want to remove the warning screen
cost: Free to set up. Google doesn't charge for app review. Gmail access needs a yearly security assessment, and the assessor may charge you.
link: https://console.cloud.google.com/projectcreate
verified: 2026-11-26
sources: [https://developers.google.com/workspace/guides/create-project, https://developers.google.com/workspace/guides/enable-apis, https://developers.google.com/workspace/calendar/api/quickstart/nodejs, https://developers.google.com/workspace/guides/configure-oauth-consent, https://developers.google.com/workspace/guides/create-credentials, https://support.google.com/cloud/answer/15549257, https://support.google.com/cloud/answer/15549945, https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/workspace/gmail/api/auth/scopes, https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification, https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification, https://support.google.com/cloud/answer/13463817, https://support.google.com/cloud/answer/7454865]
---
## What it's for
This lets your clients connect their Google Calendar (so the receptionist can see free times and book appointments) and, if you want, their Gmail mailbox, by clicking "Sign in with Google". Nobody types a password into your app. Skip this if your clients don't use Google.

## Steps
1. In the Google Cloud console, go to **Menu** > **IAM & Admin** > **Create a Project**. Enter a **Project Name** (for example "Receptionist") and click **Create**. Wait a minute while it's set up.
2. Turn on the Google Calendar API: go to **Menu** > **APIs & Services** > **Library**, open **Google Calendar API** and click **Enable**.
3. Only if you'll connect Gmail mailboxes: do the same for **Gmail API**.
4. Go to **Menu** > **Google Auth platform** > **Branding**. If it says "Google Auth platform not configured yet", click **Get Started**.
5. Under **App Information**, enter an **App name** (your business or product name) and choose a **User support email**. Click **Next**.
6. Under **Audience**, choose **External**. Click **Next**.
7. Under **Contact Information**, enter your email. Click **Next**.
8. Tick **I agree to the Google API Services: User Data Policy**, click **Continue**, then **Create**.
9. Go to **Data Access** and click **Add or Remove Scopes**. Add the scopes under "Permissions / scopes" below, then click **Save**.
10. Go to **Audience** and click **Publish app**, so the status reads **In production** (see "Watch out for" for why).
11. Go to **Clients** and click **Create Client**.
12. For **Application type**, choose **Web application**. Give it a **Name** (only you see this).
13. Under **Authorized redirect URIs**, click to add one and enter `https://app.yourdomain/api/oauth/google/callback`, using your real app address. Leave **Authorized JavaScript origins** empty.
14. Click **Create**. Copy the **Client ID** and **Client secret** straight away.

## What to paste into the wizard
- **Client ID**: ends in `.apps.googleusercontent.com`
- **Client secret**: a separate long string of letters, numbers and dashes

## Permissions / scopes
Add these on the **Data Access** page:
- `openid` and `.../auth/userinfo.email`: to know which Google account connected (basic, no review)
- `https://www.googleapis.com/auth/calendar.events`: to see and add calendar events (rated **sensitive** by Google)
- `https://mail.google.com/`: only if you connect Gmail mailboxes (rated **restricted** by Google). This is the only scope Gmail accepts for reading and sending mail through IMAP and SMTP.

## Watch out for
- **Testing status breaks connections every week.** While the app is in **Testing**, only test users you list can sign in (up to 100), and Google ends their access after 7 days. Publish the app (step 10) so connections keep working.
- **Unverified apps show a warning screen.** Until Google verifies your app, clients see an "unverified app" screen before they can approve. Google also caps an unverified app at 100 new users, for the life of the project, and the count never resets. You can see your count under **OAuth user cap**.
- **Calendar only** (sensitive scope): to remove the warning, submit the app for verification. Google estimates about 10 business days. You must explain why you need each scope, and why a narrower one won't do.
- **Gmail** (restricted scope): verification takes about 6 weeks. Because your app keeps Gmail data on its server, it also needs a security assessment by an independent CASA assessor, repeated every 12 months. Google doesn't charge for this, but the assessor sets its own price. If you only need calendar booking, leave the Gmail scope out.
- **Internal** audience only works if everyone who connects is in your own Google Workspace organisation. It skips verification, but your clients' accounts can't connect.
- Google shows the full client secret only once, when you create it. After that you see only its last four characters. If you lose it, add a new secret on the client's page.
- The redirect address must match exactly, including `https://` and with no slash on the end.
- A Google account that changes its password loses Gmail access, and has to sign in with Google again.
- Unconfirmed: the **Publish app** button sits on the **Audience** page in Google's help, but it might be worded differently on your screen.
