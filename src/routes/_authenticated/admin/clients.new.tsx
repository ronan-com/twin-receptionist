import { useEffect, useState, type KeyboardEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Panel, Notice, ErrorState } from "@/components/app/primitives";
import { Field } from "@/components/app/forms";
import { cn } from "@/lib/utils";
import { companyApi, createReceptionist, getVoices } from "@/lib/api/console";
import {
  DAYS,
  INDUSTRIES,
  TIMEZONES,
  blankSettings,
  defaultGreeting,
  defaultHours,
  describeHours,
  industry,
  type DayKey,
  type IndustryKey,
  type Settings,
} from "@/lib/shared";
import { READ_ONLY_HINT, useConsole } from "./-shared";

// The receptionist setup wizard (ported from the old Twin Setup page): four short
// steps, then the existing POST /api/clients creates the phone assistant.
export const Route = createFileRoute("/_authenticated/admin/clients/new")({
  validateSearch: (s: Record<string, unknown>): { company?: string } => (typeof s.company === "string" && /^[a-f0-9-]{36}$/.test(s.company) ? { company: s.company } : {}),
  head: () => ({ meta: [{ title: "New receptionist — Answered admin" }] }),
  component: NewReceptionistPage,
});

const STEPS = ["Client and business", "Hours and services", "Voice", "Review"];
const NEW = "new";

function problem(step: number, s: Settings): string {
  if (step === 0 && s.businessName.trim().length < 2) return "Enter the business name.";
  if (step === 1) {
    if (s.services.length === 0) return "Add at least one service callers can ask for.";
    if (Object.values(s.hours).some((h) => h.open && h.from >= h.to)) return "Check the hours: closing time must be after opening time.";
    if (!Object.values(s.hours).some((h) => h.open)) return "Mark at least one day as open.";
  }
  if (step === 2 && !s.voiceId) return "Choose a voice.";
  return "";
}

function NewReceptionistPage() {
  const { ws, readOnly, orgName, platform } = useConsole();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<Settings>(blankSettings);
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
  const voicesQ = useQuery({ queryKey: ["console", "voices-raw"], queryFn: getVoices, staleTime: 5 * 60_000 });
  const voices = voicesQ.data ?? [];

  // Preselect the first recommended voice so the default can just be accepted.
  useEffect(() => {
    if (voices[0]) setSettings((s) => (s.voiceId ? s : { ...s, voiceId: voices[0].id, voiceName: voices[0].name }));
  }, [voices]);

  const patch = (p: Partial<Settings>) => {
    setError("");
    setSettings((s) => ({ ...s, ...p }));
  };

  function next() {
    const issue = problem(step, settings);
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
      const created = await createReceptionist(settings);
      await companyApi.attach(target, created.id);
      await qc.invalidateQueries({ queryKey: ["admin"] });
      await qc.invalidateQueries({ queryKey: ["console"] });
      await qc.invalidateQueries({ queryKey: ["businesses"] });
      toast.success(`${settings.businessName.trim()} is ready`, { description: "Share it with the business, or request a phone number." });
      void navigate({ to: "/admin/clients/$businessId", params: { businessId: target } });
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

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
        title={step === 3 ? "Check the details" : "New receptionist"}
        description={platform ? `Created in ${orgName || "your own team"}. Agencies create their own from their console.` : `For a business ${orgName || "your agency"} looks after.`}
      />

      <ol className="grid grid-cols-4 gap-2" aria-label="Setup progress">
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
            voicesQ.error ? <ErrorState message={(voicesQ.error as Error).message} onRetry={() => void voicesQ.refetch()} /> : <VoiceStep value={settings} onChange={patch} voices={voices} loading={voicesQ.isPending} />
          ) : null}
          {step === 3 ? (
            <dl className="divide-y divide-hairline text-[13px]" data-review>
              <ReviewRow label="Client">{chosen ? chosen.name : `${settings.businessName} (new)`}</ReviewRow>
              <ReviewRow label="Business">
                {settings.businessName}
                <span className="text-ink-muted"> · {industry(settings.industry).label}{settings.suburb ? ` · ${settings.suburb}` : ""}</span>
              </ReviewRow>
              <ReviewRow label="Hours">
                {describeHours(settings.hours).map((line) => (
                  <span key={line} className="block">{line}</span>
                ))}
              </ReviewRow>
              <ReviewRow label="Callers can ask for">{settings.services.join(", ")}</ReviewRow>
              <ReviewRow label="Voice">
                {settings.voiceName.split(" - ")[0]}
                <span className="text-ink-muted"> · {settings.tone === "friendly" ? "Friendly" : "Professional"}</span>
              </ReviewRow>
              <ReviewRow label="It answers with">“{greeting}”</ReviewRow>
            </dl>
          ) : null}
          {step === 3 ? <p className="text-[12px] text-ink-muted">Creating it takes a few seconds. You can change any of this afterwards and test it from your browser straight away.</p> : null}

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
            {step < 3 ? (
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

function BusinessStep({ value, onChange }: StepProps) {
  // During setup the hours and services follow the industry's preset.
  const pick = (key: IndustryKey) => onChange({ industry: key, services: [...industry(key).services], hours: defaultHours(key) });
  return (
    <>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">The business</h2>
        <p className="text-[12.5px] text-ink-muted">Who this receptionist answers the phone for.</p>
      </div>
      <Field label="Business name" htmlFor="w-name" required>
        <Input id="w-name" maxLength={80} placeholder="e.g. Bright Smile Dental" value={value.businessName} onChange={(e) => onChange({ businessName: e.target.value })} autoFocus />
      </Field>
      <div className="grid gap-1.5">
        <span id="w-industry" className="text-[12.5px] font-medium text-ink">What kind of business is it?</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="w-industry">
          {INDUSTRIES.map((i) => (
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

function HoursStep({ value, onChange }: StepProps) {
  const [draft, setDraft] = useState("");
  const full = value.services.length >= 12;
  const setDay = (day: DayKey, p: Partial<Settings["hours"][DayKey]>) => onChange({ hours: { ...value.hours, [day]: { ...value.hours[day], ...p } } });
  const add = () => {
    const next = draft.trim();
    if (!next || full) return;
    if (!value.services.some((s) => s.toLowerCase() === next.toLowerCase())) onChange({ services: [...value.services, next] });
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };
  return (
    <>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">When are they open?</h2>
        <p className="text-[12.5px] text-ink-muted">It only offers times inside these hours.</p>
      </div>
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
      <div>
        <h2 className="text-[15px] font-semibold text-ink">What do callers ask for?</h2>
        <p className="text-[12.5px] text-ink-muted">Common ones for a {industry(value.industry).noun}. Remove any that don't apply and add the business's own.</p>
      </div>
      <ul className="flex flex-wrap gap-1.5" data-list="services">
        {value.services.map((s) => (
          <li key={s} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas-2 py-0.5 pl-2.5 pr-1 text-[12.5px] text-ink">
            {s}
            <button type="button" aria-label={`Remove ${s}`} className="rounded-full p-0.5 text-ink-muted hover:bg-white hover:text-ink" onClick={() => onChange({ services: value.services.filter((x) => x !== s) })}>
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input maxLength={60} placeholder={full ? "That's the maximum of 12" : "Add another, then press Enter"} disabled={full} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} aria-label="Add a service" />
        <Button type="button" variant="outline" onClick={add} disabled={full || !draft.trim()}>
          Add
        </Button>
      </div>
      <Field label="Anything else callers often ask?" htmlFor="w-notes" hint="Optional. Parking, payment options, how long appointments take…">
        <Textarea id="w-notes" rows={4} maxLength={1500} value={value.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </>
  );
}

function VoiceStep({ value, onChange, voices, loading }: StepProps & { voices: { id: string; name: string; gender: string; recommended: boolean }[]; loading: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const recommended = voices.filter((v) => v.recommended);
  const chosenHidden = !showAll && value.voiceId && !recommended.some((v) => v.id === value.voiceId);
  const list = showAll || chosenHidden || recommended.length === 0 ? voices : recommended;
  return (
    <>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">Voice</h2>
        <p className="text-[12.5px] text-ink-muted">All of these are Australian voices.</p>
      </div>
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
          <p className="text-[12.5px] text-ink-muted">Loading Australian voices…</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="w-voice">
            {list.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={value.voiceId === v.id}
                onClick={() => onChange({ voiceId: v.id, voiceName: v.name })}
                className={cn("rounded-[6px] border px-3 py-2 text-left", value.voiceId === v.id ? "border-indigo bg-[#efeeff]" : "border-hairline bg-white hover:bg-canvas-2")}
              >
                <span className="block text-[13px] font-medium text-ink">{v.name.split(" - ")[0]}</span>
                <span className="block truncate text-[11.5px] text-ink-muted">
                  {v.gender}
                  {v.name.includes(" - ") ? ` · ${v.name.split(" - ")[1]}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
        {voices.length > recommended.length && recommended.length > 0 ? (
          <button type="button" className="justify-self-start text-[12.5px] text-indigo hover:underline" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer voices" : `Show all ${voices.length} Australian voices`}
          </button>
        ) : null}
      </div>
      <Field label="Greeting" htmlFor="w-greeting" hint="Leave blank to use the suggested greeting. Keep the part that says it's an AI assistant and that the call is recorded.">
        <Textarea id="w-greeting" rows={3} maxLength={300} placeholder={defaultGreeting(value.businessName, value.receptionistName)} value={value.greeting} onChange={(e) => onChange({ greeting: e.target.value })} />
      </Field>
    </>
  );
}
