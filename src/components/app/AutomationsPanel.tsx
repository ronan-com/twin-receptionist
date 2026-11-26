import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Languages, MessageSquareText, Mic, MoonStar, PhoneCall, PhoneForwarded, Star, Timer, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, Notice, PageSkeleton } from "@/components/app/primitives";
import { Field, SaveBar } from "@/components/app/forms";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import {
  automationsQueryKey,
  getAutomations,
  saveAutomations,
  type AutomationKey,
  type AutomationSettings,
  type AutomationStatus,
  type AutomationsPatch,
  type AutomationsState,
} from "@/lib/api/automations";
import { fmtRelative } from "@/lib/app/format";
import { REMINDER_HOURS } from "@/lib/followups";
import { RecentFollowups, TemplateField, TestRow } from "./FollowupParts";
import { cn } from "@/lib/utils";
import type { Hue } from "./hues";

// The receptionist's automations as a list of cards: each with a switch, its
// settings and an honest status from the server. Used by /app/automations and
// meant to be embedded in the console's receptionist page too.

const STATUS_TONE: Record<AutomationStatus["state"], Tone> = {
  on: "success",
  off: "muted",
  needs_setup: "warning",
  unsupported: "neutral",
  error: "danger",
};

// Each automation keeps its own colour on every page.
const AUTOMATION_HUE: Record<AutomationKey, Hue> = {
  transfer: "coral",
  textBack: "magenta",
  recording: "violet",
  language: "cyan",
  callLimits: "amber",
  hoursMode: "indigo",
  reminders: "sky",
  missedFollowup: "green",
  reviews: "amber",
};

const selectClass =
  "h-9 w-full rounded-[6px] border border-hairline bg-white px-2.5 text-[13px] text-ink shadow-none focus:outline-none focus:ring-2 focus:ring-indigo/30 disabled:cursor-not-allowed disabled:opacity-60";

function sectionDiff<K extends AutomationKey>(a: AutomationSettings[K], b: AutomationSettings[K]): Partial<AutomationSettings[K]> | null {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a) as (keyof AutomationSettings[K])[]) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k as string] = a[k];
  }
  return Object.keys(out).length ? (out as Partial<AutomationSettings[K]>) : null;
}

function diff(next: AutomationSettings, saved: AutomationSettings): AutomationsPatch {
  const patch: AutomationsPatch = {};
  for (const key of Object.keys(next) as AutomationKey[]) {
    const d = sectionDiff(next[key] as never, saved[key] as never);
    if (d) (patch as Record<string, unknown>)[key] = d;
  }
  return patch;
}

function Card({
  id,
  icon: Icon,
  title,
  description,
  status,
  on,
  onToggle,
  canEdit,
  toggleable = true,
  children,
}: {
  id: AutomationKey;
  icon: LucideIcon;
  title: string;
  description: string;
  status: AutomationStatus;
  on: boolean;
  onToggle?: (v: boolean) => void;
  canEdit: boolean;
  toggleable?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={cn("panel transition-shadow", on && toggleable && "shadow-[inset_3px_0_0_var(--hue)]")} data-automation={id} data-hue={AUTOMATION_HUE[id]}>
      <header className="flex items-start gap-3 p-4">
        <span className="hue-icon mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]" aria-hidden>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
            <StatusBadge tone={STATUS_TONE[status.state]} dot className="max-w-full" >
              <span data-status={status.state} className="truncate">{status.label}</span>
            </StatusBadge>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-5 text-ink-muted">{description}</p>
          {status.detail ? <p className="mt-1 text-[12px] leading-4 text-ink-muted">{status.detail}</p> : null}
        </div>
        {toggleable ? (
          <Switch
            checked={on}
            onCheckedChange={(v) => onToggle?.(v)}
            disabled={!canEdit}
            aria-label={`${title}: ${on ? "on" : "off"}`}
            data-toggle={id}
            className="mt-1"
          />
        ) : null}
      </header>
      {children ? <div className={cn("grid gap-4 border-t border-hairline p-4", !on && toggleable && "opacity-70")}>{children}</div> : null}
    </section>
  );
}

function Check({ label, hint, checked, onChange, disabled, name }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean; name: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[6px] border border-hairline px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint ? <span className="block text-[12px] text-ink-muted">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} data-option={name} aria-label={label} />
    </label>
  );
}

export function AutomationsPanel({ businessId, canEdit: canEditProp = true }: { businessId: string; canEdit?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: automationsQueryKey(businessId), queryFn: () => getAutomations(businessId) });
  const [form, setForm] = useState<AutomationSettings | null>(null);

  useEffect(() => {
    if (q.data) setForm(q.data.settings);
  }, [q.data]);

  const save = useMutation({
    mutationFn: (patch: AutomationsPatch) => saveAutomations(businessId, patch),
    onSuccess: (state: AutomationsState) => {
      qc.setQueryData(automationsQueryKey(businessId), state);
      setForm(state.settings);
      if (state.applyError) toast.warning("Saved, but the receptionist couldn't be updated yet", { description: state.applyError });
      else toast.success("Automations saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const patch = useMemo(() => (form && q.data ? diff(form, q.data.settings) : {}), [form, q.data]);
  const dirty = Object.keys(patch).length > 0;

  if (q.isLoading || (q.data && !form)) return <PageSkeleton metrics={0} rows={6} />;
  if (q.error || !q.data || !form) return <ErrorState message={(q.error as Error)?.message ?? "Couldn't load automations."} onRetry={() => void q.refetch()} />;

  const state = q.data;
  const canEdit = canEditProp && state.canEdit;
  const s = form;
  const set = <K extends AutomationKey>(key: K, value: Partial<AutomationSettings[K]>) =>
    setForm((f) => (f ? { ...f, [key]: { ...f[key], ...value } } : f));
  const st = state.status;
  const fu = state.followups;

  return (
    <div className="space-y-4" data-automations-panel>
      {state.demo ? (
        <Notice tone="warning" title="Demo receptionist">
          Settings save here, but nothing reaches a real phone: no calls are transferred and no texts are sent.
        </Notice>
      ) : state.applyError ? (
        <Notice tone="danger" title="Not applied to the receptionist yet">
          {state.applyError}
        </Notice>
      ) : null}
      {!canEdit ? <Notice tone="neutral">View-only. Ask a manager of this business to change automations.</Notice> : null}

      <Card
        id="transfer"
        icon={PhoneForwarded}
        title="Transfer to a person"
        description="Puts the caller through to your number when they ask for a person, it's urgent, or the receptionist can't help."
        status={st.transfer}
        on={s.transfer.enabled}
        onToggle={(v) => set("transfer", { enabled: v })}
        canEdit={canEdit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Transfer to number" htmlFor="auto-transfer-number" hint="An Australian mobile or landline, like 0412 345 678.">
            <Input id="auto-transfer-number" inputMode="tel" value={s.transfer.number} onChange={(e) => set("transfer", { number: e.target.value })} disabled={!canEdit} placeholder="0412 345 678" />
          </Field>
          <Field label="Who answers" htmlFor="auto-transfer-name" hint={'Said to the caller: "I\'ll put you through to the team."'}>
            <Input id="auto-transfer-name" value={s.transfer.name} onChange={(e) => set("transfer", { name: e.target.value })} disabled={!canEdit} placeholder="the team" maxLength={40} />
          </Field>
        </div>
        <Field label="When to transfer" htmlFor="auto-transfer-when">
          <select id="auto-transfer-when" className={selectClass} value={s.transfer.when} onChange={(e) => set("transfer", { when: e.target.value as AutomationSettings["transfer"]["when"] })} disabled={!canEdit}>
            <option value="hours">Only during opening hours (take a message otherwise)</option>
            <option value="always">Any time</option>
          </select>
        </Field>
        <div className="grid gap-2">
          <Check name="onRequest" label="When the caller asks for a person" checked={s.transfer.onRequest} onChange={(v) => set("transfer", { onRequest: v })} disabled={!canEdit} />
          <Check name="urgent" label="When it's urgent" hint="An emergency or something that can't wait." checked={s.transfer.urgent} onChange={(v) => set("transfer", { urgent: v })} disabled={!canEdit} />
          <Check name="cantHelp" label="When the receptionist can't help" hint="Otherwise it takes a message." checked={s.transfer.cantHelp} onChange={(v) => set("transfer", { cantHelp: v })} disabled={!canEdit} />
          <Check
            name="voicemail"
            label="If your phone goes to voicemail, take a message instead"
            hint="The phone service listens for a voicemail greeting on each transfer (it may add a small carrier charge)."
            checked={s.transfer.voicemail === "take_message"}
            onChange={(v) => set("transfer", { voicemail: v ? "take_message" : "off" })}
            disabled={!canEdit}
          />
        </div>
      </Card>

      <Card
        id="textBack"
        icon={MessageSquareText}
        title="Text-back after calls"
        description="Texts the caller once the call ends: their booking details, or a note that you'll call back."
        status={st.textBack}
        on={s.textBack.enabled}
        onToggle={(v) => set("textBack", { enabled: v })}
        canEdit={canEdit}
      >
        <div className="grid gap-2">
          <Check name="afterCall" label="After a call" hint="A booking confirmation, or a thank-you." checked={s.textBack.afterCall} onChange={(v) => set("textBack", { afterCall: v })} disabled={!canEdit} />
          <Check name="missedCall" label="After a missed or dropped call" hint="When the caller hangs up within 15 seconds." checked={s.textBack.missedCall} onChange={(v) => set("textBack", { missedCall: v })} disabled={!canEdit} />
        </div>
        <Field label="Booking confirmation" htmlFor="auto-text-booking" hint="{business}, {name}, {time} and {service} are filled in.">
          <Textarea id="auto-text-booking" rows={2} maxLength={300} value={s.textBack.bookingText} onChange={(e) => set("textBack", { bookingText: e.target.value })} disabled={!canEdit} />
        </Field>
        <Field label="After other calls" htmlFor="auto-text-after">
          <Textarea id="auto-text-after" rows={2} maxLength={300} value={s.textBack.afterCallText} onChange={(e) => set("textBack", { afterCallText: e.target.value })} disabled={!canEdit} />
        </Field>
        <Field label="After a missed call" htmlFor="auto-text-missed">
          <Textarea id="auto-text-missed" rows={2} maxLength={300} value={s.textBack.missedCallText} onChange={(e) => set("textBack", { missedCallText: e.target.value })} disabled={!canEdit} />
        </Field>
        {state.recentTexts.length ? (
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium text-ink">Recent texts</div>
            <ul className="divide-y divide-hairline rounded-[6px] border border-hairline text-[12.5px]">
              {state.recentTexts.slice(0, 5).map((t, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-ink">{t.to || "Unknown number"}</span>
                  <span className="text-ink-muted">
                    {t.status === "sent" ? "Sent" : t.status === "skipped" ? `Skipped: ${t.detail}` : `Failed: ${t.detail}`} · {fmtRelative(t.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card
        id="recording"
        icon={Mic}
        title="Call recording"
        description="Records calls so you can listen back. Callers hear the notice at the start of every call."
        status={st.recording}
        on={s.recording.enabled}
        onToggle={(v) => set("recording", { enabled: v })}
        canEdit={canEdit}
      >
        <Field label="Recording notice" htmlFor="auto-rec-notice" hint="Australian law expects callers to be told. It's said straight after the greeting.">
          <Textarea id="auto-rec-notice" rows={2} maxLength={200} value={s.recording.notice} onChange={(e) => set("recording", { notice: e.target.value })} disabled={!canEdit} />
        </Field>
      </Card>

      <Card
        id="language"
        icon={Languages}
        title="Language"
        description="The language the receptionist listens for and speaks."
        status={st.language}
        on
        toggleable={false}
        canEdit={canEdit}
      >
        <Field label="Language" htmlFor="auto-language" hint={state.languages.find((l) => l.code === s.language.code)?.note}>
          <select id="auto-language" className={selectClass} value={s.language.code} onChange={(e) => set("language", { code: e.target.value as AutomationSettings["language"]["code"] })} disabled={!canEdit}>
            {state.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card
        id="callLimits"
        icon={Timer}
        title="Call length and silence"
        description="Ends calls that run too long or where the caller has gone quiet."
        status={st.callLimits}
        on
        toggleable={false}
        canEdit={canEdit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Longest call (minutes)" htmlFor="auto-max-minutes" hint="Between 2 and 60.">
            <Input id="auto-max-minutes" type="number" min={2} max={60} value={s.callLimits.maxMinutes} onChange={(e) => set("callLimits", { maxMinutes: Number(e.target.value) })} disabled={!canEdit} />
          </Field>
          <Field label="End after silence (seconds)" htmlFor="auto-idle" hint="Between 10 and 120.">
            <Input id="auto-idle" type="number" min={10} max={120} value={s.callLimits.idleSeconds} onChange={(e) => set("callLimits", { idleSeconds: Number(e.target.value) })} disabled={!canEdit} />
          </Field>
        </div>
      </Card>

      <Card
        id="hoursMode"
        icon={MoonStar}
        title="After-hours mode"
        description="Outside opening hours the receptionist greets callers differently and takes messages."
        status={st.hoursMode}
        on={s.hoursMode.enabled}
        onToggle={(v) => set("hoursMode", { enabled: v })}
        canEdit={canEdit}
      >
        <Field label="After-hours greeting" htmlFor="auto-ah-greeting">
          <Textarea id="auto-ah-greeting" rows={2} maxLength={300} value={s.hoursMode.greeting} onChange={(e) => set("hoursMode", { greeting: e.target.value })} disabled={!canEdit} />
        </Field>
        <Field label="Outside opening hours" htmlFor="auto-ah-mode">
          <select id="auto-ah-mode" className={selectClass} value={s.hoursMode.mode} onChange={(e) => set("hoursMode", { mode: e.target.value as AutomationSettings["hoursMode"]["mode"] })} disabled={!canEdit}>
            <option value="message_only">Take messages only (no bookings)</option>
            <option value="message_and_booking">Take messages and still offer bookings</option>
          </select>
        </Field>
      </Card>

      <Card
        id="reminders"
        icon={BellRing}
        title="Appointment reminders"
        description="Reminds customers about the appointments the receptionist booked, so fewer people forget."
        status={st.reminders}
        on={s.reminders.enabled}
        onToggle={(v) => set("reminders", { enabled: v })}
        canEdit={canEdit}
      >
        <div className="grid gap-2">
          <Check name="remindSms" label="Send a text" checked={s.reminders.sms} onChange={(v) => set("reminders", { sms: v })} disabled={!canEdit} />
          <Check name="remindEmail" label="Send an email" hint="When the customer gave an email address." checked={s.reminders.email} onChange={(v) => set("reminders", { email: v })} disabled={!canEdit} />
        </div>
        <Field label="Send it" htmlFor="auto-remind-hours" hint="Texts wait until 8am if the time falls between 8pm and 8am. Replies to texts go to the receptionist, so the text tells people to call to change a booking.">
          <select id="auto-remind-hours" className={selectClass} value={s.reminders.hoursBefore} onChange={(e) => set("reminders", { hoursBefore: Number(e.target.value) as AutomationSettings["reminders"]["hoursBefore"] })} disabled={!canEdit}>
            {REMINDER_HOURS.map((h) => (
              <option key={h} value={h}>
                {h} hours before the appointment
              </option>
            ))}
          </select>
        </Field>
        {s.reminders.sms ? <TemplateField id="auto-remind-sms" label="Text" value={s.reminders.smsText} onChange={(v) => set("reminders", { smsText: v })} disabled={!canEdit} businessName={fu.businessName} channel="sms" /> : null}
        {s.reminders.email ? <TemplateField id="auto-remind-email" label="Email" value={s.reminders.emailText} onChange={(v) => set("reminders", { emailText: v })} disabled={!canEdit} businessName={fu.businessName} channel="email" rows={7} max={1500} /> : null}
        <TestRow businessId={businessId} kind="reminder" smsOn={s.reminders.sms} emailOn={s.reminders.email} section={s.reminders} disabled={!canEdit} />
        <RecentFollowups items={fu.recent} kind="reminder" />
      </Card>

      <Card
        id="missedFollowup"
        icon={PhoneCall}
        title="Missed-call follow-up"
        description="Texts the caller when they hung up before the receptionist finished, or when a callback they asked for hasn't happened."
        status={st.missedFollowup}
        on={s.missedFollowup.enabled}
        onToggle={(v) => set("missedFollowup", { enabled: v })}
        canEdit={canEdit}
      >
        <div className="grid gap-2">
          <Check name="shortCall" label="After a very short call" hint="When the caller hangs up within 10 seconds." checked={s.missedFollowup.shortCall} onChange={(v) => set("missedFollowup", { shortCall: v })} disabled={!canEdit} />
          <Check name="callbackOverdue" label="When a callback hasn't happened" hint="A callback was asked for and it's still marked New." checked={s.missedFollowup.callbackOverdue} onChange={(v) => set("missedFollowup", { callbackOverdue: v })} disabled={!canEdit} />
        </div>
        {s.missedFollowup.callbackOverdue ? (
          <Field label="Hours to wait for a callback" htmlFor="auto-missed-hours" hint="Between 1 and 72. Never to withheld numbers, and at most one text per caller per day.">
            <Input id="auto-missed-hours" type="number" min={1} max={72} value={s.missedFollowup.overdueHours} onChange={(e) => set("missedFollowup", { overdueHours: Number(e.target.value) })} disabled={!canEdit} />
          </Field>
        ) : null}
        <TemplateField id="auto-missed-text" label="Text" value={s.missedFollowup.text} onChange={(v) => set("missedFollowup", { text: v })} disabled={!canEdit} businessName={fu.businessName} channel="sms" />
        <TestRow businessId={businessId} kind="missed" smsOn emailOn={false} section={s.missedFollowup} disabled={!canEdit} />
        <RecentFollowups items={fu.recent} kind="missed" />
      </Card>

      <Card
        id="reviews"
        icon={Star}
        title="Review requests"
        description="Asks for a Google review after an appointment. Once per customer every 90 days, and never for a cancelled booking."
        status={st.reviews}
        on={s.reviews.enabled}
        onToggle={(v) => set("reviews", { enabled: v })}
        canEdit={canEdit}
      >
        <Field label="Your review link" htmlFor="auto-review-link" hint="Paste the link customers use to leave a Google review. It must start with https://">
          <Input id="auto-review-link" type="url" inputMode="url" value={s.reviews.link} onChange={(e) => set("reviews", { link: e.target.value })} disabled={!canEdit} placeholder="https://g.page/r/your-business/review" maxLength={300} />
        </Field>
        <Field label="Ask" htmlFor="auto-review-delay">
          <select id="auto-review-delay" className={selectClass} value={s.reviews.delay} onChange={(e) => set("reviews", { delay: e.target.value as AutomationSettings["reviews"]["delay"] })} disabled={!canEdit}>
            <option value="2h">2 hours after the appointment ends</option>
            <option value="next_morning">The next morning (9am)</option>
          </select>
        </Field>
        <div className="grid gap-2">
          <Check name="reviewSms" label="Send a text" checked={s.reviews.sms} onChange={(v) => set("reviews", { sms: v })} disabled={!canEdit} />
          <Check name="reviewEmail" label="Send an email" hint="When the customer gave an email address." checked={s.reviews.email} onChange={(v) => set("reviews", { email: v })} disabled={!canEdit} />
        </div>
        {s.reviews.sms ? <TemplateField id="auto-review-sms" label="Text" value={s.reviews.smsText} onChange={(v) => set("reviews", { smsText: v })} disabled={!canEdit} businessName={fu.businessName} link={s.reviews.link} channel="sms" /> : null}
        {s.reviews.email ? <TemplateField id="auto-review-email" label="Email" value={s.reviews.emailText} onChange={(v) => set("reviews", { emailText: v })} disabled={!canEdit} businessName={fu.businessName} link={s.reviews.link} channel="email" rows={7} max={1500} /> : null}
        <TestRow businessId={businessId} kind="review" smsOn={s.reviews.sms} emailOn={s.reviews.email} section={s.reviews} disabled={!canEdit} />
        <RecentFollowups items={fu.recent} kind="review" />
      </Card>

      {canEdit ? (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          onSave={() => save.mutate(patch)}
          onReset={() => setForm(state.settings)}
          lastSavedAt={state.updatedAt}
        />
      ) : null}
    </div>
  );
}
