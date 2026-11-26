import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { VoiceProviderId } from "@/lib/shared";
import { cn } from "@/lib/utils";

// The voice engine choice and its keys, shared by Setup and Connections.
// Telnyx: one API key. Vapi: a private key (the server uses it) and a public key
// (the browser test call uses it). Both are on the same API Keys page in Vapi.

export const ENGINES: { id: VoiceProviderId; name: string; blurb: string }[] = [
  { id: "telnyx", name: "Telnyx", blurb: "Recommended. Buy Australian numbers here, texting included." },
  { id: "vapi", name: "Vapi", blurb: "Backup option. Use your Vapi account. Buy or bring a Twilio number (or a Telnyx one); texts go out from Twilio." },
];

export const engineName = (id: VoiceProviderId | undefined) => (id === "vapi" ? "Vapi" : "Telnyx");

export type PhoneKeyValue = { provider: VoiceProviderId; key: string; publicKey: string };
export const keysReady = (v: PhoneKeyValue) => Boolean(v.key.trim()) && (v.provider === "telnyx" || Boolean(v.publicKey.trim()));

/** Telnyx first and primary. Vapi is a backup option, folded away under "Other options (backup)" unless it's already chosen. */
export function EngineChoice({ value, onChange }: { value: VoiceProviderId; onChange: (id: VoiceProviderId) => void }) {
  const card = (e: (typeof ENGINES)[number]) => (
    <button
      key={e.id}
      type="button"
      role="radio"
      aria-checked={value === e.id}
      onClick={() => onChange(e.id)}
      data-engine={e.id}
      className={cn("w-full rounded-[10px] border px-3.5 py-2.5 text-left transition-colors", value === e.id ? "border-indigo bg-[#f5f4ff]" : "border-hairline bg-white hover:border-ink-muted")}
    >
      <div className="text-[13.5px] font-semibold text-ink">{e.name}{e.id === "telnyx" ? " (recommended)" : " (backup option)"}</div>
      <div className="mt-0.5 text-[12px] leading-5 text-ink-muted">{e.blurb}</div>
    </button>
  );
  const [main, ...backup] = ENGINES;
  return (
    <div role="radiogroup" aria-label="Voice engine" className="space-y-2" data-field="voice-engine">
      {card(main)}
      <details className="group rounded-[10px] border border-dashed border-hairline px-3 py-2" data-field="backup-engines" open={value !== "telnyx"}>
        <summary className="cursor-pointer select-none text-[12.5px] font-medium text-ink-muted">Other options (backup)</summary>
        <div className="mt-2 space-y-2">{backup.map(card)}</div>
      </details>
    </div>
  );
}

export function KeyInput({ id, label, value, onChange, placeholder, field }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string; field: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="h-10 bg-white pr-10 font-mono text-[13px]"
          data-field={field}
        />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide key" : "Show key"} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/** The key fields for one engine. */
export function PhoneKeyFields({ value, onChange, idPrefix }: { value: PhoneKeyValue; onChange: (v: PhoneKeyValue) => void; idPrefix: string }) {
  if (value.provider === "vapi") {
    return (
      <div className="space-y-3">
        <KeyInput id={`${idPrefix}-key`} label="Vapi private API key" value={value.key} onChange={(key) => onChange({ ...value, key })} placeholder="Private key" field="api-key" />
        <KeyInput id={`${idPrefix}-public`} label="Vapi public key (for the browser test call)" value={value.publicKey} onChange={(publicKey) => onChange({ ...value, publicKey })} placeholder="Public key" field="vapi-public-key" />
      </div>
    );
  }
  return <KeyInput id={`${idPrefix}-key`} label="Your Telnyx API key" value={value.key} onChange={(key) => onChange({ ...value, key })} placeholder="KEY…" field="api-key" />;
}
