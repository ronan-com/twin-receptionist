/** What to tell a person about an error Telnyx answered with. */
export const ACCOUNT_LEVEL_MSG = "Your Telnyx account needs verification or an upgrade for this. In Telnyx, open your profile, then Account Level.";

// Telnyx's wording for an account that isn't verified or paid up enough says nothing about what to do.
export const telnyxProblem = (detail: string): string => (/not permitted at this account level/i.test(detail) ? ACCOUNT_LEVEL_MSG : `The phone service said: ${detail}`);
