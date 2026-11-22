import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, Mail, MoreHorizontal, Shield, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageHeader, Panel, ErrorState, Notice, InitialsAvatar, EmptyState } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate, fmtRelative } from "@/lib/app/format";
import { teamQuery } from "@/lib/app/queries";
import { cancelInvite, changeMemberRole, inviteMember, removeMember, resendInvite, type InviteResult, type TeamData, type TeamMember } from "@/lib/api/manage";
import { useWorkspace } from "@/lib/app/workspace";

export const Route = createFileRoute("/_authenticated/app/team")({
  head: () => ({ meta: [{ title: "Team — Answered" }] }),
  component: TeamPage,
});

type Role = "manager" | "viewer";
const ROLE_LABELS: Record<Role, string> = { manager: "Manager", viewer: "Viewer" };
const ROLE_DESCRIPTIONS: Record<Role, string> = {
  manager: "Changes the receptionist, knowledge, numbers, integrations and team.",
  viewer: "Sees calls, bookings, follow-ups and reports. Can't change anything.",
};

function TeamPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery(teamQuery(ws.businessId));
  const canManage = ws.access.canManage;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const data = q.data as TeamData | undefined;
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];
  const managers = members.filter((m) => m.access_role === "manager");

  const setTeam = (t: TeamData) => qc.setQueryData(["team", ws.businessId], t);
  const need = () => {
    if (!ws.businessId) throw new Error("No business selected.");
    return ws.businessId;
  };
  const showInvite = (r: InviteResult, again = false) => {
    setTeam(r.team);
    if (r.added) toast.success(`${r.email} can now see ${ws.business?.name ?? "this business"}`, { description: "They already had a login, so no invite was needed." });
    else if (r.emailed) toast.success(again ? "Invite sent again" : `Invitation sent to ${r.email}`, { description: "The link works for 7 days." });
    else {
      toast.success(again ? "New invite link ready" : `Invite ready for ${r.email}`, { description: "Email isn't set up yet, so send them the link yourself." });
      setLink({ email: r.email, url: r.url });
    }
  };

  const invite = useMutation({
    mutationFn: async () => inviteMember(need(), { email: email.trim().toLowerCase(), role }),
    onSuccess: (r) => {
      setInviteOpen(false);
      setEmail("");
      setRole("viewer");
      showInvite(r);
    },
    onError: (e) => toast.error("Couldn't send invitation", { description: e.message }),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => changeMemberRole(need(), userId, role),
    onSuccess: (t, v) => {
      setTeam(t);
      toast.success(`Role updated to ${ROLE_LABELS[v.role]}`);
    },
    onError: (e) => toast.error("Couldn't change role", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => removeMember(need(), userId),
    onSuccess: (t, userId) => {
      setTeam(t);
      setRemoving(null);
      toast.success("Removed from this business");
      if (userId === ws.user?.id) void qc.invalidateQueries({ queryKey: ["businesses"] });
    },
    onError: (e) => toast.error("Couldn't remove", { description: e.message }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => cancelInvite(need(), id),
    onSuccess: (t) => {
      setTeam(t);
      toast.success("Invitation cancelled");
    },
    onError: (e) => toast.error("Couldn't cancel", { description: e.message }),
  });

  const resend = useMutation({
    mutationFn: async (id: string) => resendInvite(need(), id),
    onSuccess: (r) => showInvite(r, true),
    onError: (e) => toast.error("Couldn't resend", { description: e.message }),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title="Team"
        description="Who can see and change this business. Managers change settings; viewers can look but not touch."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Invite
            </Button>
          ) : null
        }
      />

      {q.error ? <ErrorState message={q.error.message} onRetry={() => void q.refetch()} /> : null}
      {!canManage ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Only managers can invite people or change roles."}</Notice> : null}
      {link ? (
        <Notice
          tone="info"
          title={`Invite link for ${link.email}`}
          action={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[12px]"
              onClick={() => {
                void navigator.clipboard?.writeText(link.url).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Couldn't copy. Select the link and copy it."),
                );
              }}
            >
              <Copy className="mr-1.5 h-3 w-3" /> Copy link
            </Button>
          }
        >
          <span className="block break-all font-mono text-[11.5px]" data-testid="invite-link">{link.url}</span>
        </Notice>
      ) : null}

      <Panel title={`People (${members.length})`} padded={false}>
        {q.isPending ? (
          <div className="p-4 text-[13px] text-ink-muted">Loading…</div>
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title="Nobody from the business yet" description="Invite a manager or a viewer by email." compact />
        ) : (
          <ul className="divide-y divide-hairline">
            {members.map((m) => {
              const isMe = m.user_id === ws.user?.id;
              const lastManager = m.access_role === "manager" && managers.length === 1;
              // Agency staff can always change roles; a manager can't leave the business without one.
              const guarded = lastManager && ws.accessRole === "manager";
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3" data-member={m.profile?.email ?? ""}>
                  <InitialsAvatar name={m.profile?.full_name ?? m.profile?.email} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-ink">{m.profile?.full_name ?? m.profile?.email ?? "Member"}</span>
                      {isMe ? <StatusBadge tone="muted">You</StatusBadge> : null}
                      <span className="sm:hidden">
                        <StatusBadge tone={m.access_role === "manager" ? "info" : "muted"}>{ROLE_LABELS[m.access_role]}</StatusBadge>
                      </span>
                    </div>
                    <div className="truncate text-[12px] text-ink-muted">
                      {m.profile?.email ?? "—"} · since {fmtDate(m.created_at)}
                    </div>
                  </div>
                  <div className="hidden sm:block">
                    <StatusBadge tone={m.access_role === "manager" ? "info" : "muted"}>{ROLE_LABELS[m.access_role]}</StatusBadge>
                  </div>
                  {canManage && !guarded ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${m.profile?.email ?? "member"}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-ink-muted">Change role</DropdownMenuLabel>
                        {(["manager", "viewer"] as Role[]).map((r) => (
                          <DropdownMenuItem key={r} disabled={r === m.access_role} onClick={() => changeRole.mutate({ userId: m.user_id, role: r })}>
                            <div>
                              <div className="text-[13px]">{ROLE_LABELS[r]}</div>
                              <div className="text-[11px] text-ink-muted">{ROLE_DESCRIPTIONS[r]}</div>
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-[#a41d1d] focus:text-[#a41d1d]" onClick={() => setRemoving(m)}>
                          {isMe ? "Leave this business" : "Remove access"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="w-8 shrink-0" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={`Pending invitations (${invitations.length})`} description="Invitations expire after 7 days." padded={false}>
        {invitations.length === 0 ? (
          <div className="px-6 py-8 text-center text-[13px] text-ink-muted">No pending invitations.</div>
        ) : (
          <ul className="divide-y divide-hairline">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-invite={inv.email}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-canvas-2 text-ink-muted">
                  <Mail className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-ink">{inv.email}</div>
                  <div className="text-[12px] text-ink-muted">
                    {ROLE_LABELS[inv.access_role]} · expires {fmtRelative(inv.expires_at)}
                  </div>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => resend.mutate(inv.id)} disabled={resend.isPending}>
                      Resend
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-[12px] text-ink-muted" onClick={() => revoke.mutate(inv.id)} disabled={revoke.isPending}>
                      Cancel invite
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Roles explained">
        <div className="grid gap-3 sm:grid-cols-2">
          {(["manager", "viewer"] as Role[]).map((r) => (
            <div key={r} className="rounded-[6px] border border-hairline p-3">
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-indigo" />
                <span className="text-[13px] font-semibold text-ink">{ROLE_LABELS[r]}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">{ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
        </div>
        {ws.business?.org_name ? (
          <p className="mt-3 text-[12px] text-ink-muted">The team at {ws.business.org_name} can also manage this business.</p>
        ) : null}
      </Panel>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription>They'll get a link to set up their login for {ws.business?.name ?? "this business"}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Email" htmlFor="inv-email" required>
              <Input id="inv-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourbusiness.com" />
            </Field>
            <Field label="Role" htmlFor="inv-role" hint={ROLE_DESCRIPTIONS[role]}>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">{ROLE_LABELS.manager}</SelectItem>
                  <SelectItem value="viewer">{ROLE_LABELS.viewer}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => invite.mutate()} disabled={invite.isPending || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}>
              {invite.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removing?.user_id === ws.user?.id ? "Leave this business?" : `Remove ${removing?.profile?.full_name ?? removing?.profile?.email ?? "this person"}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.user_id === ws.user?.id ? "You'll lose access straight away. A manager can invite you back." : "They'll lose access straight away. You can invite them again at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-[#a41d1d] hover:bg-[#8a1717]" onClick={() => removing && remove.mutate(removing.user_id)}>
              {removing?.user_id === ws.user?.id ? "Leave" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
