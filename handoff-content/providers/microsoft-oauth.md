---
id: microsoft-oauth
title: Microsoft calendar keys
time: 15 minutes
cost: Free
link: https://entra.microsoft.com
checked: 28 Nov 2026
---
1. Sign in to the [Entra admin center](https://entra.microsoft.com), open **Entra ID > App registrations** and click **New registration**.
2. Name it anything. Under **Supported account types** choose **Any Entra ID Tenant + Personal Microsoft accounts**, so both work and personal Outlook accounts can connect.
3. Under **Redirect URI** choose **Web** and paste the address from the setup page: `https://app.your-domain/api/oauth/microsoft/callback`. Click **Register**.
4. On the **Overview** page copy the **Application (client) ID**.
5. Open **Certificates & secrets > New client secret**, choose an expiry and **Add**. Copy the **Value** straight away. It is shown once.
6. Paste both into the setup page. Your agency asks for the `Calendars.ReadWrite` permission when someone connects Outlook: you don't add it by hand.

## Common problems
- **"Invalid client secret".** You copied the **Secret ID**. Copy the **Value** column instead. If it's gone, make a new secret.
- **Calendar stops working later.** The secret expired. Make a new one (pick the longest expiry) and paste it under **Settings** in your dashboard.
- **"AADSTS50011" redirect mismatch.** The address must match exactly, including `https://`, and be added under **Web**, not **Single-page application**.
- **"Need admin approval".** A work account is blocking the app. Sign in with a personal account, or ask the account's administrator to approve it.
- **Can't register apps.** Your account needs the **Application Developer** role in that directory.
