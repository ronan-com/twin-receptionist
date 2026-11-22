import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { accountApi } from "../lib/api";
import type { Account, OrgRole, TeamState } from "../lib/shared";

const ROLES: { value: OrgRole; label: string; detail: string }[] = [
  { value: "member", label: "Member", detail: "Sets up and runs receptionists." },
  { value: "admin", label: "Admin", detail: "Also invites people, buys numbers and deletes receptionists." },
  { value: "owner", label: "Owner", detail: "Everything, including managing other owners." },
];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

export default function Team({ account, onAccount }: { account: Account; onAccount: (a: Account) => void }) {
  const [team, setTeam] = useState<TeamState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [link, setLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [orgName, setOrgName] = useState(account.org?.name ?? "");
  const [name, setName] = useState(account.user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saved, setSaved] = useState("");
  const [newTeam, setNewTeam] = useState("");

  const isAdmin = account.role === "owner" || account.role === "admin";
  const isOwner = account.role === "owner";

  useEffect(() => {
    accountApi
      .team()
      .then(setTeam)
      .catch((err: Error) => setError(err.message));
  }, [account.org?.id]);

  useEffect(() => setOrgName(account.org?.name ?? ""), [account.org?.name]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    setSaved("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function sendInvite(event: FormEvent) {
    event.preventDefault();
    run("invite", async () => {
      const result = await accountApi.invite(email.trim(), role);
      setLink({ email: email.trim(), ...result });
      setCopied(false);
      setEmail("");
      setTeam(await accountApi.team());
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
          <p className="eyebrow">Settings</p>
          <h1>{account.org?.name}</h1>
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="notice notice-ok" role="status">
          {saved}
        </div>
      )}

      <section className="card stack">
        <h2>People</h2>
        {!team && !error && <p className="muted">Loading…</p>}
        {team && (
          <ul className="members">
            {team.members.map((m) => {
              const me = m.id === account.user.id;
              // Admins manage members and admins; only owners touch owners.
              const canEdit = isAdmin && !me && (isOwner || m.role !== "owner");
              return (
                <li key={m.id}>
                  <span className="member-who">
                    <strong>
                      {m.name || m.email}
                      {me && " (you)"}
                    </strong>
                    {m.name && <span className="muted">{m.email}</span>}
                  </span>
                  {canEdit ? (
                    <select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={busy !== ""}
                      onChange={(e) =>
                        run(`role-${m.id}`, async () => setTeam(await accountApi.changeRole(m.id, e.target.value as OrgRole)))
                      }
                    >
                      {ROLES.filter((r) => isOwner || r.value !== "owner").map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="pill">{ROLES.find((r) => r.value === m.role)?.label}</span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy !== ""}
                      onClick={() => {
                        if (!window.confirm(`Remove ${m.name || m.email} from ${account.org?.name}?`)) return;
                        run(`remove-${m.id}`, async () => setTeam(await accountApi.removeMember(m.id)));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {team && team.invites.length > 0 && (
          <>
            <h3 className="sub-head">Waiting to join</h3>
            <ul className="members">
              {team.invites.map((i) => (
                <li key={i.id}>
                  <span className="member-who">
                    <strong>{i.email}</strong>
                    <span className="muted">
                      {ROLES.find((r) => r.value === i.role)?.label} · invite works until {day(i.expiresAt)}
                    </span>
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy !== ""}
                      onClick={() => run(`revoke-${i.id}`, async () => setTeam(await accountApi.revokeInvite(i.id)))}
                    >
                      Cancel invite
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {isAdmin && (
        <section className="card stack">
          <h2>Invite someone</h2>
          <form onSubmit={sendInvite} className="stack">
            <div className="field-row">
              <label className="field">
                <span>Email</span>
                <input type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="field">
                <span>Role</span>
                <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>
            <p className="hint">{ROLES.find((r) => r.value === role)?.detail}</p>
            <div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== ""}>
                {busy === "invite" ? "Inviting…" : "Send invite"}
              </button>
            </div>
          </form>
          {link && (
            <div className="stack-sm">
              <p className="muted">
                {link.emailed
                  ? `Invite emailed to ${link.email}. You can also send them this link:`
                  : `Send ${link.email} this link. (Invite emails aren't set up on this server yet.)`}
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
      )}

      {isOwner && (
        <section className="card stack">
          <h2>Team name</h2>
          <form
            className="link-box"
            onSubmit={(e) => {
              e.preventDefault();
              run("org", async () => {
                onAccount(await accountApi.renameOrg(orgName));
                setSaved("Team name saved.");
              });
            }}
          >
            <input type="text" required aria-label="Team name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== ""}>
              Save
            </button>
          </form>
        </section>
      )}

      <section className="card stack">
        <h2>Your account</h2>
        <p className="muted">{account.user.email}</p>
        <form
          className="link-box"
          onSubmit={(e) => {
            e.preventDefault();
            run("name", async () => {
              onAccount(await accountApi.update({ name }));
              setSaved("Name saved.");
            });
          }}
        >
          <input type="text" aria-label="Your name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== ""}>
            Save
          </button>
        </form>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            run("password", async () => {
              await accountApi.update({ currentPassword, newPassword });
              setCurrentPassword("");
              setNewPassword("");
              setSaved("Password changed. You've been signed out on other devices.");
            });
          }}
        >
          <div className="field-row">
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
          </div>
          <div>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== ""}>
              {busy === "password" ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </section>

      <section className="card stack">
        <h2>Your teams</h2>
        <ul className="members">
          {account.orgs.map((o) => (
            <li key={o.id}>
              <span className="member-who">
                <strong>{o.name}</strong>
                <span className="muted">{ROLES.find((r) => r.value === o.role)?.label}</span>
              </span>
              {o.id === account.org?.id ? (
                <span className="pill pill-on">Current</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== ""}
                  onClick={() => run(`switch-${o.id}`, async () => onAccount(await accountApi.switchOrg(o.id)))}
                >
                  Switch
                </button>
              )}
            </li>
          ))}
        </ul>
        {account.user.platformAdmin && (
        <form
          className="link-box"
          onSubmit={(e) => {
            e.preventDefault();
            run("new-team", async () => {
              onAccount(await accountApi.createOrg(newTeam));
              setNewTeam("");
            });
          }}
        >
          <input
            type="text"
            required
            aria-label="New team name"
            placeholder="Start another team, e.g. a client business"
            value={newTeam}
            onChange={(e) => setNewTeam(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== ""}>
            Create
          </button>
        </form>
        )}
      </section>
    </div>
  );
}
