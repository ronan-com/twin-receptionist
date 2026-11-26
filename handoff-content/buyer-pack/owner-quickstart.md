# Chloe owner quickstart

Use this once your setup link says your agency is live. Your address is on the last setup screen: the https address Railway gave it (ending .up.railway.app), or app.[THEIR DOMAIN] if you added your own. Button and menu names below are the ones in your dashboard. Use fictional family details for every test.

**Stuck at any point?** Click **Need help?** on the setup site, or see section 9.

---

## 1. First sign-in (2 minutes)

1. Open your agency address.
2. Click **Create an account** and use the owner email you gave the setup wizard. Only that email can make the first account.
3. Choose a password of at least 10 characters and save it in your password manager.

You'll see your dashboard. This owner account sees every centre and every call. Everyone else joins by invite.

> **Stuck?** Forgot your password: click **Forgot password?**. The link works for 60 minutes and arrives by email once email is set up (section 10). Until then it's written to the app's log in Railway.

## 2. Set your brand (5 minutes)

1. Open **Settings**, then the **Branding** tab.
2. Add your logo and pick your colours. The preview updates as you go.
3. Open the **Team** tab and invite anyone who works with you.

You'll see your logo and colours on every centre's screens, unless a centre has its own branding. To change your brand name, see the operating guide.

## 3. Create the first centre's receptionist (10 minutes)

Have the director's completed Centre setup form (Centre-Intake-Form.docx) open.

1. Open **Clients** and click **New receptionist**.
2. **Client and business:** leave **Client** on *New client*, type the **Business name**, pick **Childcare or early learning centre**, and add suburb, **Time zone** and street address.
3. **Hours and services:** choose **Set specific times**, then enter the centre's hours, closures and public holidays. Keep or edit the starter services (tour, enrolment or waitlist, fees, message for the director).
4. **Voice and urgent calls:** type the **Receptionist's name** (for example Chloe), pick a voice and a **Ready-made greeting**, then enter the director's **Phone number** for urgent calls.
5. **Review:** check every line and click **Create receptionist**.

You'll land on the centre's page. You can change anything later.

Two things to get right:
- Keep the greeting's line that says it's an AI receptionist. Only say the call is recorded if recording is on for this centre.
- Under **Topics to pass to staff**, add: Private child or family matters, Collection or custody arrangements, Health or medical matters, Complaints. The receptionist won't discuss these. It offers to pass on a message.

> **Stuck?** The greeting wording must be the director's approved opening (Privacy-and-Call-Wording.docx). If you don't have it yet, don't give out the number.

## 4. Check the starter answers with the director

A childcare receptionist starts with seven answers. They're live as soon as it's created, so check them before the number goes live.

1. On the centre's page click **Open and edit**, then **Receptionist**, then **Business knowledge**.
2. Open each answer titled "(starter answer: director to check)".
3. Replace the suggested direction with the director's exact wording.
4. Remove "(starter answer: director to check)" from the title.
5. Write who approved it, and when, in Approved-Answers.csv.

| Topic | Parent asks | Check with the director |
|---|---|---|
| Tours | Can I visit? | Tour length, days and times, families per tour |
| Availability | Is there a place for my child? | Who calls back, and whether to mention waitlists |
| Fees | What will it cost? | The approved fee wording, or callback only |
| Hours and parking | When are you open and where do I go? | Hours, closures, parking, which door |
| Family matters | Can I change collection arrangements? | Who handles it |
| Urgent | I need somebody urgently. | The fallback number and staffed hours |
| Booking changes | Can I cancel or move my visit? | Who handles changes, and the notice needed |

The receptionist never discusses an individual child, collection, custody or health, and never promises a place, start date or fee unless an approved answer says so. If a child may be in danger right now, it tells the caller to call triple zero.

Later, open **Questions your receptionist couldn't answer** on the same page and add approved answers for them.

## 5. Connect the tour calendar (5 minutes)

Do this inside the centre's workspace (the centre's page, then **Open and edit**).

1. Open **Settings**, then **Integrations**.
2. Under Calendar, choose **Google Calendar** or **Microsoft Outlook Calendar** and click **Connect**. Or use the built-in calendar: nothing to connect, and tours show in **Bookings**.
3. Set **Appointment length** to the centre's tour length.
4. In **Email each booking to**, type the staff address that should get each booking and callback.
5. Make sure **Take bookings on calls** is on, then click **Continue to sign in** and sign in with the account that owns the tour calendar.

You'll see the calendar marked **Connected**. Tours are only offered inside active hours and skip anything already busy. To block a time, add a busy event to the calendar.

> **Stuck?** Google or Microsoft isn't listed: you haven't set it up yet. Add it under **Settings**, then **Email and calendars** (section 10).

## 6. Test-call it, then get a number

1. On the centre's page, under **Test call**, click **Talk to this receptionist**. Allow your microphone. No phone number is needed.
2. Ask an approved question, ask to book a tour, and ask for a person.
3. Open **Calls** to see the call, its outcome and the transcript.
4. Click **Buy a number**. You'll see the monthly price before you confirm.
5. Once the number says connected, ring it from a mobile and run the acceptance checks (acceptance-checklist.csv) with the director.

Only after those pass, have the centre forward its public number to the receptionist's number, using the routing the director approved. Write down the centre's original forwarding first, so you can put it back.

> **Stuck?** Australian numbers need proof of address in Telnyx (mobiles also need ID) and take 1 to 3 days. Until then the number shows as ordered, not connected.

## 7. Invite the centre's staff

1. On the centre's page, find **Customers with access**.
2. Type the person's work email in **Invite customer (email)**.
3. Pick **Manager** (can change the receptionist) or **Viewer** (can only look).
4. Click **Invite customer**.
5. To check their view, click **See what [centre] sees**.

The invite is emailed if email is set up. The link is always shown, so you can copy it and send it yourself. To invite the director to finish setting up in their own workspace, click **Send onboarding link** instead.

## 8. Where bookings show

- **The centre's calendar:** one event per tour, with the parent's name and phone.
- **Bookings** and **Follow-ups** in the centre's workspace: every tour booked and everyone who asked for a call back.
- **Calls:** every call, with outcome and transcript.
- **Email:** staff get "New booking" or "Call back" at the **Email each booking to** address. The parent gets a confirmation if they gave an email.
- **Overview** on your dashboard: bookings and follow-ups across every centre.

Staff handle changes and cancellations in the calendar.

## 9. If something breaks

**Calls stop.** Go down this list. Most problems are the first two.
1. **Telnyx credit.** Open Telnyx, then **Billing**. No credit, no calls. Top up and turn on **Auto Recharge**.
2. **Telnyx account level.** Click your profile icon, then **Account Level**. It should say **Paid**.
3. **The number.** On the centre's page check it's listed under **Phone number**, and active in Telnyx.
4. **Paused.** A paused receptionist or centre shows **Paused**. Click **Resume**.
5. **The app.** Open your agency address followed by `/api/health`. If it doesn't answer, open the app in Railway, read the latest deployment's logs, and check Railway hasn't stopped it for a usage limit or failed payment.

While calls are down, have the centre switch its forwarding back to its original route. Switch it back only after a test call works.

**A booking fails.** The receptionist takes a callback instead, so check **Follow-ups**. In **Settings**, **Integrations**, check the calendar still says **Connected**. If not, sign in again.

**Nobody gets emails.** Check email is set up (section 10), then click **Settings**, **Email and calendars**, **Send test email**. In Resend, check your domain still says **Verified**.

**Locked out.** Use **Forgot password?**. If no email arrives, the reset link is in the app's log in Railway.

**Something looks wrong on your dashboard.** **Overview**, **Needs attention**, and **System / QA** list failed calls and background problems.

## 10. Optional extras you can add later

Your agency works without these. Your setup link keeps listing any you skipped, with the same steps.

**Your own email** (5 minutes)
1. Open **Settings**, then **Email and calendars**.
2. Paste the mail server address and the address emails come from. For Resend the address is `smtps://resend:YOUR_KEY@smtp.resend.com:465`.
3. Click **Send test email**.
4. Add the DNS records Resend shows for your domain.

Until then, invite links show on screen for you to copy and send.

**Your own domain** (10 minutes, then a wait)
1. In Railway, open the **app** service, then **Settings**, **Networking**, **Custom Domain**.
2. Type `app.yourbusiness.com` and add the CNAME and TXT records Railway shows.
3. When it says active, open **Variables** and change `PUBLIC_URL` to `https://app.yourbusiness.com`.

**Calendars** (20 minutes)
1. Make a Google Cloud or Microsoft Entra app (see the guides on the setup site).
2. Use your agency address plus `/api/oauth/google/callback` (or `/microsoft/callback`) as its redirect address.
3. Paste the client ID and secret under **Settings**, **Email and calendars**.

**AI help for your team** (5 minutes)
1. Make an account at openrouter.ai, create an API key and add a few dollars of credit.
2. In Railway, open the **app** service, then **Variables**, and add `OPENROUTER_API_KEY` with the key.

An **Ask for help** button then appears at the bottom right of your dashboard. Optional: `OPENROUTER_MODEL` picks a different model.

**Sharing and support** (**Settings**, **Support**). Two switches, both yours. **Share health and usage stats with your setup provider** is on by default: every 15 minutes your agency sends counts and health, never callers, messages, recordings or keys. **Support access** is off unless you turn it on: it lets your setup provider sign in read-only to help you, for 24 hours, 7 days or until you turn it off. Every support sign-in is in your audit log.

Backups, logs, costs and settings are in the operating guide (operating-guide.md). What you own and how to keep access is in the ownership checklist (ownership-checklist.md).

## Every day and week

- **Every day:** check failed or missed calls and open follow-ups first. Compare new tours with the centre calendar.
- **Every week:** place a test call to each centre. Review unanswered questions with directors. Check Telnyx credit and Railway usage.
- **Every month:** check supplier bills, backups and who has access to each centre.
