import { useEffect, useState, type FormEvent } from "react";
import { adminApi, customerApi } from "../lib/api";
import { useAccount } from "../lib/account";
import type { CustomerAccess } from "../lib/shared";

// Share this receptionist's calls with the business it answers for. They get their
// own read-only login: calls, bookings and follow-ups, nothing else.
export default function CustomerAccessCard({
  clientId,
  businessName,
  onChanged,
}: {
  clientId: string;
  businessName: string;
  onChanged: (a: CustomerAccess) => void;
}) {
  const account = useAccount();
  const [access, setAccess] = useState<CustomerAccess | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  function set(a: CustomerAccess) {
    setAccess(a);
    onChanged(a);
  }

  useEffect(() => {
    customerApi
      .get(clientId)
      .then(set)
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    run("invite", async () => {
      const r = await customerApi.invite(clientId, email.trim());
      set(r.access);
      if (r.added) setNote(`${email.trim()} can now see this receptionist too.`);
      else setLink({ email: email.trim(), url: r.url, emailed: r.emailed });
      setCopied(false);
      setEmail("");
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
    <section className="card stack">
      <h2>Customer dashboard</h2>
      <p className="muted">
        Give {businessName} their own login to see every call, booking and follow-up. It's read-only: they can't change
        anything or see your other clients.
      </p>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {note && (
        <div className="notice notice-ok" role="status">
          {note}
        </div>
      )}

      {access && (access.people.length > 0 || access.invites.length > 0) && (
        <ul className="members">
          {access.people.map((p) => (
            <li key={p.id}>
              <span className="member-who">
                <strong>{p.name || p.email}</strong>
                {p.name && <span className="muted">{p.email}</span>}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy !== ""}
                onClick={() => {
                  if (!window.confirm(`Remove ${p.name || p.email}'s access?`)) return;
                  run(`rm-${p.id}`, async () => set(await customerApi.remove(clientId, p.id)));
                }}
              >
                Remove
              </button>
            </li>
          ))}
          {access.invites.map((i) => (
            <li key={i.id}>
              <span className="member-who">
                <strong>{i.email}</strong>
                <span className="muted">Invited, hasn't signed in yet</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy !== ""}
                onClick={() => run(`ci-${i.id}`, async () => set(await customerApi.cancelInvite(clientId, i.id)))}
              >
                Cancel invite
              </button>
            </li>
          ))}
        </ul>
      )}

      {account?.user.platformAdmin && account.org && (
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== ""}
            onClick={() =>
              run("preview", async () => {
                await adminApi.viewAs(account.org!.id, clientId);
                window.location.replace("/");
              })
            }
          >
            See what {businessName} sees
          </button>
        </div>
      )}

      <form onSubmit={invite} className="link-box">
        <input
          type="email"
          required
          autoComplete="off"
          aria-label="Customer's email"
          placeholder="Their email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== ""}>
          {busy === "invite" ? "Inviting…" : "Invite"}
        </button>
      </form>

      {link && (
        <div className="stack-sm">
          <p className="muted">
            {link.emailed
              ? `Invite emailed to ${link.email}. You can also send them this link:`
              : `Send ${link.email} this link. (Invite emails aren't set up on this server yet.)`}
          </p>
          <div className="link-box">
            <input type="text" readOnly value={link.url} aria-label="Customer invite link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
