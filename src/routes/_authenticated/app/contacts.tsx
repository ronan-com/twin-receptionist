import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState } from "@/components/app/primitives";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { contactsCsvUrl, getContact, getContacts, patchContact, type Contact, type ContactStatus } from "@/lib/api/clean";
import { fmtDateTime, fmtPhone, fmtRelative } from "@/lib/app/format";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/contacts")({
  head: () => ({ meta: [{ title: "Contacts" }] }),
  component: ContactsPage,
});

const STATUSES: { id: ContactStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "active", label: "Active" },
  { id: "customer", label: "Customer" },
  { id: "closed", label: "Closed" },
];
const TAG: Record<ContactStatus, string> = { new: "bg-indigo/10 text-indigo", active: "bg-[#fff4dc] text-[#8a4b00]", customer: "bg-[#e6f6ee] text-[#0e6245]", closed: "bg-canvas-2 text-ink-muted" };
const Tag = ({ s }: { s: ContactStatus }) => <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", TAG[s])}>{STATUSES.find((x) => x.id === s)?.label}</span>;

function ContactsPage() {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ["contacts", ws.businessId], enabled: !!ws.businessId, queryFn: () => getContacts(ws.businessId!) });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ContactStatus>("all");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((c) => (status === "all" || c.status === status) && (!s || [c.name, c.phone, c.email, c.notes].join(" ").toLowerCase().includes(s)));
  }, [q.data, search, status]);

  return (
    <div className="space-y-5" data-page="contacts">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">Contacts</h1>
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" asChild><Link to="/app/leads">Follow-ups</Link></Button><Button variant="outline" size="sm" asChild>
          <a href={ws.businessId ? contactsCsvUrl(ws.businessId) : "#"} download data-action="export-csv">
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </a>
        </Button></div>
      </div>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search" className="h-11 pl-10" />
        </div>
        <div role="radiogroup" aria-label="Status" className="flex gap-1.5 overflow-x-auto">
          {[{ id: "all", label: "All" }, ...STATUSES].map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={status === k.id}
              onClick={() => setStatus(k.id as typeof status)}
              className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[13.5px] font-medium", status === k.id ? "border-indigo bg-indigo text-white" : "border-hairline bg-white text-ink-muted hover:text-ink")}
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
          <EmptyState compact icon={Users} title={search || status !== "all" ? "Nothing matches" : "No contacts yet"} description={search || status !== "all" ? undefined : "People who call, chat or book appear here."} />
        </div>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-white">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(c.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none hover:bg-canvas-2/60 focus-visible:bg-canvas-2/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-ink">{c.name || (c.phone ? fmtPhone(c.phone) : c.email)}</span>
                  <span className="block truncate text-[13px] text-ink-muted">{[c.name && c.phone ? fmtPhone(c.phone) : "", c.email].filter(Boolean).join(" · ") || "No details"}</span>
                </span>
                <span className="hidden text-[12.5px] text-ink-muted sm:block">{c.counts.calls + c.counts.chats} chats and calls · {c.counts.bookings} bookings</span>
                <span className="hidden w-24 text-right text-[12.5px] text-ink-muted sm:block">{fmtRelative(c.last_at)}</span>
                <Tag s={c.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ContactSheet contact={rows.find((c) => c.id === open) ?? (q.data ?? []).find((c) => c.id === open) ?? null} onClose={() => setOpen(null)} />
    </div>
  );
}

function ContactSheet({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const canEdit = ws.access.canEdit;
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ContactStatus>("new");
  const [call, setCall] = useState<string | null>(null);
  useEffect(() => {
    if (!contact) return;
    setName(contact.name);
    setNotes(contact.notes);
    setStatus(contact.status);
  }, [contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useQuery({ queryKey: ["contact", ws.businessId, contact?.id], enabled: !!contact && !!ws.businessId, queryFn: () => getContact(ws.businessId!, contact!.id) });
  const save = useMutation({
    mutationFn: (body: { name?: string; notes?: string; status?: ContactStatus }) => patchContact(ws.businessId!, contact!.id, body),
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["contacts", ws.businessId] });
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });
  const dirty = !!contact && (name !== contact.name || notes !== contact.notes);
  return (
    <>
      <Sheet open={!!contact} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{contact?.name || (contact?.phone ? fmtPhone(contact.phone) : contact?.email) || "Contact"}</SheetTitle>
          </SheetHeader>
          {contact ? (
            <div className="mt-5 space-y-5">
              <p className="text-[13.5px] text-ink-muted">{[contact.phone && fmtPhone(contact.phone), contact.email].filter(Boolean).join(" · ")}</p>
              <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={status === s.id}
                    disabled={!canEdit}
                    onClick={() => {
                      setStatus(s.id);
                      save.mutate({ status: s.id });
                    }}
                    className={cn("h-8 rounded-full border px-3 text-[13px] font-medium", status === s.id ? "border-indigo bg-indigo text-white" : "border-hairline text-ink-muted hover:text-ink")}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" disabled={!canEdit} className="h-11" />
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" rows={4} disabled={!canEdit} />
              {canEdit ? (
                <Button disabled={!dirty || save.isPending} onClick={() => save.mutate({ name, notes })}>
                  {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
                </Button>
              ) : null}
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Timeline</h3>
                {detail.isPending ? (
                  <div className="h-20 animate-pulse rounded-lg bg-canvas-2" />
                ) : (
                  <ol className="space-y-3 border-l border-hairline pl-4">
                    {(detail.data?.timeline ?? []).map((t, i) => (
                      <li key={i} className="relative">
                        <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo" />
                        <button type="button" disabled={!t.callId} onClick={() => t.callId && setCall(t.callId)} className="text-left">
                          <span className="block text-[13.5px] font-medium text-ink">{t.title}</span>
                          <span className="block text-[12px] text-ink-muted">{fmtDateTime(t.at)}</span>
                          {t.summary ? <span className="mt-0.5 block text-[13px] text-ink-muted">{t.summary}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <CallDetailSheet callId={call} onOpenChange={(o) => !o && setCall(null)} />
    </>
  );
}
