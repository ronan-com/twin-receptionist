# What we can see, and how to switch it off

Your agency runs in your own accounts. After setup we hold no keys and have no login to your hosting, database or phone account. Two things stay connected to the company that set you up (we call it "your setup provider" or "we" below), and both are your choice. Both are **on by default** so we can spot problems and help you quickly. Both can be turned off at any time from the same place.

**Where:** your dashboard, **Settings**, then the **Support** tab. Only the owner can change these switches. (Updates are on the **Updates** tab next to it.)

---

## 1. Health and usage stats

**On by default. Switch: "Share health and usage stats with your setup provider".**

Every 15 minutes your agency sends us a small fixed summary. It can't send anything else, because anything outside this list is thrown away on our side:

- The app's version and its web address
- Whether it is healthy, and how many problems were logged
- Counts only: agencies, clients, receptionists, phone numbers, calls in the last 24 hours, 7 days and 30 days, bookings in the last 7 days, and errors in the last 24 hours
- When the last call came in
- Your brand's name and logo address
- Yes or no for your optional extras: email, your own domain, AI help
- Whether sharing, Support access and "Support can make changes" are on
- What went wrong in the last 24 hours: a short kind, a one-line description (numbers, email addresses and anything in quotes are masked), how many times, and when (up to 50)
- Whether automatic updates are on, which version is newest, and how the last update went

We **never** receive caller names or numbers, messages, transcripts, recordings, customer details, passwords or keys. We keep the latest summary and a short history of the counts.

**Switch it off:** Settings, Support, turn **Share health and usage stats** to Off. Nothing is sent after that. The Settings page shows when it last sent.

## 2. Support access

**On by default for a fresh install, until you choose. Switch: "Let your setup provider sign in to your dashboard to help you".**

While it is on, we can sign in to your dashboard as a support person.

- We sign in through a **one-time link that works for 60 seconds** and can be used once. Nobody has a password for your dashboard.
- A support session lasts up to 8 hours, and ends sooner if you turn access off or it was set to expire.
- We can see your dashboard, including calls and messages, so we can work out what went wrong. We can also ask your agency for its last 200 log lines, with numbers, emails and names masked.
- We can **never** see or change your keys or connection secrets, billing, the owner account or anyone's password, delete your agency, or export your data.
- Every link we ask for, every sign-in, and every refused request is recorded in your **Audit Log** and shown under **Support activity** in Settings, Support.

**Switch it off:** Settings, Support, turn the Support access switch to Off. Any open support session ends straight away, and any new link request is refused (and logged). When you turn it on yourself you choose how long: 24 hours, 7 days, or until you turn it off.

### "Support can make changes"

**On by default. Switch: "Let your setup provider fix things while they're signed in".** It only applies while Support access is on.

With it on, a support session can fix things the way an agency admin can: receptionists, automations, website chat, knowledge, clients, branding and settings, and **phone numbers, including buying a number on your phone account (Telnyx)**. Buying a number is a real charge on your account. Each change is recorded in your Audit Log as "By support".

**Switch it off:** Settings, Support, turn **Support can make changes** to Off. Support becomes view only, and any change is refused.

---

## Other things that reach us

- **Help requests.** If you send a request from **Support requests** in your dashboard, we receive that message, and our replies come back there. Nothing is sent unless you send it.
- **Updates.** Your agency checks us hourly for a new version and installs it in your own Railway project, if automatic updates are on. We don't receive anything about you from this. Turn it off in Settings, **Updates**, **Automatic updates**, and nothing updates until you press "Update your agency" on your setup link.
- **Owner password reset.** If you are locked out, your private setup link can make a one-time owner reset link. This works even with Support access off. It is recorded in your Audit Log.

## Quick reference

| What | Default | Where | Effect of turning it off |
|---|---|---|---|
| Share health and usage stats | On | Settings, Support | Nothing is sent to us |
| Support access | On (until you choose) | Settings, Support | We can't sign in; open sessions end |
| Support can make changes | On | Settings, Support | We can look but not change anything (incl. buying numbers) |
| Automatic updates | On (overnight) | Settings, Updates | No automatic updates |

Check what happened at any time: **Audit Log** (left menu) and **Support activity** (Settings, Support).
