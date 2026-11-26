# Chloe owner quickstart

Use this once your setup link has finished and app.[THEIR DOMAIN] is live. Menu and button names below are the ones in your dashboard.

Use fictional family details for every test.

---

## 1. First sign-in (2 minutes)

1. Open `https://app.[THEIR DOMAIN]`.
2. Click **Create an account**. Use the owner email you gave the setup wizard. Only that address can create the first account.
3. Choose a password of at least 10 characters. Save it in your password manager.

This is the owner account. It sees every centre and every call. After it exists, new people join by invite only.

Forgot it later? Click **Forgot password?** on the sign-in page. The reset link works for 60 minutes.

## 2. Set your brand (5 minutes)

1. Open **Settings**, then the **Branding** tab.
2. Add your logo and set your colours (Primary, Accent, and optionally Sidebar and Background). The preview shows how it looks.
3. These show on every centre's screens, unless a centre has its own branding (set on that centre's page).
4. On the **Team** tab, check your team name and invite anyone who works with you. Owners and admins can invite people. Members can work on centres.

Your brand name (for example Chloe) was set in the setup wizard. To change it later, see the operating guide.

## 3. Create the first centre's receptionist (10 minutes)

Have the director's completed Centre setup form (Centre-Intake-Form.docx) in front of you.

Open **Clients** and click **New receptionist**. There are five steps.

**Step 1: Client and business**
- **Client:** leave it on *New client (named after the business)*.
- **Business name:** the centre's trading name.
- **How do you say the business name?** Only if it isn't obvious. Write it the way it sounds.
- Business type: pick **Childcare or early learning centre**. This sets the childcare services, hours, greeting and starter answers.
- **What does the business do?** A sentence or two, for example ages and programmes.
- **Suburb or town**, **Time zone** and **Street address**.

**Step 2: Hours and services**
- *When would you like the AI receptionist to be active?* Choose **Set specific times** and enter the centre's hours. The childcare default is weekdays 6:30am to 6:30pm, closed weekends. Tours are only offered inside these hours.
- **Closures and public holidays:** one per line, from the intake form.
- *What can callers ask it for?* The childcare defaults are: Book a centre tour, Enrolment or waitlist enquiry, Fees and subsidy question, Message for the director. Add or remove as the director wants.
- **Anything else callers often ask?** Parking, what to bring, arrival instructions.

**Step 3: Voice**
- **Receptionist's name:** for example Chloe.
- *How should it sound?* **Friendly** suits most centres.
- Pick a voice. All of them are Australian.
- Under **Ready-made greetings**, pick **Childcare centre**, or write your own in **Greeting** using the director's approved opening from Privacy-and-Call-Wording.docx. Keep the part that says it's an AI receptionist. Only say the call is recorded if recording is on for this centre.

**Step 4: Urgent calls**
- **Phone number:** the staff fallback number from the intake form. An Australian mobile or landline.
- **Whose number is it?** Callers hear "putting you through to ...", for example "the director".
- Leave **Also put callers through when they ask for a person** on, unless the director says otherwise.
- **Topics to pass to staff:** add the childcare suggestions: Private child or family matters, Collection or custody arrangements, Health or medical matters, Complaints. The receptionist won't discuss these. It offers to pass a message to the team.

**Step 5: Review**
- Check every line, then click **Create receptionist**. It takes a few seconds. You land on the centre's page. You can change any of this later.

## 4. Check the starter answers with the director

A childcare receptionist starts with seven answers from the centre pack. They are live as soon as it's created, so check them before the centre's number goes live.

To find them: on the centre's page, click **Open and edit**, then **Receptionist**, then **Business knowledge**. Each one is titled "(starter answer: director to check)".

Go through each one with the director. Replace the suggested direction with their exact wording, then remove "(starter answer: director to check)" from the title. Record who approved it and when in Approved-Answers.csv.

| Topic | Parent asks | Starter direction | Check with the director |
|---|---|---|---|
| Tours | Can I visit? | Offer available tours from the designated calendar. Confirm only after booking succeeds. | Tour length, days and times, how many families per tour |
| Availability | Is there a place for my child? | Ask the enrolments team to call back. A tour does not reserve a place. | Who calls back, and whether to mention waitlists |
| Fees | What will it cost? | Use the current fee sheet approved by the director or offer a callback. | The approved fee wording, or callback only |
| Hours and parking | When are you open and where do I go? | Use verified opening times, closures, address and arrival instructions for this centre. | Hours, closures, parking, which door |
| Family matters | Can I change collection arrangements? | Refer to authorised staff. Avoid collecting private child or family details in the call summary. | Who handles it |
| Urgent | I need somebody urgently. | Use the director-approved urgent call instructions and fixed staff fallback. | The fallback number and staffed hours |
| Booking changes | Can I cancel or move my visit? | Take the minimum callback details and pass the change to the centre team. | Who handles changes, and the notice needed |

Whatever the answers say, the receptionist never discusses an individual child, collection, custody or health matters, and never promises a place, enrolment, start date or fee unless an approved answer says so. If a child may be in danger right now, it tells the caller to call triple zero.

Later, check **Questions your receptionist couldn't answer** on the same page and add approved answers for them.

## 5. Connect the tour calendar

Do this inside the centre's workspace (centre's page, **Open and edit**).

1. Open **Settings**, then **Integrations**.
2. Under Calendar, pick **Google Calendar** or **Microsoft Outlook Calendar** and click **Connect**. Or use the built-in calendar (nothing to connect; tours show in **Bookings**).
3. Set **Appointment length** to the centre's tour length.
4. In **Email each booking to**, enter the staff address that should get each booking and callback. This is the staff summary.
5. Check **Take bookings on calls** is on, then **Continue to sign in**. Sign in with the account that owns the centre's tour calendar.

Tours are offered inside the receptionist's active hours, one appointment length at a time, skipping anything already busy in that calendar. To block a time, add a busy event to the calendar.

Google or Microsoft only appears here if you set it up in the setup wizard's Calendars step, or later under **Settings**, **Email and calendars**.

## 6. Test-call the receptionist

1. On the centre's page, under **Test call**, click **Talk to this receptionist**. Allow your microphone. This is a live call from your browser. No phone number is needed.
2. Ask an approved question, ask to book a tour, and ask for a person.
3. The call, its outcome and transcript show under **Calls**.

Then get the centre a phone number:

1. On the centre's page, click **Buy a number**. You see the monthly price before you confirm. Telnyx charges your account each month until you release it.
2. Australian numbers need proof of address in Telnyx (mobiles also need ID). Approval takes about three days. Until then the number shows as ordered, not connected.
3. Once it's connected, ring it from a mobile and run the acceptance checks (acceptance-checklist.csv) with the director.

Only after those pass, have the centre forward its public number to the receptionist's number, using the routing the director approved. Write down the centre's original forwarding first, so you can put it back.

## 7. Invite the centre's staff

On the centre's page, under **Customers with access**:

1. Enter the person's work email in **Invite customer (email)**.
2. Pick **Manager** (can change the receptionist) or **Viewer** (can only look).
3. Click **Invite customer**. The invite is emailed. The link is also shown, so you can send it yourself.

Or click **Send onboarding link**. It invites the director as a manager to finish setting up in their own workspace.

Click **See what [centre] sees** to check their view. Each centre's staff see only their own centre.

## 8. Where bookings show

- **The centre's calendar:** one event per tour, with the parent's name and phone.
- **Bookings** in the centre's workspace: every tour the receptionist has booked.
- **Follow-ups** in the centre's workspace: everyone who asked for a call back.
- **Calls:** every call, with outcome and transcript.
- **Email:** staff get "New booking" or "Call back" at the **Email each booking to** address. The parent gets a confirmation email if they gave one.
- **Your dashboard:** **Overview** shows bookings and follow-ups across all centres. Each centre's page has a **Bookings and follow-ups** panel.

Staff handle changes and cancellations in the calendar.

## 9. If something breaks

**Calls stop.** Work down this list. Most problems are the first two.
1. **Telnyx credit.** Telnyx, Billing. No credit, no calls. Top up and turn on Auto Recharge.
2. **Telnyx account level.** Profile, Account Level should say Paid.
3. **The number.** On the centre's page, check it's listed under **Phone number**. In Telnyx, check it's active and not still waiting for approval.
4. **Paused.** A paused receptionist or centre shows **Paused**. Click **Resume**.
5. **The app.** Open `https://app.[THEIR DOMAIN]/api/health`. If it doesn't answer, open the app in Railway and read the latest deployment's logs. Check Railway hasn't stopped it for a usage limit or failed payment.

While calls are down, have the centre switch its forwarding back to its original route. Switch it back to the receptionist only after a test call works.

**A booking fails.** The receptionist takes a callback instead, so check **Follow-ups**. In the centre's **Settings**, **Integrations**, check the calendar still shows Connected. If not, sign in again.

**Nobody gets emails.** **Settings**, **Email and calendars**, **Send test email**. In Resend, check your domain still shows Verified.

**Locked out.** Use **Forgot password?**. If the email doesn't arrive, the reset link is written to the app's log in Railway.

**Your dashboard shows problems.** **Overview**, Needs attention, and **System / QA** list failed calls and background problems.

Backups, logs, costs and settings are in the operating guide (operating-guide.md). What you own and how to keep access is in the ownership checklist (ownership-checklist.md).

## Every day and week

- **Every day:** check failed or missed calls and open follow-ups first. Compare new tours with the centre calendar. Give each open item a person and a time.
- **Every week:** place a test call to each centre. Review unanswered questions with directors. Check Telnyx credit and Railway usage.
- **Every month:** check supplier bills, backups and who has access to each centre.
