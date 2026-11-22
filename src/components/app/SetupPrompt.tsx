import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, MessageSquareText, Sparkles, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agentsQuery } from "@/lib/app/queries";
import type { AgentRow } from "@/lib/api/manage";
import { useWorkspace } from "@/lib/app/workspace";

// First-run prompt on the dashboard (area S). Shown to someone who can edit the
// business while its receptionist still has the sign-up defaults (nothing saved
// since it was made). It goes away by itself after the first save, or when hidden.

const KEY = (id: string) => `answered.setup-hidden.${id}`;

function hidden(id: string): boolean {
  try {
    return window.localStorage.getItem(KEY(id)) === "1";
  } catch {
    return false;
  }
}

const STEPS = [
  { tab: "hours", label: "Opening hours", hint: "When you're open, so callers are told the right times.", icon: CalendarClock },
  { tab: "booking", label: "Services", hint: "What callers can ask for.", icon: Wrench },
  { tab: "conversation", label: "Greeting", hint: "The first thing every caller hears.", icon: MessageSquareText },
] as const;

export function SetupPrompt() {
  const ws = useWorkspace();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onDashboard = path === "/app" || path === "/app/";
  const id = ws.businessId;
  const show = onDashboard && !!id && ws.access.kind === "member" && ws.access.canEdit && !ws.business?.is_demo;
  const agentsQ = useQuery({ ...agentsQuery(show ? id : null), staleTime: 30_000 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const agent = (agentsQ.data?.[0] ?? null) as AgentRow | null;
  if (!show || !id || !agent?.setup_fresh || dismissed === id || hidden(id)) return null;

  return (
    <section data-setup-prompt className="mb-5 rounded-[8px] border border-[#dcdaff] bg-[#f7f6ff] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">Finish setting up your receptionist</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              It's answering with starter settings. Check these three things so callers get the right answers.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Hide this"
          className="shrink-0 rounded p-1 text-ink-muted hover:bg-white hover:text-ink"
          onClick={() => {
            try {
              window.localStorage.setItem(KEY(id), "1");
            } catch {
              /* private window: hidden for this visit only */
            }
            setDismissed(id);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.tab}>
            <Link
              to="/app/receptionist"
              search={{ tab: s.tab }}
              className="flex h-full items-start gap-2.5 rounded-[6px] border border-hairline bg-white px-3 py-2.5 hover:border-[#c7c4ff]"
            >
              <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{s.label}</span>
                <span className="block text-[12px] text-ink-muted">{s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/app/receptionist">Set up my receptionist</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/app/knowledge">Add answers to common questions</Link>
        </Button>
      </div>
    </section>
  );
}
