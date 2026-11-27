---
id: telnyx-api-key
title: Copy a Telnyx API key
time: 2 minutes
cost: Free
link: https://portal.telnyx.com/#/app/api-keys
checked: 28 Nov 2026
---
1. Sign in to the [Telnyx portal](https://portal.telnyx.com/) and open [API Keys](https://portal.telnyx.com/#/app/api-keys). If you can't find it, open **Account Settings** in the left menu, then **Keys & Credentials**.
2. Make sure you are on the **v2** keys (the older v1 keys won't work). Click **Create API Key**.
3. Give it a name like `Setup`. Under **Expiration** choose **No expiration**. A key that expires would stop your agency's calls.
4. Create it and copy the whole key straight away. Telnyx shows it once. It starts with `KEY`.
5. Paste it into the setup page and press **Check key**.

## Common problems
- **"Telnyx didn't accept that key".** Copy the whole key again, including the `KEY` at the start, with no spaces. Or make a new one.
- **Key doesn't start with KEY.** It is probably a v1 key. Create a v2 key under API Keys.
- **Lost the key.** Make a new one. If a trial account says you have reached its limit (one key), delete the old key first.
- **Worked, then stopped.** The key expired or was removed. Make a new one with **No expiration**, and update it under **Connections** in your dashboard.
- **Key accepted but calls fail.** The account is still a trial or has no credit. See "Open and upgrade a Telnyx account".
