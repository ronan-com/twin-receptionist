import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, FormError } from "@/components/auth/AuthLayout";
import { authApi, homeOf, safeRedirect } from "@/lib/api/auth";
import { sessionQuery } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";

type Mode = "signin" | "forgot";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; mode?: "forgot" } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    mode: search.mode === "forgot" ? ("forgot" as const) : undefined,
  }),
  head: () => ({ meta: [{ title: `Sign in — ${PRODUCT}` }, { name: "robots", content: "noindex" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const redirectTo = safeRedirect(search.redirect);
  const [mode, setMode] = useState<Mode>(search.mode === "forgot" ? "forgot" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ title: string; body: string } | null>(null);
  // SINGLE_AGENCY: after the first account, people join by invite, so there's no sign-up link.
  const sessionQ = useQuery(sessionQuery());
  const inviteOnly = sessionQ.data && !sessionQ.data.signedIn ? Boolean(sessionQ.data.singleAgency) && !sessionQ.data.firstRun : false;

  // Already signed in: straight to where they belong.
  useEffect(() => {
    let active = true;
    queryClient.fetchQuery({ ...sessionQuery(), staleTime: 0 }).then((s) => {
      if (!active) return;
      if (s.signedIn) navigate({ to: redirectTo ?? homeOf(s), replace: true });
      // A brand-new agency copy has no accounts yet: its owner needs the set-up page, not a sign-in.
      else if (s.singleAgency && s.firstRun) navigate({ to: "/signup", replace: true });
    }, () => {});
    return () => {
      active = false;
    };
  }, [navigate, queryClient, redirectTo]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        await authApi.signIn(email.trim(), password);
        queryClient.clear();
        const s = await queryClient.fetchQuery(sessionQuery());
        navigate({ to: redirectTo ?? homeOf(s), replace: true });
      } else {
        await authApi.requestReset(email.trim());
        setInfo({ title: "Reset link sent", body: `If an account exists for ${email.trim()}, a password reset link is on its way. It works for 60 minutes.` });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={mode === "signin" ? `Sign in to ${PRODUCT}` : "Reset your password"}
      subtitle={mode === "signin" ? "Welcome back. Your receptionist has been busy." : "We'll email you a secure link to choose a new password."}
      footer={
        mode === "signin" ? (
          inviteOnly ? (
            <>New to {PRODUCT}? Ask for an invite.</>
          ) : (
            <>
              New to {PRODUCT}?{" "}
              <Link to="/signup" className="font-medium text-indigo hover:underline">
                Create an account
              </Link>
            </>
          )
        ) : (
          <>
            Remembered it?{" "}
            <button type="button" onClick={() => switchMode("signin")} className="font-medium text-indigo hover:underline">
              Sign in
            </button>
          </>
        )
      }
    >
      {info ? (
        <div className="mt-6 rounded-[6px] border border-[#c8eedf] bg-[#f1fbf7] p-4" role="status">
          <div className="flex items-start gap-3">
            <MailCheck className="mt-0.5 h-5 w-5 text-[#0e6245]" />
            <div>
              <div className="text-[14px] font-semibold text-[#0e6245]">{info.title}</div>
              <p className="mt-1 text-[13px] leading-5 text-[#0e6245]/90">{info.body}</p>
              <button type="button" onClick={() => switchMode("signin")} className="mt-3 text-[13px] font-medium text-indigo hover:underline">
                Back to sign in
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@business.com" required autoFocus />
          </div>
          {mode === "signin" ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" onClick={() => switchMode("forgot")} className="text-[12px] font-medium text-indigo hover:underline">
                  Forgot password?
                </button>
              </div>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" required />
            </div>
          ) : null}

          {error ? <FormError>{error}</FormError> : null}

          <Button type="submit" className="h-10 w-full" disabled={busy || !email || (mode === "signin" && !password)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === "signin" ? "Sign in" : "Send reset link"}
            {!busy ? <ArrowRight className="ml-1.5 h-4 w-4" /> : null}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
