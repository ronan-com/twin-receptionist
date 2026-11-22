import { useEffect, useState } from "react";
import { BusinessFields, HoursFields, NotesField, ServicesFields, VoiceFields } from "../components/fields";
import { api } from "../lib/api";
import {
  blankSettings,
  defaultGreeting,
  describeHours,
  industry,
  type Business,
  type Settings,
  type Voice,
} from "../lib/shared";

const STEPS = ["The business", "Hours and services", "Voice", "Review"];

function problem(step: number, s: Settings): string {
  if (step === 0 && s.businessName.trim().length < 2) return "Enter the business name.";
  if (step === 1) {
    if (s.services.length === 0) return "Add at least one service callers can ask for.";
    const bad = Object.values(s.hours).some((h) => h.open && h.from >= h.to);
    if (bad) return "Check the hours: closing time must be after opening time.";
    if (!Object.values(s.hours).some((h) => h.open)) return "Mark at least one day as open.";
  }
  if (step === 2 && !s.voiceId) return "Choose a voice.";
  return "";
}

export default function Setup({ onCreated }: { onCreated: (b: Business) => void }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<Settings>(blankSettings);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .voices()
      .then((list) => {
        setVoices(list);
        // Preselect the first recommended voice so the owner can accept the default.
        setSettings((s) => (s.voiceId || !list[0] ? s : { ...s, voiceId: list[0].id, voiceName: list[0].name }));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

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
      onCreated(await api.create(settings));
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  const greeting = settings.greeting.trim() || defaultGreeting(settings.businessName, settings.receptionistName);

  return (
    <div className="setup">
      <div className="setup-head">
        <p className="eyebrow">
          Step {step + 1} of {STEPS.length}
        </p>
        <h1>{step === 3 ? "Check the details" : "New receptionist"}</h1>
        <ol className="steps" aria-label="Setup progress">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? "is-current" : i < step ? "is-done" : ""}>
              <span className="steps-bar" />
              <span className="steps-label">{label}</span>
            </li>
          ))}
        </ol>
      </div>

      <section className="card setup-card">
        {step === 0 && (
          <>
            <h2>The business</h2>
            <p className="muted">Who this receptionist answers the phone for.</p>
            <BusinessFields value={settings} onChange={patch} resetOnIndustry />
          </>
        )}

        {step === 1 && (
          <>
            <h2>When are they open?</h2>
            <p className="muted">It only offers times inside these hours.</p>
            <HoursFields value={settings} onChange={patch} />
            <h2 className="gap-top">What do callers ask for?</h2>
            <p className="muted">
              These are common ones for a {industry(settings.industry).noun}. Remove any that don't apply and add
              the client's own.
            </p>
            <ServicesFields value={settings} onChange={patch} />
            <div className="gap-top">
              <NotesField value={settings} onChange={patch} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Voice</h2>
            <p className="muted">All of these are Australian voices.</p>
            <VoiceFields value={settings} onChange={patch} voices={voices} />
          </>
        )}

        {step === 3 && (
          <>
            <dl className="review">
              <div>
                <dt>Business</dt>
                <dd>
                  {settings.businessName}
                  <span className="muted">
                    {" "}
                    · {industry(settings.industry).label}
                    {settings.suburb ? ` · ${settings.suburb}` : ""}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Hours</dt>
                <dd>
                  {describeHours(settings.hours).map((line) => (
                    <span key={line} className="line">
                      {line}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt>Callers can ask for</dt>
                <dd>{settings.services.join(", ")}</dd>
              </div>
              <div>
                <dt>Voice</dt>
                <dd>
                  {settings.voiceName.split(" - ")[0]}
                  <span className="muted"> · {settings.tone === "friendly" ? "Friendly" : "Professional"}</span>
                </dd>
              </div>
              <div>
                <dt>It answers with</dt>
                <dd className="quote">“{greeting}”</dd>
              </div>
            </dl>
            <p className="hint">
              Creating it takes a few seconds. You can change any of this afterwards, and you can call it from your
              browser straight away.
            </p>
          </>
        )}

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        <div className="setup-actions">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" disabled={creating} onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <button type="button" className="btn btn-primary" onClick={next}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={creating} onClick={create}>
              {creating ? "Creating the receptionist…" : "Create receptionist"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
