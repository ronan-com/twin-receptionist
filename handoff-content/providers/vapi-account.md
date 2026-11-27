---
id: vapi-account
title: Vapi keys
time: 5 minutes
cost: Free to open. Calls are billed per minute from your credit.
link: https://dashboard.vapi.ai/org/api-keys
checked: 28 Nov 2026
---
1. Sign up at [dashboard.vapi.ai](https://dashboard.vapi.ai/). New accounts get a small amount of free credit to try it (US$10 at the last check).
2. Add credit: click **Buy credits** at the bottom of the left menu, or open **Billing & Payment** and the **Payments** tab. You can add a card and turn on **Auto-reload** there.
3. Open [API Keys](https://dashboard.vapi.ai/org/api-keys) in the left menu.
4. Under **Private API Keys** copy the key. This one runs your calls. Keep it secret.
5. Under **Public API Keys** copy the key. It is used by the test call in your browser. If there is none, click **Add Key**, name it `Setup` and create it without any origin limits.
6. Paste the private key in the first box and the public key in the second, then press **Check and save**.

## Common problems
- **"Invalid key" or a 401/403 error.** The two keys are swapped. The **private** one goes in the private box, the **public** one in the public box.
- **Calls stop and nothing rings.** Your balance hit zero and Vapi froze usage. Buy credits or turn on auto-reload on the **Payments** tab.
- **Browser test call fails.** The public key has origin limits. Make a new public key without **Allowed Origins**.
- **Wrong account.** Check the organisation name at the top of the dashboard: keys belong to one organisation.
