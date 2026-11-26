---
id: microsoft-oauth
title: Set up "Sign in with Microsoft" (optional)
time: 15 minutes
cost: Microsoft doesn't charge for publisher verification. You need a Microsoft work account or an Azure account (a free one works). Check current pricing at azure.microsoft.com.
link: https://entra.microsoft.com
verified: 2026-11-26
sources: [https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app, https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri, https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials, https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-access-web-apis, https://learn.microsoft.com/en-us/graph/permissions-reference, https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth, https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview, https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission]
---
## What it's for
This lets your clients connect their Outlook or Microsoft 365 calendar (for booking) and, if you want, their mailbox, by clicking "Sign in with Microsoft". Nobody types a password into your app. Skip this if your clients don't use Microsoft.

## Steps
1. Sign in to the Microsoft Entra admin center.
2. Go to **Entra ID** > **App registrations** and click **New registration**.
3. Enter a **Name**. Your clients see it when they connect, so use your business or product name.
4. Under **Supported account types**, choose **Any Entra ID Tenant + Personal Microsoft accounts**. This lets both business (Microsoft 365) and personal (Outlook.com, Hotmail) accounts connect.
5. Click **Register**.
6. On the **Overview** page, copy the **Application (client) ID**.
7. Under **Manage**, click **Authentication**. On the **Redirect URI configuration** tab, click **Add Redirect URI**, choose **Web**, and enter `https://app.yourdomain/api/oauth/microsoft/callback`, using your real app address. Click **Configure**.
8. Click **Certificates & secrets** > **Client secrets** > **New client secret**.
9. Add a description (for example "Receptionist"), choose an expiry (Microsoft recommends under 12 months) and click **Add**.
10. Copy the secret's **Value** straight away. Not the **Secret ID**.
11. Click **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**.
12. Tick the permissions listed under "Permissions / scopes" below, then click **Add permissions**.

## What to paste into the wizard
- **Application (client) ID**: looks like `1a2b3c4d-....-....-....-............` (36 characters with dashes)
- **Client secret Value**: the long string from the **Value** column. It is **not** the **Secret ID**, which looks like the client ID.

## Permissions / scopes
All **Delegated**, under **Microsoft Graph**:
- `openid`, `email`, `offline_access`: to know who connected and to stay connected
- `Calendars.ReadWrite`: to read and add calendar events
- `IMAP.AccessAsUser.All` and `SMTP.Send`: only if you connect mailboxes

None of these needs an admin's approval in Microsoft's list, so each person can approve them when they connect.

## Watch out for
- Microsoft never shows the secret **Value** again after you leave the page. If you lose it, create a new one.
- **Secrets expire.** The longest allowed is 24 months. When yours expires, connections stop working. Put a reminder in your calendar a few weeks before, create a new secret, and paste it into your dashboard.
- The redirect address must match exactly, including `https://`.
- **Unverified publisher.** Your clients' businesses are separate Microsoft organisations. Microsoft may show them a warning, or block approval, for apps from publishers it hasn't verified. Their IT admin can still approve your app for their whole business. To remove the warning, you can do Microsoft's publisher verification. It's free, but you need a verified Microsoft AI Cloud Partner Program account.
- Some businesses turn off self-approval of apps entirely. Then their admin has to approve your app once.
- **Mailboxes only:** Microsoft 365 mailboxes need **Authenticated SMTP** turned on to send. The client's admin turns it on in the Microsoft 365 admin center under **Users** > **Active users** > the user > **Mail** > **Manage email apps**. If their business uses Microsoft's *security defaults*, sending this way is blocked.
- Unconfirmed: whether new Microsoft sign-ups can register apps without a work account or Azure account. Microsoft's guide lists an Azure account as a requirement.
