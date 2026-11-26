import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, ErrorState, Notice, EmptyState } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate } from "@/lib/app/format";
import { brandApi, getInternalAdmins, grantPlatformAdmin, revokePlatformAdmin, teamApi } from "@/lib/api/console";
import type { Brand } from "@/lib/shared";
import { BrandEditor } from "./-brand";
import { LinkBox, READ_ONLY_HINT, useConsole } from "./-shared";
import { named } from "@/lib/app/product";
import { EmailCalendarsSection } from "./-email-calendars";

const TABS = ["team", "branding", "account", "platform", "email"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/admin/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (TABS.includes(s.tab as Tab) ? { tab: s.tab as Tab } : {}),
  head: () => ({ meta: [{ title: named("Settings — Answered admin") }] }),
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const { ws, platform, orgName } = useConsole();
  // The server's own email sender and Google/Microsoft apps: the platform admin, or (SINGLE_AGENCY) the owner.
  const serverSettings = platform || Boolean(ws.session?.serverSettings);
  const { tab = "team" } = Route.useSearch();
  const navigate = useNavigate();
  const setTab = (t: string) => void navigate({ to: "/admin/settings", search: t === "team" ? {} : { tab: t as Tab }, replace: true });

  return (
    <div className="space-y-5" data-page="admin-settings">
      <PageHeader eyebrow={platform ? "Platform console" : "Agency console"} title="Settings" description={`${orgName || "Your team"}: the people who use this console, its branding and your own account.`} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          {platform ? <TabsTrigger value="platform">Platform admins</TabsTrigger> : null}
          {serverSettings ? <TabsTrigger value="email">Email and calendars</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="team" className="mt-4">
          <TeamSection />
        </TabsContent>
        <TabsContent value="branding" className="mt-4">
          <BrandingSection />
        </TabsContent>
        <TabsContent value="account" className="mt-4">
          <AccountSection />
        </TabsContent>
        {platform ? (
          <TabsContent value="platform" className="mt-4">
            <PlatformAdminsSection />
          </TabsContent>
        ) : null}
        {serverSettings ? (
          <TabsContent value="email" className="mt-4">
            <EmailCalendarsSection />
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
  const revoke = useMutation({ mutationFn: teamApi.revoke, onSuccess: set, onError: (e: Error) => toast.error(e.message) });
  const change = useMutation({ mutationFn: ({ id, r }: { id: string; r: string }) => teamApi.changeRole(id, r), onSuccess: set, onError: (e: Error) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: teamApi.remove, onSuccess: set, onError: (e: Error) => toast.error(e.message) });
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
      <Panel title="Name" description="Shown to your team and to the businesses you share receptionists with.">
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

      <Panel title="People" description="Owners and admins can invite people and share clients. Members can work on clients." padded={false}>
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
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-ink-muted" aria-label={`Remove ${m.email}`} onClick={() => remove.mutate(m.id)}>
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

// ---- Branding: logo and background for the agency's own screens and its clients' ----

function BrandingSection() {
  const { ws, canManage, readOnly, orgName } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "brand"], queryFn: brandApi.get });
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-4" data-section="branding">
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : !canManage ? <Notice tone="info">Only owners and admins can change the branding.</Notice> : null}
      <Panel title="Default branding" description="Used on your clients' workspaces unless a client has its own (set it on the client's page).">
        <BrandEditor
          brand={q.data}
          canManage={canManage}
          previewName={orgName || "Your client"}
          upload={brandApi.upload}
          save={brandApi.set}
          onSaved={async (b: Brand) => {
            qc.setQueryData(["console", "brand"], b);
            await ws.refresh();
          }}
        />
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
