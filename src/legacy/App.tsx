import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Building2, LayoutGrid, LogOut, Plus, Settings as SettingsIcon } from "lucide-react";
import ViewBanner from "./components/ViewBanner";
import Wordmark from "./components/Wordmark";
import { AccountContext } from "./lib/account";
import { brandStyle } from "./lib/brand";
import { accountApi, adminApi, api, auth } from "./lib/api";
import type { Account, Business, Session } from "./lib/shared";
import { AcceptInvite, NoTeam, ResetPassword, SignIn } from "./pages/Auth";
import Agencies from "./pages/Agencies";
import Clients from "./pages/Clients";
import Connect from "./pages/Connect";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import Portal from "./pages/Portal";
import Setup from "./pages/Setup";
import Team from "./pages/Team";

function Shell({ account, onAccount }: { account: Account; onAccount: (a: Account) => void }) {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (account.user.platformAdmin) adminApi.numberRequests().then((r) => setWaiting(r.pending)).catch(() => {});
  }, [account.user.platformAdmin]);
  async function signOut() {
    await auth.signOut().catch(() => {});
    window.location.replace("/");
  }
  const items = [
    { to: "/", label: "Receptionists", icon: LayoutGrid, end: true, show: true },
    { to: "/new", label: "New receptionist", icon: Plus, end: false, show: true },
    { to: "/team", label: "Settings", icon: SettingsIcon, end: false, show: true },
    { to: "/agencies", label: waiting > 0 ? `Agencies (${waiting})` : "Agencies", icon: Building2, end: false, show: account.user.platformAdmin },
  ].filter((i) => i.show);
  const teamPicker =
    account.orgs.length > 1 ? (
      <select
        className="org-switch ws-switch"
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
      <p className="ws-biz">{account.org?.name}</p>
    );
  return (
    <div className="app ws" style={brandStyle(account.brand)}>
      {account.viewing && <ViewBanner viewing={account.viewing} />}
      <aside className="ws-side">
        <div className="ws-brand">
          <Wordmark to="/" brand={account.brand} />
        </div>
        {teamPicker}
        <nav className="ws-nav" aria-label="Main">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? "is-on" : "")}>
              <i.icon size={15} strokeWidth={1.8} aria-hidden />
              <span>{i.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="ws-user">
          <span className="ws-email">{account.user.email}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      </aside>
      <div className="ws-main">
        <header className="ws-mobile">
          <div className="ws-mobile-top">
            <Wordmark to="/" brand={account.brand} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
              Sign out
            </button>
          </div>
          <nav className="ws-chips" aria-label="Main">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? "is-on" : "")}>
                {i.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="ws-content">
          {account.orgs.length > 1 && <div className="ws-mobile-team">{teamPicker}</div>}
          <Outlet />
        </main>
      </div>
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
  // The end customer's own, read-only view.
  if (account.role === "customer") return <Portal account={account} />;
  // Switching team changes everything on screen, so start from a clean slate.
  const onAccount = (next: Account) => {
    if (next.org?.id !== account.org?.id) window.location.replace("/");
    else setSession({ signedIn: true, ...next });
  };

  return (
    <AccountContext.Provider value={account}>
    <Routes>
      <Route element={<Shell account={account} onAccount={onAccount} />}>
        <Route path="/" element={<Clients />} />
        <Route path="/agencies" element={account.user.platformAdmin ? <Agencies /> : <Navigate to="/" replace />} />
        <Route path="/new" element={<NewClient />} />
        <Route path="/clients/:id" element={<Client />} />
        <Route path="/team" element={<Team account={account} onAccount={onAccount} />} />
      </Route>
      {/* The sales page a client business would see. Not part of the dashboard. */}
      <Route path="/site" element={<Landing />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </AccountContext.Provider>
  );
}
