import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import Wordmark from "./components/Wordmark";
import { accountApi, api, auth } from "./lib/api";
import type { Account, Business, Session } from "./lib/shared";
import { AcceptInvite, NoTeam, ResetPassword, SignIn } from "./pages/Auth";
import Clients from "./pages/Clients";
import Connect from "./pages/Connect";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import Setup from "./pages/Setup";
import Team from "./pages/Team";

function Shell({ account, onAccount }: { account: Account; onAccount: (a: Account) => void }) {
  const navigate = useNavigate();
  async function signOut() {
    await auth.signOut().catch(() => {});
    window.location.replace("/");
  }
  return (
    <div className="app">
      <header className="app-top">
        <Wordmark to="/" />
        <div className="app-top-right">
          {account.orgs.length > 1 ? (
            <select
              className="org-switch"
              aria-label="Team"
              value={account.org?.id}
              onChange={async (e) => {
                onAccount(await accountApi.switchOrg(e.target.value));
                navigate("/");
              }}
            >
              {account.orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="app-biz">{account.org?.name}</span>
          )}
          <Link to="/team" className="btn btn-ghost btn-sm">
            Team
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
          <Link to="/new" className="btn btn-primary btn-sm">
            New receptionist
          </Link>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

function NewClient() {
  const navigate = useNavigate();
  return <Setup onCreated={(client) => navigate(`/clients/${client.id}`)} />;
}

function Client() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState<Business | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setClient(null);
    setError("");
    api
      .client(id)
      .then(setClient)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <>
        <Link to="/" className="back">
          ← All receptionists
        </Link>
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      </>
    );
  }
  if (!client) return <p className="muted center pad">Loading…</p>;
  return <Dashboard business={client} onChange={setClient} onDeleted={() => navigate("/")} />;
}

export default function App() {
  const path = window.location.pathname;
  // A business opening its private connect link sees only that page, with no
  // sign-in in the way. Invite and reset links work signed in or not.
  const connect = path.match(/^\/connect\/([A-Za-z0-9_-]{1,64})\/?$/);
  if (connect) return <Connect token={connect[1]} />;
  const invite = path.match(/^\/invite\/([A-Za-z0-9_-]{1,100})\/?$/);
  if (invite) return <AcceptInvite token={invite[1]} />;
  const reset = path.match(/^\/reset\/([A-Za-z0-9_-]{1,100})\/?$/);
  if (reset) return <ResetPassword token={reset[1]} />;
  return <Operator />;
}

function Operator() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    auth
      .session()
      .then(setSession)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="auth">
        <main className="auth-card">
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        </main>
      </div>
    );
  }
  if (!session) return null;
  if (!session.signedIn) return <SignIn signupOpen={session.signupOpen} firstRun={session.firstRun} onSignedIn={load} />;
  if (!session.org) return <NoTeam onDone={load} />;

  const account: Account = session;
  // Switching team changes everything on screen, so start from a clean slate.
  const onAccount = (next: Account) => {
    if (next.org?.id !== account.org?.id) window.location.replace("/");
    else setSession({ signedIn: true, ...next });
  };

  return (
    <Routes>
      <Route element={<Shell account={account} onAccount={onAccount} />}>
        <Route path="/" element={<Clients />} />
        <Route path="/new" element={<NewClient />} />
        <Route path="/clients/:id" element={<Client />} />
        <Route path="/team" element={<Team account={account} onAccount={onAccount} />} />
      </Route>
      {/* The sales page a client business would see. Not part of the dashboard. */}
      <Route path="/site" element={<Landing />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
