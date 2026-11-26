import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Loader2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Panel, Notice, UsageBar } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { BrandingEditor } from "@/components/app/BrandingEditor";
import { Field, FormSection, SaveBar } from "@/components/app/forms";
import { fmtDateTime, fmtNumber, fmtRelative, humanize } from "@/lib/app/format";
import { usageQuery } from "@/lib/app/queries";
import { getAudit, getBilling, updateAccount, updateBusiness } from "@/lib/api/manage";
import { asBusinessHours, asRecord, asStringArray, DAY_KEYS, DAY_LABELS, DEFAULT_HOURS, type Business, type BusinessHours } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { mergeFormOnRefresh } from "@/lib/app/business-logic";
import { ALWAYS_FROM, ALWAYS_TO, TIMEZONES } from "@/lib/shared";
import { PRODUCT } from "@/lib/app/product";
import { ClientSettings } from "@/components/app/client/ClientSettings";
import { ProfileEditor } from "@/components/app/profile/ProfileEditor";
import { cleanProfile, profileOf, settingsToneFor, totalProgress } from "@/components/app/profile/helpers";
import { saveReceptionist, type ReceptionistRow } from "@/components/app/receptionist/model";
import { agentsQuery } from "@/lib/app/queries";
import type { ReceptionProfile } from "@/lib/profile";

const SETTINGS_TABS = ["business", "hours", "handling", "branding", "account", "billing", "activity"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({ meta: [{ title: `Settings | ${PRODUCT}` }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
    const t = String(search["tab"] ?? "");
    return SETTINGS_TABS.includes(t as SettingsTab) ? { tab: t as SettingsTab } : {};
  },
  component: SettingsRoute,
});

// No tab: the owner's simple settings. A tab (Business, Account, and the agency's own
// Call handling, Branding, Plan) opens the fuller editors.
function SettingsRoute() {
  const { tab } = Route.useSearch();
  return tab ? <SettingsPage /> : <ClientSettings />;
}

// The industries our receptionist script knows (they round-trip through the server).
const INDUSTRY_OPTIONS = ["Dental", "Healthcare", "Trades", "Salon & beauty", "Real estate", "Automotive", "Professional services", "Childcare", "Other"];

interface BizForm {
  name: string;
  industry: string;
  phone: string;
  email: string;
  website: string;
  address_line1: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  timezone: string;
  business_hours: BusinessHours;
  /** One closure per line here; the server stores them as "a; b". */
  closures: string;
}

// "Always on (24/7)": every day open 00:00 to 23:59.
const allDay = (h: BusinessHours): boolean => DAY_KEYS.every((d) => !h[d].closed && h[d].open === ALWAYS_FROM && h[d].close === ALWAYS_TO);
const alwaysHours = (): BusinessHours =>
  Object.fromEntries(DAY_KEYS.map((d) => [d, { open: ALWAYS_FROM, close: ALWAYS_TO, closed: false }])) as BusinessHours;

function fromBusiness(b: Business & { closures?: string | null }): BizForm {
  return {
    name: b.name,
    industry: b.industry ?? "Other",
    phone: b.phone ?? "",
    email: b.email ?? "",
    website: b.website ?? "",
    address_line1: b.address_line1 ?? "",
    city: b.city ?? "",
    region: b.region ?? "",
    postal_code: b.postal_code ?? "",
    country: b.country ?? "AU",
    timezone: b.timezone,
    business_hours: asBusinessHours(b.business_hours),
    closures: String(b.closures ?? "").split(/;\s*/).filter(Boolean).join("\n"),
  };
}

function SettingsPage() {
  const ws = useWorkspace();
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const staff = ws.access.kind === "staff_view";
  // Call handling and the plan are the agency's: owners don't get those tabs.
  const tab: SettingsTab = tabParam && (staff || !["handling", "billing"].includes(tabParam)) ? tabParam : "business";
  const qc = useQueryClient();
  const b = ws.business;
  const canManage = ws.access.canManage;
  const billingQ = useQuery({ queryKey: ["billing", ws.businessId], enabled: !!ws.businessId, queryFn: () => getBilling(ws.businessId!) });
  const usageQ = useQuery(usageQuery(ws.businessId));
  const auditQ = useQuery({ queryKey: ["audit", ws.businessId], enabled: !!ws.businessId && canManage, queryFn: () => getAudit(ws.businessId!) });

  const [form, setForm] = useState<BizForm | null>(b ? fromBusiness(b) : null);
  const [baseline, setBaseline] = useState<string>(b ? JSON.stringify(fromBusiness(b)) : "");
  const loadedBusinessId = useRef<string | null>(b?.id ?? null);

  useEffect(() => {
    if (!b) return;
    const next = fromBusiness(b);
    if (loadedBusinessId.current !== b.id) {
      loadedBusinessId.current = b.id;
      setForm(next);
      setBaseline(JSON.stringify(next));
      return;
    }
    // Same business refreshed in the background: keep what is being typed.
    setForm((prev) => {
      if (!prev) return next;
      const base = (JSON.parse(baseline || "null") as BizForm | null) ?? prev;
      return mergeFormOnRefresh(prev as unknown as Record<string, unknown>, base as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>) as unknown as BizForm;
    });
    setBaseline(JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b]);

  const dirty = !!form && JSON.stringify(form) !== baseline;

  const save = useMutation({
    mutationFn: async () => {
      if (!form || !b) throw new Error("No business selected.");
      if (!canManage) throw new Error(ws.access.readOnlyReason ?? "You don't have permission to change these settings.");
      if (!form.name.trim()) throw new Error("Business name is required.");
      const submitted: BizForm = JSON.parse(JSON.stringify(form)) as BizForm;
      const res = await updateBusiness(b.id, {
        name: submitted.name.trim(),
        industry: submitted.industry,
        phone: submitted.phone.trim(),
        email: submitted.email.trim(),
        website: submitted.website.trim(),
        address_line1: submitted.address_line1.trim(),
        city: submitted.city.trim(),
        region: submitted.region.trim(),
        postal_code: submitted.postal_code.trim(),
        country: submitted.country.trim(),
        timezone: submitted.timezone,
        business_hours: submitted.business_hours,
        closures: submitted.closures,
      });
      return { submittedBusinessId: b.id, applied: res.applied, saved: res.business };
    },
    onSuccess: ({ submittedBusinessId, applied, saved }) => {
      if (loadedBusinessId.current !== submittedBusinessId) return;
      // Show what the server stored (it tidies values, e.g. adds https:// to the website).
      const stored = fromBusiness(saved);
      setForm(stored);
      setBaseline(JSON.stringify(stored));
      toast.success(applied ? "Saved and applied to your receptionist" : "Settings saved");
      void qc.invalidateQueries({ queryKey: ["businesses"] });
      void qc.invalidateQueries({ queryKey: ["agents", ws.businessId] });
      void qc.invalidateQueries({ queryKey: ["audit", ws.businessId] });
    },
    onError: (e) => toast.error("Couldn't save", { description: e.message }),
  });

  const usage = usageQ.data ?? [];
  const last30 = useMemo(() => {
    const since = Date.now() - 30 * 86_400_000;
    const recent = usage.filter((u) => Date.parse(u.period_start) >= since);
    return {
      minutes: recent.filter((u) => u.kind === "call_minutes").reduce((s, u) => s + Number(u.quantity), 0),
      texts: recent.filter((u) => u.kind === "sms").reduce((s, u) => s + Number(u.quantity), 0),
    };
  }, [usage]);

  if (!b || !form) {
    return (
      <div className="space-y-5">
        <PageHeader title="Settings" description="Business details, hours and your account." />
        <Notice tone="info">No business is selected.</Notice>
      </div>
    );
  }

  const set = <K extends keyof BizForm>(k: K, v: BizForm[K]) => setForm({ ...form, [k]: v });
  const businessTab = tab === "business" || tab === "hours";

  return (
    <div className="space-y-5">
      <Link to="/app/settings" search={{}} data-back className="-ml-1 inline-flex min-h-10 items-center gap-1 rounded-md pr-3 text-[14px] font-medium text-[var(--primary-ink)] hover:underline">
        <ChevronLeft className="h-4 w-4" /> Settings
      </Link>
      <PageHeader eyebrow={b.name} title={tab === "account" ? "Your login" : tab === "business" || tab === "hours" ? "Business details" : "Settings"} />

      {!canManage ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Only managers can change business settings."}</Notice> : null}

      <Tabs value={tab} onValueChange={(v) => void navigate({ search: { tab: v as SettingsTab }, replace: true })}>
        <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-[6px] bg-canvas-2 p-1 sm:w-auto">
          <TabsTrigger value="business" className="text-[12.5px]">Business</TabsTrigger>
          <TabsTrigger value="hours" className="text-[12.5px]">Hours</TabsTrigger>
          {staff ? <TabsTrigger value="handling" className="text-[12.5px]" data-settings-tab="handling">Call handling details</TabsTrigger> : null}
          <TabsTrigger value="branding" className="text-[12.5px]">Branding</TabsTrigger>
          <TabsTrigger value="account" className="text-[12.5px]">Your account</TabsTrigger>
          {staff ? <TabsTrigger value="billing" className="text-[12.5px]">Plan & usage</TabsTrigger> : null}
          {canManage ? <TabsTrigger value="activity" className="text-[12.5px]">Activity</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="business" className="mt-3 space-y-4">
          <FormSection title="Business details" description="Used by your receptionist when callers ask who you are or how to reach you.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" htmlFor="b-name" required>
                <Input id="b-name" value={form.name} onChange={(e) => set("name", e.target.value)} disabled={!canManage} maxLength={80} />
              </Field>
              <Field label="Industry" htmlFor="b-ind">
                <Select value={INDUSTRY_OPTIONS.includes(form.industry) ? form.industry : "Other"} onValueChange={(v) => set("industry", v)} disabled={!canManage}>
                  <SelectTrigger id="b-ind"><SelectValue /></SelectTrigger>
                  <SelectContent>{INDUSTRY_OPTIONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Main phone" htmlFor="b-phone" hint="Your own number, for your records. Your receptionist's numbers are under Call handling.">
                <Input id="b-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={!canManage} />
              </Field>
              <Field label="Email" htmlFor="b-email">
                <Input id="b-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} disabled={!canManage} />
              </Field>
              <Field label="Website" htmlFor="b-web" className="sm:col-span-2">
                <Input id="b-web" type="url" value={form.website} onChange={(e) => set("website", e.target.value)} disabled={!canManage} placeholder="https://" />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Address">
            <div className="grid gap-4 sm:grid-cols-6">
              <Field label="Street" htmlFor="b-addr" className="sm:col-span-6">
                <Input id="b-addr" value={form.address_line1} onChange={(e) => set("address_line1", e.target.value)} disabled={!canManage} maxLength={140} />
              </Field>
              <Field label="Suburb / city" htmlFor="b-city" className="sm:col-span-2">
                <Input id="b-city" value={form.city} onChange={(e) => set("city", e.target.value)} disabled={!canManage} maxLength={60} />
              </Field>
              <Field label="State" htmlFor="b-region" className="sm:col-span-2">
                <Input id="b-region" value={form.region} onChange={(e) => set("region", e.target.value)} disabled={!canManage} maxLength={40} />
              </Field>
              <Field label="Postcode" htmlFor="b-pc">
                <Input id="b-pc" value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} disabled={!canManage} maxLength={10} />
              </Field>
              <Field label="Country" htmlFor="b-country">
                <Input id="b-country" value={form.country} onChange={(e) => set("country", e.target.value)} disabled={!canManage} maxLength={40} />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Time zone">
            <Field label="Time zone" htmlFor="b-tz" hint="Opening hours, bookings and reports all follow this.">
              <Select value={form.timezone} onValueChange={(v) => set("timezone", v)} disabled={!canManage}>
                <SelectTrigger id="b-tz" className="sm:max-w-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </FormSection>
          <p className="text-[12px] text-ink-muted">
            Calls are transcribed; audio isn't stored. The services your receptionist can book are kept with the receptionist.{" "}
            {ws.access.kind === "staff_view" ? <Link to="/app/receptionist" search={{ tab: "booking" }} className="text-indigo hover:underline">Edit services</Link> : "Change them in Settings, What callers can ask for"}.
          </p>
        </TabsContent>

        <TabsContent value="hours" className="mt-3">
          <Panel title="When would you like the AI receptionist to be active?" description="It only operates within these hours.">
            <div className="mb-3 inline-flex rounded-[6px] border border-hairline p-0.5" role="radiogroup" aria-label="When it's active">
              {[
                { id: "always", label: "Always on (24/7)", on: allDay(form.business_hours), pick: () => set("business_hours", alwaysHours()) },
                {
                  id: "times",
                  label: "Set specific times",
                  on: !allDay(form.business_hours),
                  // Back to set times: the saved hours, unless they were 24/7 too.
                  pick: () => {
                    if (!allDay(form.business_hours)) return;
                    const saved = (JSON.parse(baseline) as BizForm).business_hours;
                    set("business_hours", allDay(saved) ? { ...DEFAULT_HOURS } : saved);
                  },
                },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={o.on}
                  data-hours={o.id}
                  disabled={!canManage}
                  onClick={o.pick}
                  className={`flex-1 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-[12.5px] ${o.on ? "bg-indigo text-white" : "text-ink-muted hover:text-ink"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {allDay(form.business_hours) ? (
              <p className="rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 text-[12.5px] text-ink">Your receptionist answers every call, any time of day, every day of the week.</p>
            ) : (
              <>
                <ul className="divide-y divide-hairline">
                  {DAY_KEYS.map((d) => {
                    const day = form.business_hours[d];
                    const put = (next: Partial<typeof day>) => set("business_hours", { ...form.business_hours, [d]: { ...day, ...next } });
                    return (
                      <li key={d} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 sm:grid-cols-[120px_auto_1fr]">
                        <span className="text-[13px] font-medium text-ink">{DAY_LABELS[d]}</span>
                        <div className="flex items-center gap-2 sm:order-3 sm:justify-self-end">
                          <span className="text-[12px] text-ink-muted">{day.closed ? "Closed" : "Open"}</span>
                          <Switch checked={!day.closed} onCheckedChange={(v) => put({ closed: !v })} disabled={!canManage} aria-label={`${DAY_LABELS[d]} open`} />
                        </div>
                        <div className="col-span-2 flex items-center gap-2 sm:order-2 sm:col-span-1">
                          <Input type="time" value={day.open} onChange={(e) => put({ open: e.target.value })} disabled={!canManage || day.closed} className="h-8 w-[112px] text-[12.5px]" aria-label={`${DAY_LABELS[d]} opens`} />
                          <span className="text-[12px] text-ink-muted">to</span>
                          <Input type="time" value={day.close} onChange={(e) => put({ close: e.target.value })} disabled={!canManage || day.closed} className="h-8 w-[112px] text-[12.5px]" aria-label={`${DAY_LABELS[d]} closes`} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-7 text-[12px]"
                    onClick={() => {
                      const next = { ...form.business_hours };
                      for (const d of ["tue", "wed", "thu", "fri"] as const) next[d] = { ...form.business_hours.mon };
                      set("business_hours", next);
                    }}
                  >
                    Copy Monday to weekdays
                  </Button>
                ) : null}
              </>
            )}
          </Panel>
          <Panel className="mt-4" title="Closures and public holidays" description="Optional. On these days callers are told the business is closed, whatever the hours above say.">
            <Field label="Closures" htmlFor="h-closures" hint="One per line.">
              <Textarea
                id="h-closures"
                rows={3}
                maxLength={600}
                placeholder={"e.g. Closed all national public holidays\nClosed 24 December to 6 January"}
                value={form.closures}
                onChange={(e) => set("closures", e.target.value)}
                disabled={!canManage}
                data-field="closures"
              />
            </Field>
          </Panel>
        </TabsContent>

        <TabsContent value="handling" className="mt-3">
          <CallHandlingDetails />
        </TabsContent>

        <TabsContent value="branding" className="mt-3">
          <BrandingEditor />
        </TabsContent>

        <TabsContent value="account" className="mt-3 space-y-4">
          <AccountSettings />
        </TabsContent>

        <TabsContent value="billing" className="mt-3 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Panel title="Usage, last 30 days" description="Measured from your receptionist's calls and texts.">
              <div className="space-y-4">
                {[
                  { label: "Call minutes", value: last30.minutes, unit: "min" },
                  { label: "Text conversations", value: last30.texts, unit: "" },
                  { label: "Phone numbers", value: (b as { phone_numbers?: string[] }).phone_numbers?.length ?? 0, unit: "" },
                ].map((u) => (
                  <div key={u.label}>
                    <div className="mb-1 flex items-center justify-between text-[12.5px]">
                      <span className="text-ink">{u.label}</span>
                      <span className="tabular-nums text-ink-muted">
                        {usageQ.isPending ? "…" : fmtNumber(Math.round(u.value))} {u.unit}
                      </span>
                    </div>
                    <UsageBar value={u.value} max={Math.max(u.value, 1)} />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Your plan">
              {billingQ.isPending ? (
                <div className="h-24 animate-pulse rounded bg-canvas-2" />
              ) : (
                <p className="text-[13px] text-ink-muted">{billingQ.data?.billing ?? "Billing isn't set up yet."}</p>
              )}
            </Panel>
          </div>
        </TabsContent>

        {canManage ? (
          <TabsContent value="activity" className="mt-3">
            <Panel title="Recent changes" description="Who changed what for this business." padded={false}>
              {auditQ.isPending ? (
                <div className="p-4 text-[13px] text-ink-muted">Loading…</div>
              ) : (auditQ.data ?? []).length === 0 ? (
                <div className="px-6 py-10 text-center text-[13px] text-ink-muted">
                  <ScrollText className="mx-auto mb-2 h-5 w-5 text-ink-muted/60" />
                  No changes recorded yet.
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {(auditQ.data ?? []).slice(0, 50).map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-[12.5px]">
                      <StatusBadge tone="muted" className="mt-0.5 shrink-0">{humanize(a.entity_type)}</StatusBadge>
                      <div className="min-w-0 flex-1">
                        <div className="[overflow-wrap:anywhere] text-ink">{a.summary ?? humanize(a.action)}</div>
                        <div className="truncate text-[11.5px] text-ink-muted">{a.actor_email ?? "System"} · {fmtDateTime(a.created_at)}</div>
                      </div>
                      <span className="hidden shrink-0 text-ink-muted sm:inline">{fmtRelative(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </TabsContent>
        ) : null}
      </Tabs>

      {businessTab ? (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          onSave={() => save.mutate()}
          onReset={() => setForm(JSON.parse(baseline) as BizForm)}
          lastSavedAt={b.updated_at}
          disabled={!canManage}
          disabledReason={ws.access.readOnlyReason}
        />
      ) : null}

      <p className="text-[11.5px] text-ink-muted">
        {staff ? <>Need another number? See <Link to="/app/phone-numbers" className="text-indigo hover:underline">Call handling</Link>. </> : null}To close this business or change your numbers, contact {b.org_name || "your agency"}.
      </p>
    </div>
  );
}

// The detailed receptionist setup (tone, booking rules, services and prices, what it asks,
// policies, house rules): the same editor as the new-receptionist wizard. Common questions
// aren't here: once the receptionist exists they live under Knowledge.
function CallHandlingDetails() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const businessId = ws.businessId;
  const canEdit = ws.access.canEdit;
  const agentsQ = useQuery(agentsQuery(businessId));
  const agent = agentsQ.data?.[0] as (ReceptionistRow & { profile?: ReceptionProfile }) | undefined;
  const saved = useMemo(() => profileOf(agent), [agent]);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<ReceptionProfile>(saved);
  const [baseline, setBaseline] = useState(savedKey);
  const loaded = useRef<string | null>(null);

  // Load once per receptionist; later refreshes only move the baseline unless nothing was edited.
  useEffect(() => {
    if (!agent) return;
    if (loaded.current !== agent.id) {
      loaded.current = agent.id;
      setDraft(saved);
    } else if (JSON.stringify(draft) === baseline) setDraft(saved);
    setBaseline(savedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, savedKey]);

  const dirty = JSON.stringify(draft) !== baseline;
  const save = useMutation({
    mutationFn: async () => {
      if (!businessId) throw new Error("No business selected.");
      const profile = cleanProfile(draft);
      return saveReceptionist(businessId, { profile, ...(profile.tone ? { tone: settingsToneFor(profile.tone) } : {}) } as Parameters<typeof saveReceptionist>[1]);
    },
    onSuccess: async (res) => {
      toast.success(res.applied ? "Saved and applied to your receptionist" : "Call handling saved");
      await qc.invalidateQueries({ queryKey: ["agents", businessId] });
      await qc.invalidateQueries({ queryKey: ["audit", businessId] });
    },
    onError: (e) => toast.error("Couldn't save", { description: e.message }),
  });

  if (agentsQ.isPending) return <div className="h-40 animate-pulse rounded-[6px] bg-canvas-2" />;
  if (!agent) return <Notice tone="info">This business doesn't have a receptionist yet.</Notice>;
  const progress = totalProgress(draft, false);
  return (
    <div className="space-y-4" data-page="call-handling-details">
      <Panel title="Call handling details" description={`How ${agent.name || "your receptionist"} sounds, books, quotes and handles urgent calls. ${progress.set} of ${progress.total} details set.`}>
        <ProfileEditor value={draft} onChange={setDraft} disabled={!canEdit} showFaqs={false} services={asStringArray(asRecord(agent.booking_rules)["services"])} />
        <p className="mt-3 text-[12px] text-ink-muted">
          Common questions and answers are managed under <Link to="/app/knowledge" className="text-indigo hover:underline">Knowledge</Link>.
        </p>
      </Panel>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onReset={() => setDraft(JSON.parse(baseline) as ReceptionProfile)} disabled={!canEdit} disabledReason={ws.access.readOnlyReason} />
    </div>
  );
}

// The signed-in person's own name and password (existing /api/account). Viewers can
// change their own details too: it's their login, not the business's settings.
function AccountSettings() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [name, setName] = useState(ws.session?.user.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  useEffect(() => setName(ws.session?.user.name ?? ""), [ws.session?.user.name]);

  const saveName = useMutation({
    mutationFn: () => updateAccount({ name: name.trim() }),
    onSuccess: () => {
      toast.success("Name updated");
      void qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => toast.error("Couldn't save", { description: e.message }),
  });
  const savePassword = useMutation({
    mutationFn: async () => {
      if (next.length < 10) throw new Error("Use a password of at least 10 characters.");
      if (next !== confirm) throw new Error("The new passwords don't match.");
      return updateAccount({ currentPassword: current, newPassword: next });
    },
    onSuccess: () => {
      toast.success("Password changed", { description: "You've been signed out on your other devices." });
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (e) => toast.error("Couldn't change password", { description: e.message }),
  });

  return (
    <>
      <FormSection title="Your details" description="How you appear to the rest of the team.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="me-name">
            <Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Email" htmlFor="me-email" hint="Your sign-in email can't be changed here.">
            <Input id="me-email" value={ws.session?.user.email ?? ""} readOnly disabled />
          </Field>
        </div>
        <div>
          <Button size="sm" onClick={() => saveName.mutate()} disabled={saveName.isPending || name.trim() === (ws.session?.user.name ?? "")}>
            {saveName.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Save name
          </Button>
        </div>
      </FormSection>
      <FormSection title="Password" description="Changing it signs you out everywhere else.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password" htmlFor="me-cur">
            <Input id="me-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" htmlFor="me-new" hint="At least 10 characters.">
            <Input id="me-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="me-confirm">
            <Input id="me-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button size="sm" onClick={() => savePassword.mutate()} disabled={savePassword.isPending || !current || !next}>
            {savePassword.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Change password
          </Button>
        </div>
      </FormSection>
    </>
  );
}
