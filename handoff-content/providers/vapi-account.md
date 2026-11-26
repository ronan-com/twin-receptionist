---
id: vapi-account
title: Create your Vapi account
time: 5 minutes
cost: Free to open. Calls are charged per minute from your Vapi credit.
link: https://dashboard.vapi.ai/
verified: 2026-11-27
sources: [https://docs.vapi.ai/quickstart/introduction, https://docs.vapi.ai/phone-calling, https://docs.vapi.ai/free-telephony, https://docs.vapi.ai/phone-numbers/import-twilio, https://docs.vapi.ai/telnyx]
---
## What it's for
Vapi is the voice service your receptionists can run on instead of Telnyx. The account is yours: you see every call and charge there, and you pay Vapi directly.

## Steps
1. Open the Vapi dashboard and sign up with your work email.
2. Open **Billing** and add a card or credit, so calls aren't cut off.
3. Decide where your phone numbers will come from (see below).

## About phone numbers
Vapi gives away free **US** numbers only, and only for inbound calls. It does not sell Australian numbers. For an Australian number, use **Twilio**: add your Twilio Account SID and Auth Token (on the Phones step, or later under Connections), then buy a number or pick one you already have from each receptionist's page. You can also bring a number from **Telnyx**. Your number provider keeps billing you for the number itself. Australian numbers on Twilio need a regulatory bundle (business details and proof of address) approved in the Twilio console first.

## What's different from Telnyx
- Texts after calls, reminders and review requests go out through Twilio, from a Twilio mobile number the receptionist answers. Without one they stay off. The text simulator is a Telnyx feature and isn't available.
- A transfer that reaches voicemail isn't pulled back, and the silence limit isn't applied: Vapi has no setting for either.
- Email replies still use Telnyx's AI service. Add a Telnyx key on the phones step if you want them.

## Watch out for
- Vapi's own voices are American, British, Canadian or Indian. The Australian voices on offer come from Azure, through Vapi.
- If your credit runs out, receptionists stop answering until you top up.

> **Stuck?** No Australian number from Vapi is normal: connect Twilio (or bring a Telnyx number) and pick the number from each receptionist's page. Twilio says it needs a bundle: finish the regulatory bundle in the Twilio console first.
