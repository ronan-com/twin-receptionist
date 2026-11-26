---
id: stripe
title: Get paid by your clients with Stripe
time: 20 minutes, then 7–14 days until your first payout
cost: No monthly fee. In Australia, 1.65% + A$0.30 per domestic card payment, 3.5% + A$0.30 for international cards. Invoices add 0.4% per paid invoice.
link: https://dashboard.stripe.com/register
verified: 2026-11-26
sources: [https://docs.stripe.com/get-started/account/activate, https://docs.stripe.com/payment-links/create, https://docs.stripe.com/invoicing/dashboard, https://docs.stripe.com/payouts, https://stripe.com/au/pricing]
---
## What it's for
Stripe is how you charge **your** clients for their receptionist. It isn't connected to the app. You bill clients from Stripe yourself, with a payment link or an invoice.

## Steps
1. Create a Stripe account and confirm your email.
2. Turn on two-step sign-in in your user settings. Stripe recommends a passkey or security key.
3. Click to verify your business. Enter your business details, what you sell, and your role in the business.
4. Add the bank account your money should go to (BSB and account number) in **Payout settings**.
5. Check your public details: business name, support email and phone, and the statement descriptor (the name clients see on their card statement). Make it obviously you.
6. **To charge a monthly fee:** go to **Payment Links**, click **+New**, then **+Add a new product**. Name it (for example "AI receptionist, monthly"), set the price as recurring monthly, click **Add product**, then **Create link**. Send the link to your client.
7. **To send an invoice:** go to **Invoices**, click **Create Invoice**, choose or add the customer, click **Add one-time item**, enter the **Quantity** and **Price**, choose **Email invoice with link**, then click **Review invoice** and send it.

## What to paste into the wizard
Nothing. Stripe isn't connected to the receptionist app.

## Permissions / scopes
None.

## Watch out for
- You can try everything in a sandbox first, but you can only take real payments once Stripe has verified your business.
- Once you take live payments, you can't change the business's country. Pick Australia (or your real country) from the start.
- Your first payout usually arrives 7 to 14 days after your first live payment. After that, Australian payouts take about 2 business days.
- Before you can send invoices, Stripe asks you to choose a Billing plan in the Dashboard.
- Unconfirmed: the exact wording of the "monthly" (recurring) option when you add a product.
- If a client doesn't recognise your statement descriptor, they might dispute the charge. Keep it close to your business name.
- Stripe says its Australian card fees include GST. Check current pricing at [stripe.com/au/pricing](https://stripe.com/au/pricing).
