---
id: microsoft-oauth
title: Get your Microsoft calendar keys (optional)
time: 15 minutes
cost: Free
link: https://entra.microsoft.com
verified: 2026-11-27
sources: [https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app, https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri, https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials, https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-access-web-apis, https://learn.microsoft.com/en-us/graph/permissions-reference, https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth, https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview, https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission]
---
Optional. This lets your clients connect Outlook or Microsoft 365 calendars. Skip it if they don't use Microsoft. Add it later any time.

1. Sign in at [entra.microsoft.com](https://entra.microsoft.com), open **App registrations** and click **New registration**.
2. Type a name. Under **Supported account types** pick **Any Entra ID Tenant + Personal Microsoft accounts**. Click **Register**, then copy the **Application (client) ID**.
3. Click **Authentication**, **Add Redirect URI**, choose **Web** and enter this address (use your real one from the wizard): `https://app.your-domain/api/oauth/microsoft/callback`
4. Click **Certificates & secrets**, **New client secret**, then **Add**. Copy the **Value**, not the **Secret ID**.
5. Click **API permissions**, **Add a permission**, **Microsoft Graph**, **Delegated**, and tick Calendars.ReadWrite, offline_access, openid and email. Paste the client ID and secret into the wizard.

> **Stuck?** "Invalid client secret": you copied the **Secret ID**. Copy the **Value** column. Secrets expire (24 months at most), so put a reminder in your calendar.
