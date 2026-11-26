import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/forms";
import { sendFollowupTest, type AutomationsState } from "@/lib/api/automations";
import { fmtRelative } from "@/lib/app/format";
import { SAMPLE_VARS, TEMPLATE_VARS, fillTemplate, withOptOut } from "@/lib/followups";

// Pieces shared by the reminder, missed-call and review cards in AutomationsPanel:
// a template editor with a live preview, "Send me a test", and the recent list.

const VARS_HINT = TEMPLATE_VARS.map((v) => `{${v}}`).join(", ");

/** A template box with the message as the customer would see it, filled with sample details. */
export function TemplateField({
  id,
  label,
  value,
  onChange,
  disabled,
  businessName,
  link,
  channel,
  rows = 2,
  max = 300,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  businessName: string;
  link?: string;
  channel: "sms" | "email";
  rows?: number;
  max?: number;
  hint?: string;
}) {
  const vars = { ...SAMPLE_VARS, business: businessName || SAMPLE_VARS.business, link: link || SAMPLE_VARS.link };
  const filled = fillTemplate(value, vars);
  const shown = channel === "sms" ? withOptOut(filled) : filled;
  const parts = Math.max(1, Math.ceil(shown.length / 160));
  return (
    <Field label={label} htmlFor={id} hint={hint ?? `${VARS_HINT} are filled in.`}>
      <Textarea id={id} rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      <div className="rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2" data-preview={id}>
        <div className="mb-1 flex items-center justify-between text-[11.5px] uppercase tracking-wide text-ink-muted">
          <span>Preview</span>
          {channel === "sms" ? (
            <span>
              {shown.length} characters · {parts} text{parts === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink">{shown || "Nothing will be sent: the message is empty."}</p>
      </div>
    </Field>
  );
}

/** "Send me a test": a text to the mobile number typed here, or an email to the signed-in person. */
export function TestRow({
  businessId,
  kind,
  smsOn,
  emailOn,
  section,
  disabled,
}: {
  businessId: string;
  kind: "reminder" | "missed" | "review";
  smsOn: boolean;
  emailOn: boolean;
  /** The section as it is on screen (maybe unsaved), so the test uses the wording just typed. */
  section: Record<string, unknown>;
  disabled: boolean;
}) {
  const [phone, setPhone] = useState("");
  const test = useMutation({
    mutationFn: (channel: "sms" | "email") => sendFollowupTest(businessId, { kind, channel, phone, settings: section }),
    onSuccess: (r) => toast.success(`Test sent to ${r.sentTo}`),
    onError: (err: Error) => toast.error(err.message),
  });
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-[6px] border border-hairline px-3 py-2.5" data-test-row={kind}>
      {smsOn ? (
        <>
          <Field label="Your mobile, for a test text" htmlFor={`test-phone-${kind}`} className="min-w-[190px] flex-1">
            <Input id={`test-phone-${kind}`} inputMode="tel" placeholder="0412 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={disabled} />
          </Field>
          <Button type="button" variant="outline" size="sm" disabled={disabled || test.isPending || !phone.trim()} onClick={() => test.mutate("sms")}>
            Text me a test
          </Button>
        </>
      ) : null}
      {emailOn ? (
        <Button type="button" variant="outline" size="sm" disabled={disabled || test.isPending} onClick={() => test.mutate("email")}>
          Email me a test
        </Button>
      ) : null}
      {!smsOn && !emailOn ? <span className="text-[12.5px] text-ink-muted">Turn on texts or email to send a test.</span> : null}
    </div>
  );
}

const STATUS_WORDS: Record<string, string> = { sent: "Sent", sending: "Sending", skipped: "Skipped", failed: "Failed" };

export function RecentFollowups({ items, kind }: { items: AutomationsState["followups"]["recent"]; kind: "reminder" | "missed" | "review" }) {
  const mine = items.filter((t) => t.kind === kind).slice(0, 4);
  if (!mine.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-medium text-ink">Recent</div>
      <ul className="divide-y divide-hairline rounded-[6px] border border-hairline text-[12.5px]">
        {mine.map((t, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-ink">
              {t.to || "Unknown"} · {t.channel === "sms" ? "text" : "email"}
            </span>
            <span className="text-ink-muted">
              {STATUS_WORDS[t.status] ?? t.status}
              {t.detail ? `: ${t.detail}` : ""} · {fmtRelative(t.at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
