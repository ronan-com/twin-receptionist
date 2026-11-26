import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { formatNumber, type BookingProvider, type BookingState } from "../lib/shared";

const MINUTES = [15, 20, 30, 45, 60, 90];
const PROVIDERS: { value: BookingProvider; label: string; hint: string }[] = [
  {
    value: "builtin",
    label: "Built-in calendar",
    hint: "Nothing to connect. Appointments are listed here and emailed to the business. Good for businesses without an online calendar, and for demos.",
  },
  {
    value: "google",
    label: "Google Calendar",
    hint: "Books into the business's own Google Calendar and avoids times they're already busy. You or the business signs in with Google next.",
  },
  {
    value: "microsoft",
    label: "Outlook",
    hint: "Books into the business's Outlook or Microsoft 365 calendar and avoids times they're already busy. You or the business signs in with Microsoft next.",
  },
];
const NAME: Record<BookingProvider, string> = { builtin: "Built-in calendar", google: "Google Calendar", microsoft: "Outlook calendar" };

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// The page comes back from "Sign in with Google/Microsoft" with ?calendar=1 or ?error=...
function takeReturnParams(): { connected: boolean; error: string } {
  const params = new URLSearchParams(window.location.search);
  const result = { connected: params.get("calendar") === "1", error: params.get("error") ?? "" };
  if (params.has("calendar") || params.has("error")) window.history.replaceState(null, "", window.location.pathname);
  return result;
}

export default function BookingCard({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const [state, setState] = useState<BookingState | null>(null);
  const [provider, setProvider] = useState<BookingProvider>("builtin");
  const [minutes, setMinutes] = useState(30);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [leadWebhook, setLeadWebhook] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api
      .booking(clientId)
      .then((s) => {
        setState(s);
        setNotifyEmail(s.setup?.notifyEmail ?? "");
        setLeadWebhook(s.setup?.leadWebhook ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  useEffect(() => {
    const back = takeReturnParams();
    if (back.connected) setNote("Calendar connected.");
    if (back.error) setError(back.error);
    load();
  }, [load]);

  async function run(label: string, action: () => Promise<BookingState>, changesScript = true, done = "") {
    setBusy(label);
    setError("");
    setNote("");
    try {
      const next = await action();
      setState(next);
      setNotifyEmail(next.setup?.notifyEmail ?? "");
      setLeadWebhook(next.setup?.leadWebhook ?? "");
      if (done) setNote(done);
      if (changesScript) onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function runTest() {
    setBusy("test");
    setError("");
    setNote("");
    try {
      const { result } = await api.testBooking(clientId);
      const r = result as { day?: string; open?: boolean; slots?: { time: string }[]; message?: string; error?: string };
      if (r.error) setNote(r.error);
      else if (!r.open || !r.slots?.length) setNote(`${r.day}: ${r.message}`);
      else setNote(`Working. Free on ${r.day}: ${r.slots.map((s) => s.time).join(", ")}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function saveNotices(event: FormEvent) {
    event.preventDefault();
    run("notices", () => api.changeBooking(clientId, { notifyEmail, leadWebhook }), false, "Saved.");
  }

  const setup = state?.setup;
  const linked = setup && setup.provider !== "builtin";
  const calendarReady = setup && (setup.provider === "builtin" || (state?.calendar && !state.calendar.lastError));
  const signInReady = (p: BookingProvider) => p === "builtin" || Boolean(state?.signIn[p]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Calendar and bookings</h2>
        {state && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
            Refresh
          </button>
        )}
      </div>

      {state === null && !error && <p className="muted">Checking…</p>}

      {state && !setup && (
        <div className="stack">
          <p className="muted">
            Let the receptionist see free times and book them on calls and texts. Callback requests are saved too, and the
            business gets an email for each one.
          </p>
          <div className="segmented segmented-3" role="radiogroup" aria-label="Calendar">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={provider === p.value}
                className={provider === p.value ? "is-on" : ""}
                onClick={() => setProvider(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {PROVIDERS.find((p) => p.value === provider)!.hint}
            {!signInReady(provider) &&
              ` Not available on this server yet: it needs ${provider === "google" ? "Google" : "Microsoft"} sign-in set up.`}
          </p>
          <div className="field-row">
            <label className="field">
              <span>Appointment length</span>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Email each booking to</span>
              <input
                type="email"
                placeholder="owner@theirbusiness.com.au"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
              />
            </label>
          </div>
          <div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== "" || !signInReady(provider)}
              onClick={() => run("create", () => api.setUpBooking(clientId, { provider, minutes, notifyEmail }))}
            >
              {busy === "create" ? "Setting up…" : provider === "builtin" ? "Turn on booking" : "Next: connect the calendar"}
            </button>
          </div>
        </div>
      )}

      {setup && state && (
        <div className="stack">
          <ul className="numbers">
            <li>
              <span>
                {NAME[setup.provider]} · {setup.minutes} min appointments
              </span>
              <span className={`pill ${state.live && calendarReady ? "pill-on" : state.calendar?.lastError ? "pill-bad" : ""}`}>
                {!setup.enabled
                  ? "Switched off"
                  : linked && !state.calendar
                    ? "Calendar not connected"
                    : state.calendar?.lastError
                      ? "Calendar problem"
                      : !state.publicUrl
                        ? "Needs public address"
                        : "Booking live"}
              </span>
            </li>
          </ul>

          {linked && !state.calendar && (
            <div className="notice notice-wait stack-sm" role="status">
              <span>
                Connect the business's {setup.provider === "google" ? "Google" : "Outlook"} calendar. Sign in here with their
                account, or send them their connect link (in the Email card) and they can do it themselves. Until then the
                receptionist takes callback requests instead of booking.
              </span>
              <span>
                <a className="btn btn-primary btn-sm" href={`/api/clients/${clientId}/calendar/signin/${setup.provider}`}>
                  Sign in with {setup.provider === "google" ? "Google" : "Microsoft"}
                </a>
              </span>
            </div>
          )}
          {linked && state.calendar && (
            <p className="hint">
              Connected to {state.calendar.account}'s main calendar.{" "}
              <button
                type="button"
                className="link"
                disabled={busy !== ""}
                onClick={() => {
                  if (window.confirm("Disconnect this calendar? The receptionist will take callback requests instead of booking.")) {
                    run("disconnect", () => api.disconnectCalendar(clientId));
                  }
                }}
              >
                Disconnect
              </button>
            </p>
          )}
          {state.calendar?.lastError && (
            <div className="notice notice-error" role="alert">
              {state.calendar.lastError}
            </div>
          )}
          {!state.publicUrl && (
            <div className="notice notice-wait" role="status">
              The phone service can't reach this server yet, so the receptionist won't book on calls. On a laptop, run{" "}
              <code>bun run tunnel</code> in the twin-receptionist folder; in the cloud, set <code>PUBLIC_URL</code>.
            </div>
          )}

          <div className="booking-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={runTest}>
              {busy === "test" ? "Checking…" : "Test calendar"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== ""}
              onClick={() => run("toggle", () => api.changeBooking(clientId, { enabled: !setup.enabled }))}
            >
              {setup.enabled ? "Switch off booking" : "Switch on booking"}
            </button>
            <select
              aria-label="Appointment length"
              value={setup.minutes}
              disabled={busy !== ""}
              onChange={(e) => run("minutes", () => api.changeBooking(clientId, { minutes: Number(e.target.value) }))}
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>

          <form className="stack-sm" onSubmit={saveNotices}>
            <h3 className="subhead">Who hears about bookings</h3>
            <label className="field">
              <span>Email each booking and callback to</span>
              <input
                type="email"
                placeholder="owner@theirbusiness.com.au"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
              />
              {!state.emailReady && notifyEmail && (
                <span className="hint">This server can't send email yet (SMTP_URL isn't set), so these aren't going out.</span>
              )}
            </label>
            <details className="advanced" open={Boolean(setup.leadWebhook)}>
              <summary>Send them to a CRM too</summary>
              <label className="field">
                <span>Webhook address</span>
                <input
                  type="url"
                  placeholder="https://hooks.zapier.com/…"
                  value={leadWebhook}
                  onChange={(e) => setLeadWebhook(e.target.value)}
                />
                <span className="hint">
                  Every booking and callback is POSTed here as JSON. Works with HubSpot, GoHighLevel, Zapier, Make or anything
                  that takes a webhook.
                  {state.webhookSecret &&
                    ` To check a request is genuine, compare the X-Twin-Signature header with an HMAC-SHA256 of the body using this key: ${state.webhookSecret}`}
                </span>
              </label>
            </details>
            <div>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== ""}>
                {busy === "notices" ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {note && (
        <div className="notice notice-ok" role="status">
          {note}
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {setup && state && setup.provider === "builtin" && (
        <>
          <h3 className="subhead">Coming appointments</h3>
          {state.upcoming.length === 0 ? (
            <p className="muted">None booked.</p>
          ) : (
            <ul className="requests">
              {state.upcoming.map((e) => (
                <li key={e.id}>
                  <span className="pill pill-on">{when(e.start)}</span>
                  <span className="request-main">
                    <strong>{e.title}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy !== ""}
                    onClick={() => {
                      if (window.confirm(`Cancel ${e.title} on ${when(e.start)}? This frees the time; it doesn't tell the customer.`)) {
                        run(`cancel-${e.id}`, () => api.cancelAppointment(clientId, e.id), false);
                      }
                    }}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {setup && state && (
        <>
          <h3 className="subhead">Bookings and callbacks taken</h3>
          {state.requests.length === 0 && <p className="muted">None yet. Book something in the Text tab above to try it.</p>}
          {state.requests.length > 0 && (
            <ul className="requests">
              {state.requests.slice(0, 15).map((r) => (
                <li key={r.id}>
                  <span className={`pill ${r.status === "failed" ? "pill-bad" : "pill-on"}`}>
                    {r.kind === "callback" ? "Call back" : r.status === "booked" ? "Booked" : "Not booked"}
                  </span>
                  <span className="request-main">
                    <strong>{r.name || "No name"}</strong> · {formatNumber(r.phone)}
                    <span className="muted">
                      {" "}
                      · {r.service || "—"}
                      {r.kind === "booking" && r.start ? ` · ${when(r.start)}` : r.start ? ` · prefers ${r.start}` : ""}
                    </span>
                    {r.note && <span className="request-note">{r.note}</span>}
                  </span>
                  <span className="request-when">
                    {when(r.at)} · {r.channel === "sms" ? "text" : r.channel === "web" ? "website chat" : "call"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="link"
            disabled={busy !== ""}
            onClick={() => {
              if (window.confirm("Turn off booking and remove this calendar? Appointments already made stay in the calendar.")) {
                run("remove", () => api.removeBooking(clientId));
              }
            }}
          >
            Remove calendar
          </button>
        </>
      )}
    </section>
  );
}
