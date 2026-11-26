import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/app/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OwnedNumbers } from "./-own-numbers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buyNumberFor, platformApi } from "@/lib/api/console";
import { twilioAccountQuery } from "@/lib/api/twilio";
import { fmtPhone } from "@/lib/app/format";
import { NUMBER_COUNTRIES, countryForTimezone, type AvailableNumber, type NumberCountry, type NumberType } from "@/lib/shared";
import { cn } from "@/lib/utils";

// An agency on its own phone account buys a number for a receptionist itself: pick
// one, see the monthly price, confirm. It's charged to the agency's Telnyx account.
// (Agencies on the platform's account request one instead.)
// Australia (mobile or local) or the US (local or toll-free); the country starts as
// the receptionist's, from its time zone.

const price = (n: AvailableNumber) => new Intl.NumberFormat("en-US", { style: "currency", currency: n.currency || "USD" }).format(n.monthly);
const typesOf = (c: NumberCountry) => NUMBER_COUNTRIES.find((x) => x.value === c)!.types;
const typeName = (c: NumberCountry, t: NumberType) => typesOf(c).find((x) => x.value === t)?.label.replace(/ \(.*\)$/, "").toLowerCase() ?? t;

export function BuyNumber({ clientId, timezone, onBought }: { clientId: string; timezone?: string; onBought: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"buy" | "own" | "twilio">("buy");
  // Twilio is a backup option: its tab only appears once the agency has connected a Twilio account.
  const twilio = useQuery({ ...twilioAccountQuery(), enabled: open });
  const showTwilio = Boolean(twilio.data?.connected);
  const qc = useQueryClient();
  const [country, setCountry] = useState<NumberCountry>(() => countryForTimezone(timezone));
  const [type, setType] = useState<NumberType>(() => typesOf(countryForTimezone(timezone))[0].value);
  const [picked, setPicked] = useState<AvailableNumber | null>(null);
  const q = useQuery({ queryKey: ["numbers", "available", country, type], queryFn: () => platformApi.availableNumbers(type, country), enabled: open && tab === "buy", staleTime: 60_000 });
  const buy = useMutation({
    mutationFn: () => buyNumberFor(clientId, picked!.phoneNumber),
    onSuccess: async (res) => {
      if (res.order.status === "success") toast.success("Number connected", { description: `${fmtPhone(picked!.phoneNumber)} now rings this receptionist.` });
      else toast.success("Number ordered", { description: "Telnyx is checking it before it goes live. It shows here once it's ready." });
      setOpen(false);
      setPicked(null);
      await qc.invalidateQueries({ queryKey: ["own-numbers"] });
      await onBought();
    },
    onError: (e: Error) => toast.error("Couldn't buy that number", { description: e.message }),
  });

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <Button type="button" size="sm" variant="outline" className="h-8 w-full text-[12.5px]" onClick={() => setOpen(true)} data-action="buy-number">
        <Phone /> Add a number
      </Button>
      <p className="mt-1.5 text-[11.5px] text-ink-muted">Buy one (charged to your Telnyx account each month) or use one you already own there.</p>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setPicked(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a phone number</DialogTitle>
            <DialogDescription>
              {tab === "buy" ? "Pick a number for this receptionist. Telnyx charges your account for it every month until you release it." : tab === "own" ? "Numbers on your Telnyx account that no receptionist answers yet." : "A backup option, for agencies that use Vapi for voice."}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "buy" | "own" | "twilio")}>
            <TabsList className={cn("grid w-full", showTwilio ? "grid-cols-[1fr_1fr_auto]" : "grid-cols-2")}>
              <TabsTrigger value="buy" data-tab="buy-new">Buy a new number</TabsTrigger>
              <TabsTrigger value="own" data-tab="use-existing">Use a number I already have</TabsTrigger>
              {showTwilio ? (
                <TabsTrigger value="twilio" data-tab="twilio-backup" className="px-2.5 text-[11.5px] font-normal text-ink-muted">
                  Twilio (backup)
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="twilio" className="mt-3">
              <Notice tone="info" title="Twilio numbers use the Vapi backup option">
                This receptionist runs on Telnyx (recommended), so it keeps a Telnyx number. To answer a Twilio number, switch your voice engine to Vapi under{" "}
                <Link to="/admin/connections" className="font-medium text-indigo hover:underline">
                  Connections, Other options (backup)
                </Link>
                .
              </Notice>
            </TabsContent>
            <TabsContent value="own" className="mt-3">
              <OwnedNumbers
                clientId={clientId}
                onChanged={async () => {
                  await qc.invalidateQueries({ queryKey: ["own-numbers"] });
                  await onBought();
                }}
              />
            </TabsContent>
          </Tabs>

          {tab === "buy" ? (
            <>

              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={country}
                  onValueChange={(v) => {
                    const c = v as NumberCountry;
                    setCountry(c);
                    setType(typesOf(c)[0].value);
                    setPicked(null);
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
                    setPicked(null);
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

              {country === "US" ? (
                <div data-note="us-texting">
                  <Notice tone="info">
                    US numbers take calls straight away; texting needs 10DLC (or toll-free) registration in Telnyx first, so it isn't switched on here.
                  </Notice>
                </div>
              ) : null}

              {q.isPending ? (
                <div className="flex items-center gap-2 py-6 text-[13px] text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Finding numbers…
                </div>
              ) : q.error ? (
                <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
                  {(q.error as Error).message}
                </div>
              ) : q.data.length === 0 ? (
                <p className="py-4 text-[13px] text-ink-muted">No {typeName(country, type)} numbers are available right now. Try the other type.</p>
              ) : (
                <ul className="max-h-[260px] space-y-1.5 overflow-y-auto" data-list="available-numbers" data-country={country}>
                  {q.data.map((n) => {
                    const on = picked?.phoneNumber === n.phoneNumber;
                    return (
                      <li key={n.phoneNumber}>
                        <button
                          type="button"
                          onClick={() => setPicked(n)}
                          aria-pressed={on}
                          data-number={n.phoneNumber}
                          className={cn("flex w-full items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-left text-[13px] transition-colors", on ? "border-indigo bg-[#f4f3ff]" : "border-hairline hover:bg-canvas-2")}
                        >
                          <span className="flex items-center gap-2 font-medium tabular-nums text-ink">
                            <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", on ? "border-indigo bg-indigo text-white" : "border-hairline")}>{on ? <Check className="h-3 w-3" /> : null}</span>
                            {fmtPhone(n.phoneNumber)}
                          </span>
                          <span className="shrink-0 text-ink-muted">{price(n)} a month</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => buy.mutate()} disabled={!picked || buy.isPending} data-action="confirm-buy-number">
                  {buy.isPending ? "Buying…" : picked ? `Buy for ${price(picked)} a month` : "Pick a number"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
