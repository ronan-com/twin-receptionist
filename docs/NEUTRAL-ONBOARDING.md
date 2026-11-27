# Shared onboarding, separate businesses

The onboarding portal is shared infrastructure. Chloe is one buyer brand, not the portal's identity.

Default flow:
1. Add an agency using Generic style, or create one generic onboarding link for multiple buyers.
2. Each buyer gets their own private setup and account state.
3. They confirm their owner email, connect their accounts and install.
4. With no brand supplied, their copy starts as "Your agency": no logo and neutral colours.
5. The owner creates their account without choosing a brand. Branding does not block the get-started checklist.
6. Jesse adds the agency name in Settings > Team and uploads its logo and colours in Settings > Branding.
   The signed-in agency header follows that saved name and logo. Customer workspaces inherit its branding.

The generic portal stays neutral even after an agency is branded. Existing saved business names, logos and colours are preserved. Legacy setup styles render through the neutral portal. Admins can still provide a brand during
an assisted install when requested.

Plain installs receive NEUTRAL_DASHBOARD=1, with no initial BRAND_COLOUR or BRAND_LOGO_PNG.
Saved custom colours override the neutral theme. PRODUCT_NAME is the generic "Your agency"
until changed in the installation configuration; signed-out pages and emails use that product
name. To use the final business name on those pages too, set PRODUCT_NAME to that buyer's
name during manual branding. The neutral base theme can remain on because saved colours win.

The shared setup address must stay generic. Keep the current sslip address and the legacy API
routes used by installed agencies. No buyer's marketing site is part of this portal.

Implementation is on fix-neutral-owner-onboarding, including the earlier UI refresh.
No automatic conversion or reset of existing buyers is performed by this change.
