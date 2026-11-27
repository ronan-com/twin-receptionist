import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Briefcase, Check, Eye, MailPlus, Pause, Play, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, EmptyState } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { DeleteDialog, DeletedDialog, type DeletedReport } from "@/components/app/DeleteDialog";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber, fmtPhone } from "@/lib/app/format";
import { platformApi } from "@/lib/api/console";
import type { Agency } from "@/lib/shared";
import { LinkBox, useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/agencies")({
  head: () => ({ meta: [{ title: `Agencies — ${PRODUCT} admin` }] }),
  component: AgenciesPage,
});

function AgenciesPage() {
  const { ws, platform } = useConsole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["console", "agencies"], queryFn: platformApi.agencies, enabled: platform });
  const [search, setSearch] = useState("");
  const [showSandbox, setShowSandbox] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [link, setLink] = useState<{ who: string; agency: string; url: string; emailed: boolean } | null>(null);
  const [reinvite, setReinvite] = useState<Agency | null>(null);
  const [reinviteEmail, setReinviteEmail] = useState("");
  const [pausing, setPausing] = useState<Agency | null>(null);
  const [deleting, setDeleting] = useState<Agency | null>(null);
  const [deleted, setDeleted] = useState<DeletedReport | null>(null);
  const preview = useQuery({ queryKey: ["console", "agency-delete", deleting?.id], queryFn: () => platformApi.agencyDeletePreview(deleting!.id), enabled: !!deleting, staleTime: 0, gcTime: 0 });
  const remove = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: string }) => platformApi.deleteAgency(id, confirm),
    onSuccess: async (r) => {
      set(r.agencies);
      setDeleting(null);
      setDeleted({ name: r.name, numbers: r.numbers, warnings: r.warnings });
      await qc.invalidateQueries({ queryKey: ["admin"] });
      await qc.invalidateQueries({ queryKey: ["console"] });
    },
    onError: (e: Error) => toast.error("Couldn't delete the agency", { description: e.message }),
  });

  const set = (agencies: Agency[]) => qc.setQueryData(["console", "agencies"], agencies);
  const create = useMutation({
    mutationFn: () => platformApi.createAgency(name.trim(), ownerEmail.trim()),
    onSuccess: async (r) => {
      setLink({ who: ownerEmail.trim(), agency: name.trim(), ...r });
      setCreating(false);
      setName("");
      setOwnerEmail("");
      toast.success("Agency created");
      await qc.invalidateQueries({ queryKey: ["console", "agencies"] });
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error("Couldn't create the agency", { description: e.message }),
  });
  const invite = useMutation({
    mutationFn: () => platformApi.inviteOwner(reinvite!.id, reinviteEmail.trim()),
    onSuccess: async (r) => {
      setLink({ who: reinviteEmail.trim(), agency: reinvite!.name, ...r });
      setReinvite(null);
      await qc.invalidateQueries({ queryKey: ["console", "agencies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, change }: { id: string; change: { suspended?: boolean; platformTelnyx?: boolean } }) => platformApi.updateAgency(id, change),
    onSuccess: (a) => {
      set(a);
      setPausing(null);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const viewAs = useMutation({
    mutationFn: async (a: Agency) => {
      await platformApi.viewAs(a.id);
      await qc.invalidateQueries();
      await ws.refresh();
    },
    onSuccess: () => void navigate({ to: "/admin" }),
    onError: (e: Error) => toast.error(e.message),
  });

  const all = q.data ?? [];
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((a) => (showSandbox || !a.sandbox) && (!s || [a.name, ...a.owners, ...a.pendingInvites].some((v) => v.toLowerCase().includes(s))));
  }, [all, search, showSandbox]);
  const real = all.filter((a) => !a.sandbox && a.id !== ws.org?.id);

  if (!platform) return <ErrorState message="Only the platform team can see agencies." />;

  return (
    <div className="space-y-5" data-page="admin-agencies">
      <PageHeader
        eyebrow="Platform console"
        title="Agencies"
        description="Agencies sign up by themselves or are invited by you. Each brings its own clients and team."
        actions={
          <Button size="sm" className="h-8 text-[12.5px]" onClick={() => setCreating(true)} data-action="new-agency">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Invite an agency
          </Button>
        }
      />

      <MetricGrid cols={4}>
        <MetricCard label="Agencies" value={fmtNumber(real.length)} icon={Briefcase} loading={q.isPending} />
        <MetricCard label="Signed up" value={fmtNumber(real.filter((a) => a.owners.length > 0).length)} loading={q.isPending} />
        <MetricCard label="With receptionists" value={fmtNumber(real.filter((a) => a.clients > 0).length)} loading={q.isPending} />
        <MetricCard label="Paused" value={fmtNumber(real.filter((a) => a.suspended).length)} loading={q.isPending} />
      </MetricGrid>

      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      {link ? (
        <Panel title={`Invite for ${link.agency}`} actions={<Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setLink(null)}>Done</Button>}>
          <div className="space-y-2" data-agency-invite>
            <p className="text-[12.5px] text-ink-muted">
              {link.emailed ? `Invite emailed to ${link.who}. You can also send them this link:` : `Send ${link.who} this link. (Invite emails aren't set up on this server yet.)`}
            </p>
            <LinkBox url={link.url} />
          </div>
        </Panel>
      ) : null}

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2.5">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agency or owner" className="h-8 pl-8 text-[12.5px]" aria-label="Search agencies" />
          </div>
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-muted">
            <Switch checked={showSandbox} onCheckedChange={setShowSandbox} aria-label="Show the test lab" /> Test lab
          </label>
        </div>
        {rows.length === 0 && !q.isPending ? (
          <EmptyState compact icon={Briefcase} title="No agencies yet" description="Invite one, or share the sign-up page." />
        ) : (
          <ul className="divide-y divide-hairline" data-list="agencies">
            {rows.map((a) => {
              const own = a.id === ws.org?.id;
              const flow: [string, boolean][] = [
                ["Invited", true],
                ["Signed up", a.owners.length > 0],
                [`${a.clients} receptionist${a.clients === 1 ? "" : "s"}`, a.clients > 0],
                [`${a.withNumbers} with a number`, a.withNumbers > 0],
                [`${a.customers} customer${a.customers === 1 ? "" : "s"} shared`, a.customers > 0],
              ];
              return (
                <li key={a.id} className="space-y-2 px-4 py-3 text-[13px]" data-agency={a.name}>
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                        <span className="break-words">{a.name}</span>
                        {own ? <StatusBadge tone="indigo">Your team</StatusBadge> : null}
                        {a.suspended ? <StatusBadge tone="muted" dot>Paused</StatusBadge> : null}
                        {a.sandbox ? <StatusBadge tone="warning">Test lab</StatusBadge> : null}
                      </div>
                      <div className="text-[12px] text-ink-muted">
                        {a.clients} client{a.clients === 1 ? "" : "s"} · {a.members} {a.members === 1 ? "person" : "people"} · since {fmtDate(a.createdAt)} · phone: {a.provider === "vapi" ? "Vapi · " : ""}{a.telnyx === "own" ? "own key" : a.telnyx === "platform" ? "platform account" : "not set up"}
                      </div>
                      <div className="break-words text-[12px] text-ink-muted">
                        {a.owners.length ? `Owner: ${a.owners.join(", ")}` : "No owner yet"}
                        {a.pendingInvites.length ? ` · Invited: ${a.pendingInvites.join(", ")}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {!own ? (
                        <Button size="sm" variant="outline" className="h-8 text-[12.5px]" disabled={viewAs.isPending} onClick={() => viewAs.mutate(a)} data-action="view-as">
                          <Eye className="mr-1.5 h-3.5 w-3.5" /> View as
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-[12.5px]"
                        onClick={() => {
                          setReinvite(a);
                          setReinviteEmail(a.pendingInvites[0] ?? "");
                        }}
                      >
                        <MailPlus className="mr-1.5 h-3.5 w-3.5" /> Owner invite
                      </Button>
                      {!own && !a.home ? (
                        <Button size="sm" variant="ghost" className="h-8 text-[12.5px] text-destructive hover:text-destructive" onClick={() => setDeleting(a)} data-action="delete-agency">
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                        </Button>
                      ) : null}
                      {!own ? (
                        a.suspended ? (
                          <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" onClick={() => update.mutate({ id: a.id, change: { suspended: false } })} data-action="resume-agency">
                            <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" onClick={() => setPausing(a)} data-action="pause-agency">
                            <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause
                          </Button>
                        )
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5" aria-label="Onboarding progress" data-flow>
                    {flow.map(([label, done]) => (
                      <span key={label} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px]", done ? "border-[#c8eedf] bg-[#e6f8f1] text-[#0e6245]" : "border-hairline bg-canvas-2 text-ink-muted")}>
                        {done ? <Check className="h-3 w-3" /> : null}
                        {label}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite an agency</DialogTitle>
              <DialogDescription>Creates the agency's console and invites its owner. Calls run on the platform's phone account.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-3">
              <Field label="Agency name" htmlFor="ag-name" required>
                <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
              </Field>
              <Field label="Owner's email" htmlFor="ag-email" required>
                <Input id="ag-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} autoComplete="off" required />
              </Field>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending || !name.trim() || !ownerEmail.trim()} data-action="create-agency">
                {create.isPending ? "Creating…" : "Create and invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reinvite} onOpenChange={(o) => !o && setReinvite(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (reinviteEmail.trim()) invite.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>New owner invite for {reinvite?.name}</DialogTitle>
              <DialogDescription>For a lost or expired link. The old link stops working.</DialogDescription>
            </DialogHeader>
            <Field label="Email" htmlFor="ag-reinvite" className="mt-4">
              <Input id="ag-reinvite" type="email" value={reinviteEmail} onChange={(e) => setReinviteEmail(e.target.value)} required />
            </Field>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setReinvite(null)}>Cancel</Button>
              <Button type="submit" disabled={invite.isPending}>{invite.isPending ? "Sending…" : "Send invite"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the agency ${deleting?.name ?? ""}?`}
        name={deleting?.name ?? ""}
        nameLabel="agency name"
        confirmLabel="Delete agency for good"
        pending={remove.isPending}
        onConfirm={(typed) => deleting && remove.mutate({ id: deleting.id, confirm: typed })}
      >
        <p>This can't be undone (use Pause if you only want it switched off). It permanently deletes the whole agency:</p>
        <ul className="list-disc pl-4">
          <li>
            {preview.data ? preview.data.clients : "…"} client{preview.data?.clients === 1 ? "" : "s"} and {preview.data ? preview.data.receptionists.length : "…"} receptionist{preview.data?.receptionists.length === 1 ? "" : "s"}, with their assistants on the phone provider
          </li>
          <li>
            {preview.data ? fmtNumber(preview.data.calls) : "…"} call{preview.data?.calls === 1 ? "" : "s"}, {preview.data ? fmtNumber(preview.data.bookings) : "…"} booking/callback request{preview.data?.bookings === 1 ? "" : "s"}, follow-ups, website chats and knowledge
          </li>
          <li>
            {preview.data ? preview.data.members : "…"} team member{preview.data?.members === 1 ? "" : "s"} and {preview.data ? preview.data.logins : "…"} client login{preview.data?.logins === 1 ? "" : "s"} (accounts that belong to no other agency are deleted too), plus every invite and sign-in
          </li>
        </ul>
        {preview.data?.numbers.length ? (
          <p className="rounded-md bg-canvas-2 p-2 text-ink">
            Phone numbers on its receptionists: <strong>{preview.data.numbers.map((n) => fmtPhone(n)).join(", ")}</strong>. They are <strong>not</strong> deleted. They stay on the phone account, so release them there if you don't want them.
          </p>
        ) : null}
        <p>The agency's own phone account (its Telnyx or Vapi key) is not touched either.</p>
      </DeleteDialog>
      <DeletedDialog report={deleted} onClose={() => setDeleted(null)} />

      <Dialog open={!!pausing} onOpenChange={(o) => !o && setPausing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause {pausing?.name}?</DialogTitle>
            <DialogDescription>Its people are signed out, and its receptionists stop booking and replying to email until you resume it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPausing(null)}>Cancel</Button>
            <Button onClick={() => pausing && update.mutate({ id: pausing.id, change: { suspended: true } })} disabled={update.isPending} data-action="confirm-pause-agency">
              Pause agency
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
