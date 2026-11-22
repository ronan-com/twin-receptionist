import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AudioLines, Bot, CalendarCheck, CheckCircle2, MessageSquareText, PhoneForwarded, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader, Panel, ErrorState, PageSkeleton, Notice } from "@/components/app/primitives";
import { Field, FormSection, SaveBar, TagInput } from "@/components/app/forms";
import { StatusBadge } from "@/components/app/StatusBadge";
import { agentsQuery, phoneNumbersQuery } from "@/lib/app/queries";
import { getVoices, updateReceptionist, type AgentRow } from "@/lib/api/manage";
import { asBusinessHours, asRecord, asStringArray, DAY_KEYS, DAY_LABELS, type BusinessHours, type Voice } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { receptionistReadiness } from "@/lib/app/business-logic";
import { fmtRelative } from "@/lib/app/format";
import { TIMEZONES } from "@/lib/shared";
import { cn } from "@/lib/utils";

const AGENT_TABS = ["persona", "conversation", "booking", "transfers", "hours"] as const;
type AgentTab = (typeof AGENT_TABS)[number];

export const Route = createFileRoute("/_authenticated/app/receptionist")({
  head: () => ({ meta: [{ title: "Receptionist | Answered" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: AgentTab } => {
    const t = String(search["tab"] ?? "");
    return AGENT_TABS.includes(t as AgentTab) ? { tab: t as AgentTab } : {};
  },
  component: ReceptionistPage,
});

/* ---------------- Form model ---------------- */

// The industries our receptionist script knows (they round-trip through the server).
const INDUSTRY_OPTIONS = ["Dental", "Healthcare", "Trades", "Salon & beauty", "Real estate", "Automotive", "Professional services", "Other"];
const TONES = [
  { value: "friendly", label: "Friendly", hint: "Warm, relaxed, like a good local receptionist." },
  { value: "professional", label: "Professional", hint: "Polite, clear and efficient." },
];
const LENGTHS = [15, 20, 30, 45, 60, 90];

interface AgentForm {
  name: string;
  greeting: string;
  tone: string;
  business_context: string;
  voice_id: string | null;
  services: string[];
  booking_enabled: boolean;
  duration: number;
  notify_email: string;
  business_name: string;
  industry: string;
  city: string;
  address: string;
  timezone: string;
  hours: BusinessHours;
}

type Biz = { name: string; industry: string | null; city: string | null; address_line1: string | null; timezone: string; business_hours: unknown } | null;

function fromAgent(a: AgentRow, b: Biz): AgentForm {
  const booking = asRecord(a.booking_rules);
  const esc = asRecord(a.escalation_rules);
  return {
    name: a.name === "Receptionist" ? "" : a.name,
    greeting: a.greeting ?? "",
    tone: a.tone === "professional" ? "professional" : "friendly",
    business_context: a.business_context ?? "",
    voice_id: a.voice_id,
    services: asStringArray(booking["services"]),
    booking_enabled: booking["enabled"] === true,
    duration: Number(booking["default_duration_minutes"] ?? 30),
    notify_email: String(esc["notify_email"] ?? ""),
    business_name: b?.name ?? "",
    industry: b?.industry ?? "Other",
    city: b?.city ?? "",
    address: b?.address_line1 ?? "",
    timezone: b?.timezone ?? "Australia/Brisbane",
    hours: asBusinessHours(b?.business_hours),
  };
}

/* ---------------- Page ---------------- */

function ReceptionistPage() {
  const ws = useWorkspace();
  const agentsQ = useQuery(agentsQuery(ws.businessId));
  const agent = agentsQ.data?.[0] ?? null;

  if (agentsQ.isPending) return <PageSkeleton metrics={0} rows={4} />;
  if (agentsQ.error) return <ErrorState message={agentsQ.error.message} onRetry={() => void agentsQ.refetch()} />;
  if (!agent) return <ErrorState message="This business has no receptionist yet. Ask your agency to set one up." />;
  return <AgentEditor key={agent.id} agent={agent} />;
}

function VoicePicker({ voices, value, onChange, disabled, loading }: { voices: Voice[]; value: string | null; onChange: (id: string | null) => void; disabled?: boolean; loading?: boolean }) {
  if (loading) return <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[76px] animate-pulse rounded-[6px] bg-canvas-2" />)}</div>;
  if (voices.length === 0) return <p className="text-[12.5px] text-ink-muted">Voices couldn't be loaded from the phone provider just now. Your current voice stays as it is.</p>;

  return (
    <div role="radiogroup" aria-label="Voice" className="grid gap-2 sm:grid-cols-2">
      {voices.map((v) => {
        const selected = v.id === value;
        return (
          <div
            key={v.id}
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            onClick={() => !disabled && onChange(v.id)}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(v.id);
              }
            }}
            className={cn(
              "flex items-start gap-3 rounded-[6px] border p-3 text-left outline-none transition-colors",
              selected ? "border-indigo bg-[#f7f6ff] ring-1 ring-indigo" : "border-hairline bg-white hover:border-[#c7c4ff]",
              disabled ? "cursor-default opacity-70" : "cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo",
            )}
          >
            <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", selected ? "bg-indigo text-white" : "bg-canvas-2 text-ink-muted")}>
              <AudioLines className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold text-ink">{v.display_name}</span>
                {v.gender ? <span className="text-[11px] capitalize text-ink-muted">{v.gender}</span> : null}
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-muted">{[v.accent, v.style].filter(Boolean).join(" · ")}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HoursEditor({ value, onChange, disabled }: { value: BusinessHours; onChange: (h: BusinessHours) => void; disabled?: boolean }) {
  return (
    <div>
      <ul className="divide-y divide-hairline">
        {DAY_KEYS.map((d) => {
          const day = value[d];
          return (
            <li key={d} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 sm:grid-cols-[120px_auto_1fr]">
              <span className="text-[13px] font-medium text-ink">{DAY_LABELS[d]}</span>
              <div className="flex items-center gap-2 sm:order-3 sm:justify-self-end">
                <span className="text-[12px] text-ink-muted">{day.closed ? "Closed" : "Open"}</span>
                <Switch checked={!day.closed} onCheckedChange={(v) => onChange({ ...value, [d]: { ...day, closed: !v } })} disabled={disabled} aria-label={`${DAY_LABELS[d]} open`} />
              </div>
              <div className="col-span-2 flex items-center gap-2 sm:order-2 sm:col-span-1">
                <Input type="time" value={day.open} onChange={(e) => onChange({ ...value, [d]: { ...day, open: e.target.value } })} disabled={disabled || day.closed} className="h-8 w-[112px] text-[12.5px]" aria-label={`${DAY_LABELS[d]} opens`} />
                <span className="text-[12px] text-ink-muted">to</span>
                <Input type="time" value={day.close} onChange={(e) => onChange({ ...value, [d]: { ...day, close: e.target.value } })} disabled={disabled || day.closed} className="h-8 w-[112px] text-[12.5px]" aria-label={`${DAY_LABELS[d]} closes`} />
              </div>
            </li>
          );
        })}
      </ul>
      {!disabled ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-7 text-[12px]"
          onClick={() => {
            const next = { ...value };
            for (const d of ["tue", "wed", "thu", "fri"] as const) next[d] = { ...value.mon };
            onChange(next);
          }}
        >
          Copy Monday to weekdays
        </Button>
      ) : null}
    </div>
  );
}

function AgentEditor({ agent }: { agent: AgentRow }) {
  const ws = useWorkspace();
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const tab: AgentTab = tabParam ?? "persona";
  const qc = useQueryClient();
  const voicesQ = useQuery({ queryKey: ["voices", "business", ws.businessId], enabled: !!ws.businessId, queryFn: () => getVoices(true, ws.businessId), staleTime: 300_000 });
  const numbersQ = useQuery(phoneNumbersQuery(ws.businessId));
  const initial = useMemo(() => fromAgent(agent, ws.business), [agent, ws.business]);
  const [form, setForm] = useState<AgentForm>(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const canEdit = ws.access.canEdit;
  const bookingSetUp = asRecord(agent.booking_rules)["configured"] === true;
  const [applied, setApplied] = useState<{ at: string; live: boolean } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!ws.businessId) throw new Error("No business selected.");
      if (!form.business_name.trim()) throw new Error("Enter your business name.");
      if (form.services.length === 0) throw new Error("Add at least one service callers can ask for.");
      return updateReceptionist(ws.businessId, {
        name: form.name.trim(),
        greeting: form.greeting.trim(),
        tone: form.tone,
        business_context: form.business_context.trim(),
        voice_id: form.voice_id,
        booking_rules: { services: form.services, ...(bookingSetUp ? { enabled: form.booking_enabled, default_duration_minutes: form.duration } : {}) },
        ...(bookingSetUp ? { escalation_rules: { notify_email: form.notify_email.trim() } } : {}),
        business_hours: form.hours,
        business: { name: form.business_name.trim(), industry: form.industry, city: form.city.trim(), address_line1: form.address.trim(), timezone: form.timezone },
      });
    },
    onSuccess: async (res) => {
      // Only now is it true: the server saved it and (for a real receptionist) the phone provider took it.
      setApplied({ at: new Date().toISOString(), live: res.applied });
      toast.success(res.applied ? "Saved and applied to your receptionist" : "Saved", {
        description: res.applied ? "Callers hear the new settings from the next call." : res.demo ? "This is a test receptionist, so nothing is sent to the phone provider." : undefined,
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["agents", ws.businessId] }), qc.invalidateQueries({ queryKey: ["businesses"] })]);
    },
    onError: (e) => {
      setApplied(null);
      toast.error("Couldn't save. Nothing was changed on your receptionist.", { description: e.message });
    },
  });

  const set = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const voices = voicesQ.data ?? [];
  const voice = voices.find((v) => v.id === form.voice_id) ?? (agent.voice && agent.voice.id === form.voice_id ? agent.voice : null);
  const readiness = useMemo(() => receptionistReadiness(agent, numbersQ.data ?? [], { isDemo: ws.business?.is_demo ?? false }), [agent, numbersQ.data, ws.business]);
  const connected = (numbersQ.data ?? []).filter((n) => n.status === "active");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            {form.name || "Receptionist"}
            <StatusBadge tone={readiness.tone === "success" ? "success" : readiness.tone === "warning" ? "warning" : readiness.tone === "info" ? "info" : "muted"}>{readiness.label}</StatusBadge>
          </span>
        }
        description="How your receptionist sounds, what it says and what it knows about your business."
        actions={
          <>
            <TestPreviewDialog form={form} voice={voice} />
            <Button asChild variant="outline" size="sm">
              <Link to="/app/knowledge">Edit knowledge</Link>
            </Button>
          </>
        }
      />

      {!canEdit ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Your access to this business is view only."}</Notice> : null}
      {connected.length === 0 ? (
        <Notice tone="info" title="No phone number yet">
          Everything you save here is stored and applied to your receptionist. Callers reach it once a number is connected.{" "}
          <Link to="/app/phone-numbers" className="font-medium underline-offset-2 hover:underline">Request a number</Link>.
        </Notice>
      ) : null}
      {applied && !dirty ? (
        <Notice tone="success" title={applied.live ? "Applied to your receptionist" : "Saved"}>
          {applied.live
            ? `The phone provider accepted these settings ${fmtRelative(applied.at)}. Callers hear them from the next call.`
            : "This is a test receptionist, so the settings are saved here and nothing is sent to the phone provider."}
        </Notice>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Tabs value={tab} onValueChange={(v) => void navigate({ search: { tab: v as AgentTab }, replace: true })} className="w-full min-w-0">
          <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-[6px] bg-canvas-2 p-1 sm:w-auto">
            <TabsTrigger value="persona" className="text-[12.5px]">Persona & voice</TabsTrigger>
            <TabsTrigger value="conversation" className="text-[12.5px]">Conversation</TabsTrigger>
            <TabsTrigger value="booking" className="text-[12.5px]">Booking & services</TabsTrigger>
            <TabsTrigger value="transfers" className="text-[12.5px]">Transfers</TabsTrigger>
            <TabsTrigger value="hours" className="text-[12.5px]">Hours</TabsTrigger>
          </TabsList>

          <TabsContent value="persona" className="mt-4 space-y-4">
            <FormSection title="Identity" description="The name and tone callers experience.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Receptionist name" htmlFor="a-name" hint="Callers hear it in the greeting. Leave blank for no name.">
                  <Input id="a-name" value={form.name} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} maxLength={30} placeholder="e.g. Mia" />
                </Field>
                <Field label="Tone" htmlFor="a-tone" hint={TONES.find((t) => t.value === form.tone)?.hint}>
                  <Select value={form.tone} onValueChange={(v) => set("tone", v)} disabled={!canEdit}>
                    <SelectTrigger id="a-tone"><SelectValue /></SelectTrigger>
                    <SelectContent>{TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            </FormSection>

            <FormSection title="Your business" description="What your receptionist says when callers ask who and where you are.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" htmlFor="a-biz" required>
                  <Input id="a-biz" value={form.business_name} onChange={(e) => set("business_name", e.target.value)} disabled={!canEdit} maxLength={80} />
                </Field>
                <Field label="Industry" htmlFor="a-ind" hint="Shapes how the receptionist talks about bookings.">
                  <Select value={INDUSTRY_OPTIONS.includes(form.industry) ? form.industry : "Other"} onValueChange={(v) => set("industry", v)} disabled={!canEdit}>
                    <SelectTrigger id="a-ind"><SelectValue /></SelectTrigger>
                    <SelectContent>{INDUSTRY_OPTIONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Suburb" htmlFor="a-city">
                  <Input id="a-city" value={form.city} onChange={(e) => set("city", e.target.value)} disabled={!canEdit} maxLength={60} />
                </Field>
                <Field label="Time zone" htmlFor="a-tz">
                  <Select value={form.timezone} onValueChange={(v) => set("timezone", v)} disabled={!canEdit}>
                    <SelectTrigger id="a-tz"><SelectValue /></SelectTrigger>
                    <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Address" htmlFor="a-addr" className="sm:col-span-2" hint="Optional. Read out when callers ask where you are.">
                  <Input id="a-addr" value={form.address} onChange={(e) => set("address", e.target.value)} disabled={!canEdit} maxLength={140} />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Voice" description="The voice callers hear on the phone. Voices come from the phone provider's Australian catalogue.">
              <VoicePicker voices={voices} value={form.voice_id} onChange={(id) => set("voice_id", id)} disabled={!canEdit} loading={voicesQ.isPending} />
            </FormSection>
          </TabsContent>

          <TabsContent value="conversation" className="mt-4 space-y-4">
            <FormSection title="Greeting" description="The first thing every caller hears. Keep it short and warm.">
              <Textarea rows={3} value={form.greeting} onChange={(e) => set("greeting", e.target.value)} disabled={!canEdit} aria-label="Greeting" maxLength={300} />
              <p className="text-[12px] text-ink-muted">Leave it blank and we'll use a standard greeting with your business name.</p>
            </FormSection>
            <FormSection title="Business context" description="What your receptionist should know before it picks up: who you are, what you do, what matters to your callers.">
              <Textarea rows={6} value={form.business_context} onChange={(e) => set("business_context", e.target.value)} disabled={!canEdit} aria-label="Business context" maxLength={1500} placeholder="We're a family dental practice in Manly. We see new patients, offer emergency appointments the same day where possible…" />
              <p className="text-[12px] text-ink-muted">
                Questions callers ask, prices and policies belong in the <Link to="/app/knowledge" className="font-medium text-indigo hover:underline">knowledge base</Link>.
              </p>
            </FormSection>
            <FormSection title="What it does on a call" description="Set by how your receptionist is connected.">
              <ul className="grid gap-2 sm:grid-cols-2">
                {[
                  { on: true, label: "Answers questions", hint: "From your business details and knowledge base." },
                  { on: true, label: "Takes messages", hint: "Name, number and reason, sent to your team." },
                  { on: bookingSetUp && form.booking_enabled, label: "Books appointments", hint: bookingSetUp ? "Into your connected calendar." : "Connect a calendar in Integrations." },
                  { on: true, label: "Ends calls politely", hint: "Once the caller has what they need." },
                ].map((c) => (
                  <li key={c.label} className={cn("flex items-start gap-2.5 rounded-[6px] border px-3 py-2.5", c.on ? "border-[#dcdaff] bg-[#fbfaff]" : "border-hairline")}>
                    <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", c.on ? "text-indigo" : "text-ink-muted/50")} />
                    <span>
                      <span className="block text-[13px] font-medium text-ink">{c.label}</span>
                      <span className="block text-[12px] text-ink-muted">{c.hint}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </FormSection>
          </TabsContent>

          <TabsContent value="booking" className="mt-4 space-y-4">
            <FormSection title="Services" description="What callers can ask for. Your receptionist matches requests to this list.">
              <TagInput values={form.services} onChange={(v) => set("services", v.slice(0, 12))} disabled={!canEdit} placeholder="e.g. Check-up & clean (press Enter)" />
              {form.services.length === 0 ? <p className="text-[12px] text-[#a41d1d]">Add at least one service.</p> : null}
            </FormSection>
            <FormSection title="Appointment booking" description="How your receptionist books into your calendar.">
              {bookingSetUp ? (
                <>
                  <label className="flex items-center justify-between gap-3 rounded-[6px] border border-hairline px-3 py-2.5">
                    <span>
                      <span className="block text-[13px] font-medium text-ink">Allow bookings on calls</span>
                      <span className="block text-[12px] text-ink-muted">Turn off to only take messages and booking requests.</span>
                    </span>
                    <Switch checked={form.booking_enabled} onCheckedChange={(v) => set("booking_enabled", v)} disabled={!canEdit} aria-label="Allow bookings on calls" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Appointment length" htmlFor="b-dur">
                      <Select value={String(form.duration)} onValueChange={(v) => set("duration", Number(v))} disabled={!canEdit || !form.booking_enabled}>
                        <SelectTrigger id="b-dur"><SelectValue /></SelectTrigger>
                        <SelectContent>{LENGTHS.map((m) => <SelectItem key={m} value={String(m)}>{m} min</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Email each booking to" htmlFor="b-email" hint="Optional. Bookings and messages are always in your dashboard.">
                      <Input id="b-email" type="email" value={form.notify_email} onChange={(e) => set("notify_email", e.target.value)} disabled={!canEdit} placeholder="reception@yourbusiness.com" />
                    </Field>
                  </div>
                </>
              ) : (
                <Notice tone="neutral">
                  No calendar is connected, so your receptionist takes booking requests and your team confirms them.{" "}
                  <Link to="/app/integrations" className="font-medium text-indigo hover:underline">Connect a calendar</Link>.
                </Notice>
              )}
            </FormSection>
          </TabsContent>

          <TabsContent value="transfers" className="mt-4 space-y-4">
            <FormSection title="Human hand-off" description="What happens when a caller asks for a person.">
              <Notice tone="neutral" title="Live transfers are coming soon">
                Today, when a caller asks for someone, your receptionist takes their name, number and a short message, and your team gets it as a follow-up.
              </Notice>
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link to="/app/leads">See follow-ups</Link>
              </Button>
            </FormSection>
          </TabsContent>

          <TabsContent value="hours" className="mt-4 space-y-4">
            <FormSection title="Opening hours" description="Your receptionist tells callers when you're open and offers times inside these hours.">
              <HoursEditor value={form.hours} onChange={(h) => set("hours", h)} disabled={!canEdit} />
            </FormSection>
            <FormSection title="When it answers" description="How the receptionist behaves around those hours.">
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { label: "Always on", hint: "Answers every call, day and night.", icon: Bot, on: true },
                  { label: "Follow business hours", hint: "Coming soon.", icon: CalendarCheck, on: false },
                  { label: "After hours only", hint: "Coming soon.", icon: PhoneForwarded, on: false },
                ].map((o) => (
                  <div key={o.label} aria-disabled={!o.on} className={cn("rounded-[6px] border p-3 text-left", o.on ? "border-indigo bg-[#f7f6ff] ring-1 ring-indigo" : "border-hairline opacity-60")}>
                    <o.icon className={cn("mb-2 h-4 w-4", o.on ? "text-indigo" : "text-ink-muted")} />
                    <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                    <span className="block text-[12px] text-ink-muted">{o.hint}</span>
                  </div>
                ))}
              </div>
            </FormSection>
          </TabsContent>
        </Tabs>

        <Panel title="Preview" description="How a typical call opens with these settings" className="h-fit lg:sticky lg:top-[72px]">
          <div className="space-y-2 text-[12.5px]">
            <Bubble who={form.name || "Receptionist"} accent>
              {form.greeting || `Thanks for calling ${form.business_name || "us"}${form.name ? `, this is ${form.name}` : ""}. How can I help?`}
            </Bubble>
            <Bubble who="Caller">Hi, I'd like to book in for {form.services[0] ?? "an appointment"} please.</Bubble>
            <Bubble who={form.name || "Receptionist"} accent>
              {bookingSetUp && form.booking_enabled ? "Of course. Which day suits you? I'll check what's free." : "Of course. I'll take your details and the team will confirm a time with you."}
            </Bubble>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <StatusBadge tone="muted">{voice ? voice.display_name : "No voice selected"}</StatusBadge>
              <StatusBadge tone="muted" className="capitalize">{form.tone}</StatusBadge>
              <StatusBadge tone="muted"><MessageSquareText className="h-3 w-3" /> Calls and texts</StatusBadge>
            </div>
          </div>
        </Panel>
      </div>

      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onReset={() => setForm(initial)}
        lastSavedAt={agent.updated_at}
        disabled={!canEdit}
        disabledReason={ws.access.readOnlyReason}
      />
    </div>
  );
}

function Bubble({ who, accent, children }: { who: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("max-w-[92%] rounded-[8px] px-3 py-2", accent ? "bg-[#efeeff] text-ink" : "ml-auto bg-canvas-2 text-ink")}>
      <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-muted">{who}</div>
      <div className="leading-5 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

interface SampleLine {
  who: "caller" | "agent";
  text: string;
}

/**
 * Browser-only sample. Nothing is dialled, recorded or saved: the script below
 * is read aloud by the browser's own speech voice so the wording of the settings
 * on screen can be heard.
 */
function TestPreviewDialog({ form, voice }: { form: AgentForm; voice: Voice | null }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [spokenIndex, setSpokenIndex] = useState(-1);
  const [speechError, setSpeechError] = useState(false);
  const agentName = form.name || "Receptionist";
  const service = form.services[0] ?? "an appointment";
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const browserVoiceName = useRef<string>("");

  const script: SampleLine[] = [
    { who: "agent", text: form.greeting || `Thanks for calling ${form.business_name || "us"}. How can I help?` },
    { who: "caller", text: `Hi, this is Alex Sample. I'd like to book ${service} please.` },
    { who: "agent", text: "Of course, Alex. What's the best mobile number for you?" },
    { who: "caller", text: "It's 0400 000 000." },
    { who: "agent", text: "Thank you. I'll pass that straight to the team and they'll confirm a time with you." },
    { who: "caller", text: "Great, thanks." },
    { who: "agent", text: "All noted. Have a lovely day." },
  ];

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(false);
    setSpokenIndex(-1);
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  const play = () => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeechError(false);
    setPlaying(true);
    script.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line.text);
      u.pitch = line.who === "caller" ? 0.9 : 1.05;
      browserVoiceName.current = u.voice?.name || window.speechSynthesis.getVoices()[0]?.name || "your browser's default voice";
      u.onstart = () => setSpokenIndex(i);
      u.onerror = () => {
        window.speechSynthesis.cancel();
        setPlaying(false);
        setSpokenIndex(-1);
        setSpeechError(true);
      };
      if (i === script.length - 1) {
        u.onend = () => {
          setPlaying(false);
          setSpokenIndex(-1);
        };
      }
      window.speechSynthesis.speak(u);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Hear a sample
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-[6px]">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Sample call</DialogTitle>
          <DialogDescription className="text-[12.5px]">Browser-generated sample, not a live call or recording. Nothing is dialled, booked, sent or saved.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1 text-[12.5px]">
          {script.map((line, i) => (
            <div key={i} className={cn("rounded-[8px]", i === spokenIndex ? "ring-1 ring-indigo" : "")}>
              <Bubble who={line.who === "agent" ? agentName : "Alex Sample (sample caller)"} accent={line.who === "agent"}>
                {line.text}
              </Bubble>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <StatusBadge tone="muted">Read aloud by your browser voice</StatusBadge>
            {voice ? <StatusBadge tone="muted">Live voice on real calls: {voice.display_name}</StatusBadge> : null}
          </div>
          {!supported ? <p className="text-[12px] text-ink-muted">Your browser cannot read this aloud, so the script above is the full sample.</p> : null}
          {speechError ? <p className="text-[12px] text-ink-muted">Your browser stopped reading the sample aloud. The full script above is unchanged.</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-[11.5px] text-ink-muted">The wording comes from the settings on this page.</span>
          {supported ? (
            playing ? (
              <Button variant="outline" size="sm" onClick={stop}>Stop</Button>
            ) : (
              <Button size="sm" onClick={play}>Play sample</Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

