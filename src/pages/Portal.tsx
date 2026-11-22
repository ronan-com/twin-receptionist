import { useEffect, useState } from "react";
import Wordmark from "../components/Wordmark";
import { accountApi, auth, portalApi } from "../lib/api";
import { formatNumber, type Account, type BookingRequest, type CalendarEvent, type CallMessage, type CallSummary, type PortalClient } from "../lib/shared";

// The end customer's view: every call, booking and follow-up their receptionist
// handled. Read-only; they never see the agency's dashboard.

const TABS = ["Calls", "Bookings", "Follow-ups"] as const;
type Tab = (typeof TABS)[number];

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};
const weekAgo = () => Date.now() - 7 * 86_400_000;

type Loaded = { calls: CallSummary[]; upcoming: CalendarEvent[]; requests: BookingRequest[] };

function CallRow({ clientId, call }: { clientId: string; call: CallSummary }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ summary: string; messages: CallMessage[] } | "loading" | "error" | null>(null);
  const texts = call.channel === "sms_chat";

  function toggle() {
    setOpen(!open);
    if (open || detail) return;
    setDetail("loading");
    portalApi
      .call(clientId, call.id)
      .then(setDetail)
      .catch(() => setDetail("error"));
  }

  return (
    <li>
      <button type="button" className="call-row" aria-expanded={open} onClick={toggle}>
        <span className="call-when">{when(call.startedAt)}</span>
        <span className="call-from">
          {texts ? "Texts with " : ""}
          {call.from ? formatNumber(call.from) : "Unknown number"}
        </span>
        <span className="call-chevron" aria-hidden>
          {open ? "–" : "+"}
        </span>
      </button>
      {open && (
        <div className="transcript">
          {detail === "loading" && <p className="muted">Loading…</p>}
          {detail === "error" && <p className="muted">Couldn't load this one. Try again in a moment.</p>}
          {typeof detail === "object" && detail?.summary && (
            <p className="call-summary">
              <span className="turn-who">Summary</span>
              {detail.summary}
            </p>
          )}
          {typeof detail === "object" && detail?.messages.length === 0 && <p className="muted">Nothing was said.</p>}
          {typeof detail === "object" &&
            detail?.messages.map((m, i) => (
              <p key={i} className={`turn turn-${m.role}`}>
                <span className="turn-who">{m.role === "assistant" ? "Receptionist" : texts ? "Them" : "Caller"}</span>
                {m.text}
              </p>
            ))}
        </div>
      )}
    </li>
  );
}

export default function Portal({ account }: { account: Account }) {
  const [clients, setClients] = useState<PortalClient[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [receptionist, setReceptionist] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Calls");

  useEffect(() => {
    portalApi
      .clients()
      .then((c) => {
        setClients(c);
        if (c[0]) setClientId(c[0].id);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  function load(id: string) {
    setData(null);
    setError("");
    Promise.all([portalApi.calls(id), portalApi.bookings(id)])
      .then(([c, b]) => {
        setReceptionist(c.receptionist);
        setData({ calls: c.calls, upcoming: b.upcoming, requests: b.requests });
      })
      .catch((err: Error) => setError(err.message));
  }
  useEffect(() => {
    if (clientId) load(clientId);
  }, [clientId]);

  async function signOut() {
    await auth.signOut().catch(() => {});
    window.location.replace("/");
  }

  const current = clients?.find((c) => c.id === clientId);
  const bookings = (data?.requests ?? []).filter((r) => r.kind === "booking" && r.status === "booked");
  const followUps = (data?.requests ?? []).filter((r) => r.kind === "callback");
  const callsThisWeek = (data?.calls ?? []).filter((c) => new Date(c.startedAt).getTime() > weekAgo()).length;
  const upcomingCount = (data?.upcoming ?? []).length || bookings.filter((b) => new Date(b.start).getTime() > Date.now()).length;

  return (
    <div className="app">
      <header className="app-top">
        <Wordmark to="/" />
        <div className="app-top-right">
          {clients && clients.length > 1 ? (
            <select className="org-switch" aria-label="Business" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.businessName}
                </option>
              ))}
            </select>
          ) : (
            <span className="app-biz">{current?.businessName}</span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">
        <div className="dash-head">
          <div>
            <p className="eyebrow">{current?.businessName ?? account.org?.name}</p>
            <h1>Your calls</h1>
          </div>
          {receptionist && <p className="muted">Answered by {receptionist}</p>}
        </div>

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        {clients?.length === 0 && (
          <section className="card empty">
            <h2>Nothing shared with you yet</h2>
            <p className="muted">Ask {account.org?.name} to share your receptionist with this login.</p>
          </section>
        )}
        {!error && clients === null && <p className="muted center pad">Loading…</p>}

        {current && (
          <>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-n">{data ? callsThisWeek : "–"}</span>
                <span className="stat-l">calls and texts this week</span>
              </div>
              <div className="stat">
                <span className="stat-n">{data ? upcomingCount : "–"}</span>
                <span className="stat-l">upcoming bookings</span>
              </div>
              <div className="stat">
                <span className="stat-n">{data ? followUps.length : "–"}</span>
                <span className="stat-l">follow-ups</span>
              </div>
            </div>

            <div className="segmented segmented-3 portal-tabs" role="tablist" aria-label="Sections">
              {TABS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>

            <section className="card">
              {!data && !error && <p className="muted">Loading…</p>}

              {data && tab === "Calls" &&
                (data.calls.length === 0 ? (
                  <p className="muted">No calls yet. When someone rings your number, it appears here with a summary and transcript.</p>
                ) : (
                  <ul className="calls">
                    {data.calls.map((c) => (
                      <CallRow key={c.id} clientId={current.id} call={c} />
                    ))}
                  </ul>
                ))}

              {data && tab === "Bookings" && (
                <>
                  {data.upcoming.length === 0 && bookings.length === 0 && (
                    <p className="muted">No bookings yet. Appointments the receptionist makes will show here.</p>
                  )}
                  {data.upcoming.length > 0 && (
                    <>
                      <h2>Upcoming</h2>
                      <ul className="portal-list">
                        {data.upcoming.map((e) => (
                          <li key={e.id}>
                            <strong>{e.title}</strong>
                            <span className="muted">{when(e.start)}</span>
                            {e.details && <span className="muted">{e.details}</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {bookings.length > 0 && (
                    <>
                      <h2>Booked by the receptionist</h2>
                      <ul className="portal-list">
                        {bookings.map((b) => (
                          <li key={b.id}>
                            <strong>
                              {b.name || "Customer"}
                              {b.service ? ` · ${b.service}` : ""}
                            </strong>
                            <span className="muted">{when(b.start)}</span>
                            {b.phone && (
                              <a className="muted" href={`tel:${b.phone}`}>
                                {formatNumber(b.phone)}
                              </a>
                            )}
                            {b.note && <span className="muted">{b.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}

              {data && tab === "Follow-ups" &&
                (followUps.length === 0 ? (
                  <p className="muted">Nothing to follow up. People who ask for a call back appear here.</p>
                ) : (
                  <ul className="portal-list">
                    {followUps.map((f) => (
                      <li key={f.id}>
                        <strong>{f.name || "Someone"} asked for a call back</strong>
                        {f.service && <span>{f.service}</span>}
                        {f.phone && (
                          <a href={`tel:${f.phone}`} className="portal-phone">
                            {formatNumber(f.phone)}
                          </a>
                        )}
                        <span className="muted">
                          {f.start ? `Best time: ${when(f.start)} · ` : ""}Received {when(f.at)}
                        </span>
                        {f.note && <span className="muted">{f.note}</span>}
                      </li>
                    ))}
                  </ul>
                ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
