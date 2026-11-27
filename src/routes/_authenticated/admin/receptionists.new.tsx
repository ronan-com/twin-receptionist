import { ConnectPhoneFirst, usePhoneKeyNeeded } from "@/components/app/PhoneGate";
import { useEffect, useState, type KeyboardEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Panel, Notice, ErrorState } from "@/components/app/primitives";
import { Field } from "@/components/app/forms";
import { cn } from "@/lib/utils";
import { companyApi, createReceptionist, getVoiceEngines, getVoices } from "@/lib/api/console";
import { VoicePreviewButton } from "@/components/app/VoicePreview";
import type { Voice as EngineVoice } from "@/lib/shared";
import { saveAutomations } from "@/lib/api/automations";
import { createKnowledge } from "@/lib/api/manage";
import {
  CHILDCARE_STARTER_ANSWERS,
  DAYS,
  INDUSTRIES,
  TIMEZONES,
  alwaysOpen,
  article,
  blankSettings,
  businessNoun,
  defaultGreeting,
  defaultHours,
  describeHours,
  greetingsFor,
  industry,
  isAlwaysOpen,
  starterTitle,
  type DayKey,
  type IndustryKey,
  type Settings,
} from "@/lib/shared";
import { READ_ONLY_HINT, useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";
import { ProfileEditor } from "@/components/app/profile/ProfileEditor";
import { TemplatePicker } from "@/components/app/profile/TemplatePicker";
import { cleanProfile, fillGreeting, profileOf, settingsToneFor, summarizeProfile, templatePatch, totalProgress, type WithProfile } from "@/components/app/profile/helpers";
import { templateById } from "@/lib/templates";
import type { NicheTemplate, ReceptionProfile } from "@/lib/profile";

// The receptionist setup wizard (ported from the old Twin Setup page): six short
// steps (the first can start from a niche template; "How it handles calls" is the detailed profile), then the existing POST /api/clients creates the phone assistant. An urgent
// number then turns on the transfer automation, and a childcare centre gets the
// starter answers from the centre onboarding pack as knowledge for the director to check.
export const Route = createFileRoute("/_authenticated/admin/receptionists/new")({
  validateSearch: (s: Record<string, unknown>): { company?: string } => (typeof s.company === "string" && /^[a-f0-9-]{36}$/.test(s.company) ? { company: s.company } : {}),
  head: () => ({ meta: [{ title: `New receptionist — ${PRODUCT} admin` }] }),
  component: NewReceptionistPage,
});

const STEPS = ["Client and business", "Hours and services", "How it handles calls", "Voice", "Urgent calls", "Review"];
const REVIEW = STEPS.length - 1;
const NEW = "new";

// Who urgent calls are put through to (the transfer automation, server/automations.ts).
type Urgent = { number: string; name: string; onRequest: boolean };
// Australian mobile or landline, as server/automations.ts auNumber accepts it.
const AU_NUMBER = /^(\+?61|0)[2-478]\d{8}$/;
const compact = (n: string) => n.replace(/[\s().-]/g, "");

function problem(step: number, s: WithProfile, urgent: Urgent): string {
  if (step === 0 && s.businessName.trim().length < 2) return "Enter the business name.";
  if (step === 1) {
    if (s.services.length === 0) return "Add at least one service callers can ask for.";
    if (Object.values(s.hours).some((h) => h.open && h.from >= h.to)) return "Check the hours: closing time must be after opening time.";
    if (!Object.values(s.hours).some((h) => h.open)) return "Mark at least one day as open.";
  }
  if (step === 3 && !s.voiceId) return "Choose a voice.";
  if (step === 4 && urgent.number.trim() && !AU_NUMBER.test(compact(urgent.number))) return "Enter an Australian phone number for urgent calls, like 0412 345 678 or 07 3123 4567.";
  return "";
}

function NewReceptionistPage() {
  // A single-agency install with no phone provider yet: nothing can be made until it's connected.
  if (usePhoneKeyNeeded()) return <ConnectPhoneFirst />;
  return <NewReceptionistWizard />;
}

function NewReceptionistWizard() {
  const { ws, readOnly, orgName, platform } = useConsole();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<WithProfile>(blankSettings);
  // The template's greeting keeps its {business} and {name} until the person writes their own.
  const [tplGreeting, setTplGreeting] = useState<string | null>(null);
  const [greetingTouched, setGreetingTouched] = useState(false);
  const [urgent, setUrgent] = useState<Urgent>({ number: "", name: "", onRequest: true });
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const search = Route.useSearch();
  const companiesQ = useQuery({ queryKey: ["console", "companies"], queryFn: companyApi.list });
  const [companyId, setCompanyId] = useState<string>(search.company ?? NEW);
  // Receptionists are made in the org you work in, so only its clients can take them.
  const own = (companiesQ.data ?? []).filter((c) => c.org_id === ws.org?.id);
  const chosen = own.find((c) => c.id === companyId);
  // Coming from a client's page: start with its name and industry.
  useEffect(() => {
    if (!chosen) return;
    setSettings((s) =>
      s.businessName
        ? s
        : {
            ...s,
            businessName: chosen.name,
            ...(chosen.industry ? { industry: chosen.industry as IndustryKey, services: [...industry(chosen.industry as IndustryKey).services], hours: defaultHours(chosen.industry as IndustryKey) } : {}),
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.id]);
  // An agency with both Telnyx and Vapi connected picks the engine per receptionist (Telnyx recommended).
  const enginesQ = useQuery({ queryKey: ["console", "voice-engines"], queryFn: getVoiceEngines, staleTime: 5 * 60_000 });
  const connectedEngines = (enginesQ.data?.engines ?? []).filter((e) => e.connected);
  const bothEngines = connectedEngines.length > 1;
  const [engineChoice, setEngineChoice] = useState<"telnyx" | "vapi" | null>(null);
  const engine = engineChoice ?? enginesQ.data?.default ?? null;
  const voicesQ = useQuery({ queryKey: ["console", "voices-raw", bothEngines ? engine : "default"], queryFn: () => getVoices(bothEngines && engine ? engine : undefined), staleTime: 5 * 60_000, enabled: !enginesQ.isPending });
  const voices = voicesQ.data ?? [];

  // Preselect the first recommended voice so the default can just be accepted (again after an engine change).
  useEffect(() => {
    if (voices[0]) setSettings((s) => (s.voiceId && voices.some((v) => v.id === s.voiceId) ? s : { ...s, voiceId: voices[0].id, voiceName: voices[0].name }));
  }, [voices]);

  const patch = (p: Partial<Settings>) => {
    setError("");
    if ("greeting" in p) setGreetingTouched(true);
    setSettings((s) => ({ ...s, ...p }));
  };
  const patchProfile = (profile: ReceptionProfile) => {
    setError("");
    setSettings((s) => ({ ...s, profile, ...(profile.tone !== s.profile?.tone && profile.tone ? { tone: settingsToneFor(profile.tone) } : {}) }));
  };
  const pickTemplate = (t: NicheTemplate) => {
    setError("");
    setGreetingTouched(false);
    setTplGreeting(t.greeting);
    setSettings((s) => ({ ...s, ...templatePatch(t) }));
  };
  const startBlank = () => {
    setError("");
    setTplGreeting(null);
    setSettings((s) => ({ ...s, profile: undefined, ...(greetingTouched ? {} : { greeting: "" }) }));
  };
  // Keep a template greeting in step with the business and receptionist names.
  useEffect(() => {
    if (!tplGreeting || greetingTouched) return;
    setSettings((s) => {
      const g = fillGreeting(tplGreeting, s.businessName, s.receptionistName);
      return s.greeting === g ? s : { ...s, greeting: g };
    });
  }, [tplGreeting, greetingTouched, settings.businessName, settings.receptionistName]);

  function next() {
    const issue = problem(step, settings, urgent);
    if (issue) return setError(issue);
    setError("");
    setStep(step + 1);
    window.scrollTo({ top: 0 });
  }

  async function create() {
    setCreating(true);
    setError("");
    try {
      // The client (company) first, then its receptionist inside it.
      const target = companyId === NEW ? await companyApi.create({ name: settings.businessName.trim(), industry: settings.industry }) : companyId;
      // The detailed profile goes with the settings; its FAQs become knowledge items below.
      const { faqs = [], ...profileRest } = cleanProfile(profileOf(settings));
      const { profile: _drop, ...plain } = settings;
      const withEngine = bothEngines && engine ? { ...plain, engine } : plain;
      const created = await createReceptionist(Object.keys(profileRest).length ? ({ ...withEngine, profile: profileRest } as Settings) : withEngine);
      await companyApi.attach(target, created.id);
      // The receptionist exists now: a problem below is reported, not a reason to stop.
      const missed: string[] = [];
      if (urgent.number.trim()) {
        await saveAutomations(created.id, {
          transfer: { enabled: true, number: compact(urgent.number), name: urgent.name.trim() || "the team", urgent: true, onRequest: urgent.onRequest },
        }).catch((err) => missed.push(`the urgent number (${(err as Error).message})`));
      }
      if (faqs.length) {
        for (const f of faqs) {
          await createKnowledge(created.id, { title: f.q.slice(0, 120), type: "faq", question: f.q, answer: f.a, content: null, status: "published" }).catch(() => {
            if (!missed.includes("some answers")) missed.push("some answers");
          });
        }
      } else if (settings.industry === "childcare") {
        for (const a of CHILDCARE_STARTER_ANSWERS) {
          await createKnowledge(created.id, { title: starterTitle(a.question), type: "faq", question: starterTitle(a.question), answer: a.answer, content: null, status: "published" }).catch(() => {
            if (!missed.includes("some starter answers")) missed.push("some starter answers");
          });
        }
      }
      await qc.invalidateQueries({ queryKey: ["admin"] });
      await qc.invalidateQueries({ queryKey: ["console"] });
      await qc.invalidateQueries({ queryKey: ["businesses"] });
      if (missed.length) toast.warning(`${settings.businessName.trim()} is ready, but ${missed.join(" and ")} couldn't be saved`, { description: "Add them from the receptionist's page." });
      else toast.success(`${settings.businessName.trim()} is ready`, { description: "Share it with the business, or request a phone number." });
      void navigate({ to: "/admin/clients/$businessId", params: { businessId: target } });
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  const faqCount = (profileOf(settings).faqs ?? []).filter((f) => f.q.trim() && f.a.trim()).length;
  const greeting = settings.greeting.trim() || defaultGreeting(settings.businessName, settings.receptionistName);

  if (readOnly) {
    return (
      <div className="space-y-5">
        <PageHeader title="New receptionist" />
        <Notice tone="info">{READ_ONLY_HINT}</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-page="admin-new-receptionist">
      <Link to="/admin/clients" className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All clients
      </Link>
      <PageHeader
        eyebrow={`Step ${step + 1} of ${STEPS.length}`}
        title={step === REVIEW ? "Check the details" : "New receptionist"}
        description={platform ? `Created in ${orgName || "your own team"}. Agencies create their own from their console.` : `For a business ${orgName || "your agency"} looks after.`}
      />

      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className="min-w-0">
            <span className={cn("block h-1 rounded-full", i <= step ? "bg-indigo" : "bg-hairline")} />
            <span className={cn("mt-1.5 block truncate text-[11.5px]", i === step ? "font-medium text-ink" : "text-ink-muted")}>{label}</span>
          </li>
        ))}
      </ol>

      <Panel>
        <div className="space-y-5" data-step={step}>
          {step === 0 ? (
            <>
              <TemplatePicker templateId={settings.profile?.template} onPick={pickTemplate} onBlank={startBlank} />
              <Field label="Client" htmlFor="w-company" hint="The company this receptionist works for. A client can have several receptionists.">
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger id="w-company" data-select="company"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW}>New client (named after the business)</SelectItem>
                    {own.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <BusinessStep value={settings} onChange={patch} />
            </>
          ) : null}
          {step === 1 ? <HoursStep value={settings} onChange={patch} /> : null}
          {step === 2 ? (
            <>
              <div>
                <h2 className="text-[15px] font-semibold text-ink">How it handles calls</h2>
                <p className="text-[12.5px] text-ink-muted">
                  {settings.profile?.template ? `Filled in from the ${templateById(settings.profile.template)?.label ?? "template"} template. ` : ""}Open a section to check or change it. Skip anything that doesn't apply.
                </p>
              </div>
              <ProfileEditor value={profileOf(settings)} onChange={patchProfile} services={settings.services} />
            </>
          ) : null}
          {step === 3 ? (
            voicesQ.error ? <ErrorState message={(voicesQ.error as Error).message} onRetry={() => void voicesQ.refetch()} /> : <VoiceStep value={settings} onChange={patch} voices={voices} loading={voicesQ.isPending} engines={bothEngines ? connectedEngines : []} engine={engine} onEngine={setEngineChoice} />
          ) : null}
          {step === 4 ? <UrgentStep value={settings} onChange={patch} urgent={urgent} onUrgent={(p) => { setError(""); setUrgent((u) => ({ ...u, ...p })); }} /> : null}
          {step === REVIEW ? (
            <dl className="divide-y divide-hairline text-[13px]" data-review>
              <ReviewRow label="Client">{chosen ? chosen.name : `${settings.businessName} (new)`}</ReviewRow>
              <ReviewRow label="Business">
                {settings.businessName}
                <span className="text-ink-muted"> · {kindOf(settings)}{settings.suburb ? ` · ${settings.suburb}` : ""}</span>
                {settings.sayName ? <span className="block text-ink-muted">Said “{settings.sayName}”</span> : null}
                {settings.about ? <span className="block text-ink-muted">{settings.about}</span> : null}
              </ReviewRow>
              <ReviewRow label="Active">
                {describeHours(settings.hours).map((line) => (
                  <span key={line} className="block">{line}</span>
                ))}
                {settings.closures?.trim() ? <span className="block text-ink-muted">Closures: {settings.closures}</span> : null}
              </ReviewRow>
              <ReviewRow label="Callers can ask for">{settings.services.join(", ")}</ReviewRow>
              {bothEngines && engine ? <ReviewRow label="Voice engine">{engine === "vapi" ? "Vapi" : "Telnyx"}</ReviewRow> : null}
              <ReviewRow label="Voice">
                {settings.voiceName.split(" - ")[0]}
                <span className="text-ink-muted"> · {settings.tone === "friendly" ? "Friendly" : "Professional"}</span>
              </ReviewRow>
              <ReviewRow label="It answers with">“{greeting}”</ReviewRow>
              <ReviewRow label="Urgent calls">
                {urgent.number.trim() ? (
                  <>
                    {`Put through to ${urgent.name.trim() || "the team"} on ${urgent.number.trim()}${urgent.onRequest ? ", and when a caller asks for a person" : ""}`}
                    <span className="block text-ink-muted">Transfers start once this receptionist has a phone number.</span>
                  </>
                ) : "It takes a message"}
              </ReviewRow>
              {settings.avoid?.length ? <ReviewRow label="Passed to staff">{settings.avoid.join(", ")}</ReviewRow> : null}
              {settings.profile?.template ? <ReviewRow label="Template">{templateById(settings.profile.template)?.label ?? settings.profile.template}</ReviewRow> : null}
              {summarizeProfile(profileOf(settings)).map((r) => (
                <ReviewRow key={r.label} label={r.label}>{r.value}</ReviewRow>
              ))}
              {faqCount > 0 ? (
                <ReviewRow label="Saved answers">{faqCount} common question{faqCount === 1 ? "" : "s"} saved as answers the receptionist can use</ReviewRow>
              ) : settings.industry === "childcare" ? (
                <ReviewRow label="Starter answers">{CHILDCARE_STARTER_ANSWERS.length} answers from the centre pack, each marked for the director to check</ReviewRow>
              ) : null}
              <ReviewRow label="Call details">{(() => { const t = totalProgress(profileOf(settings)); return `${t.set} of ${t.total} set`; })()}</ReviewRow>
            </dl>
          ) : null}
          {step === REVIEW ? <p className="text-[12px] text-ink-muted">Creating it takes a few seconds. You can change any of this afterwards and test it from your browser straight away.</p> : null}

          {error ? (
            <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-4">
            {step > 0 ? (
              <Button type="button" variant="ghost" disabled={creating} onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            {step < REVIEW ? (
              <Button type="button" onClick={next} data-action="continue">
                Continue
              </Button>
            ) : (
              <Button type="button" disabled={creating} onClick={create} data-action="create-receptionist">
                {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                {creating ? "Creating the receptionist…" : "Create receptionist"}
              </Button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

type StepProps = { value: Settings; onChange: (p: Partial<Settings>) => void };

/** The business type as shown: the preset's label, or its own words for "Something else". */
const kindOf = (s: Settings) => (s.industry === "other" && s.industryLabel?.trim() ? s.industryLabel.trim() : industry(s.industry).label);

// Adds a line to a short list (services, topics) on Enter, ignoring repeats.
function ListInput({ items, max, each, onAdd, label, placeholder }: { items: string[]; max: number; each: number; onAdd: (item: string) => void; label: string; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const full = items.length >= max;
  const add = () => {
    const next = draft.trim();
    if (!next || full) return;
    if (!items.some((s) => s.toLowerCase() === next.toLowerCase())) onAdd(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="flex gap-2">
      <Input maxLength={each} placeholder={full ? `That's the maximum of ${max}` : placeholder} disabled={full} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} aria-label={label} />
      <Button type="button" variant="outline" onClick={add} disabled={full || !draft.trim()}>
        Add
      </Button>
    </div>
  );
}

function Chips({ items, onRemove, list }: { items: string[]; onRemove: (item: string) => void; list: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" data-list={list}>
      {items.map((s) => (
        <li key={s} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas-2 py-0.5 pl-2.5 pr-1 text-[12.5px] text-ink">
          {s}
          <button type="button" aria-label={`Remove ${s}`} className="rounded-full p-0.5 text-ink-muted hover:bg-white hover:text-ink" onClick={() => onRemove(s)}>
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

// One-tap additions: the suggestions not already in the list.
function Suggestions({ items, taken, max, onAdd, list }: { items: string[]; taken: string[]; max: number; onAdd: (item: string) => void; list: string }) {
  const left = items.filter((x, i) => items.indexOf(x) === i && !taken.some((t) => t.toLowerCase() === x.toLowerCase()));
  if (left.length === 0 || taken.length >= max) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-suggestions={list}>
      <span className="text-[12px] text-ink-muted">Suggestions:</span>
      {left.map((x) => (
        <button key={x} type="button" onClick={() => onAdd(x)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-hairline bg-white px-2.5 py-0.5 text-[12.5px] text-ink-muted hover:border-indigo hover:text-indigo">
          <Plus className="h-3 w-3" /> {x}
        </button>
      ))}
    </div>
  );
}

function BusinessStep({ value, onChange }: StepProps) {
  const [query, setQuery] = useState("");
  // During setup the hours and services follow the industry's preset.
  const pick = (key: IndustryKey) => onChange({ industry: key, services: [...industry(key).services], hours: defaultHours(key), ...(key === "other" ? {} : { industryLabel: "" }) });
  const q = query.trim().toLowerCase();
  // "Something else" is always there, last.
  const shown = INDUSTRIES.filter((i) => i.key === "other" || !q || [i.label, i.noun, ...i.services].some((t) => t.toLowerCase().includes(q)));
  return (
    <>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">The business</h2>
        <p className="text-[12.5px] text-ink-muted">Who this receptionist answers the phone for.</p>
      </div>
      <Field label="Business name" htmlFor="w-name" required>
        <Input id="w-name" maxLength={80} placeholder="e.g. Bright Smile Dental" value={value.businessName} onChange={(e) => onChange({ businessName: e.target.value })} />
      </Field>
      <Field label="How do you say the business name?" htmlFor="w-sayname" hint="Optional. Only if it isn't obvious, written the way it sounds.">
        <Input id="w-sayname" maxLength={80} placeholder="e.g. Kee-OR-a" value={value.sayName ?? ""} onChange={(e) => onChange({ sayName: e.target.value })} />
      </Field>
      <div className="grid gap-1.5">
        <span id="w-industry" className="text-[12.5px] font-medium text-ink">What kind of business is it?</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
          <Input className="pl-8" placeholder="Search, e.g. vet, café, plumber" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search business types" />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="w-industry">
          {shown.map((i) => (
            <button
              key={i.key}
              type="button"
              role="radio"
              aria-checked={value.industry === i.key}
              onClick={() => pick(i.key)}
              className={cn(
                "rounded-[6px] border px-3 py-2 text-left text-[13px] transition-colors",
                value.industry === i.key ? "border-indigo bg-[#efeeff] font-medium text-indigo" : "border-hairline bg-white text-ink hover:bg-canvas-2",
              )}
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>
      {value.industry === "other" ? (
        <Field label="What kind of business is it?" htmlFor="w-kind" hint="In a few words. The receptionist describes the business this way.">
          <Input id="w-kind" maxLength={60} placeholder="e.g. florist, wedding photographer" value={value.industryLabel ?? ""} onChange={(e) => onChange({ industryLabel: e.target.value })} />
        </Field>
      ) : null}
      <Field label="What does the business do?" htmlFor="w-about" hint="Optional. A sentence or two the receptionist can use when callers ask.">
        <Textarea id="w-about" rows={2} maxLength={400} placeholder="e.g. Family dental clinic for all ages, with gentle care for nervous patients." value={value.about ?? ""} onChange={(e) => onChange({ about: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Suburb or town" htmlFor="w-suburb">
          <Input id="w-suburb" maxLength={60} placeholder="e.g. Paddington" value={value.suburb} onChange={(e) => onChange({ suburb: e.target.value })} />
        </Field>
        <Field label="Time zone" htmlFor="w-tz">
          <Select value={value.timezone} onValueChange={(v) => onChange({ timezone: v })}>
            <SelectTrigger id="w-tz"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Street address" htmlFor="w-address" hint="Optional. So callers can ask where you are.">
        <Input id="w-address" maxLength={140} value={value.address} onChange={(e) => onChange({ address: e.target.value })} />
      </Field>
    </>
  );
}

// Extra one-tap services offered for every type of business.
const GENERAL_SERVICES = ["Request a call back", "Opening hours and directions", "Change or cancel a booking", "Message for the team"];

function HoursStep({ value, onChange }: StepProps) {
  const always = isAlwaysOpen(value.hours);
  const setDay = (day: DayKey, p: Partial<Settings["hours"][DayKey]>) => onChange({ hours: { ...value.hours, [day]: { ...value.hours[day], ...p } } });
  // Back to set times: the business type's usual hours (or 8 to 5 if those are 24/7 too).
  const specific = () => {
    if (!always) return;
    const preset = defaultHours(value.industry);
    onChange({ hours: isAlwaysOpen(preset) ? defaultHours("other") : preset });
  };
  const preset = industry(value.industry);
  return (
    <>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">When would you like the AI receptionist to be active?</h2>
        <p className="text-[12.5px] text-ink-muted">It only operates within these hours.</p>
      </div>
      <div className="inline-flex rounded-[6px] border border-hairline p-0.5" role="radiogroup" aria-label="When it's active">
        {[
          { on: always, label: "Always on (24/7)", pick: () => onChange({ hours: alwaysOpen() }), id: "always" },
          { on: !always, label: "Set specific times", pick: specific, id: "times" },
        ].map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={o.on} data-hours={o.id} onClick={o.pick} className={cn("flex-1 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-[13px]", o.on ? "bg-indigo text-white" : "text-ink-muted hover:text-ink")}>
            {o.label}
          </button>
        ))}
      </div>
      {always ? (
        <p className="rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 text-[12.5px] text-ink">It answers every call, any time of day, every day of the week.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-[6px] border border-hairline">
          {DAYS.map((d) => {
            const h = value.hours[d.key];
            return (
              <li key={d.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <label className="flex w-32 items-center gap-2">
                  <Switch checked={h.open} onCheckedChange={(open) => setDay(d.key, { open })} aria-label={`${d.label} open`} />
                  <span className={h.open ? "text-ink" : "text-ink-muted"}>{d.label}</span>
                </label>
                {h.open ? (
                  <span className="flex items-center gap-2">
                    <Input type="time" aria-label={`${d.label} opens`} value={h.from} onChange={(e) => setDay(d.key, { from: e.target.value })} className="h-8 w-[110px]" />
                    <span className="text-ink-muted">to</span>
                    <Input type="time" aria-label={`${d.label} closes`} value={h.to} onChange={(e) => setDay(d.key, { to: e.target.value })} className="h-8 w-[110px]" />
                  </span>
                ) : (
                  <span className="text-ink-muted">Closed</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Field label="Closures and public holidays" htmlFor="w-closures" hint="Optional. One per line. On these days callers are told the business is closed.">
        <Textarea id="w-closures" rows={3} maxLength={600} placeholder={"e.g. Closed all national public holidays\nClosed 24 December to 6 January"} value={value.closures ?? ""} onChange={(e) => onChange({ closures: e.target.value })} />
      </Field>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">What can callers ask it for?</h2>
        <p className="text-[12.5px] text-ink-muted">Common ones for {article(businessNoun(value))} {businessNoun(value)}. Remove any that don't apply and add the business's own.</p>
      </div>
      <Chips list="services" items={value.services} onRemove={(s) => onChange({ services: value.services.filter((x) => x !== s) })} />
      <Suggestions list="services" items={[...preset.services, ...GENERAL_SERVICES]} taken={value.services} max={12} onAdd={(x) => onChange({ services: [...value.services, x] })} />
      <ListInput items={value.services} max={12} each={60} label="Add a service" placeholder="Add another, then press Enter" onAdd={(x) => onChange({ services: [...value.services, x] })} />
      <Field label="Anything else callers often ask?" htmlFor="w-notes" hint="Optional. Parking, payment options, how long appointments take…">
        <Textarea id="w-notes" rows={4} maxLength={1500} value={value.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </>
  );
}

// Topics staff should handle, offered as one-tap additions.
const TOPIC_SUGGESTIONS: Partial<Record<IndustryKey, string[]>> = {
  childcare: ["Private child or family matters", "Collection or custody arrangements", "Health or medical matters", "Complaints"],
};
const GENERAL_TOPICS = ["Complaints", "Refunds and billing disputes", "Job applications", "Media enquiries"];

function UrgentStep({ value, onChange, urgent, onUrgent }: StepProps & { urgent: Urgent; onUrgent: (p: Partial<Urgent>) => void }) {
  const topics = value.avoid ?? [];
  return (
    <>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">Who should urgent calls go to?</h2>
        <p className="text-[12.5px] text-ink-muted">Optional. With a number here, it puts urgent callers through to a person during active hours instead of only taking a message.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number" htmlFor="w-urgent" hint="An Australian mobile or landline. Transfers start once this receptionist has a phone number.">
          <Input id="w-urgent" type="tel" maxLength={20} placeholder="e.g. 0412 345 678" value={urgent.number} onChange={(e) => onUrgent({ number: e.target.value })} />
        </Field>
        <Field label="Whose number is it?" htmlFor="w-urgent-name" hint="Callers hear “putting you through to …”.">
          <Input id="w-urgent-name" maxLength={40} placeholder="the team" value={urgent.name} onChange={(e) => onUrgent({ name: e.target.value })} />
        </Field>
      </div>
      {urgent.number.trim() ? (
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Switch checked={urgent.onRequest} onCheckedChange={(onRequest) => onUrgent({ onRequest })} aria-label="Also when a caller asks for a person" />
          Also put callers through when they ask for a person
        </label>
      ) : null}
      <div>
        <h2 className="text-[15px] font-semibold text-ink">Topics to pass to staff</h2>
        <p className="text-[12.5px] text-ink-muted">Optional. It won't discuss these on the phone. It offers to pass a message to the team instead.</p>
      </div>
      <Chips list="topics" items={topics} onRemove={(t) => onChange({ avoid: topics.filter((x) => x !== t) })} />
      <Suggestions list="topics" items={[...(TOPIC_SUGGESTIONS[value.industry] ?? []), ...GENERAL_TOPICS]} taken={topics} max={12} onAdd={(x) => onChange({ avoid: [...topics, x] })} />
      <ListInput items={topics} max={12} each={80} label="Add a topic" placeholder="Add a topic, then press Enter" onAdd={(x) => onChange({ avoid: [...topics, x] })} />
    </>
  );
}

type EngineOption = { id: "telnyx" | "vapi"; label: string; recommended: boolean };

function VoiceStep({ value, onChange, voices, loading, engines, engine, onEngine }: StepProps & { voices: EngineVoice[]; loading: boolean; engines: EngineOption[]; engine: "telnyx" | "vapi" | null; onEngine: (e: "telnyx" | "vapi") => void }) {
  const [showAll, setShowAll] = useState(false);
  const recommended = voices.filter((v) => v.recommended);
  const chosenHidden = !showAll && value.voiceId && !recommended.some((v) => v.id === value.voiceId);
  const list = showAll || chosenHidden || recommended.length === 0 ? voices : recommended;
  const allAustralian = voices.every((v) => !v.accent || v.accent === "Australian");
  const pick = (v: EngineVoice) => onChange({ voiceId: v.id, voiceName: v.name });
  return (
    <>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">Voice</h2>
        <p className="text-[12.5px] text-ink-muted">{allAustralian ? "All of these are Australian voices." : "Australian, British and American voices."} Press play to hear one.</p>
      </div>
      {engines.length > 1 ? (
        <div className="grid gap-1.5" data-field="voice-engine">
          <span id="w-engine" className="text-[12.5px] font-medium text-ink">Voice engine</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="w-engine">
            {engines.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={engine === e.id}
                data-engine={e.id}
                onClick={() => onEngine(e.id)}
                className={cn("rounded-[6px] border px-3 py-2 text-left", engine === e.id ? "border-indigo bg-[#efeeff]" : "border-hairline bg-white hover:bg-canvas-2")}
              >
                <span className="block text-[13px] font-medium text-ink">
                  {e.label}
                  {e.recommended ? <span className="ml-1.5 text-[11px] font-normal text-indigo">Recommended</span> : null}
                </span>
                <span className="block text-[11.5px] text-ink-muted">{e.id === "telnyx" ? "Australian voices, Telnyx numbers, texts built in" : "ElevenLabs voices, answers Twilio numbers"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Receptionist's name" htmlFor="w-rname" hint="Optional.">
          <Input id="w-rname" maxLength={30} placeholder="e.g. Grace" value={value.receptionistName} onChange={(e) => onChange({ receptionistName: e.target.value })} />
        </Field>
        <div className="grid gap-1.5">
          <span id="w-tone" className="text-[12.5px] font-medium text-ink">How should it sound?</span>
          <div className="inline-flex rounded-[6px] border border-hairline p-0.5" role="radiogroup" aria-labelledby="w-tone">
            {(["friendly", "professional"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={value.tone === t}
                onClick={() => onChange({ tone: t })}
                className={cn("flex-1 rounded-[4px] px-3 py-1.5 text-[13px]", value.tone === t ? "bg-indigo text-white" : "text-ink-muted hover:text-ink")}
              >
                {t === "friendly" ? "Friendly" : "Professional"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-1.5">
        <span id="w-voice" className="text-[12.5px] font-medium text-ink">Voice</span>
        {loading ? (
          <p className="text-[12.5px] text-ink-muted">Loading voices…</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="w-voice" data-list="voices">
            {list.map((v) => (
              <div
                key={v.id}
                role="radio"
                tabIndex={0}
                aria-checked={value.voiceId === v.id}
                data-voice-option={v.id}
                onClick={() => pick(v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(v);
                  }
                }}
                className={cn("flex cursor-pointer items-center gap-2.5 rounded-[6px] border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo", value.voiceId === v.id ? "border-indigo bg-[#efeeff]" : "border-hairline bg-white hover:bg-canvas-2")}
              >
                <VoicePreviewButton id={v.id} url={v.previewUrl} name={v.name.split(" - ")[0]} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{v.name.split(" - ")[0]}</span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    {[v.gender, allAustralian ? "" : v.accent, v.name.includes(" - ") ? v.name.split(" - ")[1] : v.label, v.maker && v.maker !== "Telnyx" ? v.maker : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        {voices.length > recommended.length && recommended.length > 0 ? (
          <button type="button" className="justify-self-start text-[12.5px] text-indigo hover:underline" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer voices" : `Show all ${voices.length} ${allAustralian ? "Australian " : ""}voices`}
          </button>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <span id="w-greetings" className="text-[12.5px] font-medium text-ink">Ready-made greetings</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="w-greetings" data-list="greetings">
          {greetingsFor(value.industry, value.businessName, value.receptionistName).map((g) => {
            const on = (value.greeting.trim() || defaultGreeting(value.businessName, value.receptionistName)) === g.text;
            return (
              <button key={g.label} type="button" role="radio" aria-checked={on} onClick={() => onChange({ greeting: g.text })} className={cn("rounded-[6px] border px-3 py-2 text-left", on ? "border-indigo bg-[#efeeff]" : "border-hairline bg-white hover:bg-canvas-2")}>
                <span className="block text-[12.5px] font-medium text-ink">{g.label}</span>
                <span className="block text-[12px] leading-4 text-ink-muted">{g.text}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Greeting" htmlFor="w-greeting" hint="Pick one above or write your own. Leave blank to use the standard one. Keep the part that says it's an AI assistant. The recording notice is added only if call recording is on.">
        <Textarea id="w-greeting" rows={3} maxLength={300} placeholder={defaultGreeting(value.businessName, value.receptionistName)} value={value.greeting} onChange={(e) => onChange({ greeting: e.target.value })} />
      </Field>
    </>
  );
}
