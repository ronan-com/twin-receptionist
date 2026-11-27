# Agency quick guide

Set up each product for a client in a few minutes. Every step is a page or button in your dashboard.

**Before you start (once):** open **Connections**. Connect your phone key (**Connect your key**) and your AI key (**AI (OpenRouter)**). Chat, texts and email replies all need the AI key.

**Per-client settings:** go to **Clients**, open the client, then press **Open and edit** on its receptionist. Tabs: **General**, **Receptionist**, **Knowledge**, **Automations**, **Apps**, **Team**, **Brand**.

---

## 1. AI voice receptionist

1. Open **Clients** and press **Add client**.
2. Pick **Set it up myself**, enter **Company name** and **Industry**, press **Continue to setup**. (Or pick **Send the client an onboarding link**, enter their email, press **Create and get link**. They finish setup themselves.)
3. Step **Client and business**: check the name, type of business, suburb and time zone. Press **Continue**.
4. Step **Hours and services**: set each day's hours, add closures, list what callers can ask for. Press **Continue**.
5. Step **How it handles calls**: open each section, fix anything wrong, skip the rest. Press **Continue**.
6. Step **Voice**: play the voices, pick one, set the receptionist's name and **Greeting**. Press **Continue**.
7. Step **Urgent calls**: enter the number to put urgent calls through to. Press **Continue**.
8. Step **Review**: press **Create receptionist**.
9. Teach it the business: open **Open and edit**, then **Knowledge**, then **Import from website**. Enter the **Website address**, press **Read my website**, untick anything wrong, press **Add items**. Use **Add knowledge** for your own answers.
10. Hours later: **Receptionist** tab, **Hours & voicemail**. Press **Save changes**.
11. Bookings: connect a calendar under **Apps** (see "Connect your apps"). Then **Receptionist** tab, **Booking & leads**, turn on **Allow bookings on calls** and set **Appointment length**.
12. Give it a number. Open the client and use the **Phone number** box:
    - Your own phone account: press **Add a number**, pick one and buy it, or use **Use a number I already have** and press **Connect number**.
    - Platform phone key: choose **Mobile (calls and texts)** or **Local (calls only)** under **Request a number**, then press **Request number**.
13. Test: on the client page press **Talk to this receptionist** and speak. Check the result under **Calls**.
14. Client keeps their old number? Their **Phone numbers** page shows the forwarding codes to dial.

---

## 2. AI chatbot

### Website chat
1. Open **Clients** and choose the client. Scroll to **Website chat**.
2. Turn on **Website chat on**.
3. Under **Websites that can show the chat**, enter the business's site (one per line). Leave empty to allow any site.
4. Optional: write a **First message**. Press **Save**.
5. In **Snippet**, press **Copy**. Paste it just before `</body>` on the website (or in the site's custom code box).
6. Press **Preview** to check it.
7. Branding: the bubble uses the client's **Brand** logo and **Primary** colour. Change them under **Brand** (see Branding).
8. Chats show under **Website chats** on the client page, and in the client's **Inbox**.

### Texts
1. Give the receptionist a number that can text: **Mobile (calls and texts)**. Local numbers can't text.
2. An Australian mobile that is live when you add it has texting switched on for you. If it was still waiting for approval, add it again once it is live. On Vapi, texts come through your Twilio number.
3. Check **Phone numbers** shows the **Texts** tag on the number.
4. When a customer texts, the chatbot answers like the phone receptionist. It uses the same script and knowledge, and can book or take a message.
5. Texts and chats sit together in **Inbox**.
6. If a customer sends **STOP** (or UNSUBSCRIBE, CANCEL, END, QUIT), they get no more texts. **START** turns them back on.
7. Extra texts, such as reminders, are set under **Automations**: **Text-back after calls**, **Appointment reminders**, **Missed-call follow-up**, **Review requests**.

---

## 3. AI email agent

1. Open **Clients**, choose the client, press **Open and edit**, then **Apps**.
2. Find **Email inbox** and press **Connect**.
3. Enter the **Email address** and its **App password**. For Gmail or Outlook, make an app password in the account's security settings first.
4. Pick **Replies**:
   - **Save as drafts for me to send**: replies wait in the Drafts folder. Start here.
   - **Send automatically**: replies go out on their own.
5. Press **Connect**. It reads new mail every minute. Press **Check now** to test.
6. To change **Replies** later, press **Disconnect** and connect again. The setting is locked once connected.

---

## Connect your apps

Open the client's **Apps** tab.

- **Calendar:** press **Connect** on **Google Calendar** or **Microsoft Outlook Calendar** and sign in. One calendar per client. The built-in calendar needs nothing. Press **Check free times** to test.
- **ServiceM8, Cliniko, Xero:** paste the **API key**, press **Save**, then **Test connection**. Switch on **Send bookings** to send each booking, callback and call summary. Pick the options shown (location, practitioner, appointment type).
- **MCP link:** under **MCP link**, paste the address (and a header name and value if it needs one), press **Save**. The phone receptionist uses it.
- **Webhook:** press **Connect** on **Webhook / custom CRM**, enter the HTTPS **Endpoint URL**. Every booking and callback is sent there as JSON. Check the **Signing secret** on your end.
- **Pipedream (optional):** you add your Pipedream key once under **Connections**, then **Pipedream**, **Add key**. Clients then see **Connect an app** for thousands more apps.

---

## Approvals

1. In the client's **General** tab, turn on **Bookings need my approval**.
2. New bookings wait under **Needs your approval** at the top of **Calendar**.
3. Press **Approve** or **Decline**. The customer is told either way.

---

## Branding

1. Your agency: open **Brand**. Upload your logo, pick colours, press **Save colours**.
2. One client: open the client, find **Branding**. Upload their logo, pick colours, press **Save colours**. Empty fields use yours.
3. Turn on **Lock: the client can't change its own logo or colours** to stop changes.
4. Left unlocked, the client can change theirs in their own **Brand** tab.

---

## Backups

1. Open **Settings**, then **Backups**.
2. A copy of everything is saved every day. The last 7 are kept.
3. Press **Back up now** before big changes. Press **Download latest** to keep a copy.
4. Under **Copy off-site**, enter your storage details and press **Save** to send each backup to your own storage.

---

## Balances and top-ups

1. Open **Connections** and look at **Balances**.
2. Press **Top up** next to any low balance.
3. If credit runs out, receptionists stop answering. Keep auto-recharge on with your phone provider.
4. Check **Overview** for anything under **Needs attention**.
