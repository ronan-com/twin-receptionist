---
id: google-oauth
title: Google calendar keys
time: 15 minutes
cost: Free
link: https://console.cloud.google.com/projectcreate
---
1. In [Google Cloud](https://console.cloud.google.com/projectcreate) make a project and enable the **Google Calendar API**.
2. Under **Google Auth platform**, set up the app and **Publish** it.
3. Create a **Web application** client with the redirect address from the wizard: `https://app.your-domain/api/oauth/google/callback`
4. Copy the **Client ID** and **Client secret** here.

> **Stuck?** Redirect mismatch? It must match exactly, with `https://`.
