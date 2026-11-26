import { useState, type KeyboardEvent } from "react";
import {
  DAYS,
  INDUSTRIES,
  TIMEZONES,
  defaultGreeting,
  defaultHours,
  industry,
  type DayKey,
  type IndustryKey,
  type Settings,
  type Voice,
} from "../lib/shared";

type Props = { value: Settings; onChange: (patch: Partial<Settings>) => void };

export function BusinessFields({ value, onChange, resetOnIndustry }: Props & { resetOnIndustry?: boolean }) {
  function pickIndustry(key: IndustryKey) {
    // During first-time setup the hours and services follow the industry preset.
    // When editing later, changing industry leaves the saved lists alone.
    onChange(
      resetOnIndustry
        ? { industry: key, services: [...industry(key).services], hours: defaultHours(key) }
        : { industry: key },
    );
  }

  return (
    <div className="stack">
      <label className="field">
        <span>Business name</span>
        <input
          type="text"
          maxLength={80}
          placeholder="e.g. Bright Smile Dental"
          value={value.businessName}
          onChange={(e) => onChange({ businessName: e.target.value })}
        />
      </label>

      <div className="field">
        <span id="industry-label">What kind of business is it?</span>
        <div className="choice-grid" role="radiogroup" aria-labelledby="industry-label">
          {INDUSTRIES.map((i) => (
            <button
              key={i.key}
              type="button"
              role="radio"
              aria-checked={value.industry === i.key}
              className={`choice ${value.industry === i.key ? "is-on" : ""}`}
              onClick={() => pickIndustry(i.key)}
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>

      <div className="row-2">
        <label className="field">
          <span>Suburb or town</span>
          <input
            type="text"
            maxLength={60}
            placeholder="e.g. Paddington"
            value={value.suburb}
            onChange={(e) => onChange({ suburb: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Time zone</span>
          <select value={value.timezone} onChange={(e) => onChange({ timezone: e.target.value })}>
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>
          Street address <em>optional</em>
        </span>
        <input
          type="text"
          maxLength={140}
          placeholder="So callers can ask where you are"
          value={value.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </label>
    </div>
  );
}

export function HoursFields({ value, onChange }: Props) {
  function setDay(day: DayKey, patch: Partial<Settings["hours"][DayKey]>) {
    onChange({ hours: { ...value.hours, [day]: { ...value.hours[day], ...patch } } });
  }

  return (
    <div className="hours">
      {DAYS.map((d) => {
        const h = value.hours[d.key];
        return (
          <div key={d.key} className={`hours-row ${h.open ? "" : "is-closed"}`}>
            <label className="check">
              <input type="checkbox" checked={h.open} onChange={(e) => setDay(d.key, { open: e.target.checked })} />
              <span>{d.label}</span>
            </label>
            {h.open ? (
              <div className="hours-times">
                <input
                  type="time"
                  aria-label={`${d.label} opens`}
                  value={h.from}
                  onChange={(e) => setDay(d.key, { from: e.target.value })}
                />
                <span className="muted">to</span>
                <input
                  type="time"
                  aria-label={`${d.label} closes`}
                  value={h.to}
                  onChange={(e) => setDay(d.key, { to: e.target.value })}
                />
              </div>
            ) : (
              <span className="muted">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ServicesFields({ value, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const full = value.services.length >= 12;

  function add() {
    const next = draft.trim();
    if (!next || full) return;
    if (!value.services.some((s) => s.toLowerCase() === next.toLowerCase())) {
      onChange({ services: [...value.services, next] });
    }
    setDraft("");
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  }

  return (
    <div className="stack-sm">
      <ul className="chips">
        {value.services.map((s) => (
          <li key={s} className="chip">
            {s}
            <button
              type="button"
              aria-label={`Remove ${s}`}
              onClick={() => onChange({ services: value.services.filter((x) => x !== s) })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="add-row">
        <input
          type="text"
          maxLength={60}
          placeholder={full ? "That's the maximum of 12" : "Add another, then press Enter"}
          disabled={full}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="button" className="btn btn-secondary" onClick={add} disabled={full || !draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

export function NotesField({ value, onChange }: Props) {
  return (
    <label className="field">
      <span>
        Anything else callers often ask this business? <em>optional</em>
      </span>
      <textarea
        rows={4}
        maxLength={1500}
        placeholder={"e.g. Parking is behind the building.\nWe accept all major health funds.\nNew patient check-ups take 45 minutes."}
        value={value.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
      />
    </label>
  );
}

export function VoiceFields({ value, onChange, voices }: Props & { voices: Voice[] }) {
  const [showAll, setShowAll] = useState(false);
  const recommended = voices.filter((v) => v.recommended);
  // Keep the chosen voice visible even if it is outside the short list.
  const chosenIsHidden = !showAll && value.voiceId && !recommended.some((v) => v.id === value.voiceId);
  const list = showAll || chosenIsHidden || recommended.length === 0 ? voices : recommended;
  const suggested = defaultGreeting(value.businessName, value.receptionistName);

  return (
    <div className="stack">
      <div className="row-2">
        <label className="field">
          <span>
            Receptionist's name <em>optional</em>
          </span>
          <input
            type="text"
            maxLength={30}
            placeholder="e.g. Grace"
            value={value.receptionistName}
            onChange={(e) => onChange({ receptionistName: e.target.value })}
          />
        </label>
        <div className="field">
          <span id="tone-label">How should it sound?</span>
          <div className="segmented" role="radiogroup" aria-labelledby="tone-label">
            {(["friendly", "professional"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={value.tone === t}
                className={value.tone === t ? "is-on" : ""}
                onClick={() => onChange({ tone: t })}
              >
                {t === "friendly" ? "Friendly" : "Professional"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <span id="voice-label">Voice</span>
        {voices.length === 0 ? (
          <p className="muted">Loading Australian voices…</p>
        ) : (
          <div className="voice-grid" role="radiogroup" aria-labelledby="voice-label">
            {list.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={value.voiceId === v.id}
                className={`voice ${value.voiceId === v.id ? "is-on" : ""}`}
                onClick={() => onChange({ voiceId: v.id, voiceName: v.name })}
              >
                <span className="voice-name">{v.name.split(" - ")[0]}</span>
                <span className="voice-meta">
                  {v.gender}
                  {v.name.includes(" - ") ? ` · ${v.name.split(" - ")[1]}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
        {voices.length > recommended.length && recommended.length > 0 && (
          <button type="button" className="link" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer voices" : `Show all ${voices.length} Australian voices`}
          </button>
        )}
        <p className="hint">You'll hear the voice on a test call as soon as the receptionist is created.</p>
      </div>

      <label className="field">
        <span>Greeting</span>
        <textarea
          rows={3}
          maxLength={300}
          placeholder={suggested}
          value={value.greeting}
          onChange={(e) => onChange({ greeting: e.target.value })}
        />
        <span className="hint">
          Leave this blank to use the suggested greeting above. Keep the part that says it's an AI assistant.
          The recording notice is added only if call recording is on.
        </span>
      </label>
    </div>
  );
}
