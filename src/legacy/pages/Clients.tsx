import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatNumber, industry, type Business } from "../lib/shared";

function created(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function Clients() {
  const [clients, setClients] = useState<Business[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .clients()
      .then(setClients)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="clients">
      <div className="dash-head">
        <div>
          <p className="eyebrow">Your clients</p>
          <h1>Receptionists</h1>
        </div>
        {clients && clients.length > 0 && (
          <p className="muted">
            {clients.length} {clients.length === 1 ? "business" : "businesses"}
          </p>
        )}
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {!error && clients === null && <p className="muted center pad">Loading…</p>}

      {clients?.length === 0 && (
        <section className="card empty">
          <h2>No receptionists yet</h2>
          <p className="muted">
            Create one for each business you sign. Enter their name, hours and services, pick a voice, and it's ready
            to call from your browser in a couple of minutes.
          </p>
          <Link to="/new" className="btn btn-primary">
            Create your first receptionist
          </Link>
        </section>
      )}

      {clients && clients.length > 0 && (
        <ul className="client-grid">
          {clients.map((c) => (
            <li key={c.id}>
              <Link to={`/clients/${c.id}`} className="client-card">
                <span className="client-industry">{industry(c.settings.industry).label}</span>
                <span className="client-name">{c.settings.businessName}</span>
                <span className="client-meta">
                  {[c.settings.suburb, `Voice: ${c.settings.voiceName.split(" - ")[0]}`].filter(Boolean).join(" · ")}
                </span>
                <span className="client-foot">
                  {c.phoneNumbers?.length ? (
                    <span className="pill pill-on">{formatNumber(c.phoneNumbers[0])}</span>
                  ) : (
                    <span className="pill">No phone number</span>
                  )}
                  <span className="muted">Created {created(c.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link to="/new" className="client-card client-add">
              <span className="client-plus" aria-hidden>
                +
              </span>
              <span className="client-name">New receptionist</span>
              <span className="client-meta">Set one up for another business</span>
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
