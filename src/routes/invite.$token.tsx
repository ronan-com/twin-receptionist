import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, FormError } from "@/components/auth/AuthLayout";
import { authApi, homeOf } from "@/lib/api/auth";
import { sessionQuery } from "@/lib/app/workspace";
import { named } from "@/lib/app/product";

// Accepting an invite: to an agency's team, or to a business's workspace.
export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: named("Accept your invite — Answered") }, { name: "robots", content: "noindex" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const infoQ = useQuery({ queryKey: ["invite", token], queryFn: () => authApi.inviteInfo(token), retry: false });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = infoQ.data;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.acceptInvite(token, info?.hasAccount ? { password } : { name: name.trim(), password });
      queryClient.clear();
      const s = await queryClient.fetchQuery(sessionQuery());
      // A new agency owner starts on Branding: logo and colours first.
      navigate({ to: homeOf(s), replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  const what = info ? (info.role === "customer" ? info.businessName || info.orgName : info.orgName) : "";

  return (
    <AuthLayout
      title={info ? `Join ${what}` : "Accept your invite"}
      subtitle={
        info
          ? info.role === "customer"
            ? `${info.orgName} has shared ${info.businessName || "your receptionist"} with you: every call, booking and follow-up.`
            : `You've been invited to ${info.orgName} as ${info.role === "owner" ? "an owner" : info.role === "admin" ? "an admin" : "a team member"}.`
          : undefined
      }
    >
      {infoQ.isPending ? (
        <p className="mt-6 text-[13px] text-ink-muted">Checking your invite…</p>
      ) : infoQ.error ? (
        <div className="mt-6">
          <FormError>{(infoQ.error as Error).message}</FormError>
        </div>
      ) : info ? (
        <form onSubmit={submit} className="mt-6 grid gap-4" data-form="accept-invite">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={info.email} readOnly disabled />
          </div>
          {!info.hasAccount ? (
            <div className="grid gap-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="password">{info.hasAccount ? "Your password" : "Choose a password"}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={info.hasAccount ? "current-password" : "new-password"}
              placeholder={info.hasAccount ? "••••••••" : "At least 10 characters"}
              required
            />
          </div>
          {error ? <FormError>{error}</FormError> : null}
          <Button type="submit" className="h-10 w-full" disabled={busy || !password || (!info.hasAccount && (!name.trim() || password.length < 10))}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Accept invite
            {!busy ? <ArrowRight className="ml-1.5 h-4 w-4" /> : null}
          </Button>
        </form>
      ) : null}
    </AuthLayout>
  );
}
