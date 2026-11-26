---
id: registrar-nameservers
title: Change your nameservers (optional)
time: 5 minutes, then a few hours (up to 48)
cost: Free
link: https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
verified: 2026-11-27
sources: [https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/, https://www.godaddy.com/help/change-my-domain-nameservers-664, https://www.godaddy.com/help/article/edit-my-domain-nameservers-664, https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/how-to-change-dns-for-a-domain/, https://www.crazydomains.com.au/help/article/change-the-name-servers-of-your-cd-domain, https://ventraip.com.au/support-centre/modifying-the-nameservers-on-a-domain-name-registration/, https://support.squarespace.com/hc/en-us/articles/4404183898125-Making-changes-to-nameservers, https://support.squarespace.com/hc/en-us/articles/17131164996365-About-the-Google-Domains-migration-to-Squarespace, https://support.squarespace.com/hc/en-us/articles/24615057474061-Managing-domains-registered-through-Google-Workspace, https://kb.porkbun.com/article/22-how-to-change-nameservers]
---
Optional. Do this where you **bought** your domain (GoDaddy, Namecheap, Crazy Domains, VentraIP, Squarespace, Porkbun and so on). You're swapping its nameservers for the two Cloudflare gave you.

1. Sign in where you bought the domain and open the domain's settings.
2. Find **Nameservers** (sometimes **DNS servers**). It's not the same as "DNS records".
3. Choose **Custom** (it might say "I'll use my own nameservers").
4. Delete the old ones and type in the two Cloudflare gave you. Save.
5. Go back to the wizard. It waits until Cloudflare says your domain is **Active**.

**GoDaddy:** **Domain Portfolio**, your domain, **DNS**, **Nameservers** tab, **Change Nameservers**, **I'll use my own nameservers**.
**Namecheap:** **Domain List**, **Manage**, **Nameservers**, choose **Custom DNS**, click the green tick.
**Crazy Domains:** **Account Manager**, your domain, **Name Servers** tab.
**VentraIP:** **VIPcontrol**, **Domains**, **DNS**, **Custom Nameservers** tab, **Enable**.

> **Stuck?** Can't find it? Ask your registrar's support: "How do I change my domain's nameservers to custom ones?" Changed the wrong thing? You need **nameservers**, not records inside the DNS list.
