---
id: microsoft-oauth
title: Microsoft calendar keys
time: 15 minutes
cost: Free
link: https://entra.microsoft.com
---
1. In [Entra](https://entra.microsoft.com) open **App registrations**, then **New registration**.
2. Allow any organisation and personal accounts, then copy the **Application (client) ID**.
3. Add a **Web** redirect: `https://app.your-domain/api/oauth/microsoft/callback`
4. Under **Certificates & secrets** make a secret and copy its **Value**.

> **Stuck?** Invalid secret? Copy the **Value**, not the Secret ID.
