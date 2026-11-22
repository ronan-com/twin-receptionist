import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Briefcase, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AuthLayout, FormError } from "@/components/auth/AuthLayout";
import { authApi, homeOf } from "@/lib/api/auth";
import { INDUSTRIES } from "@/lib/app/constants";
import { sessionQuery } from "@/lib/app/workspace";
import { TIMEZONES } from "@/lib/shared";
import { cn } from "@/lib/utils";

type Kind = "business" | "agency";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { as?: Kind } => ({
    as: search.as === "business" || search.as === "agency" ? (search.as as Kind) : undefined,
  }),
  head: () => ({ meta: [{ title: "Create your account — Answered" }, { name: "robots", content: "noindex" }] }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const [kind, setKind] = useState<Kind | null>(search.as ?? null);
  const sessionQ = useQuery({ ...sessionQuery(), staleTime: 0 });
  const firstRun = sessionQ.data && !sessionQ.data.signedIn ? sessionQ.data.firstRun : false;

  // Already signed in: go home.
  useEffect(() => {
    if (sessionQ.data?.signedIn) navigate({ to: homeOf(sessionQ.data), replace: true });
  }, [sessionQ.data, navigate]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [suburb, setSuburb] = useState("");
  const [timezone, setTimezone] = useState("Australia/Sydney");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        kind === "agency"
          ? await authApi.signupAgency({ name: name.trim(), email: email.trim(), password, agencyName: agencyName.trim() })
          : await authApi.signupBusiness({ name: name.trim(), email: email.trim(), password, businessName: businessName.trim(), industry, suburb: suburb.trim(), timezone });
      queryClient.clear();
      await queryClient.fetchQuery(sessionQuery());
      navigate({ to: res.home, replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  const ready = name.trim() && email.trim() && password.length >= 10 && (kind === "agency" ? agencyName.trim() : businessName.trim().length >= 2);

  return (
    <AuthLayout
      title={kind === "agency" ? "Set up your agency" : kind === "business" ? "Set up your receptionist" : "Create your account"}
      subtitle={
        kind === "agency"
          ? "Run AI receptionists for the businesses you look after."
          : kind === "business"
            ? "We'll set up an AI receptionist for your business in a minute."
            : "Tell us who you are and we'll get you started."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-indigo hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {firstRun ? (
        <div className="mt-5 rounded-[6px] border border-[#c5e7fb] bg-[#f2f9ff] px-3.5 py-2.5 text-[12.5px] leading-5 text-[#0b5d87]">
          This is a new server: the first account becomes the platform owner, and only the expected owner's email can create it.
        </div>
      ) : null}

      {!kind ? (
        <div className="mt-6 grid gap-3" role="radiogroup" aria-label="Account type">
          <ChoiceCard
            icon={Building2}
            title="I run a business"
            body="An AI receptionist that answers your phone, books appointments and passes on every caller."
            onClick={() => setKind("business")}
            testId="signup-business"
          />
          <ChoiceCard
            icon={Briefcase}
            title="I'm an agency"
            body="Set up and run receptionists for the businesses you look after, under your own brand."
            onClick={() => setKind("agency")}
            testId="signup-agency"
          />
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 grid gap-4" noValidate data-form={`signup-${kind}`}>
          <div className="grid gap-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex Nguyen" required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@business.com" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 10 characters" minLength={10} required />
          </div>
          {kind === "agency" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="agency">Agency name</Label>
              <Input id="agency" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} autoComplete="organization" placeholder="e.g. Brightline Digital" required />
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="business">Business name</Label>
                <Input id="business" value={businessName} onChange={(e) => setBusinessName(e.target.value)} autoComplete="organization" placeholder="e.g. Harbourside Dental" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="industry">Industry</Label>
                  <Select value={industry} onValueChange={setIndustry}>
                    <SelectTrigger id="industry">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((i) => (
                        <SelectItem key={i} value={i}>
                          {i}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="suburb">Suburb</Label>
                  <Input id="suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="e.g. Newtown" autoComplete="address-level2" />
                </div>
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="timezone">Time zone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger id="timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {error ? <FormError>{error}</FormError> : null}

          <Button type="submit" className="h-10 w-full" disabled={busy || !ready}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {kind === "agency" ? "Create agency" : busy ? "Setting up your receptionist…" : "Create my receptionist"}
            {!busy ? <ArrowRight className="ml-1.5 h-4 w-4" /> : null}
          </Button>
          <p className="text-[12px] leading-5 text-ink-muted">You can sign in straight away. We don't send a confirmation email yet.</p>
          <button
            type="button"
            onClick={() => {
              setKind(null);
              setError(null);
            }}
            className="inline-flex items-center gap-1 justify-self-start text-[12.5px] font-medium text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Choose a different account type
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

function ChoiceCard({ icon: Icon, title, body, onClick, testId }: { icon: typeof Building2; title: string; body: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={false}
      onClick={onClick}
      data-choice={testId}
      data-hue={testId === "signup-agency" ? "magenta" : "indigo"}
      className={cn("panel hue-tile flex w-full items-start gap-3 p-4 text-left transition-colors hover:border-[var(--hue)] focus-visible:ring-2 focus-visible:ring-indigo")}
    >
      <span className="hue-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px]" aria-hidden>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-5 text-ink-muted">{body}</span>
      </span>
    </button>
  );
}
