import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, KeyRound, PhoneForwarded, RefreshCw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KeyInput } from "@/components/app/PhoneKeyFields";
import { twilioAccountQuery, twilioApi, type TwilioKeys } from "@/lib/api/twilio";
import { fmtDate, fmtPhone } from "@/lib/app/format";
import type { VoiceProviderId } from "@/lib/shared";
import { cn } from "@/lib/utils";

// Twilio is an optional extra beside the voice engine: a second place phone numbers come from.
// A Twilio number is answered by a Vapi receptionist (Vapi imports it) and sends that
// receptionist's follow-up texts. Telnyx receptionists use Telnyx numbers.

export const TWILIO_CONSOLE = "https://console.twilio.com/";

type Kind = "token" | "key";

export function TwilioCard({ engine, canManage, isOwner, readOnly }: { engine: VoiceProviderId; canManage: boolean; isOwner: boolean; readOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery(twilioAccountQuery());
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [kind, setKind] = useState<Kind>("token");
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [keySid, setKeySid] = useState("");
  const [keySecret, setKeySecret] = useState("");

  const keys = (): TwilioKeys => (kind === "token" ? { accountSid: sid.trim(), authToken: token.trim() } : { accountSid: sid.trim(), apiKeySid: keySid.trim(), apiKeySecret: keySecret.trim() });
  const ready = Boolean(sid.trim()) && (kind === "token" ? Boolean(token.trim()) : Boolean(keySid.trim() && keySecret.trim()));
  const reset = () => {
    test.reset();
    setSid("");
    setToken("");
    setKeySid("");
    setKeySecret("");
    connect.reset();
  };

  const connect = useMutation({
    mutationFn: () => twilioApi.connect(keys()),
    onSuccess: (acct) => {
      qc.setQueryData(twilioAccountQuery().queryKey, acct);
      // A new account: look at its numbers again straight away (never show the last account's list).
      void qc.invalidateQueries({ queryKey: ["twilio", "numbers"] });
      setOpen(false);
      reset();
      toast.success("Twilio connected", { description: acct.name ? `${acct.name} · checked with Twilio and saved.` : "Checked with Twilio and saved." });
    },
  });
  const disconnect = useMutation({
    mutationFn: twilioApi.disconnect,
    onSuccess: (acct) => {
      qc.setQueryData(twilioAccountQuery().queryKey, acct);
      setRemoving(false);
      toast.success("Twilio disconnected", { description: "Numbers already connected to receptionists keep working in Vapi." });
    },
    onError: (e: Error) => toast.error("Couldn't disconnect", { description: e.message }),
  });

  const test = useMutation({
    mutationFn: (typed: boolean) => twilioApi.test(typed ? keys() : {}),
    onSuccess: (r) => toast.success("Twilio accepts these", { description: [r.name, r.source === "typed" ? "Not saved yet." : r.source === "server" ? "The account set on the server." : "The account saved here."].filter(Boolean).join(" · ") }),
    onError: (e: Error) => toast.error("Twilio test failed", { description: e.message }),
  });

  if (!q.data) return null;
  const a = q.data;
  const healthy = a.connected && !a.problem;
  const manageNumbers = healthy && !readOnly && canManage;

  return (
    <section className="overflow-hidden rounded-[12px] border border-hairline bg-white" data-card="twilio-account" data-mode={a.mode}>
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#fdecef] text-[#c0173a]" aria-hidden>
            <PhoneForwarded className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Twilio account</h2>
              <span className="rounded-full bg-canvas-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">Optional</span>
              {a.connected ? (
                <StatusBadge tone={healthy ? "success" : "danger"} dot>
                  {healthy ? "Connected" : "Needs attention"}
                </StatusBadge>
              ) : (
                <StatusBadge tone="muted">Not connected</StatusBadge>
              )}
            </div>
            {a.connected ? (
              <p className="mt-1 text-[13px] text-ink-muted" data-twilio-summary>
                {a.mode === "platform" || a.installed ? "Your Twilio account, set when this server was installed" : `${a.name || "Your Twilio account"}`} · <span className="font-mono text-ink">{a.accountSid.slice(0, 6)}…{a.accountSid.slice(-4)}</span>
                {a.last4 ? ` · ${a.authKind === "key" ? "API key" : "auth token"} ending ${a.last4}` : ""}
                {a.connectedAt ? ` · connected ${fmtDate(a.connectedAt)}` : ""}
              </p>
            ) : (
              <p className="mt-1 max-w-[600px] text-[13px] text-ink-muted">Buy Australian numbers on your own Twilio account, or bring ones you already have, and have a receptionist answer them. Twilio also sends the follow-up texts for those numbers.</p>
            )}
            <p className="mt-1 max-w-[600px] text-[12px] text-ink-muted" data-twilio-engines>
              {engine === "vapi"
                ? "Twilio numbers work with the Vapi voice engine, which your new receptionists use."
                : "Twilio numbers work with the Vapi voice engine. Your new receptionists use Telnyx, so they keep Telnyx numbers; switch your voice engine to Vapi above to use Twilio numbers."}
            </p>
          </div>
        </div>
        {!readOnly && canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {a.connected ? (
              <Button size="sm" variant="outline" className="h-8 text-[12.5px]" onClick={() => test.mutate(false)} disabled={test.isPending} data-action="test-twilio">
                {test.isPending && !test.variables ? "Testing…" : "Test"}
              </Button>
            ) : null}
            <Button size="sm" variant={a.connected ? "outline" : "default"} className="h-8 text-[12.5px]" onClick={() => setOpen(true)} data-action={a.connected ? "replace-twilio" : "connect-twilio"}>
              <KeyRound /> {a.connected ? "Replace" : "Connect Twilio"}
            </Button>
            {a.mode === "own" && isOwner ? (
              <Button size="sm" variant="ghost" className="h-8 text-[12.5px] text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]" onClick={() => setRemoving(true)} data-action="disconnect-twilio">
                Disconnect
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {manageNumbers ? <TwilioNumbers /> : null}
      {a.connected && a.problem ? (
        <div className="border-t border-hairline px-5 py-3">
          <Notice tone="danger" title="Twilio isn't accepting your credentials">
            {a.problem}
          </Notice>
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{a.connected ? "Replace your Twilio credentials" : "Connect your Twilio account"}</DialogTitle>
            <DialogDescription>
              Find these on the front page of the{" "}
              <a href={TWILIO_CONSOLE} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-indigo hover:underline">
                Twilio console <ExternalLink className="h-3 w-3" />
              </a>
              . They're checked with Twilio and kept sealed.
            </DialogDescription>
          </DialogHeader>
          <form
            id="connect-twilio"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) connect.mutate();
            }}
          >
            <div>
              <label htmlFor="twilio-sid" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                Account SID
              </label>
              <Input id="twilio-sid" value={sid} onChange={(e) => setSid(e.target.value)} placeholder="AC… (34 characters)" autoComplete="off" spellCheck={false} className="h-10 bg-white font-mono text-[13px]" data-field="twilio-account-sid" />
            </div>
            <div role="radiogroup" aria-label="How to sign in" className="grid grid-cols-2 gap-2">
              {(
                [
                  ["token", "Auth Token"],
                  ["key", "API Key"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  data-twilio-kind={k}
                  className={cn("rounded-[8px] border px-3 py-2 text-left text-[12.5px] font-medium transition-colors", kind === k ? "border-indigo bg-[#f5f4ff] text-ink" : "border-hairline bg-white text-ink-muted hover:border-ink-muted")}
                >
                  {label}
                </button>
              ))}
            </div>
            {kind === "token" ? (
              <KeyInput id="twilio-token" label="Auth Token" value={token} onChange={setToken} placeholder="32 letters and numbers" field="twilio-auth-token" />
            ) : (
              <>
                <div>
                  <label htmlFor="twilio-key-sid" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                    API Key SID
                  </label>
                  <Input id="twilio-key-sid" value={keySid} onChange={(e) => setKeySid(e.target.value)} placeholder="SK… (34 characters)" autoComplete="off" spellCheck={false} className="h-10 bg-white font-mono text-[13px]" data-field="twilio-key-sid" />
                </div>
                <KeyInput id="twilio-key-secret" label="API Key secret" value={keySecret} onChange={setKeySecret} placeholder="Shown once when the key is made" field="twilio-key-secret" />
              </>
            )}
            {a.testSid ? (
              <button
                type="button"
                className="text-[12px] text-indigo hover:underline"
                onClick={() => {
                  setKind("token");
                  setSid(a.testSid!);
                  setToken(a.testToken ?? "");
                }}
                data-action="use-test-twilio"
              >
                Use the test credentials (local test server)
              </button>
            ) : null}
            {connect.error ? (
              <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
                {(connect.error as Error).message}
              </div>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={!ready || test.isPending} onClick={() => test.mutate(true)} data-action="test-twilio-typed">
              Test
            </Button>
            <Button type="submit" form="connect-twilio" disabled={!ready || connect.isPending} data-action="save-twilio">
              {connect.isPending ? "Checking…" : "Check and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect your Twilio account?</AlertDialogTitle>
            <AlertDialogDescription>
              You won't be able to search, buy or connect Twilio numbers here until you connect again, and follow-up texts from Twilio numbers stop. Numbers already connected to receptionists keep answering calls in Vapi. Nothing is deleted in Twilio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disconnect.mutate();
              }}
              disabled={disconnect.isPending}
              data-action="confirm-disconnect-twilio"
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** The numbers on the connected Twilio account, whichever voice engine is the default, so connecting it visibly worked. */
function TwilioNumbers() {
  const q = useQuery({ queryKey: ["twilio", "numbers"], queryFn: twilioApi.numbers, staleTime: 0 });
  return (
    <div className="border-t border-hairline px-5 py-3" data-twilio-numbers>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">Numbers on this Twilio account{q.data ? ` (${q.data.numbers.length})` : ""}</span>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[12px]" onClick={() => void q.refetch()} disabled={q.isFetching} data-action="sync-twilio-numbers">
          <RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} /> {q.isFetching ? "Checking…" : "Sync"}
        </Button>
      </div>
      {q.isPending ? (
        <p className="text-[12.5px] text-ink-muted">Looking at your Twilio numbers…</p>
      ) : q.error ? (
        <p role="alert" className="text-[12.5px] text-[#a41d1d]">{(q.error as Error).message}</p>
      ) : q.data.numbers.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">There are no numbers on this Twilio account yet.</p>
      ) : (
        <ul className="space-y-1">
          {q.data.numbers.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-3 text-[12.5px]" data-number={n.phoneNumber}>
              <span className="font-medium tabular-nums text-ink">{fmtPhone(n.phoneNumber)}</span>
              <span className="text-ink-muted">{n.assignedTo ? `Answers for ${n.assignedTo}` : "Not on a receptionist yet"}{n.sms ? " · texts" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
