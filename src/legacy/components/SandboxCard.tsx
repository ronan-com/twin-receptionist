import { useEffect, useState } from "react";
import { accountApi, adminApi } from "../lib/api";
import type { TestLogin } from "../lib/shared";

const FLOWS = [
  ["Be an agency", "Open the test agency, then Settings, Branding: upload a logo and pick a background colour."],
  ["Invite someone", "Settings, Invite someone. The link shows on screen (no email is sent). Open it in a private window to join."],
  ["Share with a customer", "Open the demo receptionist, Set up, Customer dashboard: invite someone, or press 'See what Harbourside Dental sees'."],
  ["Request a number", "On the demo receptionist: Set up, Phone number, Request. Then come back to Number requests above and press Buy and connect (nothing is bought)."],
  ["Be them on your phone", "Press Create test logins, open this site on your phone and sign in as the test agency owner or the test customer."],
] as const;

// The test lab: a sandbox agency with a demo receptionist and ready-made logins.
export default function SandboxCard() {
  const [orgId, setOrgId] = useState<string | null | undefined>(undefined);
  const [logins, setLogins] = useState<TestLogin[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    adminApi
      .sandbox()
      .then(setOrgId)
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

  async function open(id: string) {
    await accountApi.switchOrg(id);
    window.location.replace("/");
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setError("Couldn't copy. Select it and copy by hand.");
    }
  }

  return (
    <section className="card stack">
      <h2>Test lab</h2>
      <p className="muted">
        A safe test agency with a demo receptionist and sample calls. Try being an agency, customise the logo and background, invite
        someone and test the customer's view. Nothing in it calls or charges the phone provider.
      </p>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="row-actions" style={{ justifyContent: "flex-start" }}>
        {orgId ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy !== ""} onClick={() => run("open", () => open(orgId))}>
            Open the test agency
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy !== "" || orgId === undefined}
            onClick={() =>
              run("create", async () => {
                const id = await adminApi.createSandbox();
                setOrgId(id);
                await open(id);
              })
            }
          >
            {busy === "create" ? "Setting up…" : "Create the test agency"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy !== ""}
          onClick={() =>
            run("logins", async () => {
              setLogins(await adminApi.testLogins());
              setOrgId(await adminApi.sandbox());
            })
          }
        >
          {busy === "logins" ? "Creating…" : "Create test logins"}
        </button>
        {orgId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy !== ""}
            onClick={() => {
              if (!window.confirm("Reset the test lab? The test agency, its demo data and test logins are deleted.")) return;
              run("reset", async () => {
                await adminApi.resetSandbox();
                setOrgId(null);
                setLogins(null);
              });
            }}
          >
            Reset
          </button>
        )}
      </div>

      {logins && (
        <div className="stack-sm">
          <p className="muted">
            Sign in at <strong>{window.location.origin}</strong> with these. They only work inside the test agency, and the passwords are shown once.
          </p>
          <ul className="members">
            {logins.map((l) => (
              <li key={l.email}>
                <span className="member-who">
                  <strong>{l.role}</strong>
                  <span className="muted">{l.email}</span>
                  <span className="muted">Password: {l.password}</span>
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(`${window.location.origin}\n${l.email}\n${l.password}`, l.email)}>
                  {copied === l.email ? "Copied" : "Copy"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="sub-head">Flows to try</h3>
      <ol className="flow-list">
        {FLOWS.map(([title, text]) => (
          <li key={title}>
            <strong>{title}.</strong> <span className="muted">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
