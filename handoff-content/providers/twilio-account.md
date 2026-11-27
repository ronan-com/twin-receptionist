---
id: twilio-account
title: Twilio details
time: 10 minutes, then number approval (a few days for Australia)
cost: Free to open. Upgrade with a card; numbers and texts come from your balance.
link: https://console.twilio.com/
checked: 28 Nov 2026
---
1. Sign up at [twilio.com](https://www.twilio.com/try-twilio) and verify your email and mobile number.
2. Upgrade out of the trial: click the **Trial** banner (or search **Upgrade**) in the [Console](https://console.twilio.com/). Add your address, a card and a starting balance. A trial can only send to 5 verified numbers and ends after 30 days.
3. On the Console home page find **Account Info**. Copy the **Account SID** (starts with `AC`).
4. Click **Show** next to **Auth Token** and copy it. It is 32 letters and numbers. Paste both into the setup page.
5. For Australian numbers, create a regulatory bundle first: **Phone Numbers > Regulatory Compliance > [Bundles](https://console.twilio.com/us1/develop/phone-numbers/regulatory-compliance/bundles)**. Local numbers need an Australian ID and proof of address (businesses: an ASIC company extract and ABN or ACN). Mobile numbers have their own rules.
6. To send texts to Australia, open **Messaging > Settings > Geo permissions** and tick **Australia**.

## Common problems
- **"Rejected" or error 20003.** The SID and Auth Token must both come from the same **Account Info** box. Copy again with no spaces.
- **Worked, then stopped.** Someone rotated the Auth Token. Copy the new one and paste it under **Connections** in your dashboard.
- **Texts fail with error 21408.** Geo permissions don't include that country. Tick it under **Messaging > Settings > Geo permissions**.
- **Can't buy an Australian number.** The bundle isn't approved yet. Check its status on the Bundles page and fix anything marked rejected.
- **Trial messages blocked (error 21608).** Trial accounts can only text verified numbers. Upgrade the account.
- **Balance ran out.** Texts and calls stop. Add funds in the Console under **Billing**.
