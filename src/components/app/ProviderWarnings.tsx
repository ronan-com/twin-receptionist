import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { request } from "@/lib/api/base";

// A thin warning strip when a phone/AI provider balance is low or the database is
// nearly full. Reads GET /api/provider-status; an older server (404) or any error
// shows nothing.

type Item = { provider: string; balance?: number; currency?: string; low?: boolean; url?: string; message?: string };

export type ProviderWarning = Item;

/** Low balances and a nearly full database. They show in the bell and as a small pop-up (see alerts.tsx), not as a bar. */
export function useProviderWarnings(enabled = true): Item[] {
  const q = useQuery({
    queryKey: ["provider-status", "warnings"],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      try {
        const r = await request<{ items?: Item[] }>("GET", "/api/provider-status", undefined, { allow401: true });
        return (r.items ?? []).filter((i) => i && i.low);
      } catch {
        return [] as Item[];
      }
    },
  });
  return q.data ?? [];
}

/** The old top bar. Not used by the app any more; kept for anything that still imports it. */
export function ProviderWarnings({ enabled = true }: { enabled?: boolean }) {
  const items = useProviderWarnings(enabled);
  if (items.length === 0) return null;
  return (
    <div data-provider-warnings className="space-y-px">
      {items.map((i) => (
        <div key={i.provider} className="border-b border-[#ffe1b0] bg-[#fff9ee] px-4 py-2 text-[13px] text-[#8a4b00]">
          <div className="mx-auto flex max-w-[1200px] items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="font-semibold capitalize">{i.provider}</span>
              {": "}
              {i.message || (i.balance != null ? `balance is low (${i.balance} ${i.currency ?? ""})` : "running low")}
            </span>
            {i.url && /^https:\/\//.test(i.url) ? (
              <a href={i.url} target="_blank" rel="noreferrer" className="shrink-0 font-medium underline-offset-2 hover:underline">
                Top up
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
