# Your first hour

You've finished the wizard and app.{{domain}} is live. Here's what to do next, in order. Menu names below are the ones in your dashboard.

## 1. Create your owner account (2 minutes)

1. Open `https://app.{{domain}}`.
2. Click **Create an account** and use the owner email you gave the wizard. Only that address can create the first account.
3. Pick a password of at least 10 characters and save it in your password manager.

That account is your agency's owner. It sees every client and call. After it exists, new people join by invite only.

If you forget the password later, use **Forgot password** on the sign-in page. The reset link works for 60 minutes. It needs email working (see step 7).

## 2. Set your branding (5 minutes)

1. Open **Settings → Branding**.
2. Add your logo and colours. These show on your clients' screens unless a client has its own branding (set on that client's page).
3. In **Settings → Team**, set your team name and invite anyone who works with you. Owners and admins can invite people; members can work on clients.

Your brand name ({{brand}}) was set by the wizard. To change it, see "Changing a setting" in the operating guide.

## 3. Add your first client (5 minutes)

1. Open **Clients** and click **New receptionist** (or **Create your first receptionist** on the Overview).
2. Fill in the business, opening hours, what callers can ask for, and the voice. It only offers times inside the hours you set.
3. Click create. It takes a few seconds. You can change any of this afterwards.

## 4. Get a phone number

Every client's number is on your Telnyx account.

1. Open the client's page and click **Buy a number**.
2. You see the number's monthly price before you confirm. It's charged to your Telnyx account each month.

The dashboard searches for Australian numbers. Australian numbers need proof of address in Telnyx, and mobiles also need ID. Telnyx approves them in about three days. Until then a number shows as ordered, not connected.

## 5. Hear your receptionist

1. On the client's page, click **Open and edit**, then open **Receptionist**.
2. Click **Hear a sample**. You'll hear a real recorded example call, then your own settings read aloud by your browser. This isn't a live call or the receptionist's real voice.
3. To hear the real voice, ring the client's number once it's connected. The call, its outcome and transcript show under **Calls**.

> TODO (Ronan): the brief asks for "test call from the browser", and some screens say "You can test it from the browser meanwhile", but the current dashboard has no live browser call (the old one is in `src/legacy/`, not routed). Decide: bring back a live browser test call, or reword those screens. This step describes what the code does today.

## 6. Invite the client

1. On the client's page, under **Customers with access**, enter the person's email, pick **Manager** (can change its receptionists) or **Viewer** (looks only), and click **Invite customer**.
2. Or use **Send onboarding link**: it invites them as a manager to finish setting up in their own workspace. The link is emailed, and also shown so you can send it yourself.
3. Use **See what {client} sees** to check their view.

Your client then has their own workspace with Dashboard, Calls, Bookings, Follow-ups, Receptionist, Reports and Settings.

## 7. Email and calendar keys later

Skipped calendars, or need to change your email sender? You don't need to rerun the wizard.

1. Open **Settings → Email and calendars** (owner only).
2. **Account emails:** the mail server address and the Send from name. Click **Send test email** to check it. If this isn't set, emails are written to the app's log in Railway instead of being sent.
3. **Google** and **Microsoft:** copy the redirect URI shown into the provider's console, paste the Client ID and Client secret, and click **Check**.

What you save here is used straight away and replaces the setting from the install. Secrets are stored encrypted, and only their last 4 characters are shown again.

## Before you close the tab

- Check **Phone Numbers**: your client's number should be listed.
- Check you've deleted the Railway and Cloudflare setup tokens (see the ownership checklist).
- Check backups are on for the Postgres volume in Railway (see the operating guide).
- Check all your provider logins are in your password manager.
