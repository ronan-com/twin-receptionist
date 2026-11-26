# Landing page copy (public home page)

No prices on this page. `{{product}}` is not used here: the buyer hasn't named theirs yet, so examples say "Chloe".

---

## Hero

**Headline:** Your own AI receptionist business, on accounts you own

**Sub:** Get a complete, branded AI receptionist platform on your own server, domain and phone account. Sell it to local businesses under your name. You own all of it.

**Buttons:** `See what's included` · `Have a setup link?`

---

## What's included

**A dashboard under your brand**
Your product name, logo and colours, at app.your-domain. Call it Chloe, or anything you like.

**AI receptionists for your clients**
Each client gets a receptionist that answers their phone number, books appointments inside their opening hours, takes messages and passes on callers who need a person.

**A workspace for every client**
Your clients sign in to see their calls with transcripts, bookings, follow-ups and reports, and to update what their receptionist knows.

**Room for agencies**
Invite agencies to resell it. Each runs its own clients and team, on your phone account or their own.

**Calendar booking**
Clients connect Google or Outlook calendars, and receptionists book into them.

**Phone numbers from the dashboard**
Pick a number for each client, see its monthly price, and connect it in a few clicks.

**Backups built in**
Your server backs up its database every night and before every update.

---

## How it works

1. **Buy the package.** We email you a private setup link.
2. **Connect your accounts.** The setup wizard walks you through your domain, DigitalOcean, Telnyx and Resend, and checks each key as you go.
3. **The wizard installs it.** It creates your server and installs your dashboard at app.your-domain. This takes about 10 to 20 minutes.
4. **Sign in and add your first client.** From then on, it's yours to run.

---

## What you need

- A domain you own, with any registrar
- A DigitalOcean account (for your server)
- A Telnyx account (for phone numbers and calls)
- A Resend account (for sending email)
- Optional: Google or Microsoft accounts, for calendar sign-in
- About 20 to 30 minutes, plus time for the providers' own checks

---

## FAQ

**What will hosting cost me each month?**
You pay each provider directly, at their prices. A recommended server on DigitalOcean is a small monthly fee. Telnyx charges for each phone number and for call minutes, from prepaid credit. Resend has a free plan that suits a small start. Our operating guide lists current prices with links to each provider.

**Who owns it?**
You do. The server, database, domain, phone numbers and every account are in your name. After setup, we have no access to any of them.

**Can I use my own domain and registrar?**
Yes. Use any domain you own. If its DNS is on Cloudflare, the wizard adds the records for you. If not, it shows you the exact records to add at your registrar and checks them for you. Your main website stays as it is: the dashboard goes at app.your-domain.

**Do I need to be technical?**
No. If you can sign up for an online account and copy a key, you can do this. The wizard tells you where to click at each provider and checks every step. Some later tasks, like restoring a backup or installing an update, use a few commands we give you word for word.

**What about support and updates?**
TODO (Ronan): update and support policy not decided. Fill in: what's included, for how long, and how updates are delivered.

**Does it work in Australia and the US?**
It's built for Australia first. The dashboard finds Australian numbers, and the voices are Australian. Australian numbers need proof of address, and mobiles also need ID. Telnyx approves them in about three days.
TODO (Ronan): the dashboard only searches Australian numbers today (`server/numbers.ts`) and lists Australian voices. Decide whether to support US numbers and voices before saying yes to US buyers.

**Where is my clients' data kept?**
On your server, in the DigitalOcean location you choose (Sydney is the default). Calls run on your Telnyx account, and emails go out through your Resend account. We don't receive your call records or client data.
TODO (Ronan): decide whether we give buyers a privacy policy or terms template for their own clients.

**Can I change the name later?**
Yes. The product name is a setting on your server. Change it and rerun the install, and every screen and email uses the new name.

---

## Footer box

**Have a setup link?** Open the link from your welcome email to start, or come back to where you left off.
