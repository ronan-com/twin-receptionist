import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CalendarCheck, CheckCircle2, Lock, MoonStar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, ErrorState, PageSkeleton, Notice } from "@/components/app/primitives";
import { Field, FormSection, SaveBar, TagInput } from "@/components/app/forms";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import { HoursEditor, VoicePicker } from "@/components/app/ReceptionistFields";
import { PreviewPanel, SampleCallDialog, type PreviewSettings } from "@/components/app/receptionist/CallPreview";
import { PauseControl } from "@/components/app/receptionist/PauseControl";
import {
  COLLECT_OPTIONS,
  DIALECT_OPTIONS,
  TONE_OPTIONS,
  automationsPatch,
  saveReceptionist,
  type CollectKey,
  type DialectKey,
  type ReceptionistRow,
  type ReceptionistSaved,
  type ToneKey,
} from "@/components/app/receptionist/model";
import { agentsQuery, phoneNumbersQuery } from "@/lib/app/queries";
import { getVoices, type PhoneNumberRow } from "@/lib/api/manage";
import { automationsQueryKey, getAutomations, saveAutomations, type AutomationSettings, type AutomationStatus, type AutomationsState } from "@/lib/api/automations";
import { asBusinessHours, asRecord, asStringArray, type BusinessHours } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { fmtRelative } from "@/lib/app/format";
import { TIMEZONES, formatNumber } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/app/product";

export const AGENT_TABS = ["persona", "conversation", "booking", "transfers", "hours"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];


/* ---------------- Form model ---------------- */

// The industries our receptionist script knows (they round-trip through the server).
const INDUSTRY_OPTIONS = ["Dental", "Healthcare", "Trades", "Salon & beauty", "Real estate", "Automotive", "Professional services", "Childcare", "Other"];
const LENGTHS = [15, 20, 30, 45, 60, 90];
const PROVIDER_LABEL: Record<string, string> = { builtin: `${PRODUCT} calendar`, google: "Google Calendar", microsoft: "Outlook Calendar" };

interface AgentForm {
  name: string;
  tone: ToneKey;
  personality: string;
  dialect: DialectKey;
  voice_id: string | null;
  business_name: string;
  industry: string;
  city: string;
  address: string;
  timezone: string;
  greeting: string;
  closing: string;
  business_context: string;
  faq_style: "brief" | "detailed";
  avoid: string[];
  services: string[];
  booking_enabled: boolean;
  duration: number;
  notify_email: string;
  lead_webhook: string;
  collect: CollectKey[];
  questions: string[];
  hours: BusinessHours;
}

type Biz = { name: string; industry: string | null; city: string | null; address_line1: string | null; timezone: string; business_hours: unknown } | null;

function fromAgent(a: ReceptionistRow, b: Biz): AgentForm {
  const booking = asRecord(a.booking_rules);
  const esc = asRecord(a.escalation_rules);
  return {
    name: a.name === "Receptionist" ? "" : a.name,
    tone: (TONE_OPTIONS.some((t) => t.value === a.tone) ? a.tone : "friendly") as ToneKey,
    personality: a.personality ?? "",
    dialect: a.dialect ?? "en-AU",
    voice_id: a.voice_id,
    business_name: b?.name ?? "",
    industry: b?.industry ?? "Other",
    city: b?.city ?? "",
    address: b?.address_line1 ?? "",
    timezone: b?.timezone ?? "Australia/Brisbane",
    greeting: a.greeting ?? "",
    closing: a.closing_line ?? "",
    business_context: a.business_context ?? "",
    faq_style: a.faq_style === "detailed" ? "detailed" : "brief",
    avoid: asStringArray(a.restricted_topics),
    services: asStringArray(booking["services"]),
    booking_enabled: booking["enabled"] === true,
    duration: Number(booking["default_duration_minutes"] ?? 30),
    notify_email: String(esc["notify_email"] ?? ""),
    lead_webhook: String(booking["lead_webhook"] ?? ""),
    collect: (a.collect_fields ?? []).filter((c) => COLLECT_OPTIONS.some((o) => o.value === c)),
    questions: asStringArray(a.qualification_questions),
    hours: asBusinessHours(b?.business_hours),
  };
}

/* ---------------- Status (from real state) ---------------- */

type Status = { label: string; tone: Tone; title: string; detail: ReactNode };

function statusOf(agent: ReceptionistRow, numbers: PhoneNumberRow[]): Status {
  const live = numbers.filter((n) => n.status === "active" && n.e164);
  const pending = numbers.filter((n) => n.status === "pending");
  const on = live.map((n) => n.friendly_name ?? formatNumber(n.e164)).join(", ");
  if (agent.paused_by === "agency") {
    return {
      label: "Paused",
      tone: "warning",
      title: "Paused by your agency",
      detail: "Your agency or the platform team has paused this receptionist, so it won't book or change anything. Your settings are kept; contact them to resume it.",
    };
  }
  if (agent.paused_by === "business") {
    return {
      label: "Paused",
      tone: "warning",
      title: `Paused${agent.paused_at ? ` ${fmtRelative(agent.paused_at)}` : ""}`,
      detail: `Callers hear: "${agent.paused_message}" Then it takes their name, number and a short note. Nothing is booked or transferred until you resume.${on ? ` Calls to ${on} still reach it.` : ""}`,
    };
  }
  if (agent.demo) {
    return {
      label: "Demo",
      tone: "info",
      title: "Demo receptionist",
      detail: "This receptionist isn't on a phone line. Everything you save is stored and goes into its script, but the phone provider never sees it and no real calls reach it.",
    };
  }
  if (live.length > 0) {
    return { label: "Live", tone: "success", title: "Answering calls", detail: `Calls to ${on} reach this receptionist. Saved changes apply from the next call.` };
  }
  if (pending.length > 0) {
    return {
      label: "Being connected",
      tone: "info",
      title: "Being connected",
      detail: "A phone number has been requested. Your settings are saved and applied; callers reach it once the number is connected.",
    };
  }
  return {
    label: "No number yet",
    tone: "warning",
    title: "No phone number yet",
    detail: (
      <>
        Everything you save here is applied to your receptionist, but no number is connected, so it isn't taking calls.{" "}
        <Link to="/app/phone-numbers" className="font-medium underline-offset-2 hover:underline">
          Request a number
        </Link>
        .
      </>
    ),
  };
}

const STATUS_TONE: Record<AutomationStatus["state"], Tone> = { on: "success", off: "muted", needs_setup: "warning", unsupported: "neutral", error: "danger" };

/* ---------------- Page ---------------- */

export function ReceptionistPage({ tab, onTab }: { tab?: AgentTab; onTab?: (t: AgentTab) => void } = {}) {
  const ws = useWorkspace();
  const agentsQ = useQuery(agentsQuery(ws.businessId));
  const agent = (agentsQ.data?.[0] as ReceptionistRow | undefined) ?? null;

  if (agentsQ.isPending) return <PageSkeleton metrics={0} rows={4} />;
  if (agentsQ.error) return <ErrorState message={agentsQ.error.message} onRetry={() => void agentsQ.refetch()} />;
  if (!agent) return <ErrorState message="This business has no receptionist yet. Ask your agency to set one up." />;
  return <AgentEditor key={agent.id} agent={agent} tab={tab} onTab={onTab} />;
}

function AgentEditor({ agent, tab: tabProp, onTab }: { agent: ReceptionistRow; tab?: AgentTab; onTab?: (t: AgentTab) => void }) {
  const ws = useWorkspace();
  const businessId = ws.businessId!;
  const navigate = useNavigate();
  const { tab: tabParam } = useSearch({ strict: false }) as { tab?: AgentTab };
  const tab: AgentTab = tabProp ?? (tabParam && AGENT_TABS.includes(tabParam) ? tabParam : "persona");
  const qc = useQueryClient();
  const voicesQ = useQuery({ queryKey: ["voices", "business", businessId], enabled: !!businessId, queryFn: () => getVoices(true, businessId), staleTime: 300_000 });
  const numbersQ = useQuery(phoneNumbersQuery(businessId));
  const autoQ = useQuery({ queryKey: automationsQueryKey(businessId), enabled: !!businessId, queryFn: () => getAutomations(businessId) });

  const initial = useMemo(() => fromAgent(agent, ws.business), [agent, ws.business]);
  const [form, setForm] = useState<AgentForm>(initial);
  useEffect(() => setForm(initial), [initial]);
  const [auto, setAuto] = useState<AutomationSettings | null>(null);
  useEffect(() => {
    if (autoQ.data) setAuto(autoQ.data.settings);
  }, [autoQ.data]);

  const settingsDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const autoPatch = useMemo(() => (auto && autoQ.data ? automationsPatch(auto, autoQ.data.settings) : {}), [auto, autoQ.data]);
  const autoDirty = Object.keys(autoPatch).length > 0;
  const dirty = settingsDirty || autoDirty;

  const canEdit = ws.access.canEdit;
  const canEditAuto = canEdit && (autoQ.data?.canEdit ?? false);
  const bookingSetUp = asRecord(agent.booking_rules)["configured"] === true;
  const bookingLive = bookingSetUp && asRecord(agent.booking_rules)["live"] === true;
  const provider = String(asRecord(agent.booking_rules)["provider"] ?? "");
  const [applied, setApplied] = useState<{ at: string; live: boolean } | null>(null);

  const refreshAgent = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["agents", businessId] }), qc.invalidateQueries({ queryKey: ["businesses"] })]);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.business_name.trim()) throw new Error("Enter your business name.");
      if (form.services.length === 0) throw new Error("Add at least one service callers can ask for.");
      let res: ReceptionistSaved | null = null;
      if (settingsDirty) {
        res = await saveReceptionist(businessId, {
          name: form.name.trim(),
          greeting: form.greeting.trim(),
          tone: form.tone,
          personality: form.personality.trim(),
          dialect: form.dialect,
          closing_line: form.closing.trim(),
          business_context: form.business_context.trim(),
          faq_style: form.faq_style,
          restricted_topics: form.avoid,
          qualification_questions: form.questions,
          collect_fields: form.collect,
          voice_id: form.voice_id,
          booking_rules: {
            services: form.services,
            ...(bookingSetUp ? { enabled: form.booking_enabled, default_duration_minutes: form.duration, lead_webhook: form.lead_webhook.trim() } : {}),
          },
          ...(bookingSetUp ? { escalation_rules: { notify_email: form.notify_email.trim() } } : {}),
          business_hours: form.hours,
          business: { name: form.business_name.trim(), industry: form.industry, city: form.city.trim(), address_line1: form.address.trim(), timezone: form.timezone },
        });
      }
      let autoState: AutomationsState | null = null;
      if (autoDirty) {
        try {
          autoState = await saveAutomations(businessId, autoPatch);
        } catch (err) {
          if (res) await refreshAgent();
          throw new Error(res ? `Your receptionist settings were saved, but transfers and hours weren't: ${(err as Error).message}` : (err as Error).message);
        }
      }
      return { res, autoState };
    },
    onSuccess: async ({ res, autoState }) => {
      // Only now is it true: the server saved it and (for a live receptionist) the phone provider took it.
      const demo = res?.demo ?? autoState?.demo ?? agent.demo ?? false;
      const live = !demo && (res ? res.applied : true) && !autoState?.applyError;
      setApplied({ at: new Date().toISOString(), live });
      if (autoState) {
        qc.setQueryData(automationsQueryKey(businessId), autoState);
        setAuto(autoState.settings);
      }
      if (autoState?.applyError) toast.warning("Saved, but the receptionist couldn't be updated yet", { description: autoState.applyError });
      else
        toast.success(live ? "Saved and applied to your receptionist" : "Saved", {
          description: live ? "Callers hear the new settings from the next call." : demo ? "This is a test receptionist, so nothing is sent to the phone provider." : undefined,
        });
      await refreshAgent();
    },
    onError: (e: Error) => {
      setApplied(null);
      toast.error(e.message.startsWith("Your receptionist settings were saved") ? "Partly saved" : "Couldn't save. Nothing was changed on your receptionist.", { description: e.message });
    },
  });

  const set = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setA = <K extends keyof AutomationSettings>(key: K, value: Partial<AutomationSettings[K]>) => setAuto((a) => (a ? { ...a, [key]: { ...a[key], ...value } } : a));
  const voices = voicesQ.data ?? [];
  const voice = voices.find((v) => v.id === form.voice_id) ?? (agent.voice && agent.voice.id === form.voice_id ? agent.voice : null);
  const numbers = numbersQ.data ?? [];
  const status = statusOf(agent, numbers);
  const liveNumbers = numbers.filter((n) => n.status === "active" && n.e164).map((n) => n.e164);
  const paused = agent.status === "paused";

  const preview: PreviewSettings = {
    name: form.name.trim(),
    business_name: form.business_name.trim(),
    greeting: form.greeting,
    closing: form.closing,
    tone: form.tone,
    dialect: form.dialect,
    services: form.services,
    collect: form.collect,
    questions: form.questions,
    bookingLive: bookingLive && form.booking_enabled,
    voiceName: voice ? voice.display_name : null,
    paused: agent.paused_by === "business" ? { message: agent.paused_message } : null,
  };

  const autoSection = (body: () => ReactNode) => {
    if (autoQ.isPending || (autoQ.data && !auto)) return <Skeleton className="h-40 w-full" />;
    if (autoQ.error || !auto || !autoQ.data) return <ErrorState message={(autoQ.error as Error)?.message ?? "Couldn't load these settings."} onRetry={() => void autoQ.refetch()} />;
    return body();
  };
  const autoStatus = (k: keyof AutomationSettings) => {
    const st = autoQ.data?.status[k];
    return st ? (
      <StatusBadge tone={STATUS_TONE[st.state]} dot className="max-w-full">
        <span data-status={st.state} className="truncate">
          {st.label}
        </span>
      </StatusBadge>
    ) : null;
  };

  return (
    // scroll-margin: a field scrolled into view (keyboard focus) isn't left under the sticky top bar or save bar.
    <div className="space-y-5 [&_button]:scroll-my-20 [&_input]:scroll-my-20 [&_textarea]:scroll-my-20 [&_[role=combobox]]:whitespace-normal [&_[role=combobox]]:text-left" data-page="receptionist">
      <PageHeader
        eyebrow={ws.business?.name}
        title={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            {form.name || "Receptionist"}
            <StatusBadge tone={status.tone} dot>
              <span data-receptionist-status>{status.label}</span>
            </StatusBadge>
          </span>
        }
        description="How your receptionist sounds, what it says, what it collects and how it handles calls."
        actions={
          <>
            <SampleCallDialog f={preview} auto={auto} numbers={liveNumbers} demo={!!agent.demo} />
            <Button asChild variant="outline" size="sm">
              <Link to="/app/knowledge">Edit knowledge</Link>
            </Button>
            {canEdit ? <PauseControl businessId={businessId} agent={agent} blockedReason={dirty ? "Save or discard your changes first." : null} onDone={() => refreshAgent()} /> : null}
          </>
        }
      />

      <Notice tone={status.tone === "success" ? "success" : status.tone === "warning" ? "warning" : "info"} title={status.title}>
        <span data-status-explainer>{status.detail}</span>
      </Notice>
      {!canEdit ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Your access to this business is view only."}</Notice> : null}
      {applied && !dirty ? (
        <Notice tone="success" title={<span data-applied={applied.live ? "live" : "saved"}>{applied.live ? "Applied to your receptionist" : "Saved"}</span>}>
          {applied.live
            ? `The phone provider accepted these settings ${fmtRelative(applied.at)}. Callers hear them from the next call.`
            : agent.demo
              ? "This is a test receptionist, so the settings are saved here and nothing is sent to the phone provider."
              : "Saved here. The phone provider hasn't confirmed every change yet; see the warning above."}
        </Notice>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Tabs value={tab} onValueChange={(v) => (onTab ? onTab(v as AgentTab) : void navigate({ search: { tab: v as AgentTab } as never, replace: true } as never))} className="w-full min-w-0">
          <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-[6px] bg-canvas-2 p-1 sm:w-auto">
            <TabsTrigger value="persona" className="text-[12.5px]">Persona & voice</TabsTrigger>
            <TabsTrigger value="conversation" className="text-[12.5px]">Conversation</TabsTrigger>
            <TabsTrigger value="booking" className="text-[12.5px]">Booking & leads</TabsTrigger>
            <TabsTrigger value="transfers" className="text-[12.5px]">Transfers</TabsTrigger>
            <TabsTrigger value="hours" className="text-[12.5px]">Hours & voicemail</TabsTrigger>
          </TabsList>

          {/* ---------------- Persona & voice ---------------- */}
          <TabsContent value="persona" className="mt-4 space-y-4">
            <FormSection title="Identity" description="The name, tone and personality callers experience. All of it goes into your receptionist's script.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Receptionist name" htmlFor="a-name" hint="Callers hear it in the greeting. Leave blank for no name.">
                  <Input id="a-name" value={form.name} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} maxLength={30} placeholder="e.g. Mia" />
                </Field>
                <Field label="Tone" htmlFor="a-tone" hint={TONE_OPTIONS.find((t) => t.value === form.tone)?.hint}>
                  <Select value={form.tone} onValueChange={(v) => set("tone", v as ToneKey)} disabled={!canEdit}>
                    <SelectTrigger id="a-tone"><SelectValue /></SelectTrigger>
                    <SelectContent>{TONE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Language" htmlFor="a-lang" hint={autoQ.data?.languages.find((l) => l.code === auto?.language.code)?.note ?? "What it listens for and replies in."}>
                  <Select value={auto?.language.code ?? "en-AU"} onValueChange={(v) => setA("language", { code: v as AutomationSettings["language"]["code"] })} disabled={!canEditAuto || !auto}>
                    <SelectTrigger id="a-lang"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(autoQ.data?.languages ?? [{ code: "en-AU" as const, label: "English (Australian)" }]).map((l) => (
                        <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="English style" htmlFor="a-dialect" hint="Wording and spelling. The accent comes from the voice below (all Australian).">
                  <Select value={form.dialect} onValueChange={(v) => set("dialect", v as DialectKey)} disabled={!canEdit}>
                    <SelectTrigger id="a-dialect"><SelectValue /></SelectTrigger>
                    <SelectContent>{DIALECT_OPTIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Personality" htmlFor="a-personality" hint="In plain English. This shapes every reply.">
                <Textarea id="a-personality" rows={3} maxLength={400} value={form.personality} onChange={(e) => set("personality", e.target.value)} disabled={!canEdit} placeholder="Warm and reassuring. Confirms names and times back to the caller." />
              </Field>
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

            <FormSection title="Voice" description="The voice callers hear on the phone, from the phone provider's Australian voices.">
              <VoicePicker voices={voices} value={form.voice_id} onChange={(id) => set("voice_id", id)} disabled={!canEdit} loading={voicesQ.isPending} />
            </FormSection>
          </TabsContent>

          {/* ---------------- Conversation ---------------- */}
          <TabsContent value="conversation" className="mt-4 space-y-4">
            <FormSection title="Greeting" description="The first thing every caller hears. Keep it short and warm.">
              <Textarea id="c-greeting" rows={3} value={form.greeting} onChange={(e) => set("greeting", e.target.value)} disabled={!canEdit} aria-label="Greeting" maxLength={300} />
              <p className="text-[12px] text-ink-muted">Leave it blank and we'll use a standard greeting with your business name.</p>
            </FormSection>
            <FormSection title="Closing" description="How it wraps up once the caller has what they need.">
              <Field label="Closing line" htmlFor="c-closing" hint="Said in its own words, close to this.">
                <Input id="c-closing" value={form.closing} onChange={(e) => set("closing", e.target.value)} disabled={!canEdit} maxLength={200} placeholder="Thanks for calling, have a lovely day!" />
              </Field>
            </FormSection>
            <FormSection title="Business context" description="What your receptionist should know before it picks up: who you are, what you do, what matters to your callers.">
              <Textarea rows={6} value={form.business_context} onChange={(e) => set("business_context", e.target.value)} disabled={!canEdit} aria-label="Business context" maxLength={1500} placeholder="We're a family dental practice in Manly. We see new patients, offer emergency appointments the same day where possible…" />
            </FormSection>
            <FormSection
              title="Answering questions"
              description={
                <>
                  Answers come from your business details and the <Link to="/app/knowledge" className="font-medium text-indigo hover:underline">knowledge base</Link>. When it doesn't know, it takes a message instead of guessing.
                </>
              }
            >
              <div role="radiogroup" aria-label="How to answer questions" className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { v: "brief", label: "Short answers", hint: "A sentence or two, then offers more detail." },
                    { v: "detailed", label: "Full answers", hint: "Everything you've written, then checks it helped." },
                  ] as const
                ).map((o) => (
                  <Choice key={o.v} on={form.faq_style === o.v} disabled={!canEdit} onClick={() => set("faq_style", o.v)} label={o.label} hint={o.hint} data={`faq-${o.v}`} />
                ))}
              </div>
            </FormSection>
            <FormSection title="Things never to discuss" description="Topics it politely declines, offering to pass a message to the team instead.">
              <div data-avoid>
                <TagInput values={form.avoid} onChange={(v) => set("avoid", v.slice(0, 12))} disabled={!canEdit} placeholder="e.g. Medical advice (press Enter)" />
              </div>
              {!canEdit && form.avoid.length === 0 ? <p className="text-[12.5px] text-ink-muted">None set.</p> : null}
            </FormSection>
            <FormSection title="What it does on a call" description="Set by how your receptionist is connected and the other tabs.">
              <ul className="grid gap-2 sm:grid-cols-2">
                {[
                  { on: true, label: "Answers questions", hint: "From your business details and knowledge base." },
                  { on: true, label: "Takes messages", hint: "Name, number and reason, for your team." },
                  { on: bookingLive && form.booking_enabled, label: "Books appointments", hint: bookingSetUp ? (bookingLive ? "Into your connected calendar." : "Calendar set up, but not reachable from this server yet.") : "Connect a calendar in Integrations." },
                  { on: !!auto?.transfer.enabled, label: "Puts callers through", hint: auto?.transfer.enabled ? `To ${auto.transfer.name}.` : "Turn on in Transfers." },
                  { on: !!auto?.hoursMode.enabled, label: "After-hours mode", hint: auto?.hoursMode.enabled ? "A different greeting when you're closed." : "Turn on in Hours & voicemail." },
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

          {/* ---------------- Booking & leads ---------------- */}
          <TabsContent value="booking" className="mt-4 space-y-4">
            <FormSection title="Services" description="What callers can ask for. Your receptionist matches requests to this list.">
              <TagInput values={form.services} onChange={(v) => set("services", v.slice(0, 12))} disabled={!canEdit} placeholder="e.g. Check-up & clean (press Enter)" />
              {form.services.length === 0 ? <p className="text-[12px] text-[#a41d1d]">Add at least one service.</p> : null}
            </FormSection>
            <FormSection title="Appointment booking" description="How your receptionist books into your calendar.">
              {bookingSetUp ? (
                <>
                  <p className="text-[12.5px] text-ink-muted">
                    Calendar: <span className="font-medium text-ink">{PROVIDER_LABEL[provider] ?? "Connected calendar"}</span>.{" "}
                    <Link to="/app/integrations" className="font-medium text-indigo hover:underline">Manage integrations</Link>
                  </p>
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
            <FormSection title="What to collect" description="Details it asks for on every booking or message. Name and number are always collected.">
              <ul className="grid gap-2 sm:grid-cols-2">
                {["Full name", "Best mobile number"].map((l) => (
                  <li key={l} className="flex items-center justify-between gap-3 rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2.5">
                    <span className="text-[13px] font-medium text-ink">{l}</span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-muted">
                      <Lock className="h-3 w-3" /> Always
                    </span>
                  </li>
                ))}
                {COLLECT_OPTIONS.map((o) => (
                  <li key={o.value}>
                    <label className="flex h-full items-center justify-between gap-3 rounded-[6px] border border-hairline px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                        <span className="block text-[12px] text-ink-muted">{o.hint}</span>
                      </span>
                      <Switch
                        checked={form.collect.includes(o.value)}
                        onCheckedChange={(v) => set("collect", COLLECT_OPTIONS.map((x) => x.value).filter((x) => (x === o.value ? v : form.collect.includes(x))))}
                        disabled={!canEdit}
                        aria-label={`Collect ${o.label}`}
                        data-collect={o.value}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </FormSection>
            <FormSection title="Questions to ask" description="Asked one at a time, in this order, after their details. The answers go with the booking or message.">
              <QuestionList values={form.questions} onChange={(v) => set("questions", v)} disabled={!canEdit} />
            </FormSection>
            {bookingSetUp ? (
              <FormSection title="Send leads to your CRM" description="Each booking and message is posted to this address as it happens (signed, so you can check it came from us).">
                <Field label="Webhook URL" htmlFor="b-webhook" hint="Optional. Leave blank to turn it off.">
                  <Input id="b-webhook" type="url" value={form.lead_webhook} onChange={(e) => set("lead_webhook", e.target.value)} disabled={!canEdit} placeholder="https://hooks.yourcrm.com/…" />
                </Field>
              </FormSection>
            ) : null}
          </TabsContent>

          {/* ---------------- Transfers ---------------- */}
          <TabsContent value="transfers" className="mt-4 space-y-4">
            {autoSection(() => (
              <>
                {autoQ.data!.demo ? (
                  <Notice tone="warning" title="Test receptionist">Transfer settings save and go into its script, but no real calls are put through.</Notice>
                ) : autoQ.data!.applyError ? (
                  <Notice tone="danger" title="Not applied to the receptionist yet">{autoQ.data!.applyError}</Notice>
                ) : null}
                <FormSection title="Transfer to a person" description="Puts the caller through to your phone when they ask for someone, it's urgent, or the receptionist can't help.">
                  <label className="flex items-center justify-between gap-3 rounded-[6px] border border-hairline px-3 py-2.5" data-automation="transfer">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">Transfer calls {autoStatus("transfer")}</span>
                      <span className="block text-[12px] text-ink-muted">{autoQ.data!.status.transfer.detail ?? "When it's off, the receptionist takes a message instead."}</span>
                    </span>
                    <Switch checked={auto!.transfer.enabled} onCheckedChange={(v) => setA("transfer", { enabled: v })} disabled={!canEditAuto} aria-label="Transfer calls" data-toggle="transfer" />
                  </label>
                  <div className={cn("grid gap-4", !auto!.transfer.enabled && "opacity-70")}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Transfer to number" htmlFor="t-number" hint="An Australian mobile or landline, like 0412 345 678.">
                        <Input id="t-number" inputMode="tel" value={auto!.transfer.number} onChange={(e) => setA("transfer", { number: e.target.value })} disabled={!canEditAuto} placeholder="0412 345 678" />
                      </Field>
                      <Field label="Who answers" htmlFor="t-name" hint={`Said to the caller: "I'll put you through to ${auto!.transfer.name || "the team"}."`}>
                        <Input id="t-name" value={auto!.transfer.name} onChange={(e) => setA("transfer", { name: e.target.value })} disabled={!canEditAuto} maxLength={40} placeholder="the team" />
                      </Field>
                    </div>
                    <Field label="When to transfer" htmlFor="t-when" hint={auto!.transfer.when === "hours" ? "When you're closed, it takes a message instead." : undefined}>
                      <Select value={auto!.transfer.when} onValueChange={(v) => setA("transfer", { when: v as AutomationSettings["transfer"]["when"] })} disabled={!canEditAuto}>
                        <SelectTrigger id="t-when"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hours">During opening hours only</SelectItem>
                          <SelectItem value="always">Any time</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="grid gap-2">
                      <Toggle name="onRequest" label="When the caller asks for a person" checked={auto!.transfer.onRequest} onChange={(v) => setA("transfer", { onRequest: v })} disabled={!canEditAuto} />
                      <Toggle name="urgent" label="When it's urgent" hint="An emergency or something that can't wait." checked={auto!.transfer.urgent} onChange={(v) => setA("transfer", { urgent: v })} disabled={!canEditAuto} />
                      <Toggle name="cantHelp" label="When the receptionist can't help" hint="Otherwise it takes a message." checked={auto!.transfer.cantHelp} onChange={(v) => setA("transfer", { cantHelp: v })} disabled={!canEditAuto} />
                    </div>
                  </div>
                </FormSection>
                <FormSection title="If nobody picks up" description="What happens when a transfer reaches your voicemail.">
                  <Toggle
                    name="voicemail"
                    label="Come back and take a message instead"
                    hint="The phone service listens for a voicemail greeting on each transfer (it may add a small carrier charge). Off: the caller is left with your voicemail."
                    checked={auto!.transfer.voicemail === "take_message"}
                    onChange={(v) => setA("transfer", { voicemail: v ? "take_message" : "off" })}
                    disabled={!canEditAuto}
                  />
                </FormSection>
              </>
            ))}
          </TabsContent>

          {/* ---------------- Hours & voicemail ---------------- */}
          <TabsContent value="hours" className="mt-4 space-y-4">
            <FormSection title="Opening hours" description="Your receptionist tells callers when you're open and offers times inside these hours.">
              <HoursEditor value={form.hours} onChange={(h) => set("hours", h)} disabled={!canEdit} />
            </FormSection>
            {autoSection(() => (
              <>
                <FormSection title="When it answers" description="How the receptionist behaves around those hours. It answers every call either way.">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted" data-automation="hoursMode">
                    After-hours mode {autoStatus("hoursMode")}
                  </div>
                  <div role="radiogroup" aria-label="When it answers" className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        { v: "always", label: "Same all the time", hint: "Full service day and night.", icon: Bot },
                        { v: "message_only", label: "Messages after hours", hint: "A closed greeting, then takes messages. No bookings.", icon: MoonStar },
                        { v: "message_and_booking", label: "Bookings after hours", hint: "A closed greeting, but still books.", icon: CalendarCheck },
                      ] as const
                    ).map((o) => {
                      const on = o.v === "always" ? !auto!.hoursMode.enabled : auto!.hoursMode.enabled && auto!.hoursMode.mode === o.v;
                      return (
                        <Choice
                          key={o.v}
                          on={on}
                          disabled={!canEditAuto}
                          onClick={() => setA("hoursMode", o.v === "always" ? { enabled: false } : { enabled: true, mode: o.v })}
                          label={o.label}
                          hint={o.hint}
                          icon={<o.icon className={cn("mb-2 h-4 w-4", on ? "text-indigo" : "text-ink-muted")} />}
                          data={`hours-${o.v}`}
                        />
                      );
                    })}
                  </div>
                  {auto!.hoursMode.enabled ? (
                    <Field label="After-hours greeting" htmlFor="h-greeting" hint="{business} is filled in with your business name.">
                      <Textarea id="h-greeting" rows={2} maxLength={300} value={auto!.hoursMode.greeting} onChange={(e) => setA("hoursMode", { greeting: e.target.value })} disabled={!canEditAuto} />
                    </Field>
                  ) : null}
                </FormSection>
                <FormSection title="Messages & voicemail" description="When nobody can take the call, your receptionist takes the message itself.">
                  <ul className="grid gap-2 text-[12.5px] text-ink-muted">
                    <li className="rounded-[6px] border border-hairline px-3 py-2.5">
                      <span className="block text-[13px] font-medium text-ink">Structured messages, not voicemail</span>
                      It asks for their name, number{form.collect.length ? ", the details you chose in Booking & leads" : ""} and what it's about, and reads the number back.{" "}
                      {bookingSetUp ? (
                        <>Each message lands in <Link to="/app/leads" className="font-medium text-indigo hover:underline">Follow-ups</Link>{form.notify_email ? ` and is emailed to ${form.notify_email}` : ""}.</>
                      ) : (
                        <>Messages are in the call summary under <Link to="/app/calls" className="font-medium text-indigo hover:underline">Calls</Link>. Connect a calendar to get them as follow-ups too.</>
                      )}
                    </li>
                    <li className="rounded-[6px] border border-hairline px-3 py-2.5">
                      <span className="block text-[13px] font-medium text-ink">Texts and recording</span>
                      Text-back after calls and call recording are under{" "}
                      <Link to="/app/automations" className="font-medium text-indigo hover:underline">Automations</Link>.
                    </li>
                  </ul>
                </FormSection>
                <FormSection title="Call length & silence" description="Ends calls that run too long, or where the caller has gone quiet.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Longest call (minutes)" htmlFor="h-max" hint="Between 2 and 60.">
                      <Input id="h-max" type="number" min={2} max={60} value={auto!.callLimits.maxMinutes} onChange={(e) => setA("callLimits", { maxMinutes: Number(e.target.value) })} disabled={!canEditAuto} />
                    </Field>
                    <Field label="End after silence (seconds)" htmlFor="h-idle" hint="Between 10 and 120.">
                      <Input id="h-idle" type="number" min={10} max={120} value={auto!.callLimits.idleSeconds} onChange={(e) => setA("callLimits", { idleSeconds: Number(e.target.value) })} disabled={!canEditAuto} />
                    </Field>
                  </div>
                </FormSection>
              </>
            ))}
          </TabsContent>
        </Tabs>

        <PreviewPanel f={preview} auto={auto} />
      </div>

      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onReset={() => {
          setForm(initial);
          if (autoQ.data) setAuto(autoQ.data.settings);
        }}
        lastSavedAt={[agent.updated_at, autoQ.data?.updatedAt].filter(Boolean).sort().pop() ?? agent.updated_at}
        disabled={!canEdit || paused && agent.paused_by === "agency"}
        disabledReason={!canEdit ? ws.access.readOnlyReason : "Paused by your agency."}
      />
    </div>
  );
}

/* ---------------- Small pieces ---------------- */

function Choice({ on, disabled, onClick, label, hint, icon, data }: { on: boolean; disabled: boolean; onClick: () => void; label: string; hint: string; icon?: ReactNode; data: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      data-choice={data}
      className={cn("rounded-[6px] border p-3 text-left transition-colors", on ? "border-indigo bg-[#f7f6ff] ring-1 ring-indigo" : "border-hairline hover:border-[#c7c4ff]", disabled && "cursor-default opacity-70")}
    >
      {icon}
      <span className="block text-[13px] font-medium text-ink">{label}</span>
      <span className="block text-[12px] text-ink-muted">{hint}</span>
    </button>
  );
}

function Toggle({ label, hint, checked, onChange, disabled, name }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean; name: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[6px] border border-hairline px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint ? <span className="block text-[12px] text-ink-muted">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} data-option={name} aria-label={label} />
    </label>
  );
}

function QuestionList({ values, onChange, disabled }: { values: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= values.length) return;
    const next = [...values];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="space-y-2" data-questions>
      <ol className="space-y-1.5">
        {values.map((v, i) => (
          <li key={`${v}-${i}`} className="flex items-center gap-2 rounded-[6px] border border-hairline bg-white px-2.5 py-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas-2 text-[11px] font-semibold text-ink-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 text-[13px] text-ink [overflow-wrap:anywhere]">{v}</span>
            {!disabled ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="h-6 w-6 rounded text-ink-muted hover:bg-canvas-2 disabled:opacity-30">↑</button>
                <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === values.length - 1} className="h-6 w-6 rounded text-ink-muted hover:bg-canvas-2 disabled:opacity-30">↓</button>
                <button type="button" aria-label="Remove" onClick={() => onChange(values.filter((_, j) => j !== i))} className="h-6 w-6 rounded text-ink-muted hover:bg-canvas-2">×</button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {!disabled && values.length < 6 ? (
        <input
          type="text"
          maxLength={160}
          aria-label="Add a question"
          placeholder="e.g. Is it for an adult or a child? (press Enter)"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = (e.currentTarget.value || "").trim();
              if (v) onChange([...values, v]);
              e.currentTarget.value = "";
            }
          }}
        />
      ) : values.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">None set.</p>
      ) : null}
    </div>
  );
}
