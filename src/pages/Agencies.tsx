import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../lib/api";
import type { Agency } from "../lib/shared";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

export default function Agencies() {
  const [agencies, setAgencies] = useState<Agency[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [link, setLink] = useState<{ who: string; url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    adminApi
      .agencies()
      .then(setAgencies)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    run("create", async () => {
      const result = await adminApi.create({ name: name.trim(), ownerEmail: ownerEmail.trim() });
      setLink({ who: ownerEmail.trim(), ...result });
      setCopied(false);
      setName("");
      setOwnerEmail("");
      setAgencies(await adminApi.agencies());
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <div className="team stack">
      <Link to="/" className="back">
        ← All receptionists
      </Link>
      <div className="dash-head">
        <div>
          <p className="eyebrow">Platform</p>
          <h1>Agencies</h1>
        </div>
        {agencies && <p className="muted">{agencies.length} total</p>}
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <section className="card stack">
        <h2>Invite an agency</h2>
        <p className="muted">
          Creates the agency's own dashboard and invites its owner. They sign up from the link and bring their own clients
          and team. Calls run on our API.
        </p>
        <form onSubmit={create} className="stack">
          <div className="field-row">
            <label className="field">
              <span>Agency name</span>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Owner's email</span>
              <input type="email" required autoComplete="off" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
            </label>
          </div>
          <div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== ""}>
              {busy === "create" ? "Creating…" : "Create and invite"}
            </button>
          </div>
        </form>
        {link && (
          <div className="stack-sm">
            <p className="muted">
              {link.emailed
                ? `Invite emailed to ${link.who}. You can also send them this link:`
                : `Send ${link.who} this link. (Invite emails aren't set up on this server yet.)`}
            </p>
            <div className="link-box">
              <input type="text" readOnly value={link.url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>All agencies</h2>
        {!agencies && !error && <p className="muted">Loading…</p>}
        {agencies && (
          <ul className="members">
            {agencies.map((a) => (
              <li key={a.id}>
                <span className="member-who">
                  <strong>
                    {a.name} {a.suspended && <span className="pill">Paused</span>}
                  </strong>
                  <span className="muted">
                    {a.clients} {a.clients === 1 ? "client" : "clients"} · {a.members} {a.members === 1 ? "person" : "people"} ·{" "}
                    since {day(a.createdAt)}
                  </span>
                  <span className="muted">
                    {a.owners.length ? `Owner: ${a.owners.join(", ")}` : "No owner yet"}
                    {a.pendingInvites.length ? ` · Invited: ${a.pendingInvites.join(", ")}` : ""}
                  </span>
                </span>
                <span className="row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy !== ""}
                    onClick={() => {
                      const email = window.prompt(`Send a new owner invite for ${a.name} to:`, a.pendingInvites[0] ?? "");
                      if (!email) return;
                      run(`inv-${a.id}`, async () => {
                        const result = await adminApi.inviteOwner(a.id, email.trim());
                        setLink({ who: email.trim(), ...result });
                        setCopied(false);
                        setAgencies(await adminApi.agencies());
                      });
                    }}
                  >
                    New owner invite
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy !== ""}
                    onClick={() => {
                      if (!a.suspended && !window.confirm(`Pause ${a.name}? Its people are signed out and its receptionists stop booking and replying to email.`)) return;
                      run(`sus-${a.id}`, async () => setAgencies(await adminApi.update(a.id, { suspended: !a.suspended })));
                    }}
                  >
                    {a.suspended ? "Resume" : "Pause"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
