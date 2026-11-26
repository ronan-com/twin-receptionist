import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/app/primitives";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importNumberFor, type ImportNumberInput } from "@/lib/api/console";
import { fmtPhone } from "@/lib/app/format";

// Numbers for a receptionist that runs on Vapi. Vapi doesn't sell Australian numbers
// (its free numbers are US only), so the usual way is to bring one the agency already
// has with Twilio or Telnyx and point it at the receptionist.

type Source = "twilio" | "telnyx" | "vapi";

export function ImportNumber({ clientId, onDone }: { clientId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("twilio");
  const [number, setNumber] = useState("");
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [area, setArea] = useState("");

  const input = (): ImportNumberInput =>
    source === "twilio" ? { source, number: number.trim(), accountSid: sid.trim(), authToken: token.trim() } : source === "telnyx" ? { source, number: number.trim(), apiKey: apiKey.trim() } : { source, areaCode: area.trim() };
  const ready = source === "vapi" ? /^\d{3}$/.test(area.trim()) : Boolean(number.trim()) && (source === "twilio" ? Boolean(sid.trim() && token.trim()) : Boolean(apiKey.trim()));

  const run = useMutation({
    mutationFn: () => importNumberFor(clientId, input()),
    onSuccess: async (res) => {
      const n = res.order.phoneNumbers[0];
      toast.success("Number connected", { description: n ? `${fmtPhone(n)} now rings this receptionist.` : "It now rings this receptionist." });
      setOpen(false);
      setToken("");
      setApiKey("");
      await onDone();
    },
    onError: (e: Error) => toast.error("Couldn't connect that number", { description: e.message }),
  });

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <Button type="button" size="sm" variant="outline" className="h-8 w-full text-[12.5px]" onClick={() => setOpen(true)} data-action="import-number">
        <Phone /> Connect a number
      </Button>
      <p className="mt-1.5 text-[11.5px] text-ink-muted">Vapi can't sell Australian numbers. Bring one from Twilio or Telnyx.</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a phone number</DialogTitle>
            <DialogDescription>Vapi answers a number you already own with Twilio or Telnyx. Your provider keeps billing you for the number itself.</DialogDescription>
          </DialogHeader>

          <Select value={source} onValueChange={(v) => setSource(v as Source)}>
            <SelectTrigger className="h-9 text-[13px]" aria-label="Where the number is" data-field="number-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="twilio">A number on my Twilio account</SelectItem>
              <SelectItem value="telnyx">A number on my Telnyx account</SelectItem>
              <SelectItem value="vapi">A free US number from Vapi</SelectItem>
            </SelectContent>
          </Select>

          {source === "vapi" ? (
            <div className="space-y-2">
              <Notice tone="info">Vapi's free numbers are US numbers and take inbound calls only. Use this for testing, or for a US business.</Notice>
              <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="US area code, e.g. 415" inputMode="numeric" maxLength={3} aria-label="US area code" data-field="area-code" />
            </div>
          ) : (
            <div className="space-y-2">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Number with country code, e.g. +61412345678" aria-label="Phone number" data-field="number" />
              {source === "twilio" ? (
                <>
                  <Input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="Twilio Account SID (starts with AC)" autoComplete="off" spellCheck={false} aria-label="Twilio Account SID" className="font-mono text-[13px]" />
                  <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Twilio auth token" autoComplete="off" aria-label="Twilio auth token" className="font-mono text-[13px]" />
                </>
              ) : (
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Telnyx API key for that number" autoComplete="off" spellCheck={false} aria-label="Telnyx API key" className="font-mono text-[13px]" />
              )}
              <p className="text-[11.5px] text-ink-muted">The key is passed to Vapi to link the number and isn't kept here.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} disabled={!ready || run.isPending} data-action="confirm-import-number">
              {run.isPending ? "Connecting…" : "Connect number"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
