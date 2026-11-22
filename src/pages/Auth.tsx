import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Wordmark from "../components/Wordmark";
import { accountApi, auth } from "../lib/api";
import type { InviteInfo } from "../lib/shared";

// Sign in, sign up, forgotten password, password reset and accepting an invite.

function AuthFrame({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <header className="auth-top">
        <Wordmark to="/" />
      </header>
      <main className="auth-card">
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </main>
    </div>
  );
}

function ErrorNote({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div className="notice notice-error" role="alert">
      {error}
    </div>
  );
}

// Runs a form action with a busy flag and error message.
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

type Mode = "signin" | "signup" | "forgot";

export function SignIn({ signupOpen, firstRun, onSignedIn }: { signupOpen: boolean; firstRun: boolean; onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>(firstRun ? "signup" : "signin");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      if (mode === "signin") await auth.signIn(email, password);
      else if (mode === "signup") await auth.signUp({ name, email, password, orgName });
      else {
        await auth.forgot(email);
        setSent(true);
        return;
      }
      onSignedIn();
    });
  }

  if (mode === "forgot") {
    return (
      <AuthFrame title="Reset your password" intro="We'll email you a link to choose a new one.">
        {sent ? (
          <div className="stack">
            <div className="notice notice-ok" role="status">
              If there's an account for {email}, a reset link is on its way. It works for an hour.
            </div>
            <button type="button" className="link" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            <label className="field">
              <span>Email</span>
              <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <ErrorNote error={error} />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <button type="button" className="link" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </form>
        )}
      </AuthFrame>
    );
  }

  const signingUp = mode === "signup";
  return (
    <AuthFrame
      title={firstRun ? "Create the first account" : signingUp ? "Create an account" : "Sign in"}
      intro={
        firstRun
          ? "You'll be the owner of this platform. Invite the rest of your team once you're in."
          : signingUp
            ? "Set up your team's account."
            : "Welcome back."
      }
    >
      <form onSubmit={submit} className="stack">
        {signingUp && (
          <>
            <label className="field">
              <span>Your name</span>
              <input type="text" required autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Team or business name</span>
              <input
                type="text"
                required
                autoComplete="organization"
                placeholder="Twin Sales"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            autoFocus={!signingUp}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            required
            minLength={signingUp ? 10 : undefined}
            autoComplete={signingUp ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signingUp && <span className="hint">At least 10 characters.</span>}
        </label>
        <ErrorNote error={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "One moment…" : signingUp ? "Create account" : "Sign in"}
        </button>
        {!signingUp && (
          <button type="button" className="link" onClick={() => setMode("forgot")}>
            Forgotten your password?
          </button>
        )}
        {signupOpen && !firstRun && (
          <button type="button" className="link" onClick={() => setMode(signingUp ? "signin" : "signup")}>
            {signingUp ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        )}
      </form>
    </AuthFrame>
  );
}

export function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  function submit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      await auth.reset(token, password);
      window.location.replace("/");
    });
  }

  return (
    <AuthFrame title="Choose a new password" intro="You'll be signed out everywhere else.">
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            required
            autoFocus
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="hint">At least 10 characters.</span>
        </label>
        <ErrorNote error={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Saving…" : "Save and sign in"}
        </button>
      </form>
    </AuthFrame>
  );
}

const ROLE_WORDS = { owner: "an owner", admin: "an admin", member: "a member" } as const;

export function AcceptInvite({ token }: { token: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  useEffect(() => {
    auth
      .invite(token)
      .then(setInfo)
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  function submit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      await auth.acceptInvite(token, info?.hasAccount ? { password } : { name, password });
      window.location.replace("/");
    });
  }

  if (loadError) {
    return (
      <AuthFrame title="Invite not found">
        <ErrorNote error={loadError} />
      </AuthFrame>
    );
  }
  if (!info) return null;

  return (
    <AuthFrame
      title={`Join ${info.orgName}`}
      intro={`You've been invited as ${ROLE_WORDS[info.role]}, as ${info.email}.`}
    >
      <form onSubmit={submit} className="stack">
        {!info.hasAccount && (
          <label className="field">
            <span>Your name</span>
            <input type="text" required autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>{info.hasAccount ? "Your password" : "Choose a password"}</span>
          <input
            type="password"
            required
            autoFocus={info.hasAccount}
            minLength={info.hasAccount ? undefined : 10}
            autoComplete={info.hasAccount ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {!info.hasAccount && <span className="hint">At least 10 characters.</span>}
        </label>
        <ErrorNote error={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Joining…" : `Join ${info.orgName}`}
        </button>
      </form>
    </AuthFrame>
  );
}

export function NoTeam({ onDone }: { onDone: () => void }) {
  return (
    <AuthFrame title="You're not in a team yet" intro="Teams are set up by the platform team. Ask them to send you an invite link, then open it.">
      <button type="button" className="btn btn-secondary btn-block" onClick={onDone}>
        Check again
      </button>
    </AuthFrame>
  );
}
