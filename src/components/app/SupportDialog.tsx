import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRight, ChevronLeft, ImagePlus, LifeBuoy, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/app/format";
import { readShot, ticketQuery, ticketsApi, ticketsQuery, type Shot, type TicketList, type TicketStatus, type TicketSummary } from "@/lib/api/tickets";

// "Contact support": a request to the setup provider (agency owners and admins) or to the agency (business
// users), the conversation, and our reply with an unread dot. The same pieces serve the help menu's dialog and
// the agency's "Support requests" page.

const STATUS_LABEL: Record<TicketStatus, string> = { open: "Open", waiting: "Waiting for you", closed: "Closed" };
const STATUS_LABEL_AGENCY: Record<TicketStatus, string> = { open: "Needs a reply", waiting: "Waiting on them", closed: "Closed" };

export function UnreadDot({ className }: { className?: string }) {
  return <span role="img" aria-label="New" className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-indigo", className)} data-unread-dot />;
}

/** The count of things waiting for this person: new replies, and (for agency staff) new client requests. */
export function useSupportUnread(enabled = true): { unread: number; data: TicketList | undefined } {
  const q = useQuery({ ...ticketsQuery(), enabled });
  return { unread: q.data?.unread ?? 0, data: q.data };
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["tickets"] });
}

function ShotPicker({ shot, onChange }: { shot: Shot | null; onChange: (s: Shot | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        aria-label="Attach a screenshot"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try { onChange(await readShot(f)); } catch (err) { toast.error((err as Error).message); }
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        <ImagePlus className="mr-1.5 h-4 w-4" /> {shot ? "Change screenshot" : "Attach a screenshot"}
      </Button>
      {shot ? (
        <span className="inline-flex min-w-0 items-center gap-1 text-ink-muted">
          <span className="truncate">{shot.name}</span>
          <button type="button" aria-label="Remove the screenshot" className="rounded p-0.5 hover:bg-canvas-2" onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /></button>
        </span>
      ) : <span className="text-ink-muted">Optional, up to 2 MB</span>}
    </div>
  );
}

export function TicketRow({ t, onOpen, agencyView }: { t: TicketSummary; onOpen: (id: string) => void; agencyView?: boolean }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(t.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-canvas-2" data-ticket={t.id}>
        <span className="mt-1.5 w-2 shrink-0">{t.unread ? <UnreadDot /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13.5px]", t.unread ? "font-semibold text-ink" : "font-medium text-ink")}>{t.subject}</span>
          <span className="block truncate text-[12px] text-ink-muted">{agencyView && (t.business || t.from) ? `${t.business || t.from} · ` : ""}{t.last}</span>
        </span>
        <span className="shrink-0 text-right text-[11.5px] text-ink-muted">
          <span className="block">{(agencyView ? STATUS_LABEL_AGENCY : STATUS_LABEL)[t.status]}</span>
          <span className="block">{fmtRelative(t.updatedAt)}</span>
        </span>
      </button>
    </li>
  );
}

export function TicketThread({ id, onBack }: { id: string; onBack?: () => void }) {
  const refresh = useRefresh();
  const q = useQuery(ticketQuery(id));
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);
  const reply = useMutation({
    mutationFn: () => ticketsApi.reply(id, { message, screenshot: shot }),
    onSuccess: () => { setMessage(""); setShot(null); void q.refetch(); void refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const status = useMutation({
    mutationFn: (what: "close" | "reopen") => ticketsApi.setStatus(id, what),
    onSuccess: () => { void q.refetch(); void refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Opening it reads it: the dot in the list and the menu goes away.
  if (q.isLoading) return <p className="p-4 text-[13px] text-ink-muted">Loading…</p>;
  if (q.error || !q.data) return <p className="p-4 text-[13px] text-[#a41d1d]">Couldn't open that request.</p>;
  const c = q.data;
  const closed = c.ticket.status === "closed";
  return (
    <div className="flex min-h-0 flex-col gap-3" data-ticket-thread={id}>
      <div className="flex items-start gap-2">
        {onBack ? <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2 shrink-0"><ChevronLeft className="mr-0.5 h-4 w-4" /> Back</Button> : null}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink">{c.ticket.subject}</h3>
          <p className="text-[12px] text-ink-muted">
            {c.side === "agency" ? `${c.ticket.business || c.ticket.from || "A business"} · ` : `To ${c.otherParty} · `}
            {(c.side === "agency" ? STATUS_LABEL_AGENCY : STATUS_LABEL)[c.ticket.status]}
          </p>
        </div>
      </div>
      {c.ticket.pushError ? <p className="rounded-md bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">{c.ticket.pushError} Send a new request, or email them.</p> : null}
      <ul className="flex max-h-[44vh] flex-col gap-2 overflow-y-auto pr-1" aria-label="Conversation">
        {c.messages.map((m) => {
          const mine = c.side === "agency" ? m.author === "agency" : m.author === "requester";
          return (
            <li key={m.id} className={cn("max-w-[88%] rounded-lg border px-3 py-2 text-[13px]", mine ? "self-end border-[color-mix(in_srgb,var(--indigo)_25%,#fff)] bg-[color-mix(in_srgb,var(--indigo)_8%,#fff)]" : "self-start border-hairline bg-white")}>
              <div className="mb-0.5 text-[11.5px] text-ink-muted"><b className="font-semibold text-ink">{m.author === "support" ? `${c.otherParty} support` : m.name || "You"}</b> · {fmtRelative(m.at)}</div>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              {m.shot ? <a href={m.shot} target="_blank" rel="noopener noreferrer"><img src={m.shot} alt={m.shotName || "Screenshot"} className="mt-2 max-h-48 rounded border border-hairline" /></a> : null}
            </li>
          );
        })}
      </ul>
      {c.canReply ? (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (message.trim()) reply.mutate(); }}>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={5000} placeholder={closed ? "Reply to reopen this request" : "Write a reply"} aria-label="Your reply" />
          <ShotPicker shot={shot} onChange={setShot} />
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => status.mutate(closed ? "reopen" : "close")} disabled={status.isPending}>{closed ? "Reopen" : "Mark as solved"}</Button>
            <Button type="submit" size="sm" disabled={!message.trim() || reply.isPending}>{reply.isPending ? "Sending…" : "Send reply"}</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function NewTicketForm({ list, onDone, onCancel }: { list: TicketList; onDone: (id: string) => void; onCancel?: () => void }) {
  const refresh = useRefresh();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);
  const toAgency = list.route === "agency";
  const send = useMutation({
    mutationFn: () => ticketsApi.create({ subject, message, screenshot: shot, page: window.location.href }),
    onSuccess: (r) => { toast.success(toAgency ? "Sent to your agency." : "Sent. We'll reply here."); void refresh(); onDone(r.id); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div className="grid gap-1.5">
        <label htmlFor="ticket-subject" className="text-[12.5px] font-medium text-ink">Subject</label>
        <Input id="ticket-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required placeholder="e.g. Calls aren't coming through" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="ticket-message" className="text-[12.5px] font-medium text-ink">What's wrong?</label>
        <Textarea id="ticket-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} required placeholder="What you were doing, what you expected, and what happened instead." />
      </div>
      <ShotPicker shot={shot} onChange={setShot} />
      <p className="text-[12px] leading-5 text-ink-muted">
        {toAgency ? "This goes to your agency. " : `This goes to ${list.seller}. `}
        We attach the page you're on, the app version, your browser, and your agency and receptionist ids so it's quicker to sort out. Never passwords or keys. Please don't type any into the message.
      </p>
      <div className="flex justify-end gap-2">
        {onCancel ? <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" size="sm" disabled={!subject.trim() || !message.trim() || send.isPending}>{send.isPending ? "Sending…" : "Send request"}</Button>
      </div>
    </form>
  );
}

/** The help menu's dialog: your requests, a new one, and a conversation. `allRequestsTo` links to the agency's "Support requests" page (with its client inbox). */
export function SupportDialog({ open, onOpenChange, startNew, allRequestsTo }: { open: boolean; onOpenChange: (o: boolean) => void; startNew?: boolean; allRequestsTo?: string }) {
  const q = useQuery({ ...ticketsQuery(), enabled: open });
  const [view, setView] = useState<"list" | "new" | { id: string }>(startNew ? "new" : "list");
  const list = q.data;
  const current = list && !list.mine.length && view === "list" && list.canCreate ? "new" : view;
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setView("list"); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-support-dialog>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-indigo" /> Contact support</DialogTitle>
          <DialogDescription>{list?.route === "agency" ? "Ask your agency for a hand. They'll reply here." : list ? `Ask ${list.seller} for a hand. Their reply shows up here.` : "Ask for a hand."}</DialogDescription>
        </DialogHeader>
        {!list ? <p className="text-[13px] text-ink-muted">{q.error ? "Couldn't load your requests." : "Loading…"}</p>
          : typeof current === "object" ? <TicketThread id={current.id} onBack={() => setView("list")} />
          : current === "new" && list.canCreate ? <NewTicketForm list={list} onDone={(id) => setView({ id })} onCancel={list.mine.length ? () => setView("list") : undefined} />
          : (
            <div className="grid gap-3">
              {list.mine.length ? <ul className="divide-y divide-hairline rounded-lg border border-hairline" aria-label="Your requests">{list.mine.map((t) => <TicketRow key={t.id} t={t} onOpen={(id) => setView({ id })} />)}</ul> : <p className="text-[13px] text-ink-muted">{list.why || "You haven't sent any requests."}</p>}
              {list.canCreate ? <div><Button size="sm" onClick={() => setView("new")}><Plus className="mr-1 h-4 w-4" /> New request</Button></div> : list.why && list.mine.length ? <p className="text-[12.5px] text-ink-muted">{list.why}</p> : null}
              {allRequestsTo ? (
                <Link to={allRequestsTo} onClick={() => onOpenChange(false)} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-indigo hover:underline" data-action="all-support-requests">
                  {list.inbox.some((t) => t.unread) ? <UnreadDot /> : null}
                  {list.inbox.length ? `All support requests, with ${list.inbox.length} from your clients` : "All support requests"} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}
