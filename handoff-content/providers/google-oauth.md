---
id: google-oauth
title: Get your Google calendar keys (optional)
time: 20 minutes
cost: Free
link: https://console.cloud.google.com/projectcreate
verified: 2026-11-27
sources: [https://developers.google.com/workspace/guides/create-project, https://developers.google.com/workspace/guides/enable-apis, https://developers.google.com/workspace/calendar/api/quickstart/nodejs, https://developers.google.com/workspace/guides/configure-oauth-consent, https://developers.google.com/workspace/guides/create-credentials, https://support.google.com/cloud/answer/15549257, https://support.google.com/cloud/answer/15549945, https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/workspace/gmail/api/auth/scopes, https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification, https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification, https://support.google.com/cloud/answer/13463817, https://support.google.com/cloud/answer/7454865]
---
Optional. This lets your clients connect Google Calendar so receptionists can book appointments. Skip it if they don't use Google. Add it later any time.

1. In [Google Cloud](https://console.cloud.google.com/projectcreate), click **Create** to make a project called Receptionist. Then open **APIs & Services**, **Library**, find **Google Calendar API** and click **Enable**.
2. Open **Google Auth platform**, click **Get Started**, fill in your app name and email, and choose **External**.
3. Click **Audience**, then **Publish app**, so it reads **In production**. If you skip this, connections drop after 7 days.
4. Click **Clients**, then **Create Client**. Choose **Web application** and under **Authorized redirect URIs** add this address (use your real one from the wizard): `https://app.your-domain/api/oauth/google/callback`
5. Click **Create**, then copy the **Client ID** and **Client secret** into the wizard.

> **Stuck?** "Redirect URI mismatch": the address must match exactly, with https:// and nothing on the end. Clients see an "unverified app" warning until Google reviews your app. They can still continue.
