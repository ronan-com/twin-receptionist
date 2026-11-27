import { useEffect, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, ErrorState, Notice, EmptyState } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate } from "@/lib/app/format";
import { brandApi, getInternalAdmins, grantPlatformAdmin, platformApi, revokePlatformAdmin, teamApi, type AccountRow } from "@/lib/api/console";
import { DeleteDialog } from "@/components/app/DeleteDialog";
import { LinkBox, READ_ONLY_HINT, useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";
import { EmailCalendarsSection } from "./-email-calendars";
import { EmailSendingSection } from "./-email-sending";
import { SupportSection } from "./-support";
import { UpdatesSection } from "./-updates";
import { BackupsSection } from "./-backups";

const TABS = ["team", "account", "platform", "accounts", "sending", "email", "support", "updates", "backups"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/admin/settings")({
  // Branding moved to its own page (Brand); old links still land there.
  beforeLoad: ({ location }) => {
    if (/tab=branding/.test(location.searchStr ?? "")) throw redirect({ to: "/admin/branding", replace: true });
  },
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (TABS.includes(s.tab as Tab) ? { tab: s.tab as Tab } : {}),
  head: () => ({ meta: [{ title: `Settings — ${PRODUCT} admin` }] }),
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const { ws, platform, orgName, canManage, role } = useConsole();
  // The server's own email sender and Google/Microsoft apps: the platform admin, or (SINGLE_AGENCY) the owner.
  const serverSettings = platform || Boolean(ws.session?.serverSettings);
  // Sharing stats and Support access: on a self-hosted copy (SINGLE_AGENCY), for its owner (and a support session, read-only).
  const supportTab = Boolean(ws.session?.singleAgency) && !platform;
  // How account emails are sent: the platform admin, or (SINGLE_AGENCY) the agency's owners and admins.
  const sendingTab = platform || (Boolean(ws.session?.singleAgency) && canManage && (role === "owner" || role === "admin"));
  const { tab = "team" } = Route.useSearch();
  const navigate = useNavigate();
  const setTab = (t: string) => void navigate({ to: "/admin/settings", search: t === "team" ? {} : { tab: t as Tab }, replace: true });

  return (
    <div className="space-y-5" data-page="admin-settings">
      <PageHeader eyebrow={platform ? "Platform console" : "Agency console"} title="Settings" description={orgName || "Your team"} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          {platform ? <TabsTrigger value="platform">Platform admins</TabsTrigger> : null}
          {platform ? <TabsTrigger value="accounts">All accounts</TabsTrigger> : null}
          {sendingTab ? <TabsTrigger value="sending">Email</TabsTrigger> : null}
          {serverSettings ? <TabsTrigger value="email">Email and calendars</TabsTrigger> : null}
          {supportTab ? <TabsTrigger value="support">Support</TabsTrigger> : null}
          {supportTab ? <TabsTrigger value="updates">Updates</TabsTrigger> : null}
          {supportTab ? <TabsTrigger value="backups">Backups</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="team" className="mt-4">
          <TeamSection />
        </TabsContent>
        <TabsContent value="account" className="mt-4">
          <AccountSection />
        </TabsContent>
        {platform ? (
          <TabsContent value="platform" className="mt-4">
            <PlatformAdminsSection />
          </TabsContent>
        ) : null}
        {platform ? (
          <TabsContent value="accounts" className="mt-4">
            <AllAccountsSection />
          </TabsContent>
        ) : null}
        {sendingTab ? (
          <TabsContent value="sending" className="mt-4">
            <EmailSendingSection />
          </TabsContent>
        ) : null}
        {serverSettings ? (
          <TabsContent value="email" className="mt-4">
            <EmailCalendarsSection />
          </TabsContent>
        ) : null}
        {supportTab ? (
          <TabsContent value="updates" className="mt-4">
            <UpdatesSection />
          </TabsContent>
        ) : null}
        {supportTab ? (
          <TabsContent value="backups" className="mt-4">
            <BackupsSection />
          </TabsContent>
        ) : null}
        {supportTab ? (
          <TabsContent value="support" className="mt-4">
            <SupportSection />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

// ---- Team: the agency's own people (not its customers) ----

function TeamSection() {
  const { ws, canManage, readOnly, role } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "team"], queryFn: teamApi.get });
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [link, setLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [orgName, setOrgName] = useState(ws.org?.name ?? "");
  useEffect(() => setOrgName(ws.org?.name ?? ""), [ws.org?.name]);

  const set = (data: unknown) => qc.setQueryData(["console", "team"], data);
  const invite = useMutation({
    mutationFn: () => teamApi.invite(email.trim(), inviteRole),
    onSuccess: async (r) => {
      setLink({ email: email.trim(), ...r });
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["console", "team"] });
    },
    onError: (e: Error) => toast.error("Couldn't invite", { description: e.message }),
  });
  const [reset, setReset] = useState<{ email: string; url: string } | null>(null);
  const resetLink = useMutation({
    mutationFn: teamApi.resetLink,
    onSuccess: (r) => {
      if (r.emailed) toast.success(`Reset link emailed to ${r.email}`);
      else setReset({ email: r.email, url: r.url });
    },
    onError: (e: Error) => toast.error("Couldn't make a reset link", { description: e.message }),
  });
  const revoke = useMutation({ mutationFn: teamApi.revoke, onSuccess: set, onError: (e: Error) => toast.error(e.message) });
  const change = useMutation({ mutationFn: ({ id, r }: { id: string; r: string }) => teamApi.changeRole(id, r), onSuccess: set, onError: (e: Error) => toast.error(e.message) });
  const [removing, setRemoving] = useState<{ id: string; email: string; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: string }) => teamApi.remove(id, confirm),
    onSuccess: (r) => {
      set({ members: r.members, invites: r.invites, emailsSent: r.emailsSent });
      toast.success(`${removing?.email ?? "They"} removed`, { description: r.userDeleted ? "Their account was deleted too, since they weren't in any other team." : "They're still in another team, so their account stays." });
      setRemoving(null);
    },
    onError: (e: Error) => toast.error("Couldn't remove them", { description: e.message }),
  });
  const rename = useMutation({
    mutationFn: () => teamApi.renameOrg(orgName.trim()),
    onSuccess: async () => {
      toast.success("Name saved");
      await ws.refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const t = q.data;
  return (
    <div className="space-y-4">
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : null}
      <Panel title="Name" description="Shown to your team and clients.">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (orgName.trim()) rename.mutate();
          }}
        >
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={80} disabled={readOnly || role !== "owner"} aria-label="Team name" className="h-9 sm:max-w-sm" />
          {!readOnly && role === "owner" ? (
            <Button type="submit" size="sm" className="h-9" disabled={rename.isPending || !orgName.trim() || orgName.trim() === ws.org?.name}>
              Save
            </Button>
          ) : null}
        </form>
      </Panel>

      <Panel title="People" description="Who can use this console." padded={false}>
        <ul className="divide-y divide-hairline" data-list="team">
          {(t?.members ?? []).map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-4 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{m.name || m.email}{m.id === ws.session?.user.id ? " (you)" : ""}</div>
                <div className="truncate text-[12px] text-ink-muted">{m.email} · joined {fmtDate(m.joinedAt)}</div>
              </div>
              <div className="flex items-center gap-2">
                {canManage && m.id !== ws.session?.user.id ? (
                  <>
                    <Select value={m.role} onValueChange={(r) => change.mutate({ id: m.id, r })}>
                      <SelectTrigger className="h-8 w-[110px] text-[12.5px]" aria-label={`Role for ${m.email}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {role === "owner" ? <SelectItem value="owner">Owner</SelectItem> : null}
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                    {m.role !== "owner" || role === "owner" ? (
                      <Button variant="outline" size="sm" className="h-8 text-[12px]" disabled={resetLink.isPending} onClick={() => resetLink.mutate(m.id)} data-reset-link>
                        <KeyRound className="mr-1 h-3.5 w-3.5" /> Copy reset link
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-ink-muted" aria-label={`Remove ${m.email}`} onClick={() => setRemoving({ id: m.id, email: m.email, name: m.name })} data-action="remove-member">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <StatusBadge tone={m.role === "owner" ? "indigo" : "muted"}>{m.role[0].toUpperCase() + m.role.slice(1)}</StatusBadge>
                )}
              </div>
            </li>
          ))}
          {(t?.invites ?? []).map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-4 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-ink">{i.email}</div>
                <div className="truncate text-[12px] text-ink-muted">Invited as {i.role} · until {fmtDate(i.expiresAt)}</div>
              </div>
              {canManage ? (
                <Button variant="ghost" size="sm" className="h-8 text-[12px] text-ink-muted" onClick={() => revoke.mutate(i.id)}>
                  <X className="mr-1 h-3.5 w-3.5" /> Revoke
                </Button>
              ) : null}
            </li>
          ))}
          {q.isPending ? <li className="p-4 text-[12.5px] text-ink-muted">Loading…</li> : null}
        </ul>
        {canManage ? (
          <form
            className="flex flex-col gap-3 border-t border-hairline p-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) invite.mutate();
            }}
          >
            <Field label="Invite (email)" htmlFor="team-email" className="min-w-0 flex-1">
              <Input id="team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" required />
            </Field>
            <Field label="Role" htmlFor="team-role" className="sm:w-36">
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "member")}>
                <SelectTrigger id="team-role" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" size="sm" className="h-9" disabled={invite.isPending || !email.trim()}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" /> {invite.isPending ? "Inviting…" : "Invite"}
            </Button>
          </form>
        ) : null}
        <Dialog open={Boolean(reset)} onOpenChange={(o) => !o && setReset(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Password reset link</DialogTitle>
              <DialogDescription>Send {reset?.email} this link. It lets them choose a new password, works once, and expires in an hour. Email isn't set up, so nothing was sent.</DialogDescription>
            </DialogHeader>
            {reset ? <LinkBox url={reset.url} label="Reset link" /> : null}
          </DialogContent>
        </Dialog>
        <DeleteDialog
          open={!!removing}
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Remove ${removing?.name || removing?.email || ""} from ${ws.org?.name ?? "the team"}?`}
          name={removing?.email ?? ""}
          nameLabel="email"
          confirmLabel="Remove for good"
          pending={remove.isPending}
          onConfirm={(typed) => removing && remove.mutate({ id: removing.id, confirm: typed })}
        >
          <p>They lose access to this team straight away and are signed out of it. If they aren't in any other team, their account is deleted too.</p>
          <p>The clients and receptionists they worked on stay. Only the person goes.</p>
        </DeleteDialog>
        {link ? (
          <div className="space-y-2 border-t border-hairline p-4" data-team-invite-link>
            <p className="text-[12.5px] text-ink-muted">{link.emailed ? `Invite emailed to ${link.email}. You can also send them this link:` : `Send ${link.email} this link (invite emails aren't set up on this server yet):`}</p>
            <LinkBox url={link.url} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

// ---- Account: your own name and password ----

function AccountSection() {
  const { ws, readOnly } = useConsole();
  const [name, setName] = useState(ws.session?.user.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = useMutation({
    mutationFn: () => teamApi.updateAccount({ name: name.trim(), ...(next ? { currentPassword: current, newPassword: next } : {}) }),
    onSuccess: async () => {
      toast.success(next ? "Saved. Other devices are signed out." : "Saved");
      setCurrent("");
      setNext("");
      await ws.refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel title="Your account" description={ws.session?.user.email}>
      <form
        className="grid max-w-lg gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Your name" htmlFor="acc-name">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9" disabled={readOnly} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Current password" htmlFor="acc-cur">
            <Input id="acc-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-9" disabled={readOnly} />
          </Field>
          <Field label="New password" htmlFor="acc-new" hint="At least 10 characters. Leave blank to keep it.">
            <Input id="acc-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="h-9" disabled={readOnly} />
          </Field>
        </div>
        {!readOnly ? (
          <div>
            <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </div>
        ) : null}
      </form>
      {!ws.viewing && !ws.isPlatformAdmin ? <DeleteMyAccount email={ws.session?.user.email ?? ""} /> : null}
    </Panel>
  );
}

function DeleteMyAccount({ email }: { email: string }) {
  const { ws } = useConsole();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: (confirm: string) => teamApi.deleteAccount(confirm, password),
    onSuccess: () => {
      toast.success("Your account was deleted");
      window.location.assign("/login");
    },
    onError: (e: Error) => toast.error("Couldn't delete your account", { description: e.message }),
  });
  const owns = ws.session?.role === "owner";
  return (
    <div className="mt-6 max-w-lg border-t border-hairline pt-4" data-delete-account>
      <h3 className="text-[13px] font-semibold text-ink">Delete my account</h3>
      <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">
        Permanently deletes your login and removes you from every team. {owns ? "If you're the only owner of a team you have to make someone else an owner first, or delete the agency (the platform team can do that). " : ""}
        What you set up for your agency stays with it.
      </p>
      <Button variant="outline" size="sm" className="mt-2 h-8 text-[12.5px] text-destructive hover:text-destructive" onClick={() => { setPassword(""); setOpen(true); }} data-action="delete-account">
        <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete my account
      </Button>
      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your account?"
        name={email}
        nameLabel="email"
        confirmLabel="Delete my account"
        pending={remove.isPending}
        onConfirm={(typed) => remove.mutate(typed)}
        extraReady={password.length > 0}
        extraFields={
          <Field label="Your password" htmlFor="delete-password">
            <Input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-9" />
          </Field>
        }
      >
        <p>This permanently deletes the login for {email} and signs you out everywhere. It can't be undone.</p>
        <p>If you're the only owner of a team, we'll stop you and explain what to do first.</p>
      </DeleteDialog>
    </div>
  );
}

// ---- All accounts (platform only): delete test logins ----

function AllAccountsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "accounts"], queryFn: platformApi.accounts });
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<AccountRow | null>(null);
  const remove = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: string }) => platformApi.deleteAccount(id, confirm),
    onSuccess: async (r) => {
      toast.success(`${r.email} deleted`);
      setTarget(null);
      await qc.invalidateQueries({ queryKey: ["admin", "accounts"] });
      await qc.invalidateQueries({ queryKey: ["admin"] });
      await qc.invalidateQueries({ queryKey: ["console"] });
    },
    onError: (e: Error) => toast.error("Couldn't delete the account", { description: e.message }),
  });
  const s = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((a) => !s || [a.email, a.name, ...a.orgs.map((o) => o.name)].some((v) => v.toLowerCase().includes(s)));
  return (
    <Panel title="All accounts" description="Every login on the platform. Deleting one removes the person from every team and signs them out. Platform admins, you, and the only owner of a team can't be deleted here." padded={false}>
      <div className="border-b border-hairline px-3 py-2.5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email, name or team" className="h-8 text-[12.5px] sm:max-w-xs" aria-label="Search accounts" />
      </div>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      <ul className="divide-y divide-hairline" data-list="accounts">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 px-4 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between" data-account={a.email}>
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{a.name || a.email}</div>
              <div className="truncate text-[12px] text-ink-muted">{a.email} · since {fmtDate(a.createdAt)}</div>
              <div className="truncate text-[12px] text-ink-muted">{a.orgs.length ? a.orgs.map((o) => `${o.name} (${o.role})`).join(", ") : "Not in any team"}</div>
            </div>
            {a.blocked ? (
              <span className="max-w-xs text-[12px] text-ink-muted" title={a.blocked}>{a.blocked.length > 40 ? "Only owner of a team" : a.blocked}</span>
            ) : (
              <Button variant="outline" size="sm" className="h-8 shrink-0 text-[12.5px] text-destructive hover:text-destructive" onClick={() => setTarget(a)} data-action="delete-account-row">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </li>
        ))}
        {!q.isPending && rows.length === 0 ? <li className="p-4 text-[12.5px] text-ink-muted">No accounts match.</li> : null}
        {q.isPending ? <li className="p-4 text-[12.5px] text-ink-muted">Loading…</li> : null}
      </ul>
      <DeleteDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Delete the account ${target?.email ?? ""}?`}
        name={target?.email ?? ""}
        nameLabel="email"
        confirmLabel="Delete account for good"
        pending={remove.isPending}
        onConfirm={(typed) => target && remove.mutate({ id: target.id, confirm: typed })}
      >
        <p>This permanently deletes the login. {target?.orgs.length ? `They're removed from ${target.orgs.map((o) => o.name).join(", ")} and signed out everywhere.` : "They aren't in any team."} It can't be undone.</p>
        <p>The teams and clients they were in are not deleted. To delete those, use Agencies or the client's own page.</p>
      </DeleteDialog>
    </Panel>
  );
}

// ---- Platform admins (platform only) ----

function PlatformAdminsSection() {
  const { ws } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "internal-admins"], queryFn: getInternalAdmins });
  const [email, setEmail] = useState("");
  const set = (d: { admins: unknown }) => qc.setQueryData(["admin", "internal-admins"], d.admins);
  const grant = useMutation({
    mutationFn: () => grantPlatformAdmin(email.trim()),
    onSuccess: (d) => {
      set(d);
      setEmail("");
      toast.success("Platform access granted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({ mutationFn: revokePlatformAdmin, onSuccess: set, onError: (e: Error) => toast.error(e.message) });
  return (
    <div className="space-y-4">
      <Panel title="Grant platform access" description="Platform admins see every agency and business. The person must already have an account.">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) grant.mutate();
          }}
        >
          <Field label="Email" htmlFor="pa-email" className="min-w-0 flex-1">
            <Input id="pa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
          </Field>
          <Button type="submit" size="sm" className="h-9" disabled={!email.trim() || grant.isPending}>
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Grant access
          </Button>
        </form>
      </Panel>
      <Panel title="Platform admins" padded={false}>
        {q.error ? <ErrorState message={(q.error as Error).message} /> : null}
        {(q.data ?? []).length === 0 && !q.isPending ? <EmptyState compact title="No platform admins" /> : null}
        <ul className="divide-y divide-hairline">
          {(q.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{a.profile.full_name || a.profile.email}</div>
                <div className="truncate text-[12px] text-ink-muted">{a.profile.email} · since {fmtDate(a.created_at)}</div>
              </div>
              {a.user_id !== ws.session?.user.id ? (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-ink-muted" onClick={() => revoke.mutate(a.user_id)}>
                  <X className="mr-1 h-3.5 w-3.5" /> Revoke
                </Button>
              ) : (
                <StatusBadge tone="indigo">You</StatusBadge>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
