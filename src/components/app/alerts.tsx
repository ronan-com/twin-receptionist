import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getConsoleCalls, type ConsoleCall } from "@/lib/api/console";
import { rangeKey } from "@/lib/app/queries";
import { fmtPhone } from "@/lib/app/format";
import type { ResolvedRange } from "@/lib/app/date-range";
import { armSounds, playSound } from "@/lib/app/sounds";
import { useProviderWarnings } from "./ProviderWarnings";

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

const isVoice = (c: ConsoleCall) => c.channel === "call" || c.channel === "web";
const shown = new Set<string>();

/** Provider warnings and new calls and messages as bell items; also pops each new one up once and plays its sound. */
export function useLiveAlerts(range: ResolvedRange | null, enabled: boolean): AlertItem[] {
  useEffect(() => armSounds(), []);
  const warnings = useProviderWarnings(enabled);
  const callsQ = useQuery({
    queryKey: ["console", "calls", range ? rangeKey(range) : "none"],
    queryFn: () => getConsoleCalls(range!),
    enabled: enabled && !!range,
    refetchInterval: 30_000,
    retry: false,
  });
  const seen = useRef<Set<string> | null>(null);
  const [events, setEvents] = useState<AlertItem[]>([]);

  useEffect(() => {
    const calls = callsQ.data;
    if (!calls) return;
    if (!seen.current) {
      seen.current = new Set(calls.map((c) => c.id));
      return;
    }
    const fresh = calls.filter((c) => !seen.current!.has(c.id));
    if (!fresh.length) return;
    for (const c of fresh) seen.current.add(c.id);
    const items: AlertItem[] = fresh.slice(0, 5).map((c) => {
      const voice = isVoice(c);
      const who = c.business?.name ?? "A client";
      const from = fmtPhone(c.from_number) || (voice ? "a caller" : "a customer");
      return { id: `ev-${c.id}`, kind: voice ? "call" : "message", tone: "info", title: voice ? `New call for ${who}` : `New message for ${who}`, description: `From ${from}`, to: "/admin/calls", at: Date.now() };
    });
    setEvents((e) => [...items, ...e].slice(0, 15));
    const first = items[0];
    toast(first.title, { id: first.id, description: items.length > 1 ? `${first.description} and ${items.length - 1} more` : first.description, duration: 6000, className: "alert-toast" });
    playSound(first.kind === "call" ? "call" : "message");
  }, [callsQ.data]);

  const warn = useMemo<AlertItem[]>(
    () =>
      warnings.map((i) => ({
        id: `prov-${i.provider}`,
        kind: "warning",
        tone: "warning",
        title: `${i.provider.charAt(0).toUpperCase()}${i.provider.slice(1)} is running low`,
        description: i.message || (i.balance != null ? `Balance is low (${i.balance} ${i.currency ?? ""})` : "Running low"),
        href: i.url && /^https:\/\//.test(i.url) ? i.url : undefined,
        hrefLabel: "Top up",
      })),
    [warnings],
  );

  // Each warning pops up once per visit.
  useEffect(() => {
    let any = false;
    for (const w of warn) {
      if (shown.has(w.id)) continue;
      shown.add(w.id);
      any = true;
      toast.warning(w.title, { id: w.id, description: w.description, duration: 9000, className: "alert-toast", action: w.href ? { label: "Top up", onClick: () => window.open(w.href, "_blank", "noopener") } : undefined });
    }
    if (any) playSound("warning");
  }, [warn]);

  return useMemo(() => [...warn, ...events], [warn, events]);
}
