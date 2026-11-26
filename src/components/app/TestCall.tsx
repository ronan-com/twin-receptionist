import { createElement, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Talk to a receptionist from the browser. No phone number needed. */
export function TestCall({ assistantId }: { assistantId: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Registers the call button element, only when someone asks for it.
    // @ts-expect-error the widget ships without type definitions
    import("@telnyx/ai-agent-widget")
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setFailed("The call button didn't load. Refresh the page to try again."));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const el = holder.current?.querySelector("telnyx-ai-agent");
    if (!el) return;
    // The widget floats over the window by default: keep it inside this card.
    let tries = 0;
    const pin = window.setInterval(() => {
      const root = el.shadowRoot;
      if (root && !root.querySelector("style[data-inline]")) {
        const style = document.createElement("style");
        style.setAttribute("data-inline", "");
        style.textContent = "main{position:static!important;inset:auto!important;pointer-events:auto!important}main>div{position:static!important}";
        root.appendChild(style);
      }
      if (root || ++tries > 40) window.clearInterval(pin);
    }, 100);
    return () => window.clearInterval(pin);
  }, [ready]);

  return (
    <div className="mb-3 space-y-2 border-b border-hairline pb-3" ref={holder} data-test-call>
      <div className="text-[12.5px] font-medium text-ink">Test call</div>
      {!open ? (
        <Button size="sm" className="h-8 w-full text-[12.5px]" onClick={() => setOpen(true)} data-action="test-call">
          <Mic className="mr-1 h-3.5 w-3.5" /> Talk to this receptionist
        </Button>
      ) : failed ? (
        <p role="alert" className="text-[12px] text-ink-muted">{failed}</p>
      ) : ready ? (
        createElement("telnyx-ai-agent", { "agent-id": assistantId })
      ) : (
        <p className="text-[12px] text-ink-muted">Loading the call button…</p>
      )}
    </div>
  );
}
