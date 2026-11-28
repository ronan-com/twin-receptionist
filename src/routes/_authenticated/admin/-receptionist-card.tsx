import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Pause, Pencil, Phone, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Panel, KeyValue } from "@/components/app/primitives";
import { DemoBadge, StatusBadge } from "@/components/app/StatusBadge";
import { fmtDate, fmtPhone, humanize } from "@/lib/app/format";
import { applyVapiVoiceSettings, getVoiceEngines, moveReceptionistEngine, requestNumberFor, setBusinessStatus, type CompanyReceptionist } from "@/lib/api/console";
import { getEmail } from "@/lib/api/manage";
import { InboxSetup } from "@/components/app/editor/InboxSetup";
import { useSignInOutcome } from "@/components/app/editor/SignInSetup";
import { describeHours, industry as industryPreset, type IndustryKey } from "@/lib/shared";
import { AutomationChips, AutomationIcon, useConsole } from "./-shared";
import { NumberPicker, VapiNumberPicker } from "./-number-picker";
import { AttachedNumbers } from "./-own-numbers";
import { TextsSwitch } from "./-texts-switch";
import { TestCall } from "@/components/app/TestCall";
import { TryEmail, TryMessages } from "@/components/app/editor/TryIt";
import { TelegramSetup } from "@/components/app/telegram/TelegramSetup";
import { WebsiteChatCard } from "@/components/app/webchat/WebsiteChatCard";

// One receptionist's settings, a channel at a time: AI Voice Agent (calls, number, test call),
// AI Message Agent (texts, website chat, Telegram) and AI Email Agent (the inbox). Used by the
// receptionist's own page (/admin/receptionists/<id>/...), not the client's page.

/** Where each row of the status list is set up. */
const AUTOMATION_TAB = { voice: "voice", sms: "messages", email: "email", booking: "booking", crm: "booking" } as const;

export function ReceptionistCard({
  r,
  companyName,
  ownOrg,
  platform,
  readOnly,
  canManage,
  onOpen,
  onChanged,
  section,
  advancedExtra,
}: {
  r: CompanyReceptionist;
  companyName: string;
  ownOrg: boolean;
  platform: boolean;
  readOnly: boolean;
  canManage: boolean;
  onOpen?: () => void;
  onChanged: () => Promise<void>;
  /** Which channel's settings to show under the header. */
  section: "voice" | "messages" | "email" | "advanced";
  /** Extra things shown in Advanced (knowledge, automations), added by the page. */
  advancedExtra?: ReactNode;
}) {
  const [numType, setNumType] = useState<"local" | "mobile">("mobile");
  const [numNote, setNumNote] = useState("");
  // An agency on its own phone account buys numbers itself; on the platform's it asks for one.
  // With SINGLE_AGENCY the server's key is the agency's own, so it buys them too.
  const { ws: consoleWs, single } = useConsole();
  const ownPhone = (consoleWs.session?.telnyx === "own" || single) && !platform;
  const s = r.settings;
  const paused = r.status === "paused";
  const pause = useMutation({
    mutationFn: (status: "active" | "paused") => setBusinessStatus(r.id, status),
    onSuccess: async (_d, status) => {
      toast.success(status === "paused" ? `${r.name} paused` : `${r.name} resumed`);
      await onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const request = useMutation({
    mutationFn: () => requestNumberFor(r.id, numType, numNote.trim()),
    onSuccess: async () => {
      toast.success("Number requested", { description: "The platform team will buy and connect it." });
      setNumNote("");
      await onChanged();
    },
    onError: (e: Error) => toast.error("Couldn't request a number", { description: e.message }),
  });
  const who = r.business_name || companyName;
  // An agency with both engines connected can move a receptionist between them.
  const enginesQ = useQuery({ queryKey: ["console", "voice-engines"], queryFn: getVoiceEngines, staleTime: 5 * 60_000, enabled: canManage && !readOnly && !platform });
  const engineLabel = r.provider === "vapi" ? "Vapi" : "Telnyx";
  const otherEngine = r.provider === "vapi" ? "telnyx" : "vapi";
  const otherLabel = otherEngine === "vapi" ? "Vapi" : "Telnyx";
  const canMove = Boolean(enginesQ.data?.engines.find((e) => e.id === otherEngine)?.connected);
  const [moving, setMoving] = useState(false);
  const move = useMutation({
    mutationFn: () => moveReceptionistEngine(r.id, otherEngine),
    onSuccess: async (res) => {
      setMoving(false);
      toast.success(`${r.name} now runs on ${otherLabel}`, {
        description: res.detached.length
          ? `${res.detached.map(fmtPhone).join(", ")} no longer rings it (${otherLabel} can't answer ${engineLabel === "Vapi" ? "a Twilio" : "a Telnyx"} number). Add a ${otherLabel === "Vapi" ? "Twilio" : "Telnyx"} number below.`
          : `Add a ${otherLabel === "Vapi" ? "Twilio" : "Telnyx"} number below when you're ready.`,
        duration: 12_000,
      });
      await onChanged();
    },
    onError: (e: Error) => toast.error(`Couldn't move it to ${otherLabel}`, { description: e.message }),
  });
  const applyVoice = useMutation({
    mutationFn: () => applyVapiVoiceSettings(r.id),
    onSuccess: async () => {
      toast.success("Voice settings applied", { description: "It now uses the faster voice setup: quicker replies and turn-taking." });
      await onChanged();
    },
    onError: (e: Error) => toast.error("Couldn't apply the voice settings", { description: e.message }),
  });
  // An agency owner or admin on its own phone account sees each number as Telnyx reports it (approval status, disconnect).
  const showOwnNumbers = !readOnly && ownPhone && canManage && r.provider !== "vapi";
  const plainNumbers = r.numbers.length ? (
    <ul className="space-y-1.5" data-list="numbers">
      {r.numbers.map((n) => (
        <li key={n.id} className="flex items-center justify-between gap-2 text-[13px]">
          <span className="flex items-center gap-1.5 tabular-nums">
            <Phone className="h-3.5 w-3.5 text-ink-muted" /> {n.friendly_name}
          </span>
          <StatusBadge tone="success">{n.capabilities.sms ? "Calls + texts" : "Calls"}</StatusBadge>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-[12.5px] text-ink-muted">No number yet.</p>
  );

  const advancedButtons = (
    <div className="flex flex-wrap gap-2" data-advanced-actions>
      {canManage && !readOnly && r.provider === "vapi" ? (
        <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={() => applyVoice.mutate()} disabled={applyVoice.isPending} data-action="apply-voice-settings" title="Push the faster voice setup (model, voice and turn-taking) to this receptionist">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${applyVoice.isPending ? "animate-spin" : ""}`} /> Apply new voice settings
        </Button>
      ) : null}
      {canManage && !readOnly && canMove ? (
        <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={() => setMoving(true)} data-action={`move-to-${otherEngine}`}>
          <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> Move to {otherLabel}
        </Button>
      ) : null}
    </div>
  );

  const advancedBlock = (
    <div className="space-y-4">
      <Panel title="Controls" description="Rarely needed.">{advancedButtons}</Panel>
      {advancedExtra}
    </div>
  );

  return (
    <div className="space-y-4" data-receptionist-card={r.id}>
      {canManage || r.onboarding_pending || r.demo_assistant ? (
        <div className="flex flex-wrap items-center gap-2">
          {paused ? <StatusBadge tone="muted" dot>Paused</StatusBadge> : null}
          {r.onboarding_pending ? <StatusBadge tone="warning">Waiting for client</StatusBadge> : null}
          {r.demo_assistant ? <DemoBadge /> : null}
          <span data-engine={r.provider}><StatusBadge tone="muted">{engineLabel}</StatusBadge></span>
          {canManage ? (
            paused ? (
              <Button variant="outline" size="sm" className="ml-auto h-7 text-[12px]" onClick={() => pause.mutate("active")} disabled={pause.isPending} data-action="resume-receptionist">
                <Play className="mr-1 h-3.5 w-3.5" /> Resume
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="ml-auto h-7 text-[12px]" onClick={() => pause.mutate("paused")} disabled={pause.isPending} data-action="pause-receptionist">
                <Pause className="mr-1 h-3.5 w-3.5" /> Pause
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      <AlertDialog open={moving} onOpenChange={(o) => !move.isPending && setMoving(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {r.name} to {otherLabel}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[13px]">
                <p>It's set up again on {otherLabel} with everything it has now: its script, business details, knowledge, booking, call handling and the closest {otherLabel} voice. Then the {engineLabel} one is removed.</p>
                {r.numbers.length ? (
                  <p data-warning="numbers">
                    <strong>Its number{r.numbers.length > 1 ? "s" : ""} ({r.numbers.map((n) => n.friendly_name).join(", ")}) will stop ringing it.</strong> {otherLabel} can't answer {engineLabel === "Vapi" ? "a Twilio" : "a Telnyx"} number. The number stays on your {engineLabel === "Vapi" ? "Twilio" : "Telnyx"} account; add a {otherLabel === "Vapi" ? "Twilio" : "Telnyx"} number here afterwards.
                  </p>
                ) : (
                  <p>It has no number yet. Add a {otherLabel === "Vapi" ? "Twilio" : "Telnyx"} number afterwards.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={move.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                move.mutate();
              }}
              disabled={move.isPending}
              data-action="confirm-move-engine"
            >
              {move.isPending ? "Moving…" : `Move to ${otherLabel}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {section === "voice" ? (
        <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]" data-receptionist={r.id}>
        <div className="min-w-0 space-y-3">
          {s.greeting ? <p className="rounded-[8px] bg-canvas-2 px-3 py-2 text-[13px] text-ink">“{s.greeting}”</p> : null}
          <details className="rounded-[8px] border border-hairline px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink">More</summary>
          <ul className="mt-2 divide-y divide-hairline rounded-[6px] border border-hairline" data-list="automations">
            {r.automations.map((a) => (
              <li key={a.key} className="row-hover grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 px-3 py-2 text-[12.5px] sm:grid-cols-[auto_minmax(0,1fr)_7.5rem_4.5rem]" data-automation-row={a.key}>
                <AutomationIcon automation={a.key} />
                <div className="min-w-0">
                  <div className="font-medium text-ink">{a.label}</div>
                  {a.detail ? <div className="break-words text-[11.5px] text-ink-muted">{a.detail}</div> : null}
                </div>
                <div className="justify-self-end sm:justify-self-start"><AutomationChips items={[{ ...a, label: a.state }]} /></div>
                <Button asChild size="sm" variant="outline" className="col-start-2 h-7 justify-self-start text-[12px] sm:col-start-auto sm:justify-self-end">
                  <Link to="/admin/receptionists/$receptionistId" params={{ receptionistId: r.id }} search={{ tab: AUTOMATION_TAB[a.key] }} data-action={`go-${a.key}`}>
                    {a.state === "Not set up" ? "Set up" : "Open"}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
          <KeyValue
            className="mt-3"
            items={[
              { label: "Industry", value: industryPreset((s.industry as IndustryKey) ?? "other").label },
              { label: "Suburb", value: s.suburb || "—" },
              { label: "Hours", value: s.hours ? describeHours(s.hours).join("; ") : "—" },
              { label: "Callers can ask for", value: s.services.join(", ") || "—" },
            ]}
          />
          </details>
        </div>
        <div className="min-w-0">
          {/* Try it (voice): the test call and the voice preview live here. */}
          <div data-try="voice">{!readOnly && !paused && !r.demo_assistant ? <TestCall assistantId={r.provider_agent_id} provider={r.provider} clientId={r.business_id} /> : null}</div>
          <div className="mb-1.5 mt-3 text-[12.5px] font-medium text-ink">Phone number</div>
          {showOwnNumbers ? <AttachedNumbers clientId={r.id} fallback={plainNumbers} onChanged={onChanged} /> : plainNumbers}
          {r.number_requests.length ? (
            <ul className="mt-3 space-y-1 border-t border-hairline pt-3 text-[12px]" data-list="number-requests">
              {r.number_requests.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ink-muted">
                    {n.type === "mobile" ? "Mobile" : "Local"} · {fmtDate(n.created_at)}
                    {n.status === "declined" && n.reason ? ` · ${n.reason}` : ""}
                    {n.status === "done" && n.phone_number ? ` · ${fmtPhone(n.phone_number)}` : ""}
                  </span>
                  <StatusBadge tone={n.status === "pending" ? "warning" : n.status === "done" ? "success" : "muted"}>{humanize(n.status)}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {!readOnly && ownPhone ? (
            canManage ? (
              <div className="mt-3 border-t border-hairline pt-3">{r.provider === "vapi" ? <VapiNumberPicker clientId={r.id} timezone={s.timezone} onChanged={onChanged} /> : <NumberPicker clientId={r.id} onChanged={onChanged} />}</div>
            ) : (
              <p className="mt-3 border-t border-hairline pt-3 text-[12px] text-ink-muted">Ask an owner or admin to add a number.</p>
            )
          ) : !readOnly ? (
            <>
            {r.provider === "vapi" && canManage && !platform ? <div className="mt-3 border-t border-hairline pt-3"><VapiNumberPicker clientId={r.id} timezone={s.timezone} twilioOnly onChanged={onChanged} /></div> : null}
            <details className="mt-3 border-t border-hairline pt-3" open>
            <summary className="cursor-pointer text-[12.5px] font-medium text-ink">Get a number</summary>
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                request.mutate();
              }}
            >
              <Select value={numType} onValueChange={(v) => setNumType(v as "local" | "mobile")}>
                <SelectTrigger className="h-8 text-[12.5px]" aria-label="Number type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mobile">Calls + Texts (mobile)</SelectItem>
                  <SelectItem value="local">Calls only (local)</SelectItem>
                </SelectContent>
              </Select>
              <Input value={numNote} onChange={(e) => setNumNote(e.target.value)} placeholder="Note (optional), e.g. Brisbane area code" className="h-8 text-[12.5px]" maxLength={300} />
              <Button type="submit" size="sm" variant="outline" className="h-8 w-full text-[12.5px]" disabled={request.isPending} data-action="request-number">
                {request.isPending ? "Requesting…" : "Request number"}
              </Button>
              {platform ? (
                <p className="text-[11.5px] text-ink-muted">
                  Then buy it from <Link to="/admin/number-requests" className="text-indigo hover:underline">Number requests</Link>.
                </p>
              ) : null}
            </form>
            </details>
            </>
          ) : null}
        </div>
      </div>
        </>
      ) : null}
      {section === "messages" ? (
        <div className="space-y-4">
          {!r.demo_assistant ? (
            <Panel title="Text messages" description={`Customers can text ${who}'s number and the receptionist replies.`}>
              <TextsSwitch clientId={r.id} canEdit={canManage && !readOnly} />
            </Panel>
          ) : null}
          {!r.demo_assistant && !readOnly ? <TryMessages clientId={r.id} name={r.name} /> : null}
          <div data-website-chat={r.id}>
            <WebsiteChatCard clientId={r.id} businessName={who} />
          </div>
          <div data-telegram={r.id}>
            <Panel title="Telegram" description={`A Telegram bot for ${who}. It answers like the website chat.`}>
              <TelegramSetup clientId={r.id} />
            </Panel>
          </div>
        </div>
      ) : null}
      {section === "email" ? <EmailPanel clientId={r.id} who={who} canEdit={canManage && !readOnly && !r.demo_assistant} canTry={!readOnly && !r.demo_assistant} /> : null}
      {section === "advanced" ? advancedBlock : null}
    </div>
  );
}

/** The AI Email Agent: the inbox the receptionist reads, and whether it drafts replies or sends them. */
function EmailPanel({ clientId, who, canEdit, canTry }: { clientId: string; who: string; canEdit: boolean; canTry: boolean }) {
  // Back from "Connect Gmail / Outlook".
  useSignInOutcome();
  const e = useQuery({ queryKey: ["email", clientId], queryFn: () => getEmail(clientId), retry: false }).data;
  return (
    <div className="space-y-4">
      <Panel title="Email" description={`${who} reads new emails and replies.`}>
        <InboxSetup businessId={clientId} canEdit={canEdit} editor />
      </Panel>
      {canTry ? <TryEmail clientId={clientId} mode={e?.connected ? e.mode : null} connected={Boolean(e?.connected)} /> : null}
    </div>
  );
}
