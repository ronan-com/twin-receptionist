import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, Check, Loader2, Phone, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, Notice, PageSkeleton } from "@/components/app/primitives";
import { Field, TagInput } from "@/components/app/forms";
import { BrandingEditor } from "@/components/app/BrandingEditor";
import { HoursEditor, VoicePicker } from "@/components/app/ReceptionistFields";
import { TestPreviewDialog } from "@/components/app/SampleCall";
import { markOnboardingSkipped } from "@/components/app/SetupPrompt";
import { agentsQuery, knowledgeQuery } from "@/lib/app/queries";
import {
  createKnowledge,
  deleteKnowledge,
  getVoices,
  inviteMember,
  requestNumber,
  saveOnboarding,
  setUpCalendar,
  updateReceptionist,
  type AgentRow,
} from "@/lib/api/manage";
import { asBusinessHours, asRecord, asStringArray, type BusinessHours } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { TIMEZONES } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { NEUTRAL_DASHBOARD, PRODUCT } from "@/lib/app/product";

// First-run onboarding (area S): a step-by-step set-up for a business manager whose
// receptionist is still "pending" (clients.data.onboarding): a business that signed
// up on its own, or a client an agency sent an onboarding link. Every step saves for
// real (to the phone provider; demo receptionists only save). It resumes where it was
// left, can be put off ("I'll finish later"), and finishing marks it done.

export const Route = createFileRoute("/_authenticated/app/onboarding")({
  head: () => ({ meta: [{ title: `Set up your receptionist — ${PRODUCT}` }] }),
  component: OnboardingPage,
});

const ALL_STEPS = [
  { key: "business", title: "Your business", blurb: "Who you are and where, so your receptionist can say so." },
  { key: "hours", title: "Opening hours", blurb: "When you're open. Callers are told these times." },
  { key: "services", title: "Services and answers", blurb: "What callers can ask for, and answers to the questions they ask most." },
  { key: "voice", title: "Greeting and voice", blurb: "The first thing callers hear, and how it sounds." },
  { key: "branding", title: "Branding", blurb: "Your logo and colours on this dashboard. Optional." },
  { key: "extras", title: "Finishing touches", blurb: "Optional: invite your team, get a phone number, connect a calendar." },
] as const;
const STEPS = ALL_STEPS.filter((step) => !NEUTRAL_DASHBOARD || step.key !== "branding");

const INDUSTRY_OPTIONS = ["Dental", "Healthcare", "Trades", "Salon & beauty", "Real estate", "Automotive", "Professional services", "Childcare", "Other"];

type Form = {
  business_name: string;
  industry: string;
  city: string;
  timezone: string;
  hours: BusinessHours;
  services: string[];
  name: string;
  greeting: string;
  tone: string;
  voice_id: string | null;
};

function formOf(a: AgentRow, b: ReturnType<typeof useWorkspace>["business"]): Form {
  return {
    business_name: b?.name ?? "",
    industry: b?.industry && INDUSTRY_OPTIONS.includes(b.industry) ? b.industry : "Other",
    city: b?.city ?? "",
    timezone: b?.timezone ?? "Australia/Brisbane",
    hours: asBusinessHours(b?.business_hours),
    services: asStringArray(asRecord(a.booking_rules)["services"]),
    name: a.name === "Receptionist" ? "" : a.name,
    greeting: a.greeting ?? "",
    tone: a.tone === "professional" ? "professional" : "friendly",
    voice_id: a.voice_id,
  };
}

function OnboardingPage() {
  const ws = useWorkspace();
  const agentsQ = useQuery(agentsQuery(ws.businessId));
  const agent = agentsQ.data?.[0] ?? null;
  if (agentsQ.isPending || !ws.business) return <PageSkeleton metrics={0} rows={3} />;
  if (agentsQ.error) return <ErrorState message={agentsQ.error.message} onRetry={() => void agentsQ.refetch()} />;
  if (!agent) return <ErrorState message="This business has no receptionist yet." />;
  if (!ws.access.canEdit || ws.access.kind !== "member") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Notice tone="neutral" title="Set-up is for managers" action={<Button asChild size="sm" variant="outline"><Link to="/app">Go to the dashboard</Link></Button>}>
          {ws.access.readOnlyReason ?? "Only a manager of this business can set up the receptionist."}
        </Notice>
      </div>
    );
  }
  return <Wizard key={agent.id} agent={agent} />;
}

function Wizard({ agent }: { agent: AgentRow }) {
  const ws = useWorkspace();
  const id = ws.businessId!;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const initialStep = Math.min(STEPS.length - 1, Math.max(0, agent.onboarding_step ?? 0));
  const [step, setStep] = useState(initialStep);
  const [form, setForm] = useState<Form>(() => formOf(agent, ws.business));
  const [error, setError] = useState<string | null>(null);
  const voicesQ = useQuery({ queryKey: ["voices", "business", id], queryFn: () => getVoices(true, id), staleTime: 300_000 });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const marked = useRef(false);

  // Remember it's in progress (so a self-signed-up business can come back to it).
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    if (agent.onboarding !== "done") void saveOnboarding(id, { status: "pending", step: initialStep }).catch(() => {});
  }, [agent.onboarding, id, initialStep]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["agents", id] }), qc.invalidateQueries({ queryKey: ["businesses"] })]);

  const saveStep = async (): Promise<void> => {
    const key = STEPS[step].key;
    if (key === "business") {
      if (!form.business_name.trim()) throw new Error("Enter your business name.");
      await updateReceptionist(id, { business: { name: form.business_name.trim(), industry: form.industry, city: form.city.trim(), timezone: form.timezone } });
    } else if (key === "hours") {
      await updateReceptionist(id, { business_hours: form.hours });
    } else if (key === "services") {
      if (form.services.length === 0) throw new Error("Add at least one service callers can ask for.");
      await updateReceptionist(id, { booking_rules: { services: form.services } });
    } else if (key === "voice") {
      await updateReceptionist(id, { name: form.name.trim(), greeting: form.greeting.trim(), tone: form.tone, voice_id: form.voice_id });
    }
  };

  const next = useMutation({
    mutationFn: async () => {
      setError(null);
      await saveStep();
      const last = step === STEPS.length - 1;
      await saveOnboarding(id, last ? { status: "done", step: 0 } : { step: step + 1 });
      return last;
    },
    onSuccess: async (last) => {
      await refresh();
      if (last) {
        toast.success("Your receptionist is set up", { description: "You can change anything later under Receptionist and Settings." });
        void navigate({ to: "/app" });
      } else {
        if (["business", "hours", "services", "voice"].includes(STEPS[step].key)) toast.success("Saved", { description: agent.demo ? "Test receptionist: saved here only." : "Applied to your receptionist." });
        setStep((s) => s + 1);
        window.scrollTo({ top: 0 });
      }
    },
    onError: (e) => setError((e as Error).message),
  });

  const later = () => {
    markOnboardingSkipped(id);
    void saveOnboarding(id, { step }).catch(() => {});
    void navigate({ to: "/app" });
  };

  const current = STEPS[step];
  const voice = useMemo(() => (voicesQ.data ?? []).find((v) => v.id === form.voice_id) ?? null, [voicesQ.data, form.voice_id]);

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-page="onboarding" data-step={current.key}>
      <div>
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">{ws.business?.name}</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink">Set up your receptionist</h1>
        <p className="mt-1 text-[13px] text-ink-muted">A few minutes now and callers get the right answers from the first ring. Everything saves as you go.</p>
      </div>

      <ol className={cn("grid gap-1.5", NEUTRAL_DASHBOARD ? "grid-cols-5" : "grid-cols-6")} aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === step ? "step" : undefined}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              disabled={i >= step}
              className={cn("block h-1.5 w-full rounded-full", i < step ? "bg-indigo" : i === step ? "bg-indigo/60" : "bg-hairline", i < step && "cursor-pointer")}
              aria-label={`Step ${i + 1}: ${s.title}`}
            />
          </li>
        ))}
      </ol>

      <section className="card-surface p-4 sm:p-6">
        <div className="mb-4">
          <div className="text-[12px] text-ink-muted">
            Step {step + 1} of {STEPS.length}
          </div>
          <h2 className="text-[17px] font-semibold text-ink">{current.title}</h2>
          <p className="text-[12.5px] text-ink-muted">{current.blurb}</p>
        </div>

        {current.key === "business" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" htmlFor="ob-name" required>
              <Input id="ob-name" value={form.business_name} onChange={(e) => set("business_name", e.target.value)} maxLength={80} />
            </Field>
            <Field label="Industry" htmlFor="ob-industry">
              <Select value={form.industry} onValueChange={(v) => set("industry", v)}>
                <SelectTrigger id="ob-industry"><SelectValue /></SelectTrigger>
                <SelectContent>{INDUSTRY_OPTIONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Suburb" htmlFor="ob-city">
              <Input id="ob-city" value={form.city} onChange={(e) => set("city", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Time zone" htmlFor="ob-tz">
              <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                <SelectTrigger id="ob-tz"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        ) : null}

        {current.key === "hours" ? <HoursEditor value={form.hours} onChange={(h) => set("hours", h)} /> : null}

        {current.key === "services" ? (
          <div className="space-y-5">
            <Field label="Services" hint="What callers can ask for. Press Enter after each one.">
              <TagInput values={form.services} onChange={(v) => set("services", v.slice(0, 12))} placeholder="e.g. Check-up & clean (press Enter)" />
            </Field>
            <QuickFaqs businessId={id} />
          </div>
        ) : null}

        {current.key === "voice" ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Receptionist name" htmlFor="ob-rname" hint="Optional. Callers hear it in the greeting.">
                <Input id="ob-rname" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={30} placeholder="e.g. Mia" />
              </Field>
              <Field label="Tone" htmlFor="ob-tone">
                <Select value={form.tone} onValueChange={(v) => set("tone", v)}>
                  <SelectTrigger id="ob-tone"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Greeting" htmlFor="ob-greeting" hint="Leave it blank for a standard greeting with your business name.">
              <Textarea id="ob-greeting" rows={3} value={form.greeting} onChange={(e) => set("greeting", e.target.value)} maxLength={300} />
            </Field>
            <Field label="Voice">
              <VoicePicker voices={voicesQ.data ?? []} value={form.voice_id} onChange={(v) => set("voice_id", v)} loading={voicesQ.isPending} />
            </Field>
            <div className="flex flex-col gap-2 rounded-[6px] border border-hairline bg-canvas-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12.5px] text-ink-muted">
                Hear how a call opens with these words. To call it for real, get a number in the last step (or forward your existing one to it).
              </p>
              <TestPreviewDialog form={{ name: form.name, greeting: form.greeting, business_name: form.business_name, services: form.services }} voice={voice} />
            </div>
          </div>
        ) : null}

        {current.key === "branding" ? <BrandingEditor /> : null}

        {current.key === "extras" ? <Extras businessId={id} /> : null}

        {error ? (
          <Notice tone="danger" className="mt-4" title="Couldn't save this step">
            {error} Nothing was changed.
          </Notice>
        ) : null}
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" size="sm" className="text-ink-muted" onClick={later} data-action="later">
          I'll finish later
        </Button>
        <div className="flex gap-2">
          {step > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)} disabled={next.isPending}>
              Back
            </Button>
          ) : null}
          <Button size="sm" onClick={() => next.mutate()} disabled={next.isPending} data-action="next" className="flex-1 sm:flex-none">
            {next.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {step === STEPS.length - 1 ? "Finish set-up" : current.key === "branding" ? "Continue" : "Save and continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuickFaqs({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const itemsQ = useQuery(knowledgeQuery(businessId));
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const add = useMutation({
    mutationFn: () => createKnowledge(businessId, { title: q.trim(), type: "faq", question: q.trim(), answer: a.trim(), content: null, status: "published" }),
    onSuccess: (r) => {
      setQ("");
      setA("");
      if (r.warning) toast.warning(r.warning);
      void qc.invalidateQueries({ queryKey: ["knowledge", businessId] });
    },
    onError: (e) => toast.error("Couldn't add it", { description: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => deleteKnowledge(businessId, itemId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["knowledge", businessId] }),
  });
  const items = (itemsQ.data ?? []).filter((i) => i.status === "published");
  return (
    <div className="space-y-3" data-quick-faqs>
      <div>
        <div className="text-[13px] font-medium text-ink">Common questions</div>
        <p className="text-[12px] text-ink-muted">Add the questions you're asked most. You can add more any time in Knowledge.</p>
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-hairline rounded-[6px] border border-hairline">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <span className="min-w-0 text-[12.5px]">
                <span className="block font-medium text-ink [overflow-wrap:anywhere]">{i.question ?? i.title}</span>
                <span className="block text-ink-muted [overflow-wrap:anywhere]">{i.answer ?? i.content}</span>
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Remove ${i.title}`} onClick={() => remove.mutate(i.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Question" htmlFor="ob-q">
          <Input id="ob-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="Do you take payment plans?" />
        </Field>
        <Field label="Answer" htmlFor="ob-a">
          <Input id="ob-a" value={a} onChange={(e) => setA(e.target.value)} maxLength={2000} placeholder="Yes, over 6 or 12 months." />
        </Field>
        <Button variant="outline" size="sm" className="h-9" onClick={() => add.mutate()} disabled={!q.trim() || !a.trim() || add.isPending} data-action="add-faq">
          {add.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Add
        </Button>
      </div>
    </div>
  );
}

function Extras({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "viewer">("viewer");
  const [invited, setInvited] = useState<string[]>([]);
  const [numberType, setNumberType] = useState<"local" | "mobile">("local");
  const [numberAsked, setNumberAsked] = useState(false);
  const [calendar, setCalendar] = useState(false);

  const invite = useMutation({
    mutationFn: () => inviteMember(businessId, { email: email.trim(), role }),
    onSuccess: (r) => {
      setInvited((l) => [...l, r.email]);
      setEmail("");
      toast.success(r.added ? `${r.email} can now see this business` : r.emailed ? `Invite emailed to ${r.email}` : `Invite made for ${r.email}`, { description: !r.added && !r.emailed ? "Copy their link from the Team page." : undefined });
      void qc.invalidateQueries({ queryKey: ["team", businessId] });
    },
    onError: (e) => toast.error("Couldn't invite them", { description: (e as Error).message }),
  });
  const number = useMutation({
    mutationFn: () => requestNumber(businessId, { type: numberType, note: "Requested during set-up" }),
    onSuccess: () => {
      setNumberAsked(true);
      void qc.invalidateQueries({ queryKey: ["phone-numbers", businessId] });
    },
    onError: (e) => toast.error("Couldn't request a number", { description: (e as Error).message }),
  });
  const cal = useMutation({
    mutationFn: () => setUpCalendar(businessId, { provider: "builtin", minutes: 30 }),
    onSuccess: () => {
      setCalendar(true);
      void qc.invalidateQueries({ queryKey: ["integrations", businessId] });
      void qc.invalidateQueries({ queryKey: ["agents", businessId] });
    },
    onError: (e) => toast.error("Couldn't set up the calendar", { description: (e as Error).message }),
  });

  return (
    <div className="space-y-3">
      <div className="rounded-[6px] border border-hairline p-3" data-extra="invite">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink"><UserPlus className="h-4 w-4 text-indigo" /> Invite your team</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <Input id="ob-inv" type="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourbusiness.com" />
          <Select value={role} onValueChange={(v) => setRole(v as "manager" | "viewer")}>
            <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-9" onClick={() => invite.mutate()} disabled={invite.isPending || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}>
            Invite
          </Button>
        </div>
        {invited.length ? <p className="mt-2 text-[12px] text-ink-muted [overflow-wrap:anywhere]">Invited: {invited.join(", ")}</p> : null}
      </div>

      <div className="rounded-[6px] border border-hairline p-3" data-extra="number">
        <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-ink"><Phone className="h-4 w-4 text-indigo" /> Get a phone number</div>
        {numberAsked ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-[#0e6245]"><Check className="h-3.5 w-3.5" /> Requested. We'll connect it and it shows under Phone numbers, with how to forward your existing number.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="flex-1 text-[12px] text-ink-muted">Callers reach your receptionist on its own number. Keep your existing one and forward to it.</p>
            <Select value={numberType} onValueChange={(v) => setNumberType(v as "local" | "mobile")}>
              <SelectTrigger aria-label="Number type" className="sm:w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local number</SelectItem>
                <SelectItem value="mobile">Mobile number</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-9" onClick={() => number.mutate()} disabled={number.isPending}>Request a number</Button>
          </div>
        )}
      </div>

      <div className="rounded-[6px] border border-hairline p-3" data-extra="calendar">
        <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-ink"><CalendarCheck className="h-4 w-4 text-indigo" /> Take bookings</div>
        {calendar ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-[#0e6245]"><Check className="h-3.5 w-3.5" /> Booking calendar on. Your receptionist books 30-minute appointments inside your hours.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="flex-1 text-[12px] text-ink-muted">
              Use our simple calendar now, or connect Google or Outlook in <Link to="/app/integrations" className="font-medium text-indigo hover:underline">Integrations</Link>.
            </p>
            <Button size="sm" variant="outline" className="h-9" onClick={() => cal.mutate()} disabled={cal.isPending}>Use the built-in calendar</Button>
          </div>
        )}
      </div>
    </div>
  );
}
