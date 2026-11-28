import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attachOwnedNumber, getOwnedNumbers, importNumberFor } from "@/lib/api/console";
import { twilioAccountQuery, twilioApi } from "@/lib/api/twilio";
import { ImportNumber } from "./-import-number";
import { fmtPhone } from "@/lib/app/format";
import { NumberCaps, telnyxCanText } from "./-number-caps";

/**
 * Add a number to a receptionist: pick one the agency already has, or (when there's none to pick)
 * "Get a number", which opens the Numbers page.
 */
export function NumberPicker({ clientId, onChanged }: { clientId: string; onChanged: () => Promise<void> }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["own-numbers", "owned"], queryFn: getOwnedNumbers, staleTime: 30_000, retry: false });
  const [id, setId] = useState("");
  const free = (q.data ?? []).filter((n) => !n.connectionId);
  const choices = free.length ? free : q.data ?? [];
  const attach = useMutation({
    mutationFn: () => attachOwnedNumber(clientId, id, true),
    onSuccess: async (_r, _v) => {
      toast.success("Number added");
      setId("");
      await qc.invalidateQueries({ queryKey: ["own-numbers"] });
      await onChanged();
    },
    onError: (e: Error) => toast.error("Couldn't add that number", { description: e.message }),
  });
  const getOne = (
    <Button asChild size="sm" variant="outline" className="h-8 w-full text-[12.5px]" data-action="get-number">
      <Link to="/admin/phone-numbers"><Plus className="mr-1 h-3.5 w-3.5" /> Get a number</Link>
    </Button>
  );
  if (q.isPending) return <p className="text-[12px] text-ink-muted">Looking for your numbers…</p>;
  if (q.error || choices.length === 0) return <div className="space-y-1.5" data-number-picker="empty"><p className="text-[12px] text-ink-muted">No spare numbers yet.</p>{getOne}</div>;
  return (
    <div className="space-y-2" data-number-picker>
      <Select value={id} onValueChange={setId}>
        <SelectTrigger className="h-9 text-[13px]" aria-label="Add a number" data-field="pick-number"><SelectValue placeholder="Add a number…" /></SelectTrigger>
        <SelectContent>
          {choices.map((n) => (
            <SelectItem key={n.id} value={n.id}>
              <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {fmtPhone(n.phoneNumber)} <NumberCaps sms={telnyxCanText(n.phoneNumber)} /></span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" className="h-8 flex-1 text-[12.5px]" disabled={!id || attach.isPending} onClick={() => attach.mutate()} data-action="attach-picked-number">{attach.isPending ? "Adding…" : "Add"}</Button>
        <Button asChild size="sm" variant="ghost" className="h-8 text-[12px]"><Link to="/admin/phone-numbers">Get another</Link></Button>
      </div>
    </div>
  );
}

/**
 * Add a number to a receptionist on the Vapi engine: the same dropdown as for Telnyx, listing the Twilio numbers the agency already has
 * (with what each can do). Adding one points it at this receptionist, exactly as the longer "Add a number" dialog does. With none to pick
 * (or no Twilio account yet), "Get a number" opens the Numbers page. The longer dialog stays under "More ways to add a number".
 */
export function VapiNumberPicker({ clientId, timezone, twilioOnly, onChanged }: { clientId: string; timezone?: string; twilioOnly?: boolean; onChanged: () => Promise<void> }) {
  const qc = useQueryClient();
  const account = useQuery({ ...twilioAccountQuery(), retry: false });
  const connected = Boolean(account.data?.connected && !account.data?.problem);
  const mine = useQuery({ queryKey: ["twilio", "numbers"], queryFn: twilioApi.numbers, enabled: connected, staleTime: 15_000, retry: false });
  const [number, setNumber] = useState("");
  const free = (mine.data?.numbers ?? []).filter((n) => !n.assignedTo);
  const attach = useMutation({
    mutationFn: () => importNumberFor(clientId, { source: "twilio", number }),
    onSuccess: async (res) => {
      const n = res.order.phoneNumbers[0];
      toast.success("Number added", { description: n ? `${fmtPhone(n)} now rings this receptionist.` : undefined });
      setNumber("");
      await qc.invalidateQueries({ queryKey: ["twilio", "numbers"] });
      await onChanged();
    },
    onError: (e: Error) => toast.error("Couldn't add that number", { description: e.message }),
  });
  const more = (
    <details className="mt-1 text-[12px]" data-more-numbers>
      <summary className="cursor-pointer text-ink-muted">More ways to add a number</summary>
      <ImportNumber clientId={clientId} timezone={timezone} twilioOnly={twilioOnly} onDone={onChanged} />
    </details>
  );
  const getOne = (
    <Button asChild size="sm" variant="outline" className="h-8 w-full text-[12.5px]" data-action="get-number">
      <Link to="/admin/phone-numbers"><Plus className="mr-1 h-3.5 w-3.5" /> Get a number</Link>
    </Button>
  );
  if (account.isPending || (connected && mine.isPending)) return <p className="text-[12px] text-ink-muted">Looking for your numbers…</p>;
  if (free.length === 0) return <div className="space-y-1.5" data-number-picker="empty"><p className="text-[12px] text-ink-muted">No spare numbers yet.</p>{getOne}{more}</div>;
  return (
    <div className="space-y-2" data-number-picker>
      <Select value={number} onValueChange={setNumber}>
        <SelectTrigger className="h-9 text-[13px]" aria-label="Add a number" data-field="pick-number"><SelectValue placeholder="Add a number…" /></SelectTrigger>
        <SelectContent>
          {free.map((n) => (
            <SelectItem key={n.id} value={n.phoneNumber}>
              <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {fmtPhone(n.phoneNumber)} <NumberCaps sms={n.sms} /></span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" className="h-8 flex-1 text-[12.5px]" disabled={!number || attach.isPending} onClick={() => attach.mutate()} data-action="attach-picked-number">{attach.isPending ? "Adding…" : "Add"}</Button>
        <Button asChild size="sm" variant="ghost" className="h-8 text-[12px]"><Link to="/admin/phone-numbers">Get another</Link></Button>
      </div>
      {more}
    </div>
  );
}
