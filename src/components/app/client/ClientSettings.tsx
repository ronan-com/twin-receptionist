import { NEUTRAL_DASHBOARD } from "@/lib/app/product";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { TelegramSetup } from "@/components/app/telegram/TelegramSetup";
import { telegramApi, telegramKey } from "@/lib/api/telegram";
import { PauseControl } from "@/components/app/receptionist/PauseControl";
import { saveReceptionist, type ReceptionistRow } from "@/components/app/receptionist/model";
import { agentsQuery, knowledgeQuery, phoneNumbersQuery } from "@/lib/app/queries";
import { updateBusiness } from "@/lib/api/manage";
import { fmtPhone } from "@/lib/app/format";
import { asBusinessHours, asRecord, asStringArray, DAY_KEYS, DAY_LABELS, DEFAULT_HOURS, type BusinessHours } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { ClientPayment } from "@/components/app/ClientPayment";
import { ALWAYS_FROM, ALWAYS_TO } from "@/lib/shared";
import { cn } from "@/lib/utils";

// The owner's Settings: a handful of plain questions, one at a time. Anything that is
// the agency's job (voice, call transfers, numbers, texting) says so instead of offering
// a control. The full editors are still there for agency staff and by direct link.

const allDay = (h: BusinessHours): boolean => DAY_KEYS.every((d) => !h[d].closed && h[d].open === ALWAYS_FROM && h[d].close === ALWAYS_TO);
const alwaysHours = (): BusinessHours => Object.fromEntries(DAY_KEYS.map((d) => [d, { open: ALWAYS_FROM, close: ALWAYS_TO, closed: false }])) as BusinessHours;

function Section({ id, title, summary, open, onToggle, children }: { id: string; title: string; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section data-settings-section={id} className="border-b border-hairline last:border-b-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-canvas-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo">
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-ink">{title}</span>
          {summary ? <span className="mt-0.5 block truncate text-[13.5px] text-ink-muted">{summary}</span> : null}
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-ink-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="space-y-4 border-t border-hairline bg-canvas-2/40 px-4 py-4">{children}</div> : null}
    </section>
  );
}

function LinkRow({ to, search, title, summary }: { to: string; search?: Record<string, string>; title: string; summary?: ReactNode }) {
  return (
    <Link to={to} search={search as never} className="flex min-h-[64px] items-center gap-3 border-b border-hairline px-4 py-3 outline-none last:border-b-0 hover:bg-canvas-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold text-ink">{title}</span>
        {summary ? <span className="mt-0.5 block truncate text-[13.5px] text-ink-muted">{summary}</span> : null}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" />
    </Link>
  );
}

function SaveButton({ pending, dirty, onClick, children = "Save" }: { pending: boolean; dirty: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <Button className="h-12 w-full text-[15px] sm:w-auto sm:min-w-[140px]" onClick={onClick} disabled={pending || !dirty} data-action="save-section">
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}

const AGENCY_NOTE = (who: string) => `Ask ${who} to change this.`;

export function ClientSettings() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const b = ws.business;
  const businessId = ws.businessId;
  const canEdit = ws.access.canEdit;
  const staff = ws.access.kind === "staff_view";
  const who = b?.org_name || "your agency";
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  const agentsQ = useQuery(agentsQuery(businessId));
  const numbersQ = useQuery(phoneNumbersQuery(businessId));
  const knowledgeQ = useQuery(knowledgeQuery(businessId));
  const telegramQ = useQuery({ queryKey: telegramKey(businessId ?? ""), queryFn: () => telegramApi.get(businessId!), enabled: !!businessId });
  const agent = (agentsQ.data?.[0] as ReceptionistRow | undefined) ?? null;
  const numbers = (numbersQ.data ?? []).filter((n) => n.e164 && n.status === "active");
  const bookingSet = asRecord(agent?.booking_rules)["configured"] === true;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["agents", businessId] });
    void qc.invalidateQueries({ queryKey: ["businesses"] });
  };

  /* ---- Business hours ---- */
  const savedHours = useMemo(() => asBusinessHours(b?.business_hours), [b?.business_hours]);
  const savedClosures = useMemo(() => String(b?.closures ?? "").split(/;\s*/).filter(Boolean).join("\n"), [b?.closures]);
  const [hours, setHours] = useState<BusinessHours>(savedHours);
  const [closures, setClosures] = useState(savedClosures);
  const [timesMemory, setTimesMemory] = useState<BusinessHours>(allDay(savedHours) ? { ...DEFAULT_HOURS } : savedHours);
  useEffect(() => {
    setHours(savedHours);
    if (!allDay(savedHours)) setTimesMemory(savedHours);
  }, [savedHours]);
  useEffect(() => setClosures(savedClosures), [savedClosures]);
  const hoursDirty = JSON.stringify(hours) !== JSON.stringify(savedHours) || closures !== savedClosures;
  const saveHours = useMutation({
    mutationFn: () => updateBusiness(businessId!, { business_hours: hours, closures }),
    onSuccess: (r) => {
      toast.success(r.applied ? "Saved. Your receptionist uses these hours from the next call." : "Saved");
      refresh();
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });
  const always = allDay(hours);

  /* ---- Greeting ---- */
  const savedGreeting = agent?.greeting ?? "";
  const [greeting, setGreeting] = useState(savedGreeting);
  useEffect(() => setGreeting(savedGreeting), [savedGreeting]);
  const saveGreeting = useMutation({
    mutationFn: () => saveReceptionist(businessId!, { greeting: greeting.trim() }),
    onSuccess: (r) => {
      toast.success(r.applied ? "Saved. Callers hear it from the next call." : "Saved");
      refresh();
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  /* ---- What callers can ask for ---- */
  const savedServices = useMemo(() => asStringArray(asRecord(agent?.booking_rules)["services"]), [agent?.booking_rules]);
  const [services, setServices] = useState<string[]>(savedServices);
  const [newService, setNewService] = useState("");
  useEffect(() => setServices(savedServices), [savedServices]);
  const addService = () => {
    const v = newService.trim();
    if (v && !services.includes(v)) setServices([...services, v]);
    setNewService("");
  };
  const saveServices = useMutation({
    mutationFn: () => {
      const list = newService.trim() && !services.includes(newService.trim()) ? [...services, newService.trim()] : services;
      if (list.length === 0) throw new Error("Add at least one thing callers can ask for.");
      return saveReceptionist(businessId!, { booking_rules: { services: list } });
    },
    onSuccess: (r) => {
      setNewService("");
      toast.success(r.applied ? "Saved. Callers hear it from the next call." : "Saved");
      refresh();
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  /* ---- Bookings need my approval ---- */
  const needsApproval = asRecord(agent?.booking_rules)["require_approval"] === true;
  const saveApproval = useMutation({
    mutationFn: (v: boolean) => saveReceptionist(businessId!, { booking_rules: { require_approval: v } }),
    onSuccess: (r) => {
      toast.success(r.applied ? "Saved" : "Saved");
      refresh();
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  /* ---- Where messages go ---- */
  const savedEmail = String(asRecord(agent?.escalation_rules)["notify_email"] ?? "");
  const [email, setEmail] = useState(savedEmail);
  useEffect(() => setEmail(savedEmail), [savedEmail]);
  const saveEmail = useMutation({
    mutationFn: () => saveReceptionist(businessId!, { escalation_rules: { notify_email: email.trim() } }),
    onSuccess: () => {
      toast.success("Saved. New messages and bookings are emailed to you.");
      refresh();
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  if (!b) return null;
  const pausedByYou = agent?.paused_by === "business";
  const pausedByAgency = agent?.paused_by === "agency";
  const nKnow = (knowledgeQ.data ?? []).filter((k) => k.status === "published").length;
  const ro = !canEdit;

  return (
    <div className="space-y-4" data-page="client-settings">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">Settings</h1>
      {businessId && ws.access.kind === "member" && ws.access.canManage ? <ClientPayment businessId={businessId}/> : null}
      {ro ? <p className="rounded-[8px] border border-hairline bg-white px-4 py-3 text-[13.5px] text-ink-muted">{ws.access.readOnlyReason ?? "You can look but not change anything."}</p> : null}

      <div className="panel overflow-hidden">
        <Section id="hours" title="Business hours" summary={always ? "Answering 24/7" : "Set times"} open={open === "hours"} onToggle={() => toggle("hours")}>
          <label className="flex min-h-12 items-center justify-between gap-3 rounded-[10px] border border-hairline bg-white px-4 py-2">
            <span>
              <span className="block text-[15px] font-medium text-ink">Answer calls 24/7</span>
              <span className="block text-[13px] text-ink-muted">Every call, any time, every day.</span>
            </span>
            <Switch
              checked={always}
              disabled={ro}
              data-toggle="always"
              aria-label="Answer calls 24/7"
              onCheckedChange={(v) => {
                if (v) {
                  if (!always) setTimesMemory(hours);
                  setHours(alwaysHours());
                } else setHours(allDay(timesMemory) ? { ...DEFAULT_HOURS } : timesMemory);
              }}
            />
          </label>
          {!always ? (
            <ul className="divide-y divide-hairline rounded-[10px] border border-hairline bg-white">
              {DAY_KEYS.map((d) => {
                const day = hours[d];
                const put = (next: Partial<typeof day>) => setHours({ ...hours, [d]: { ...day, ...next } });
                return (
                  <li key={d} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <span className="w-24 text-[15px] font-medium text-ink">{DAY_LABELS[d]}</span>
                    <Switch checked={!day.closed} onCheckedChange={(v) => put({ closed: !v })} disabled={ro} aria-label={`${DAY_LABELS[d]} open`} />
                    {day.closed ? (
                      <span className="text-[14px] text-ink-muted">Closed</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Input type="time" value={day.open} onChange={(e) => put({ open: e.target.value })} disabled={ro} className="h-11 w-[116px] text-[15px]" aria-label={`${DAY_LABELS[d]} opens`} />
                        <span className="text-[13px] text-ink-muted">to</span>
                        <Input type="time" value={day.close} onChange={(e) => put({ close: e.target.value })} disabled={ro} className="h-11 w-[116px] text-[15px]" aria-label={`${DAY_LABELS[d]} closes`} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div>
            <label htmlFor="cs-closures" className="mb-1 block text-[14px] font-medium text-ink">Days you're closed</label>
            <Textarea id="cs-closures" rows={2} maxLength={600} value={closures} onChange={(e) => setClosures(e.target.value)} disabled={ro} placeholder={"e.g. Closed all public holidays\nClosed 24 December to 6 January"} className="bg-white text-[15px]" />
            <p className="mt-1 text-[12.5px] text-ink-muted">One per line. Callers are told you're closed on these days.</p>
          </div>
          {canEdit ? <SaveButton pending={saveHours.isPending} dirty={hoursDirty} onClick={() => saveHours.mutate()} /> : null}
        </Section>

        <Section id="greeting" title="Greeting" summary={savedGreeting ? `“${savedGreeting}”` : "The standard greeting"} open={open === "greeting"} onToggle={() => toggle("greeting")}>
          {agent ? (
            <>
              <p className="text-[14px] text-ink-muted">The first thing every caller hears. Keep it short and warm.</p>
              <Textarea rows={3} maxLength={300} value={greeting} onChange={(e) => setGreeting(e.target.value)} disabled={ro} aria-label="Greeting" className="bg-white text-[15px]" />
              <p className="text-[12.5px] text-ink-muted">Leave it blank and we'll use a standard greeting with your business name.</p>
              {canEdit ? <SaveButton pending={saveGreeting.isPending} dirty={greeting !== savedGreeting} onClick={() => saveGreeting.mutate()} /> : null}
            </>
          ) : (
            <p className="text-[14px] text-ink-muted">Your receptionist isn't set up yet. {AGENCY_NOTE(who)}</p>
          )}
        </Section>

        <Section id="services" title="What callers can ask for" summary={savedServices.length ? savedServices.join(", ") : "Nothing added yet"} open={open === "services"} onToggle={() => toggle("services")}>
          {agent ? (
            <>
              <p className="text-[14px] text-ink-muted">The services and appointments your receptionist can talk about and book.</p>
              <ul className="flex flex-wrap gap-2">
                {services.map((s) => (
                  <li key={s} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-hairline bg-white pl-3.5 pr-2 text-[14px] text-ink">
                    {s}
                    {canEdit ? (
                      <button type="button" aria-label={`Remove ${s}`} onClick={() => setServices(services.filter((x) => x !== s))} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-canvas-2 hover:text-ink">
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canEdit ? (
                <div className="flex gap-2">
                  <Input
                    value={newService}
                    onChange={(e) => setNewService(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addService();
                      }
                    }}
                    placeholder="e.g. Check-up and clean"
                    aria-label="Add something callers can ask for"
                    className="h-12 bg-white text-[15px]"
                    maxLength={60}
                  />
                  <Button type="button" variant="outline" className="h-12 shrink-0" onClick={addService}>
                    <Plus className="mr-1 h-4 w-4" /> Add
                  </Button>
                </div>
              ) : null}
              {canEdit ? <SaveButton pending={saveServices.isPending} dirty={JSON.stringify(services) !== JSON.stringify(savedServices) || newService.trim() !== ""} onClick={() => saveServices.mutate()} /> : null}
            </>
          ) : (
            <p className="text-[14px] text-ink-muted">Your receptionist isn't set up yet. {AGENCY_NOTE(who)}</p>
          )}
        </Section>

        <LinkRow to="/app/knowledge" title="Answers to common questions" summary={knowledgeQ.isPending ? undefined : nKnow ? `${nKnow} answer${nKnow === 1 ? "" : "s"} saved` : "Teach your receptionist what to say"} />

        {bookingSet ? (
          <div className="flex min-h-[64px] items-center gap-3 border-b border-hairline px-4 py-3" data-setting="approval">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold text-ink">Bookings need my approval</span>
              <span className="mt-0.5 block text-[13.5px] text-ink-muted">{needsApproval ? "On. Approve them in Calendar." : "Off. Bookings are confirmed straight away."}</span>
            </span>
            <Switch checked={needsApproval} disabled={!canEdit || saveApproval.isPending} onCheckedChange={(v) => saveApproval.mutate(v)} aria-label="Bookings need my approval" />
          </div>
        ) : null}

        <Section id="messages" title="Where messages go" summary={savedEmail || "In your dashboard"} open={open === "messages"} onToggle={() => toggle("messages")}>
          <p className="text-[14px] text-ink-muted">Every message and booking is on your Home page. You can also get them by email.</p>
          {bookingSet ? (
            <>
              <div>
                <label htmlFor="cs-email" className="mb-1 block text-[14px] font-medium text-ink">Email me new messages and bookings</label>
                <Input id="cs-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={ro} placeholder="you@yourbusiness.com" className="h-12 bg-white text-[15px]" />
              </div>
              {canEdit ? <SaveButton pending={saveEmail.isPending} dirty={email.trim() !== savedEmail} onClick={() => saveEmail.mutate()} /> : null}
            </>
          ) : (
            <p className="text-[14px] text-ink-muted">Email alerts aren't switched on yet. {AGENCY_NOTE(who)}</p>
          )}
          <p className="text-[13px] text-ink-muted">Want calls put through to your mobile too? {AGENCY_NOTE(who)}</p>
        </Section>

        <Section id="chatbot" title="Chatbot" summary={telegramQ.data?.connected ? `Telegram: @${telegramQ.data.username}` : "Telegram: not connected"} open={open === "chatbot"} onToggle={() => toggle("chatbot")}>
          <h3 className="text-[15px] font-semibold text-ink">Telegram</h3>
          {businessId ? <TelegramSetup clientId={businessId} /> : null}
        </Section>

        <LinkRow to="/app/team" title="Team logins" summary="Who can sign in and see your calls" />

        <Section
          id="pause"
          title="Pause receptionist"
          summary={pausedByYou ? "Paused" : pausedByAgency ? `Paused by ${who}` : "On"}
          open={open === "pause"}
          onToggle={() => toggle("pause")}
        >
          {pausedByAgency ? (
            <p className="text-[14px] text-ink-muted">{who} has paused your receptionist. Get in touch with them to switch it back on.</p>
          ) : (
            <>
              <p className="text-[14px] text-ink-muted">
                {pausedByYou
                  ? "Your receptionist is paused. Callers hear your pause message and it takes their details. Nothing is booked until you resume."
                  : "Going on holiday or need a break? Callers will hear a short message and your receptionist will take their details instead of booking."}
              </p>
              {agent && canEdit ? <PauseControl businessId={businessId!} agent={agent} blockedReason={null} onDone={() => refresh()} /> : null}
            </>
          )}
        </Section>
      </div>

      <div className="panel overflow-hidden">
        <Section id="numbers" title="Your receptionist's number" summary={numbers.length ? numbers.map((n) => fmtPhone(n.e164)).join(", ") : "Not connected yet"} open={open === "numbers"} onToggle={() => toggle("numbers")}>
          {numbers.length ? (
            <ul className="space-y-1 text-[17px] font-semibold tabular-nums text-ink">
              {numbers.map((n) => (
                <li key={n.id}>{fmtPhone(n.e164)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-ink-muted">No number is connected yet.</p>
          )}
          <p className="text-[13.5px] text-ink-muted">Voice, call transfers, texting, extra numbers and other call handling are looked after for you. {AGENCY_NOTE(who)}</p>
        </Section>
        <LinkRow to="/app/how-it-works" title="How it works" summary="Quick help: calls, bookings, messages, hours and getting in touch" />
        <LinkRow to="/app/analytics" title="Reports" summary="How your calls and bookings are trending" />
        <LinkRow to="/app/settings" search={{ tab: "business" }} title="Business details" summary="Name, address, time zone" />
        {!NEUTRAL_DASHBOARD && <LinkRow to="/app/settings" search={{ tab: "branding" }} title="Logo and colours" summary="How your dashboard looks" />}
        <LinkRow to="/app/settings" search={{ tab: "account" }} title="Your login" summary="Your name and password" />
      </div>

      {staff ? (
        <div className="panel overflow-hidden" data-agency-links>
          <p className="border-b border-hairline px-4 py-3 text-[13px] font-semibold text-ink-muted">For the agency</p>
          <LinkRow to="/app/receptionist" title="Full receptionist setup" />
          <LinkRow to="/app/phone-numbers" title="Phone numbers and call handling" />
          <LinkRow to="/app/automations" title="Automations" />
          <LinkRow to="/app/integrations" title="Connected apps" />
          <LinkRow to="/app/settings" search={{ tab: "handling" }} title="Call handling details" />
          <LinkRow to="/app/settings" search={{ tab: "billing" }} title="Plan and usage" />
        </div>
      ) : null}
    </div>
  );
}
