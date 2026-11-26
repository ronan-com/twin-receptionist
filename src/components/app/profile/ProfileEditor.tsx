import { useState, type ReactNode } from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/app/forms";
import { cn } from "@/lib/utils";
import {
  APPOINTMENT_LENGTHS,
  BOOKING_MODES,
  BOOKING_NOTICE,
  BOOKING_WINDOWS,
  BUFFERS,
  CALLER_FIELDS,
  EMERGENCIES,
  LANGUAGES,
  NEW_CUSTOMERS,
  PAYMENT_METHODS,
  PRICE_ANSWERS,
  TONES,
  type Faq,
  type Option,
  type ReceptionProfile,
  type ServiceDetail,
} from "@/lib/profile";
import { sectionProgress, totalProgress, type SectionId } from "./helpers";

const UNSET = "__unset";

/** A Select that can also be left unset. */
function Pick<V extends string>({ id, value, options, onChange, disabled, placeholder = "Not set" }: { id?: string; value: V | undefined; options: Option<V>[]; onChange: (v: V | undefined) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <Select value={value ?? UNSET} onValueChange={(v) => onChange(v === UNSET ? undefined : (v as V))} disabled={disabled}>
      <SelectTrigger id={id} data-profile={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** A Select over a list of numbers (minutes, days). A value outside the list is still shown. */
function NumberPick({ id, value, list, unit, onChange, disabled, zeroLabel, placeholder = "Not set" }: { id?: string; value: number | undefined; list: number[]; unit: (n: number) => string; onChange: (v: number | undefined) => void; disabled?: boolean; zeroLabel?: string; placeholder?: string }) {
  const all = value !== undefined && !list.includes(value) ? [...list, value].sort((a, b) => a - b) : list;
  return (
    <Select value={value === undefined ? UNSET : String(value)} onValueChange={(v) => onChange(v === UNSET ? undefined : Number(v))} disabled={disabled}>
      <SelectTrigger id={id} data-profile={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>{placeholder}</SelectItem>
        {all.map((n) => <SelectItem key={n} value={String(n)}>{n === 0 && zeroLabel ? zeroLabel : unit(n)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export const minutesLabel = (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} hour${n === 60 ? "" : "s"}` : `${n} minutes`);
const daysLabel = (n: number) => (n % 7 === 0 && n >= 14 ? `${n / 7} weeks` : n === 7 ? "1 week" : n >= 60 && n % 30 === 0 ? `${n / 30} months` : n === 30 ? "1 month" : `${n} days`);

/** Toggle chips: tap to add or remove. Values outside the list stay visible, and "Other" adds more. */
function ToggleChips<V extends string>({ options, value, onChange, disabled, list, allowCustom }: { options: Option<V>[]; value: V[]; onChange: (v: V[]) => void; disabled?: boolean; list: string; allowCustom?: boolean }) {
  const [draft, setDraft] = useState("");
  const extra = value.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v, label: v }));
  const toggle = (v: V) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const add = () => {
    const t = draft.trim() as V;
    if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5" data-list={list}>
        {[...options, ...extra].map((o) => {
          const on = value.includes(o.value);
          return (
            <li key={o.value}>
              <button
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggle(o.value)}
                className={cn("rounded-full border px-2.5 py-1 text-[12.5px] transition-colors disabled:opacity-60", on ? "border-indigo bg-[#efeeff] font-medium text-indigo" : "border-hairline bg-white text-ink-muted hover:border-[#c7c4ff] hover:text-ink")}
              >
                {o.label}
              </button>
            </li>
          );
        })}
      </ul>
      {allowCustom && !disabled ? (
        <div className="flex max-w-sm gap-2">
          <Input value={draft} maxLength={40} placeholder="Other, then press Enter" aria-label={`Add another (${list})`} className="h-8 text-[12.5px]" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={add} disabled={!draft.trim()}>Add</Button>
        </div>
      ) : null}
    </div>
  );
}

/** Editable chips with an input: for the always-do and never-do lists. */
function ChipList({ items, onChange, disabled, list, placeholder, max = 12 }: { items: string[]; onChange: (v: string[]) => void; disabled?: boolean; list: string; placeholder: string; max?: number }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && items.length < max && !items.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...items, t]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      {items.length ? (
        <ul className="grid gap-1.5" data-list={list}>
          {items.map((s, i) => (
            <li key={`${s}-${i}`} className="flex items-start justify-between gap-2 rounded-[6px] border border-hairline bg-canvas-2 py-1.5 pl-2.5 pr-1.5 text-[12.5px] text-ink">
              <span className="min-w-0 break-words">{s}</span>
              {!disabled ? (
                <button type="button" aria-label={`Remove ${s}`} className="shrink-0 rounded-full p-0.5 text-ink-muted hover:bg-white hover:text-ink" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!disabled ? (
        <div className="flex gap-2">
          <Input value={draft} maxLength={160} disabled={items.length >= max} placeholder={items.length >= max ? `That's the maximum of ${max}` : placeholder} aria-label={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" onClick={add} disabled={!draft.trim() || items.length >= max}>Add</Button>
        </div>
      ) : null}
    </div>
  );
}

function Section({ id, title, hint, progress, defaultOpen, children }: { id: SectionId; title: string; hint: string; progress: { set: number; total: number }; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const done = progress.set === progress.total;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-[6px] border border-hairline" data-profile-section={id}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left" data-profile-toggle={id}>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
          <span className="block text-[12px] text-ink-muted">{hint}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] tabular-nums", done ? "bg-[#e8f7ee] text-[#1a7f4b]" : "bg-canvas-2 text-ink-muted")}>{progress.set} of {progress.total} set</span>
          <ChevronDown className={cn("h-4 w-4 text-ink-muted transition-transform", open && "rotate-180")} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 border-t border-hairline p-3.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ServicesTable({ rows, onChange, disabled, suggest }: { rows: ServiceDetail[]; onChange: (r: ServiceDetail[]) => void; disabled?: boolean; suggest: string[] }) {
  const put = (i: number, p: Partial<ServiceDetail>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const missing = suggest.filter((s) => !rows.some((r) => r.name.trim().toLowerCase() === s.toLowerCase()));
  return (
    <div className="space-y-2" data-list="service-details">
      {rows.length ? (
        <div className="hidden grid-cols-[1.4fr_120px_110px_1.4fr_32px] gap-2 px-0.5 text-[11.5px] font-medium text-ink-muted sm:grid">
          <span>Service</span><span>Length</span><span>Price</span><span>Notes for the receptionist</span><span />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-[6px] border border-hairline p-2 sm:grid-cols-[1.4fr_120px_110px_1.4fr_32px] sm:border-0 sm:p-0" data-service-row>
          <Input value={r.name} maxLength={60} disabled={disabled} placeholder="Service name" aria-label="Service name" onChange={(e) => put(i, { name: e.target.value })} />
          <Select value={r.minutes === undefined ? UNSET : String(r.minutes)} onValueChange={(v) => put(i, { minutes: v === UNSET ? undefined : Number(v) })} disabled={disabled}>
            <SelectTrigger aria-label="Length"><SelectValue placeholder="Default" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Default</SelectItem>
              {(r.minutes !== undefined && !APPOINTMENT_LENGTHS.includes(r.minutes) ? [...APPOINTMENT_LENGTHS, r.minutes].sort((a, b) => a - b) : APPOINTMENT_LENGTHS).map((n) => <SelectItem key={n} value={String(n)}>{minutesLabel(n)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={r.price ?? ""} maxLength={40} disabled={disabled} placeholder="e.g. from $90" aria-label="Price" onChange={(e) => put(i, { price: e.target.value })} />
          <Input value={r.notes ?? ""} maxLength={200} disabled={disabled} placeholder="e.g. bring your health fund card" aria-label="Notes" onChange={(e) => put(i, { notes: e.target.value })} />
          {!disabled ? (
            <Button type="button" variant="ghost" size="icon" className="h-9 w-8 text-ink-muted" aria-label={`Remove ${r.name || "service"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : <span />}
        </div>
      ))}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { name: "" }])} disabled={rows.length >= 30} data-action="add-service-row">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add a service
          </Button>
          {missing.length ? (
            <Button type="button" variant="ghost" size="sm" className="text-indigo" onClick={() => onChange([...rows, ...missing.slice(0, 30 - rows.length).map((name) => ({ name }))])}>
              Add rows for my {missing.length} other service{missing.length === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FaqList({ rows, onChange, disabled }: { rows: Faq[]; onChange: (r: Faq[]) => void; disabled?: boolean }) {
  const put = (i: number, p: Partial<Faq>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3" data-list="faqs">
      {rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-[6px] border border-hairline p-2.5" data-faq-row>
          <div className="flex items-center gap-2">
            <Input value={r.q} maxLength={160} disabled={disabled} placeholder="Question callers ask" aria-label="Question" onChange={(e) => put(i, { q: e.target.value })} />
            {!disabled ? (
              <Button type="button" variant="ghost" size="icon" className="h-9 w-8 shrink-0 text-ink-muted" aria-label={`Remove question ${r.q || i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          <Textarea value={r.a} rows={2} maxLength={600} disabled={disabled} placeholder="What the receptionist should say" aria-label="Answer" onChange={(e) => put(i, { a: e.target.value })} />
        </div>
      ))}
      {!disabled ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { q: "", a: "" }])} disabled={rows.length >= 40} data-action="add-faq">
          <Plus className="mr-1 h-3.5 w-3.5" /> Add a question
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The detailed "how it handles calls" form, in collapsible sections. Used by the new
 * receptionist wizard and by Settings, so both edit the same ReceptionProfile.
 * `showFaqs` is off in Settings: answers live under Knowledge once the receptionist exists.
 */
export function ProfileEditor({ value, onChange, disabled, showFaqs = true, services = [] }: { value: ReceptionProfile; onChange: (p: ReceptionProfile) => void; disabled?: boolean; showFaqs?: boolean; services?: string[] }) {
  const set = (p: Partial<ReceptionProfile>) => onChange({ ...value, ...p });
  const prog = sectionProgress(value);
  const total = totalProgress(value, showFaqs);
  const bookingOff = value.bookingMode === "message_only";
  return (
    <div className="space-y-3" data-profile-editor>
      <p className="text-[12.5px] text-ink-muted" data-profile-progress>
        {total.set} of {total.total} details set. Everything here is optional, and you can change it any time.
      </p>

      <Section id="handling" title="Tone and bookings" hint="How it sounds and how it books." progress={prog.handling} defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tone" htmlFor="p-tone"><Pick id="p-tone" value={value.tone} options={TONES} onChange={(tone) => set({ tone })} disabled={disabled} /></Field>
          <Field label="When a caller wants an appointment" htmlFor="p-booking"><Pick id="p-booking" value={value.bookingMode} options={BOOKING_MODES} onChange={(bookingMode) => set({ bookingMode })} disabled={disabled} /></Field>
        </div>
        {bookingOff ? (
          <p className="text-[12px] text-ink-muted">Bookings are off, so the timing options below don't apply.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Usual appointment length" htmlFor="p-length" hint="Used when a service has no length of its own.">
              <NumberPick id="p-length" value={value.appointmentMinutes} list={APPOINTMENT_LENGTHS} unit={minutesLabel} onChange={(appointmentMinutes) => set({ appointmentMinutes })} disabled={disabled} />
            </Field>
            <Field label="Gap between bookings" htmlFor="p-buffer">
              <NumberPick id="p-buffer" value={value.bufferMinutes} list={BUFFERS} unit={(n) => `${n} minutes`} zeroLabel="No gap" onChange={(bufferMinutes) => set({ bufferMinutes })} disabled={disabled} />
            </Field>
            <Field label="Shortest notice" htmlFor="p-notice"><Pick id="p-notice" value={value.bookingNotice} options={BOOKING_NOTICE} onChange={(bookingNotice) => set({ bookingNotice })} disabled={disabled} /></Field>
            <Field label="How far ahead callers can book" htmlFor="p-window">
              <NumberPick id="p-window" value={value.bookingWindowDays} list={BOOKING_WINDOWS} unit={daysLabel} onChange={(bookingWindowDays) => set({ bookingWindowDays })} disabled={disabled} />
            </Field>
          </div>
        )}
      </Section>

      <Section id="services" title="Services and prices" hint="What each service takes and costs." progress={prog.services}>
        <ServicesTable rows={value.serviceDetails ?? []} onChange={(serviceDetails) => set({ serviceDetails })} disabled={disabled} suggest={services} />
        <Field label="When callers ask about price" htmlFor="p-price"><Pick id="p-price" value={value.priceAnswers} options={PRICE_ANSWERS} onChange={(priceAnswers) => set({ priceAnswers })} disabled={disabled} /></Field>
      </Section>

      <Section id="collect" title="What to ask callers" hint="Details collected on every call." progress={prog.collect}>
        <Field label="Details to collect on every call">
          <ToggleChips list="caller-fields" options={CALLER_FIELDS} value={value.callerFields ?? []} onChange={(callerFields) => set({ callerFields })} disabled={disabled} />
        </Field>
        <Field label="New customers" htmlFor="p-new"><Pick id="p-new" value={value.newCustomers} options={NEW_CUSTOMERS} onChange={(newCustomers) => set({ newCustomers })} disabled={disabled} /></Field>
      </Section>

      <Section id="urgent" title="Emergencies" hint="What to do when it's urgent." progress={prog.urgent}>
        <Field label="When a call is an emergency" htmlFor="p-emerg"><Pick id="p-emerg" value={value.emergencies} options={EMERGENCIES} onChange={(emergencies) => set({ emergencies })} disabled={disabled} /></Field>
        <Field label="What counts as urgent here" htmlFor="p-emerg-note" hint="Optional. In your own words.">
          <Textarea id="p-emerg-note" rows={2} maxLength={300} disabled={disabled} placeholder="e.g. Burst pipes, no hot water, gas smell" value={value.emergencyNote ?? ""} onChange={(e) => set({ emergencyNote: e.target.value })} />
        </Field>
      </Section>

      <Section id="policies" title="Policies and practical info" hint="Answers to the usual questions." progress={prog.policies}>
        <Field label="Cancellation policy" htmlFor="p-cancel">
          <Input id="p-cancel" maxLength={200} disabled={disabled} placeholder="e.g. 24 hours notice, otherwise a fee may apply" value={value.cancellationPolicy ?? ""} onChange={(e) => set({ cancellationPolicy: e.target.value })} />
        </Field>
        <Field label="Payment methods">
          <ToggleChips list="payment-methods" allowCustom options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} value={value.paymentMethods ?? []} onChange={(paymentMethods) => set({ paymentMethods })} disabled={disabled} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Parking" htmlFor="p-parking"><Input id="p-parking" maxLength={200} disabled={disabled} placeholder="e.g. Free street parking out the front" value={value.parking ?? ""} onChange={(e) => set({ parking: e.target.value })} /></Field>
          <Field label="Accessibility" htmlFor="p-access"><Input id="p-access" maxLength={200} disabled={disabled} placeholder="e.g. Step-free entry and an accessible toilet" value={value.accessibility ?? ""} onChange={(e) => set({ accessibility: e.target.value })} /></Field>
        </div>
        <Field label="Service area" htmlFor="p-area" hint="For mobile businesses: suburbs or how far you travel.">
          <Input id="p-area" maxLength={200} disabled={disabled} placeholder="e.g. Brisbane north side, up to 25 km from Chermside" value={value.serviceArea ?? ""} onChange={(e) => set({ serviceArea: e.target.value })} />
        </Field>
        <Field label="Languages spoken">
          <ToggleChips list="languages" allowCustom options={LANGUAGES.map((m) => ({ value: m, label: m }))} value={value.languages ?? []} onChange={(languages) => set({ languages })} disabled={disabled} />
        </Field>
      </Section>

      {showFaqs ? (
        <Section id="faqs" title="Common questions" hint="Saved as answers the receptionist can use." progress={prog.faqs}>
          <FaqList rows={value.faqs ?? []} onChange={(faqs) => set({ faqs })} disabled={disabled} />
        </Section>
      ) : null}

      <Section id="rules" title="Always do, never do" hint="House rules for every call." progress={prog.rules}>
        <Field label="Always"><ChipList list="always-do" items={value.alwaysDo ?? []} onChange={(alwaysDo) => set({ alwaysDo })} disabled={disabled} placeholder="e.g. Ask if it's their first visit" /></Field>
        <Field label="Never"><ChipList list="never-do" items={value.neverDo ?? []} onChange={(neverDo) => set({ neverDo })} disabled={disabled} placeholder="e.g. Give medical advice" /></Field>
      </Section>
    </div>
  );
}
