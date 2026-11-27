import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox as InboxIcon, Mail, MessageCircle, MessageSquare, Phone, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/app/primitives";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { getInbox, type InboxItem, type InboxKind } from "@/lib/api/clean";
import { fmtPhone, fmtRelative, humanize } from "@/lib/app/format";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/inbox")({
  validateSearch: (s: Record<string, unknown>): { call?: string } => ({ call: typeof s["call"] === "string" && s["call"] ? String(s["call"]) : undefined }),
  head: () => ({ meta: [{ title: "Inbox" }] }),
  component: InboxPage,
});

const KINDS: { id: "all" | InboxKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "call", label: "Calls" },
  { id: "chat", label: "Chats" },
  { id: "text", label: "Texts" },
  { id: "email", label: "Emails" },
];
const ICON = { call: Phone, text: MessageSquare, chat: MessageCircle, email: Mail } as const;

function InboxPage() {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ["inbox", ws.businessId], enabled: !!ws.businessId, queryFn: () => getInbox(ws.businessId!) });
  const [kind, setKind] = useState<"all" | InboxKind>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [call, setCall] = useState<string | null>(Route.useSearch().call ?? null);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((i) => (kind === "all" || i.kind === kind) && (!s || [i.who, i.phone, i.email, i.summary, i.outcome].filter(Boolean).join(" ").toLowerCase().includes(s)));
  }, [q.data, kind, search]);

  const onRow = (i: InboxItem) => (i.callId ? setCall(i.callId) : setOpen(open === i.id ? null : i.id));

  return (
    <div className="space-y-5" data-page="inbox">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Inbox</h1>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search" className="h-11 pl-10" />
        </div>
        <div role="radiogroup" aria-label="Show" className="flex gap-1.5 overflow-x-auto">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[13.5px] font-medium", kind === k.id ? "border-indigo bg-indigo text-white" : "border-hairline bg-white text-ink-muted hover:text-ink")}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {q.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-canvas-2" aria-busy />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-hairline">
          <EmptyState compact icon={InboxIcon} title={search || kind !== "all" ? "Nothing matches" : "Nothing yet"} description={search || kind !== "all" ? undefined : "Calls, chats, texts and emails show up here."} />
        </div>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-white">
          {rows.map((i) => {
            const Icon = ICON[i.kind];
            const isOpen = open === i.id;
            return (
              <li key={i.id}>
                <button type="button" onClick={() => onRow(i)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left outline-none hover:bg-canvas-2/60 focus-visible:bg-canvas-2/60">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas-2 text-ink-muted">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[14.5px] font-medium text-ink">{i.who || (i.phone ? fmtPhone(i.phone) : i.email) || "Unknown"}</span>
                      <span className="shrink-0 text-[12px] text-ink-muted">{fmtRelative(i.at)}</span>
                    </span>
                    <span className={cn("mt-0.5 block text-[13.5px] text-ink-muted", !isOpen && "line-clamp-1")}>{i.summary || "No summary"}</span>
                    {isOpen ? <span className="mt-1 block text-[12.5px] text-ink-muted">{[i.phone && fmtPhone(i.phone), i.email].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                  {i.outcome ? (
                    <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium", i.booking ? "bg-indigo/10 text-indigo" : "bg-canvas-2 text-ink-muted")}>{humanize(i.outcome)}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <CallDetailSheet callId={call} onOpenChange={(o) => !o && setCall(null)} />
    </div>
  );
}
