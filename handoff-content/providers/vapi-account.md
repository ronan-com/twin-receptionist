---
id: vapi-account
title: Vapi: sign up and copy your two keys
time: 5 minutes
cost: Free to open. Calls are charged per minute from your Vapi credit.
link: https://dashboard.vapi.ai/
verified: 2026-11-27
sources: [https://docs.vapi.ai/security-and-privacy/api-keys, https://docs.vapi.ai/quickstart/introduction, https://docs.vapi.ai/free-telephony]
---
Vapi runs your receptionists' voice. You need two keys from it: a **private** one and a **public** one.

1. Open [dashboard.vapi.ai](https://dashboard.vapi.ai/), sign up with your work email, then add a card or credit under **Billing**.
2. Open the [API Keys page](https://dashboard.vapi.ai/org/api-keys) (**API Keys** in the sidebar).
3. Under **Private API Keys**, click the copy icon next to the key (or **Add Key**, then **Create Private Token**). Paste it into the **Vapi private API key** box.
4. Under **Public API Keys**, do the same (**Add Key**, then **Create Public Token** if there isn't one). Paste it into the **Vapi public key** box.
5. Optional: add your Twilio details below them for Australian numbers and texts (see the Twilio guide). Press **Check and use Vapi**.

Vapi doesn't sell Australian numbers: your numbers and texts come from Twilio.

> **Stuck?** "Vapi didn't accept that private key": you may have pasted the public one; the private key is under **Private API Keys**. Calls cut off: add credit under **Billing**.
