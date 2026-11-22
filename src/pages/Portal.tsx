import { useEffect, useState } from "react";
import Wordmark from "../components/Wordmark";
import { accountApi, auth, portalApi } from "../lib/api";
import { formatNumber, type Account, type BookingRequest, type CalendarEvent, type CallMessage, type CallSummary, type PortalClient } from "../lib/shared";

// The end customer's view: every call, booking and follow-up their receptionist
// handled. Read-only; they never see the agency's dashboard.

const TABS = ["Calls", "Bookings", "Follow-ups", "Reports"] as const;
type Tab = (typeof TABS)[number];

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};
const RANGES = [
  ["Today", 1],
  ["7 days", 7],
  ["30 days", 30],
  ["90 days", 90],
] as const;
// "Today" means since midnight; the others are rolling windows.
const since = (days: number) => (days === 1 ? new Date().setHours(0, 0, 0, 0) : Date.now() - days * 86_400_000);
const digits = (s: string) => s.replace(/\D/g, "");
// "+61498765432" and "0498 765 432" are the same number.
const national = (s: string) => {
  const d = digits(s);
  return d.startsWith("61") ? `0${d.slice(2)}` : d;
};

type Outcome = "Booked" | "Follow-up" | "Texts" | "Answered";
// A call is "Booked" or "Follow-up" when the receptionist logged one for the same number at about that time.
function outcomeOf(c: CallSummary, reqs: BookingRequest[]): Outcome {
  if (c.channel === "sms_chat") return "Texts";
  const t = new Date(c.startedAt).getTime();
  const near = reqs.find((r) => r.phone && c.from && national(r.phone) === national(c.from) && Math.abs(new Date(r.at).getTime() - t) < 45 * 60_000);
  if (near?.kind === "booking" && near.status === "booked") return "Booked";
  if (near?.kind === "callback") return "Follow-up";
  return "Answered";
}
const OUTCOME_CLASS: Record<Outcome, string> = { Booked: "pill-on", "Follow-up": "pill-warn", Texts: "", Answered: "" };
const STAGES = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["won", "Won"],
  ["lost", "Lost"],
] as const;

function download(name: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input type="search" className="portal-search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

type Loaded = { calls: CallSummary[]; upcoming: CalendarEvent[]; requests: BookingRequest[] };

function CallRow({ clientId, call, outcome }: { clientId: string; call: CallSummary; outcome: Outcome }) {
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
        <span className={`pill call-outcome ${OUTCOME_CLASS[outcome]}`}>{outcome}</span>
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
  const [range, setRange] = useState<number>(30);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"List" | "Week">("List");
  const [stages, setStages] = useState<Record<string, string>>({});

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
  const from = since(range);
  const needle = q.trim().toLowerCase();
  const hit = (...parts: string[]) => !needle || parts.some((p) => p.toLowerCase().includes(needle) || (digits(needle).length > 2 && national(p).includes(national(needle))));
  const inRange = (iso: string) => new Date(iso).getTime() >= from;

  const calls = (data?.calls ?? []).filter((c) => inRange(c.startedAt) && hit(c.from, c.channel === "sms_chat" ? "text" : "call"));
  const allBookings = (data?.requests ?? []).filter((r) => r.kind === "booking" && r.status === "booked");
  const bookings = allBookings.filter((b) => inRange(b.at) && hit(b.name, b.phone, b.service));
  const followUps = (data?.requests ?? []).filter((r) => r.kind === "callback" && inRange(r.at) && hit(r.name, r.phone, r.service, r.note));
  const upcoming = (data?.upcoming ?? []).filter((e) => hit(e.title, e.details));
  const upcomingCount = (data?.upcoming ?? []).length || allBookings.filter((b) => new Date(b.start).getTime() > Date.now()).length;
  const rangeLabel = RANGES.find((r) => r[1] === range)?.[0].toLowerCase() ?? "";

  // Bookings for the week view: the built-in calendar if there is one, otherwise what the receptionist logged.
  const weekItems = (data?.upcoming.length
    ? data.upcoming.map((e) => ({ id: e.id, start: e.start, title: e.title, sub: e.details }))
    : allBookings.filter((b) => b.start).map((b) => ({ id: b.id, start: b.start, title: `${b.name || "Customer"}${b.service ? ` · ${b.service}` : ""}`, sub: b.phone ? formatNumber(b.phone) : "" }))
  ).filter((it) => hit(it.title, it.sub));

  // Reports: everything in the time range, not narrowed by the search box.
  const inWindow = (data?.calls ?? []).filter((c) => inRange(c.startedAt));
  const report = (() => {
    const counts: Record<Outcome, number> = { Answered: 0, Booked: 0, "Follow-up": 0, Texts: 0 };
    const perHour = new Array(24).fill(0);
    const step = range > 31 ? 7 : 1;
    const n = range === 1 ? 1 : Math.ceil(range / step);
    const buckets = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (n - 1 - i) * step * 86_400_000);
      return { n: 0, label: d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) };
    });
    for (const c of inWindow) {
      counts[outcomeOf(c, data?.requests ?? [])]++;
      const t = new Date(c.startedAt);
      perHour[t.getHours()]++;
      const idx = n - 1 - Math.min(n - 1, Math.floor((Date.now() - t.getTime()) / (step * 86_400_000)));
      buckets[idx].n++;
    }
    const best = perHour.indexOf(Math.max(...perHour));
    const fmt = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString("en-AU", { hour: "numeric" }).toLowerCase();
    return {
      counts,
      buckets,
      total: inWindow.length,
      max: Math.max(1, ...buckets.map((b) => b.n)),
      peak: inWindow.length ? { label: `${fmt(best)} to ${fmt((best + 1) % 24)}`, n: perHour[best] } : null,
    };
  })();

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
          <div className="portal-range segmented segmented-4" role="radiogroup" aria-label="Time range">
            {RANGES.map(([label, days]) => (
              <button key={days} type="button" role="radio" aria-checked={range === days} className={range === days ? "is-on" : ""} onClick={() => setRange(days)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {receptionist && <p className="muted portal-by">Answered by {receptionist}</p>}

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
                <span className="stat-n">{data ? (data.calls ?? []).filter((c) => inRange(c.startedAt)).length : "–"}</span>
                <span className="stat-l">calls and texts, {rangeLabel === "today" ? "today" : `last ${rangeLabel}`}</span>
              </div>
              <div className="stat">
                <span className="stat-n">{data ? upcomingCount : "–"}</span>
                <span className="stat-l">upcoming bookings</span>
              </div>
              <div className="stat">
                <span className="stat-n">{data ? (data.requests ?? []).filter((r) => r.kind === "callback" && inRange(r.at)).length : "–"}</span>
                <span className="stat-l">follow-ups, {rangeLabel === "today" ? "today" : `last ${rangeLabel}`}</span>
              </div>
            </div>

            <div className="segmented segmented-4 portal-tabs" role="tablist" aria-label="Sections">
              {TABS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => { setTab(t); setQ(""); }}>
                  {t}
                </button>
              ))}
            </div>

            <section className="card">
              {!data && !error && <p className="muted">Loading…</p>}

              {data && tab !== "Reports" && (
                <div className="portal-tools">
                  <Search
                    value={q}
                    onChange={setQ}
                    placeholder={tab === "Calls" ? "Search by phone number" : "Search name, phone or service"}
                  />
                  {tab === "Bookings" && (
                    <div className="segmented segmented-2 portal-view" role="radiogroup" aria-label="View">
                      {(["List", "Week"] as const).map((v) => (
                        <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? "is-on" : ""} onClick={() => setView(v)}>
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                  {tab !== "Bookings" && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        tab === "Calls"
                          ? download("calls.csv", [["When", "Type", "Number", "Outcome"], ...calls.map((c) => [c.startedAt, c.channel === "sms_chat" ? "Text" : "Call", c.from, outcomeOf(c, data.requests)])])
                          : download("follow-ups.csv", [["Received", "Name", "Phone", "Reason", "Best time", "Stage", "Note"], ...followUps.map((f) => [f.at, f.name, f.phone, f.service, f.start, f.stage ?? "new", f.note])])
                      }
                    >
                      Export CSV
                    </button>
                  )}
                </div>
              )}

              {data && tab === "Calls" &&
                (calls.length === 0 ? (
                  <p className="muted">
                    {data.calls.length === 0
                      ? "No calls yet. When someone rings your number, it appears here with a summary and transcript."
                      : "Nothing matches. Try a wider time range or clear the search."}
                  </p>
                ) : (
                  <ul className="calls">
                    {calls.map((c) => (
                      <CallRow key={c.id} clientId={current.id} call={c} outcome={outcomeOf(c, data.requests)} />
                    ))}
                  </ul>
                ))}

              {data && tab === "Bookings" && view === "Week" && (
                <ul className="week">
                  {Array.from({ length: 7 }, (_, i) => {
                    const day = new Date();
                    day.setHours(0, 0, 0, 0);
                    day.setDate(day.getDate() + i);
                    const key = day.toDateString();
                    const items = weekItems.filter((it) => new Date(it.start).toDateString() === key).sort((a, b) => a.start.localeCompare(b.start));
                    return (
                      <li key={key} className="week-day">
                        <span className="week-date">
                          <strong>{i === 0 ? "Today" : day.toLocaleDateString("en-AU", { weekday: "short" })}</strong>
                          <span className="muted">{day.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                        </span>
                        <span className="week-items">
                          {items.length === 0 && <span className="muted">Nothing booked</span>}
                          {items.map((it) => (
                            <span key={it.id} className="week-item">
                              <strong>{new Date(it.start).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</strong> {it.title}
                              {it.sub && <span className="muted"> · {it.sub}</span>}
                            </span>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {data && tab === "Bookings" && view === "List" && (
                <>
                  {upcoming.length === 0 && bookings.length === 0 && (
                    <p className="muted">
                      {data.upcoming.length === 0 && allBookings.length === 0
                        ? "No bookings yet. Appointments the receptionist makes will show here."
                        : "Nothing matches. Try a wider time range or clear the search."}
                    </p>
                  )}
                  {upcoming.length > 0 && (
                    <>
                      <h2>Upcoming</h2>
                      <ul className="portal-list">
                        {upcoming.map((e) => (
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
                  <p className="muted">
                    {(data.requests ?? []).some((r) => r.kind === "callback")
                      ? "Nothing matches. Try a wider time range or clear the search."
                      : "Nothing to follow up. People who ask for a call back appear here."}
                  </p>
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
                        <label className="stage-pick">
                          <span className="muted">Status</span>
                          <select
                            aria-label={`Status for ${f.name || "follow-up"}`}
                            value={stages[f.id] ?? f.stage ?? "new"}
                            onChange={(e) => {
                              const next = e.target.value;
                              setStages((m) => ({ ...m, [f.id]: next }));
                              portalApi.setStage(current.id, f.id, next).catch((err: Error) => {
                                setStages((m) => ({ ...m, [f.id]: f.stage ?? "new" }));
                                setError(err.message);
                              });
                            }}
                          >
                            {STAGES.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                ))}

              {data && tab === "Reports" && (
                <div className="report stack">
                  <div className="report-tiles">
                    {(["Answered", "Booked", "Follow-up", "Texts"] as const).map((o) => (
                      <div key={o} className="stat">
                        <span className="stat-n">{o === "Answered" ? report.counts.Answered + report.counts.Booked + report.counts["Follow-up"] : report.counts[o]}</span>
                        <span className="stat-l">{o === "Answered" ? "calls answered" : o === "Booked" ? "booked by the receptionist" : o === "Follow-up" ? "asked for a call back" : "text conversations"}</span>
                      </div>
                    ))}
                  </div>
                  <h2>{range <= 31 ? "Calls and texts per day" : "Calls and texts per week"}</h2>
                  {report.total === 0 ? (
                    <p className="muted">No calls in this time range.</p>
                  ) : (
                    <>
                      <div className="bars" role="img" aria-label="Calls and texts over time">
                        {report.buckets.map((b, i) => (
                          <span key={i} className="bar-col" title={`${b.label}: ${b.n}`}>
                            <span className="bar" style={{ height: `${Math.max(4, (b.n / report.max) * 100)}%` }} />
                          </span>
                        ))}
                      </div>
                      <p className="muted bars-axis">
                        <span>{report.buckets[0]?.label}</span>
                        <span>{report.buckets[report.buckets.length - 1]?.label}</span>
                      </p>
                      {report.peak && (
                        <p>
                          Busiest time: <strong>{report.peak.label}</strong> <span className="muted">({report.peak.n} {report.peak.n === 1 ? "call" : "calls"})</span>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
