---
id: google-oauth
title: Google calendar keys
time: 15 minutes
cost: Free
link: https://console.cloud.google.com/projectcreate
checked: 28 Nov 2026
---
1. In [Google Cloud](https://console.cloud.google.com/projectcreate) create a project (name it anything). Open **APIs & Services > Library**, search **Google Calendar API** and click **Enable**.
2. Open **Google Auth platform** and click **Get started**. Fill in the app name and your email, choose **External** as the audience, then finish.
3. Under **Audience** click **Publish app**, so the status says **In production**. Under **Data Access** add the two scopes `calendar.events` and `calendar.events.freebusy`.
4. Open **Clients > Create client**. Choose **Web application** and under **Authorised redirect URIs** paste the address from the setup page: `https://app.your-domain/api/oauth/google/callback`
5. Click **Create**. Copy the **Client ID** and **Client secret** now: the secret is shown in full only once. Paste both into the setup page.

## Common problems
- **"redirect_uri_mismatch".** The address must match exactly, with `https://`, no trailing slash and no spaces. Changes can take a few minutes to apply.
- **Connection stops after about a week.** The app is still in **Testing**. Google expires those logins after 7 days. Publish it (step 3) and connect again.
- **"Google hasn't verified this app".** Normal for your own app. Click **Advanced**, then **Go to (your app name)**.
- **"Access blocked".** Add yourself as a **Test user** under **Audience** while it is in Testing, or publish it.
- **Client deleted.** Google removes clients unused for 6 months. Make a new one and paste the new keys.
