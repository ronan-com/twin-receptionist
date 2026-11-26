import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Clock, Loader2, MessageSquareText, Phone, PhoneForwarded, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, ErrorState, MetricCard, MetricGrid, Notice, EmptyState } from "@/components/app/primitives";
import { HealthDot, NumberStatusBadge, StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtNumber, fmtPhone, fmtRelative } from "@/lib/app/format";
import { agentsQuery, phoneNumbersQuery } from "@/lib/app/queries";
import { requestNumber } from "@/lib/api/manage";
import { useWorkspace } from "@/lib/app/workspace";
import { named } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/phone-numbers")({
  head: () => ({ meta: [{ title: named("Call handling — Answered") }] }),
  component: PhoneNumbersPage,
});

// How a business sends its existing number's calls to the receptionist (call
// forwarding codes used by the main Australian carriers).
const FORWARDING = [
  { title: "All calls", code: "**21*{n}#", hint: "Every call goes straight to your receptionist." },
  { title: "When busy", code: "**67*{n}#", hint: "Only when you're already on a call." },
  { title: "When unanswered", code: "**61*{n}#", hint: "If you don't pick up within about 20 seconds." },
  { title: "When unreachable", code: "**62*{n}#", hint: "When your phone is off or out of range." },
];

function PhoneNumbersPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const numbersQ = useQuery(phoneNumbersQuery(ws.businessId));
  const agentsQ = useQuery(agentsQuery(ws.businessId));
  const canManage = ws.access.canManage;

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"local" | "mobile">("local");
  const [note, setNote] = useState("");

  const all = numbersQ.data ?? [];
  const numbers = all.filter((n) => n.status !== "pending");
  const pending = all.filter((n) => n.status === "pending");
  const agent = agentsQ.data?.[0] ?? null;
  const main = numbers[0]?.e164 ?? null;
  const unhealthy = numbers.filter((n) => n.health !== "healthy");

  const request = useMutation({
    mutationFn: async () => {
      if (!ws.businessId) throw new Error("No business selected.");
      return requestNumber(ws.businessId, { type, note: note.trim() });
    },
    onSuccess: () => {
      toast.success("Number requested", { description: "We'll set it up and connect it to your receptionist. You'll see it here once it's live." });
      setOpen(false);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["phone-numbers", ws.businessId] });
    },
    onError: (e) => toast.error("Couldn't request a number", { description: e.message }),
  });

  const requestButton = (label = "Request a number", variant: "outline" | "default" = "outline") =>
    canManage ? (
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} disabled={pending.length >= 2}>
        <Phone className="mr-1.5 h-3.5 w-3.5" /> {label}
      </Button>
    ) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title="Call handling"
        description="The numbers your receptionist answers on, and how to send your existing number's calls to it."
        actions={requestButton()}
      />

      {numbersQ.error ? <ErrorState message={numbersQ.error.message} onRetry={() => void numbersQ.refetch()} /> : null}
      {!canManage ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Only managers can request numbers."}</Notice> : null}
      {pending.length > 0 ? (
        <Notice tone="info" title={pending.length === 1 ? "A number is on its way" : `${pending.length} numbers are on their way`}>
          {pending.map((p) => `${p.friendly_name}${p.notes ? ` (${p.notes})` : ""}, requested ${fmtRelative(p.created_at)}`).join(" · ")}. We'll connect it to your receptionist and it will show here once it's live.
        </Notice>
      ) : null}

      <MetricGrid cols={3}>
        <MetricCard label="Connected numbers" value={fmtNumber(numbers.length)} icon={Phone} loading={numbersQ.isPending} hint={pending.length ? `${pending.length} requested` : "Answered by your receptionist"} />
        <MetricCard label="Answered by" value={agent?.name ?? "—"} icon={Bot} loading={agentsQ.isPending} hint="Day and night, every call" />
        <MetricCard
          label="Health"
          value={numbers.length === 0 ? "—" : unhealthy.length === 0 ? "All good" : "Attention"}
          icon={ShieldCheck}
          loading={numbersQ.isPending}
          hint={numbers.length === 0 ? "No number connected yet" : unhealthy.length ? `${unhealthy.length} number(s) need a look` : "Every number is answering"}
        />
      </MetricGrid>

      {numbersQ.isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-[6px] border border-hairline bg-canvas-2" />
          ))}
        </div>
      ) : numbers.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Phone}
            title="No number connected yet"
            description="Request a local or mobile number and we'll connect it to your receptionist. You keep your existing number and forward calls to it."
            action={requestButton("Request a number", "default") ?? undefined}
          />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {numbers.map((n) => {
            const caps = (n.capabilities && typeof n.capabilities === "object" && !Array.isArray(n.capabilities) ? (n.capabilities as Record<string, unknown>) : {}) as Record<string, unknown>;
            return (
              <div key={n.id} className="card-surface flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <HealthDot health={n.health} />
                      <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">{fmtPhone(n.e164)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-ink-muted">{n.friendly_name ?? "Main line"} · {n.country ?? "AU"}</div>
                  </div>
                  <NumberStatusBadge status={n.status} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                  <div className="rounded-[4px] bg-canvas-2 px-2.5 py-2">
                    <div className="text-[11px] text-ink-muted">Routing</div>
                    <div className="mt-0.5 flex items-center gap-1.5 font-medium text-ink">
                      <Bot className="h-3.5 w-3.5 text-indigo" /> AI receptionist
                    </div>
                  </div>
                  <div className="rounded-[4px] bg-canvas-2 px-2.5 py-2">
                    <div className="text-[11px] text-ink-muted">Answered by</div>
                    <div className="mt-0.5 truncate font-medium text-ink">{n.agent?.name ?? agent?.name ?? "—"}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {caps["voice"] === true ? <StatusBadge tone="muted">Calls</StatusBadge> : null}
                  {caps["sms"] === true ? <StatusBadge tone="muted"><MessageSquareText className="h-3 w-3" /> Texts</StatusBadge> : null}
                  <span className="text-[11.5px] text-ink-muted">{n.last_health_check_at ? `Checked ${fmtRelative(n.last_health_check_at)}` : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Notice tone="neutral">Calls to these numbers always go to your receptionist. To change routing, contact support.</Notice>

      <Panel title="Forward your existing number" description="Keep the number your customers know. Dial one of these codes on that phone to send its calls to your receptionist.">
        {main ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {FORWARDING.map((f) => {
              // Dialled as a national number: 0412 345 678 in Australia, 2125550123 in the US.
              const digits = main.startsWith("+1") ? main.slice(2) : main.replace(/^\+61/, "0");
              return (
                <div key={f.title} className="rounded-[6px] border border-hairline p-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    {f.title === "All calls" ? <PhoneForwarded className="h-3.5 w-3.5 text-indigo" /> : <Clock className="h-3.5 w-3.5 text-ink-muted" />}
                    {f.title}
                  </div>
                  <div className="mt-1.5 break-all font-mono text-[13px] text-ink">{f.code.replace("{n}", digits)}</div>
                  <p className="mt-1 text-[12px] leading-5 text-ink-muted">{f.hint}</p>
                </div>
              );
            })}
            <p className="text-[12px] text-ink-muted sm:col-span-2">
              To stop forwarding, dial <span className="font-mono">##002#</span>. Codes can differ by carrier and on business phone systems; your provider can set it up for you.
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">Once your receptionist has a number, the forwarding codes for it show here.</p>
        )}
      </Panel>

      <Panel title="Test your receptionist">
        <p className="text-[12.5px] text-ink-muted">
          Call your number from any phone. Afterwards the call shows in <Link to="/app/calls" className="text-indigo hover:underline">Calls</Link> with a summary and transcript.
        </p>
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a number</DialogTitle>
            <DialogDescription>We buy and connect the number for you, usually within one business day. Numbers can't be bought from this screen.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Type of number" htmlFor="nr-type" hint={type === "mobile" ? "A mobile number takes calls and texts." : "A local landline number for your area. Calls only."}>
              <Select value={type} onValueChange={(v) => setType(v as "local" | "mobile")}>
                <SelectTrigger id="nr-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local number</SelectItem>
                  <SelectItem value="mobile">Mobile (calls and texts)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Anything we should know?" htmlFor="nr-note" hint="Optional. E.g. preferred area code, or that you want to keep an existing number.">
              <Textarea id="nr-note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A Brisbane 07 number please" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => request.mutate()} disabled={request.isPending}>
              {request.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
