# Landing page copy (public home page)

No prices on this page. `{{brand}}` is not used here: the buyer hasn't named their brand yet, so examples say "Chloe".

---

## Hero

**Headline:** Your own AI receptionist agency, on accounts you own

**Sub:** Get a complete AI receptionist agency under your brand, on your own hosting, domain and phone account. Sell receptionists to local businesses under your name. You own all of it.

**Buttons:** `See what's included` · `Have a setup link?`

---

## What's included

**A dashboard under your brand**
Your brand name, logo and colours, at app.your-domain. Call it Chloe, or anything you like.

**AI receptionists for your clients**
Each client gets a receptionist that answers their phone number, books appointments inside their opening hours, takes messages and passes on callers who need a person.

**A workspace for every client**
Your clients sign in to see their calls with transcripts, bookings, follow-ups and reports, and to update what their receptionist knows.

**Your team**
Invite the people who work with you. Owners and admins can invite people; members work on clients.

**Calendar booking**
Clients connect Google or Outlook calendars, and receptionists book into them.

**Phone numbers from the dashboard**
Pick a number for each client, see its monthly price, and connect it in a few clicks.

**Hosting you don't have to look after**
Your agency and its database run in your own Railway account. No server to patch.

---

## How it works

1. **Buy the package.** We email you a private setup link.
2. **Connect your accounts.** The setup wizard walks you through Railway, Telnyx, Resend and your domain, and checks each key as you go.
3. **The wizard installs it.** It sets up your agency in your Railway account at app.your-domain. This takes about 10 minutes.
4. **Sign in and add your first client.** From then on, it's yours to run.

---

## What you need

- A domain you own, with any registrar
- A Railway account on the Hobby plan (for hosting)
- A Telnyx account (for phone numbers and calls)
- A Resend account (for sending email)
- Optional: Google or Microsoft accounts, for calendar sign-in
- About 20 minutes, plus time for the providers' own checks

---

## FAQ

**What will hosting cost me each month?**
You pay each provider directly, at their prices. Railway's Hobby plan is US$5 a month, which includes US$5 of usage; you pay more only if you use more. Telnyx charges for each phone number and for call minutes, from prepaid credit. Resend has a free plan that suits a small start. Our operating guide lists current prices with links to each provider.

**Who owns it?**
You do. The hosting, database, domain, phone numbers and every account are in your name. After setup, we have no login to any of them. Your agency shares health counts with us unless you switch that off, and we can only sign in if you turn Support access on.

**Can I use my own domain and registrar?**
Yes. Use any domain you own. If its DNS is on Cloudflare, the wizard adds the records for you. If not, it shows you the exact records to add at your registrar and checks them for you. Your main website stays as it is: the dashboard goes at app.your-domain.

**Do I need to be technical?**
No. If you can sign up for an online account and copy a key, you can do this. The wizard tells you where to click at each provider and checks every step. Later tasks, like turning on backups or changing a setting, are done in Railway's dashboard. Our guide says where to click.

**What about support and updates?**
TODO (Ronan): update and support policy not decided. Fill in: what's included, for how long, and how updates are delivered.

**Does it work in Australia and the US?**
It's built for Australia first. The dashboard finds Australian numbers, and the voices are Australian. Australian numbers need proof of address, and mobiles also need ID. Telnyx approves them in about three days.
TODO (Ronan): the dashboard only searches Australian numbers today (`server/numbers.ts`) and lists Australian voices. Decide whether to support US numbers and voices before saying yes to US buyers.

**Where is my clients' data kept?**
In your Railway project, in the region your Railway account prefers. Railway has no Australian region; Singapore is the closest. Calls run on your Telnyx account, and emails go out through your Resend account. We don't receive your call records or client data.
TODO (Ronan): decide whether we give buyers a privacy policy or terms template for their own clients.

**Can I change the name later?**
Yes. Your brand name is a setting in your Railway project. Change it there, and every screen and email uses the new name.

---

## Footer box

**Have a setup link?** Open the link from your welcome email to start, or come back to where you left off.
