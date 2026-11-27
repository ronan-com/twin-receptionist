// One colour per meaning across the dashboards (KPI tiles, icon badges, avatars,
// automation cards, chart legends). The CSS lives in src/styles.css ([data-hue]).
// "indigo" follows the workspace's brand primary.

export type Hue = "indigo" | "cyan" | "magenta" | "coral" | "amber" | "green" | "violet" | "sky" | "slate";

/** Colour for each hue, for SVG charts. The brand hues are CSS variables, so charts follow the agency's colours. */
export const HUE_HEX: Record<Hue, string> = {
  indigo: "var(--indigo)",
  cyan: "var(--brand-2)",
  magenta: "var(--brand-3)",
  coral: "#ff7a59",
  amber: "#f5a623",
  green: "#1ea672",
  violet: "var(--brand-3)",
  sky: "var(--brand-2)",
  slate: "#8898aa",
};

// Order matters: the first rule that matches wins ("Failed calls" is coral, not indigo).
const RULES: [RegExp, Hue][] = [
  [/resolved incident|no (open )?incident/i, "green"],
  [/fail|incident|error|missed|unresolved|spam|problem|drop|no-show/i, "coral"],
  [/paus|declined|inactive|\boff\b/i, "slate"],
  [/attention|pending|waiting|request|callback|overdue|\bdue\b|review|unanswered|question|unassigned|without|no number|not set up/i, "amber"],
  [/book|appointment|calendar|schedul|upcoming/i, "cyan"],
  [/lead|enquir|follow|contact|customer|caller|captur/i, "magenta"],
  [/resolution|resolved|success|rate|active|live|connected|health|uptime|shared|publish|\bwon\b|value|revenue/i, "green"],
  [/receptionist|agent|voice|assistant|bot|knowledge|number/i, "violet"],
  [/agenc|client|business|compan|team|member|user|seat|\borg|sign/i, "sky"],
  [/length|duration|avg|average|minute|time|usage|spend|cost|bill|plan|sms|text|updated/i, "slate"],
  [/call|answer|conversation/i, "indigo"],
];

/** The hue for a metric or card, from its label. */
export function hueFor(label: string): Hue {
  for (const [re, hue] of RULES) if (re.test(label)) return hue;
  return "indigo";
}

const AVATAR_HUES: Hue[] = ["indigo", "cyan", "magenta", "coral", "violet", "sky", "green", "amber"];

/** A stable hue for a name (avatars): the same client is always the same colour. */
export function hueFromString(s: string | null | undefined): Hue {
  const t = (s ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

/** Chart series palette, in order. */
export const SERIES = [HUE_HEX.indigo, HUE_HEX.cyan, HUE_HEX.magenta, HUE_HEX.coral, HUE_HEX.violet, HUE_HEX.amber, HUE_HEX.green, HUE_HEX.sky];

/** Bucket timestamps into equal day-sized slots between two instants (sparklines). */
export function dailyCounts(dates: (string | null | undefined)[], from: Date, to: Date): number[] {
  const day = 86_400_000;
  const start = from.getTime();
  const n = Math.max(1, Math.min(120, Math.ceil((to.getTime() - start) / day)));
  const out = new Array<number>(n).fill(0);
  for (const d of dates) {
    if (!d) continue;
    const i = Math.floor((new Date(d).getTime() - start) / day);
    if (i >= 0 && i < n) out[i]++;
  }
  return out;
}
