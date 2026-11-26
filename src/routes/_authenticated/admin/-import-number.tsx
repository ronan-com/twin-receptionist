import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/app/primitives";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importNumberFor, type ImportNumberInput } from "@/lib/api/console";
import { twilioAccountQuery, twilioApi } from "@/lib/api/twilio";
import { fmtPhone } from "@/lib/app/format";
import { NUMBER_COUNTRIES, countryForTimezone, type AvailableNumber, type NumberCountry, type NumberType } from "@/lib/shared";
import { cn } from "@/lib/utils";

// Numbers for a receptionist that runs on Vapi. Vapi doesn't sell Australian numbers (its free
// numbers are US only), so the usual way is a Twilio number: buy one on the agency's connected
// Twilio account here, or use one it already has. A Telnyx number can be brought over too.
// A Twilio mobile number also sends this receptionist's follow-up texts.

type Source = "twilio_have" | "twilio_buy" | "twilio_paste" | "telnyx" | "vapi";

const price = (n: AvailableNumber) => (n.monthly > 0 ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: n.currency || "USD" }).format(n.monthly)} a month` : "price in Twilio");
const typesOf = (c: NumberCountry) => NUMBER_COUNTRIES.find((x) => x.value === c)!.types;

function NeedsTwilio() {
  return (
    <Notice tone="info" title="Connect your Twilio account first">
      Add your Twilio account under{" "}
      <Link to="/admin/connections" className="font-medium text-indigo hover:underline">
        Connections
      </Link>
      , then come back here to buy a number or use one you already have.
    </Notice>
  );
}

/** Australian numbers need an approved regulatory bundle in Twilio: say where that stands. */
function Regulatory({ approved, inReview, consoleUrl }: { approved: boolean; inReview: number; consoleUrl: string }) {
  if (approved) return null;
  return (
    <div data-notice="twilio-regulatory" data-state={inReview ? "waiting" : "missing"}>
      <Notice tone="warning" title={inReview ? "Waiting for Twilio's approval" : "Twilio needs your business details first"}>
        {inReview
          ? "Your Australian regulatory bundle is being checked by Twilio, usually 1 to 3 business days. You can buy a number here once it's approved."
          : "Australian numbers need an approved regulatory bundle (business details and proof of address) in your Twilio account before you can buy one."}{" "}
        <a href={consoleUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-indigo hover:underline">
          Open it in Twilio <ExternalLink className="h-3 w-3" />
        </a>
      </Notice>
    </div>
  );
}

export function ImportNumber({ clientId, timezone, twilioOnly = false, onDone }: { clientId: string; timezone?: string; /** On the platform's phone account only the agency's own Twilio account is offered. */ twilioOnly?: boolean; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const account = useQuery({ ...twilioAccountQuery(), enabled: open });
  const connected = Boolean(account.data?.connected);
  const [source, setSource] = useState<Source>("twilio_have");
  const [number, setNumber] = useState("");
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [area, setArea] = useState("");
  const [picked, setPicked] = useState<string>("");
  const [country, setCountry] = useState<NumberCountry>(() => countryForTimezone(timezone));
  const [type, setType] = useState<NumberType>(() => typesOf(countryForTimezone(timezone))[0].value);
  const [buying, setBuying] = useState<AvailableNumber | null>(null);

  const mine = useQuery({ queryKey: ["twilio", "numbers"], queryFn: twilioApi.numbers, enabled: open && connected && (source === "twilio_have" || source === "twilio_buy"), staleTime: 15_000 });
  const found = useQuery({ queryKey: ["twilio", "available", country, type], queryFn: () => twilioApi.available(type, country), enabled: open && connected && source === "twilio_buy", staleTime: 60_000 });

  const input = (): ImportNumberInput => {
    if (source === "twilio_have") return { source: "twilio", number: picked };
    if (source === "twilio_buy") return { source: "twilio_buy", phoneNumber: buying!.phoneNumber, confirm: true };
    if (source === "twilio_paste") return { source: "twilio", number: number.trim(), accountSid: sid.trim(), authToken: token.trim() };
    if (source === "telnyx") return { source: "telnyx", number: number.trim(), apiKey: apiKey.trim() };
    return { source: "vapi", areaCode: area.trim() };
  };
  const ready =
    source === "twilio_have"
      ? Boolean(picked)
      : source === "twilio_buy"
        ? Boolean(buying) && Boolean(mine.data?.regulatory.approved || country === "US")
        : source === "vapi"
          ? /^\d{3}$/.test(area.trim())
          : Boolean(number.trim()) && (source === "twilio_paste" ? Boolean(sid.trim() && token.trim()) : Boolean(apiKey.trim()));

  const run = useMutation({
    mutationFn: () => importNumberFor(clientId, input()),
    onSuccess: async (res) => {
      const n = res.order.phoneNumbers[0];
      toast.success("Number connected", { description: n ? `${fmtPhone(n)} now rings this receptionist.` : "It now rings this receptionist." });
      setOpen(false);
      setToken("");
      setApiKey("");
      setPicked("");
      setBuying(null);
      await onDone();
    },
    onError: (e: Error) => toast.error("Couldn't connect that number", { description: e.message }),
  });

  const twilioSource = source === "twilio_have" || source === "twilio_buy";

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <Button type="button" size="sm" variant="outline" className="h-8 w-full text-[12.5px]" onClick={() => setOpen(true)} data-action="import-number">
        <Phone /> Add a number
      </Button>
      <p className="mt-1.5 text-[11.5px] text-ink-muted">Vapi can't sell Australian numbers. Buy or use a Twilio number, or bring one from Telnyx.</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a phone number</DialogTitle>
            <DialogDescription>Vapi answers a number from your own Twilio or Telnyx account. Your provider keeps billing you for the number itself.</DialogDescription>
          </DialogHeader>

          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v as Source);
              setBuying(null);
              setPicked("");
            }}
          >
            <SelectTrigger className="h-9 text-[13px]" aria-label="Where the number is" data-field="number-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="twilio_have">A Twilio number I already have</SelectItem>
              <SelectItem value="twilio_buy">Buy a new Twilio number</SelectItem>
              {twilioOnly ? null : (
                <>
                  <SelectItem value="telnyx">A number on my Telnyx account</SelectItem>
                  <SelectItem value="twilio_paste">A number on a different Twilio account</SelectItem>
                  <SelectItem value="vapi">A free US number from Vapi</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>

          {twilioSource && account.isPending ? (
            <div className="flex items-center gap-2 py-4 text-[13px] text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your Twilio account…
            </div>
          ) : twilioSource && !connected ? (
            <NeedsTwilio />
          ) : source === "twilio_have" ? (
            <div className="space-y-2">
              {mine.isPending ? (
                <div className="flex items-center gap-2 py-4 text-[13px] text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Looking at your Twilio numbers…
                </div>
              ) : mine.error ? (
                <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
                  {(mine.error as Error).message}
                </div>
              ) : mine.data.numbers.length === 0 ? (
                <p className="py-3 text-[13px] text-ink-muted">There are no numbers on your Twilio account yet. Buy one here, or in Twilio.</p>
              ) : (
                <ul className="max-h-[260px] space-y-1.5 overflow-y-auto" data-list="twilio-numbers">
                  {mine.data.numbers.map((n) => {
                    const on = picked === n.phoneNumber;
                    const taken = Boolean(n.assignedTo);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          disabled={taken}
                          onClick={() => setPicked(n.phoneNumber)}
                          aria-pressed={on}
                          data-number={n.phoneNumber}
                          className={cn("flex w-full items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-left text-[13px] transition-colors", on ? "border-indigo bg-[#f4f3ff]" : "border-hairline hover:bg-canvas-2", taken && "opacity-60 hover:bg-transparent")}
                        >
                          <span className="flex items-center gap-2 font-medium tabular-nums text-ink">
                            <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", on ? "border-indigo bg-indigo text-white" : "border-hairline")}>{on ? <Check className="h-3 w-3" /> : null}</span>
                            {fmtPhone(n.phoneNumber)}
                          </span>
                          <span className="shrink-0 text-[12px] text-ink-muted">{taken ? `Answers for ${n.assignedTo}` : n.sms ? "Calls + texts" : "Calls only"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[11.5px] text-ink-muted">A mobile number that can text also sends this receptionist's follow-up texts.</p>
            </div>
          ) : source === "twilio_buy" ? (
            <div className="space-y-2">
              {mine.data && country === "AU" ? <Regulatory {...mine.data.regulatory} /> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={country}
                  onValueChange={(v) => {
                    const c = v as NumberCountry;
                    setCountry(c);
                    setType(typesOf(c)[0].value);
                    setBuying(null);
                  }}
                >
                  <SelectTrigger className="h-9 text-[13px]" aria-label="Country" data-field="number-country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUMBER_COUNTRIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={type}
                  onValueChange={(v) => {
                    setType(v as NumberType);
                    setBuying(null);
                  }}
                >
                  <SelectTrigger className="h-9 text-[13px]" aria-label="Number type" data-field="number-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typesOf(country).map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {found.isPending ? (
                <div className="flex items-center gap-2 py-4 text-[13px] text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Finding numbers…
                </div>
              ) : found.error ? (
                <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
                  {(found.error as Error).message}
                </div>
              ) : found.data.length === 0 ? (
                <p className="py-3 text-[13px] text-ink-muted">No numbers of that type are available right now. Try the other type.</p>
              ) : (
                <ul className="max-h-[220px] space-y-1.5 overflow-y-auto" data-list="twilio-available">
                  {found.data.map((n) => {
                    const on = buying?.phoneNumber === n.phoneNumber;
                    return (
                      <li key={n.phoneNumber}>
                        <button
                          type="button"
                          onClick={() => setBuying(n)}
                          aria-pressed={on}
                          data-number={n.phoneNumber}
                          className={cn("flex w-full items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-left text-[13px] transition-colors", on ? "border-indigo bg-[#f4f3ff]" : "border-hairline hover:bg-canvas-2")}
                        >
                          <span className="flex items-center gap-2 font-medium tabular-nums text-ink">
                            <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", on ? "border-indigo bg-indigo text-white" : "border-hairline")}>{on ? <Check className="h-3 w-3" /> : null}</span>
                            {fmtPhone(n.phoneNumber)}
                          </span>
                          <span className="shrink-0 text-[12px] text-ink-muted">
                            {price(n)}
                            {n.sms ? " · texts" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[11.5px] text-ink-muted">Charged to your Twilio account every month until you release the number in Twilio.</p>
            </div>
          ) : source === "vapi" ? (
            <div className="space-y-2">
              <Notice tone="info">Vapi's free numbers are US numbers and take inbound calls only. Use this for testing, or for a US business.</Notice>
              <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="US area code, e.g. 415" inputMode="numeric" maxLength={3} aria-label="US area code" data-field="area-code" />
            </div>
          ) : (
            <div className="space-y-2">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Number with country code, e.g. +61412345678" aria-label="Phone number" data-field="number" />
              {source === "twilio_paste" ? (
                <>
                  <Input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="Twilio Account SID (starts with AC)" autoComplete="off" spellCheck={false} aria-label="Twilio Account SID" className="font-mono text-[13px]" />
                  <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Twilio auth token" autoComplete="off" aria-label="Twilio auth token" className="font-mono text-[13px]" />
                </>
              ) : (
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Telnyx API key for that number" autoComplete="off" spellCheck={false} aria-label="Telnyx API key" className="font-mono text-[13px]" />
              )}
              <p className="text-[11.5px] text-ink-muted">The key is passed to Vapi to link the number and isn't kept here.{source === "twilio_paste" ? " Texts only go out from numbers on your connected Twilio account." : ""}</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} disabled={!ready || run.isPending} data-action="confirm-import-number">
              {run.isPending ? "Connecting…" : source === "twilio_buy" && buying ? `Buy and connect (${price(buying)})` : "Connect number"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
