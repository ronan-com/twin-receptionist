import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/app/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, homeOf } from "@/lib/api/auth";
import { sessionQuery } from "@/lib/app/workspace";
import { FormError } from "./AuthLayout";

// Choose a new password from the emailed link (/reset/<token>, or /reset-password?token=...).
export function ResetPasswordPage({ token }: { token: string | null }) {
  useQuery(sessionQuery()); // loads the agency's colours and light/dark look, like the sign-in page
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const valid = Boolean(token && /^[A-Za-z0-9_-]{20,100}$/.test(token));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPassword(token!, password);
      setDone(true);
      queryClient.clear();
      const s = await queryClient.fetchQuery(sessionQuery());
      setTimeout(() => navigate({ to: homeOf(s), replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas-2 px-4 py-8 sm:px-5">
      <BrandMark to="/" />
      <main className="mx-auto mt-16 w-full max-w-[380px]">
        <div className="panel p-6" data-page="reset-password">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Choose a new password</h1>
          {!valid ? (
            <p className="mt-3 text-[13px] leading-5 text-ink-muted">
              This reset link is invalid or has expired.{" "}
              <Link to="/login" search={{ mode: "forgot" }} className="font-medium text-indigo hover:underline">
                Request a new one
              </Link>
              .
            </p>
          ) : done ? (
            <p className="mt-3 text-[13px] leading-5 text-[#0e6245]">Password updated. Taking you to your workspace…</p>
          ) : (
            <form onSubmit={submit} className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} autoComplete="new-password" placeholder="At least 10 characters" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={10} autoComplete="new-password" required />
              </div>
              {error ? <FormError>{error}</FormError> : null}
              <Button type="submit" className="h-10" disabled={busy || password.length < 10}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Update password
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
