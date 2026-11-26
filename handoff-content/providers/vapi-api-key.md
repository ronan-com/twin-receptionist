---
id: vapi-api-key
title: Find your Vapi API keys
time: 1 minute
cost: Free
link: https://dashboard.vapi.ai/org/api-keys
verified: 2026-11-27
sources: [https://docs.vapi.ai/api-reference/assistants/create, https://docs.vapi.ai/sdk/web]
---
## What it's for
Your receptionist app needs two Vapi keys. The **private** key lets the app create and run receptionists on your Vapi account. The **public** key lets the browser test call start. The wizard checks the private key with Vapi before saving anything.

## Steps
1. In the Vapi dashboard, open **API Keys** (under Org Settings).
2. Copy the **Private Key**.
3. Copy the **Public Key** as well.
4. Paste both into the wizard.

## What to paste into the wizard
The private key in the first box and the public key in the second. Each is one line, with no spaces.

## Watch out for
- The private key can spend your Vapi credit. Paste it only into the wizard, never into an email or chat. The public key is meant for browsers and is safe to expose.
- If you create a new private key later, replace it in the app under **Connections**.
- Use keys from the same Vapi account every time: your receptionists live in that account.

> **Stuck?** "Vapi didn't accept that key": copy the whole private key again, or make a new one under API Keys. Calls cut off: add credit under Billing.
