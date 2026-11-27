import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, KeyRound, PhoneCall } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhoneKeyFields, keysReady, type PhoneKeyValue } from "@/components/app/PhoneKeyFields";
import { StatusBadge } from "@/components/app/StatusBadge";
import { phoneAccountQuery, phoneApi } from "@/lib/api/phone";
import { fmtDate } from "@/lib/app/format";
import type { PhoneAccount } from "@/lib/shared";

// Vapi is the backup voice engine, kept beside Telnyx (the main one): the agency adds, replaces or removes its
// Vapi private and public keys here at any time, with a Test for each. Saving as a backup never changes the engine
// new receptionists run on; a receptionist moves between the engines from its own page.

const VAPI_DASHBOARD = "https://dashboard.vapi.ai/";

export function VapiCard({ account: a, canManage, isOwner, readOnly }: { account: PhoneAccount; canManage: boolean; isOwner: boolean; readOnly: boolean }) {
  const qc = useQueryClient();
  const v = a.engines.vapi;
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [keys, setKeys] = useState<PhoneKeyValue>({ provider: "vapi", key: "", publicKey: "" });
  const reset = () => {
    setKeys({ provider: "vapi", key: "", publicKey: "" });
    save.reset();
    test.reset();
  };
  const done = (acct: PhoneAccount) => qc.setQueryData(phoneAccountQuery().queryKey, acct);

  const save = useMutation({
    mutationFn: () => phoneApi.connect(keys.key.trim(), { provider: "vapi", publicKey: keys.publicKey.trim(), makeDefault: false }),
    onSuccess: (acct) => {
      done(acct);
      setOpen(false);
      reset();
      toast.success("Vapi keys saved", { description: "Checked with Vapi and kept sealed. New receptionists still use Telnyx." });
    },
  });
  const test = useMutation({
    mutationFn: (typed: boolean) => phoneApi.test(typed ? keys.key.trim() : "", { provider: "vapi", publicKey: typed ? keys.publicKey.trim() : undefined }),
    onSuccess: (r) => toast.success("Vapi accepts these keys", { description: r.source === "typed" ? "Not saved yet." : r.source === "server" ? "The keys set on the server." : "The keys saved here." }),
    onError: (e: Error) => toast.error("Vapi test failed", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: () => phoneApi.disconnect("vapi"),
    onSuccess: (acct) => {
      done(acct);
      setRemoving(false);
      toast.success("Vapi keys removed");
    },
    onError: (e: Error) => {
      setRemoving(false);
      toast.error("Couldn't remove", { description: e.message });
    },
  });

  const connected = v.mode !== "none";
  return (
    <section className="overflow-hidden rounded-[12px] border border-hairline bg-white" data-card="vapi-account" data-mode={v.mode}>
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#eef4ff] text-[#2f55d4]" aria-hidden>
            <PhoneCall className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Vapi account</h2>
              <span className="rounded-full bg-canvas-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">Backup</span>
              {connected ? <StatusBadge tone="success" dot>Connected</StatusBadge> : <StatusBadge tone="muted">Not connected</StatusBadge>}
            </div>
            {v.mode === "own" ? (
              <p className="mt-1 text-[13px] text-ink-muted" data-vapi-summary>
                Your own Vapi account · private key ending <span className="font-mono text-ink">{v.last4}</span>
                {v.connectedAt ? ` · saved ${fmtDate(v.connectedAt)}` : ""}
              </p>
            ) : v.mode === "platform" ? (
              <p className="mt-1 text-[13px] text-ink-muted">Your Vapi account, set when this server was installed. Save keys here to use your own instead.</p>
            ) : (
              <p className="mt-1 max-w-[600px] text-[13px] text-ink-muted">The backup voice engine. Add your Vapi private and public keys so a receptionist can be moved to Vapi if Telnyx ever has trouble. Together with Twilio it's a full backup.</p>
            )}
          </div>
        </div>
        {!readOnly && canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {connected ? (
              <Button size="sm" variant="outline" className="h-8 text-[12.5px]" onClick={() => test.mutate(false)} disabled={test.isPending} data-action="test-vapi">
                {test.isPending && !test.variables ? "Testing…" : "Test"}
              </Button>
            ) : null}
            <Button size="sm" variant={connected ? "outline" : "default"} className="h-8 text-[12.5px]" onClick={() => setOpen(true)} data-action={connected ? "replace-vapi" : "connect-vapi"}>
              <KeyRound /> {connected ? "Replace" : "Add Vapi keys"}
            </Button>
            {v.mode === "own" && isOwner ? (
              <Button size="sm" variant="ghost" className="h-8 text-[12.5px] text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]" onClick={() => setRemoving(true)} data-action="disconnect-vapi">
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{connected ? "Replace your Vapi keys" : "Add your Vapi keys"}</DialogTitle>
            <DialogDescription>
              Both are on the API Keys page of the{" "}
              <a href={VAPI_DASHBOARD} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-indigo hover:underline">
                Vapi dashboard <ExternalLink className="h-3 w-3" />
              </a>
              . They're checked with Vapi and kept sealed. Receptionists already on Vapi need keys from the same Vapi account.
            </DialogDescription>
          </DialogHeader>
          <form
            id="connect-vapi"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (keysReady(keys)) save.mutate();
            }}
          >
            <PhoneKeyFields value={keys} onChange={setKeys} idPrefix="vapi-backup" />
            {save.error ? (
              <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
                {(save.error as Error).message}
              </div>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={!keysReady(keys) || test.isPending} onClick={() => test.mutate(true)} data-action="test-vapi-typed">
              Test
            </Button>
            <Button type="submit" form="connect-vapi" disabled={!keysReady(keys) || save.isPending} data-action="save-vapi">
              {save.isPending ? "Checking…" : "Check and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your Vapi keys?</AlertDialogTitle>
            <AlertDialogDescription>
              The backup engine goes away: receptionists can't be moved to Vapi until you add keys again. Nothing is deleted in Vapi. If any receptionist still runs on Vapi, move it to Telnyx first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
              disabled={remove.isPending}
              data-action="confirm-disconnect-vapi"
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
