import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, FlaskConical, KeyRound, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, Notice, PageHeader, Panel } from "@/components/app/primitives";
import { platformApi } from "@/lib/api/console";
import type { TestLogin } from "@/lib/shared";
import { LinkBox, useConsole } from "./-shared";
import { named } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/test-lab")({
  head: () => ({ meta: [{ title: named("Test lab — Answered admin") }] }),
  component: TestLabPage,
});

const FLOWS = [
  ["Be an agency", "Create test logins, open this site in a private window and sign in as the test agency owner. Try Settings, Branding."],
  ["Share with a customer", "As the agency, open the demo client and invite a customer. The link shows on screen (no email is sent)."],
  ["Request a number", "As the agency, request a number on the demo receptionist. Then decline it here under Number requests."],
  ["Be them on your phone", "Sign in on your phone with one of the test logins below."],
] as const;

function TestLabPage() {
  const { ws, platform } = useConsole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["console", "sandbox"], queryFn: platformApi.sandbox, enabled: platform });
  const [logins, setLogins] = useState<TestLogin[] | null>(null);
  const [resetting, setResetting] = useState(false);
  const orgId = q.data ?? null;

  const create = useMutation({
    mutationFn: platformApi.createSandbox,
    onSuccess: (id) => {
      qc.setQueryData(["console", "sandbox"], id);
      void qc.invalidateQueries({ queryKey: ["console", "agencies"] });
      toast.success("Test agency ready");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const makeLogins = useMutation({
    mutationFn: platformApi.testLogins,
    onSuccess: async (l) => {
      setLogins(l);
      await q.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: platformApi.resetSandbox,
    onSuccess: () => {
      qc.setQueryData(["console", "sandbox"], null);
      setLogins(null);
      setResetting(false);
      void qc.invalidateQueries({ queryKey: ["console", "agencies"] });
      toast.success("Test lab reset");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const view = useMutation({
    mutationFn: async () => {
      await platformApi.viewAs(orgId!);
      await qc.invalidateQueries();
      await ws.refresh();
    },
    onSuccess: () => void navigate({ to: "/admin" }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!platform) return <ErrorState message="Only the platform team can use the test lab." />;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-5" data-page="admin-test-lab">
      <PageHeader
        eyebrow="Platform console"
        title="Test lab"
        description="A safe test agency with a demo receptionist and sample calls. Nothing in it calls or charges the phone provider."
      />
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <Panel title="Test agency" description={orgId ? "Test Agency (sandbox) is set up." : "Not set up yet."}>
        <div className="flex flex-wrap gap-2">
          {orgId ? (
            <Button size="sm" className="h-8 text-[12.5px]" onClick={() => view.mutate()} disabled={view.isPending} data-action="view-sandbox">
              <Eye className="mr-1.5 h-3.5 w-3.5" /> View the test agency
            </Button>
          ) : (
            <Button size="sm" className="h-8 text-[12.5px]" onClick={() => create.mutate()} disabled={create.isPending || q.isPending} data-action="create-sandbox">
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> {create.isPending ? "Setting up…" : "Create the test agency"}
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 text-[12.5px]" onClick={() => makeLogins.mutate()} disabled={makeLogins.isPending} data-action="test-logins">
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> {makeLogins.isPending ? "Creating…" : "Create test logins"}
          </Button>
          {orgId ? (
            <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" onClick={() => setResetting(true)} data-action="reset-sandbox">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
            </Button>
          ) : null}
        </div>
      </Panel>

      {logins ? (
        <Panel title="Test logins" description="Shown once. They only work inside the test agency.">
          <div className="space-y-3" data-test-logins>
            <Notice tone="warning" title="Copy these now">
              Sign in at {origin} in a private window or on another device. The passwords aren't shown again.
            </Notice>
            {logins.map((l) => (
              <div key={l.email} className="space-y-1.5 rounded-[6px] border border-hairline p-3 text-[13px]" data-login={l.role}>
                <div className="font-medium text-ink">{l.role}</div>
                <LinkBox url={l.email} label={`${l.role} email`} />
                <LinkBox url={l.password} label={`${l.role} password`} />
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="Flows to try">
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px]">
          {FLOWS.map(([t, d]) => (
            <li key={t}>
              <span className="font-medium text-ink">{t}.</span> <span className="text-ink-muted">{d}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the test lab?</DialogTitle>
            <DialogDescription>The test agency, its demo data and its test logins are deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(false)}>Cancel</Button>
            <Button onClick={() => reset.mutate()} disabled={reset.isPending} data-action="confirm-reset-sandbox">
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
