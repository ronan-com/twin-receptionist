import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getRecentCalls } from "@/lib/api/console";
import { fmtPhone } from "@/lib/app/format";
import { armSounds, playSound } from "@/lib/app/sounds";
import { useProviderWarnings, warningInfo } from "./ProviderWarnings";

// The bell's list and the small pop-up in the bottom corner. They carry what used to be the top bar
// (low phone or AI balance), plus new calls and messages while the dashboard is open.

export type AlertItem = {
  id: string;
  title: string;
  description?: string;
  tone?: "info" | "warning" | "danger";
  /** An app page. */
  to?: string;
  /** An outside page (top up). */
  href?: string;
  hrefLabel?: string;
  at?: number;
  kind?: "call" | "message" | "warning" | "info";
};

const isVoiceChannel = (channel: string) => channel === "call" || channel === "web";
const shown = new Set<string>();

/**
 * Provider warnings and new calls and messages as bell items; also pops each new one up once and plays its sound.
 * New = started after this page opened (the feed is asked for "since" the server's last answer, so changing the
 * date range or midnight never makes old calls look new). It asks the light /calls/recent feed, not the full list.
 */
export function useLiveAlerts(enabled: boolean): AlertItem[] {
  useEffect(() => armSounds(), []);
  const warnings = useProviderWarnings(enabled);
  const since = useRef<string>(new Date().toISOString());
  const seen = useRef<Set<string>>(new Set());
  const [events, setEvents] = useState<AlertItem[]>([]);
  const feed = useQuery({
    queryKey: ["console", "calls", "recent"],
    queryFn: async () => {
      const r = await getRecentCalls(since.current);
      since.current = r.now;
      return r;
    },
    enabled,
    refetchInterval: 30_000,
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    const fresh = (feed.data?.calls ?? []).filter((c) => !seen.current.has(c.id));
    if (!fresh.length) return;
    for (const c of fresh) seen.current.add(c.id);
    const items: AlertItem[] = fresh.slice(0, 5).map((c) => {
      const voice = isVoiceChannel(c.channel);
      const who = c.business_name || "A client";
      const from = fmtPhone(c.from_number) || (voice ? "a caller" : "a customer");
      return { id: `ev-${c.id}`, kind: voice ? "call" : "message", tone: "info", title: voice ? `New call for ${who}` : `New message for ${who}`, description: `From ${from}`, to: "/admin/calls", at: Date.now() };
    });
    setEvents((e) => [...items, ...e].slice(0, 15));
    const first = items[0];
    toast(first.title, { id: first.id, description: items.length > 1 ? `${first.description} and ${items.length - 1} more` : first.description, duration: 6000, className: "alert-toast" });
    playSound(first.kind === "call" ? "call" : "message");
  }, [feed.data]);

  const warn = useMemo<AlertItem[]>(
    () =>
      warnings.map((i) => {
        const w = warningInfo(i);
        return {
          id: `prov-${i.provider}`,
          kind: "warning" as const,
          tone: "warning" as const,
          title: w.title,
          description: w.text,
          ...(w.missingKey ? { to: "/admin/connections" } : { href: i.url && /^https:\/\//.test(i.url) ? i.url : undefined, hrefLabel: "Top up" }),
        };
      }),
    [warnings],
  );

  // Each warning pops up once per visit.
  useEffect(() => {
    let any = false;
    for (const w of warn) {
      if (shown.has(w.id)) continue;
      shown.add(w.id);
      any = true;
      toast.warning(w.title, { id: w.id, description: w.description, duration: 9000, className: "alert-toast", action: w.href ? { label: "Top up", onClick: () => window.open(w.href, "_blank", "noopener") } : w.to ? { label: "Open", onClick: () => window.location.assign(w.to!) } : undefined });
    }
    if (any) playSound("warning");
  }, [warn]);

  return useMemo(() => [...warn, ...events], [warn, events]);
}
