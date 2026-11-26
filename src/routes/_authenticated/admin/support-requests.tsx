import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox, LifeBuoy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, PageHeader, Panel } from "@/components/app/primitives";
import { NewTicketForm, TicketRow, TicketThread } from "@/components/app/SupportDialog";
import { ticketsQuery, type TicketList, type TicketSummary } from "@/lib/api/tickets";
import { useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";

// "Support requests" (server/tickets.ts): what the agency's clients asked it (the inbox), and what the agency
// asked its setup provider ("Contact support" in the help menu). Opening one shows the conversation in a side
// sheet; ?ticket=<id> opens it straight away (links from the help menu and notifications).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/admin/support-requests")({
  validateSearch: (s: Record<string, unknown>): { ticket?: string } => (typeof s.ticket === "string" && UUID.test(s.ticket) ? { ticket: s.ticket } : {}),
  head: () => ({ meta: [{ title: `Support requests — ${PRODUCT} admin` }] }),
  component: SupportRequestsPage,
});

type Open = "new" | { id: string } | null;

function RequestList({ rows, agencyView, onOpen, label }: { rows: TicketSummary[]; agencyView?: boolean; onOpen: (id: string) => void; label: string }) {
  return (
    <ul className="divide-y divide-hairline" aria-label={label}>
      {rows.map((t) => (
        <TicketRow key={t.id} t={t} agencyView={agencyView} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function SupportRequestsPage() {
  const { platform } = useConsole();
  const q = useQuery(ticketsQuery());
  const navigate = useNavigate({ from: Route.fullPath });
  const linked = Route.useSearch().ticket ?? null;
  const [open, setOpen] = useState<Open>(linked ? { id: linked } : null);
  useEffect(() => setOpen(linked ? { id: linked } : null), [linked]);

  const show = (next: Open) => {
    setOpen(next);
    // Keep the address in step with the open conversation, so it can be shared or reloaded.
    void navigate({ search: next && typeof next === "object" ? { ticket: next.id } : {}, replace: true });
  };

  const list: TicketList | undefined = q.data;
  const newInbox = list?.inbox.filter((t) => t.unread).length ?? 0;
  const newMine = list?.mine.filter((t) => t.unread).length ?? 0;
  const toWhom = list?.seller || "your setup provider";

  return (
    <div className="space-y-5" data-page="admin-support-requests">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Support requests"
        description={`Questions from your clients, and the requests you've sent to ${toWhom}. New replies are marked with a dot.`}
        actions={
          list?.canCreate ? (
            <Button size="sm" className="h-8 text-[12.5px]" onClick={() => show("new")} data-action="new-support-request">
              <Plus className="mr-1 h-3.5 w-3.5" /> New request
            </Button>
          ) : null
        }
      />

      {q.error ? <ErrorState message={(q.error as Error).message || "Couldn't load your support requests."} onRetry={() => void q.refetch()} /> : null}

      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-[140px]" />
          <Skeleton className="h-[140px]" />
        </div>
      ) : list ? (
        <>
          <Panel
            title="From your clients"
            description={newInbox ? `${newInbox} new` : "Requests your clients send from the help menu in their workspace."}
            padded={false}
          >
            {list.inbox.length ? (
              <RequestList rows={list.inbox} agencyView onOpen={(id) => show({ id })} label="Requests from your clients" />
            ) : (
              <EmptyState compact icon={Inbox} title="No client requests" description="When a client asks for help from their workspace, it lands here and you can reply." />
            )}
          </Panel>

          <Panel
            title="Your requests"
            description={newMine ? `${newMine} with a new reply` : `What your team has asked ${toWhom}.`}
            padded={false}
          >
            {list.mine.length ? (
              <RequestList rows={list.mine} onOpen={(id) => show({ id })} label="Your requests" />
            ) : (
              <EmptyState
                compact
                icon={LifeBuoy}
                title="No requests yet"
                description={list.canCreate ? `Stuck on something? Send a request to ${toWhom} and their reply shows up here.` : list.why || "You haven't sent any requests."}
                action={
                  list.canCreate ? (
                    <Button size="sm" onClick={() => show("new")}>
                      <Plus className="mr-1 h-4 w-4" /> New request
                    </Button>
                  ) : null
                }
              />
            )}
            {!list.canCreate && list.why && list.mine.length ? <p className="border-t border-hairline px-4 py-2.5 text-[12.5px] text-ink-muted">{list.why}</p> : null}
          </Panel>
        </>
      ) : null}

      <Sheet open={open !== null} onOpenChange={(o) => !o && show(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-support-sheet>
          {open === "new" && list ? (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle>New support request</SheetTitle>
                <SheetDescription>{`Ask ${toWhom} for a hand. Their reply shows up here.`}</SheetDescription>
              </SheetHeader>
              <NewTicketForm list={list} onDone={(id) => show({ id })} onCancel={() => show(null)} />
            </>
          ) : open && typeof open === "object" ? (
            <>
              <SheetHeader className="mb-3">
                <SheetTitle className="sr-only">Support request</SheetTitle>
                <SheetDescription className="sr-only">The conversation and a reply box.</SheetDescription>
              </SheetHeader>
              <TicketThread key={open.id} id={open.id} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
