import { createElement, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VapiTestCall } from "./VapiTestCall";

// The widget's own start button, inside its shadow root (it is the only button
// before a call; the in-call controls appear once the call is up).
function startButton(el: Element): HTMLButtonElement | null {
  return el.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? null;
}

/**
 * Talk to a receptionist from the browser. No phone number needed.
 * One click: ours loads the call widget and starts the call as soon as it is
 * connected, so the widget's own "Talk to…" button never needs pressing. The
 * widget's in-call controls (mute, hang up, transcript) stay as they are.
 */
export function TestCall({ assistantId, provider, clientId }: { assistantId: string; provider?: string; clientId?: string }) {
  // A Vapi receptionist is called with Vapi's web SDK; everything else is the Telnyx widget below, as it always was.
  if (provider === "vapi" && clientId) return <VapiTestCall assistantId={assistantId} clientId={clientId} />;
  return <TelnyxTestCall assistantId={assistantId} />;
}

function TelnyxTestCall({ assistantId }: { assistantId: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");
  // starting: waiting for the widget to connect and the call to ring; shown: the
  // widget is on screen (call under way, or we gave up starting it ourselves).
  const [phase, setPhase] = useState<"starting" | "shown">("starting");

  // Starts loading the widget code early (hover or focus), so the click is quick.
  const preload = () => {
    // @ts-expect-error the widget ships without type definitions
    void import("@telnyx/ai-agent-widget").catch(() => {});
  };

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
    const timers: number[] = [];
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

    // Start the call once the widget is connected. It ignores a press until it has
    // caught up with its own connection, so press again if no call has begun.
    let calling = false;
    let presses = 0;
    const press = () => {
      if (calling) return;
      const btn = startButton(el);
      if (btn && presses < 5) {
        presses++;
        btn.click();
        timers.push(window.setTimeout(press, 1000));
      } else if (presses >= 5) setPhase("shown");
      else timers.push(window.setTimeout(press, 200));
    };
    const onConnected = () => timers.push(window.setTimeout(press, 250));
    const onUpdate = (e: Event) => {
      const state = (e as CustomEvent<{ callState?: string }>).detail?.callState;
      // "new" is the call being placed: stop pressing from then on.
      if (state && !["hangup", "destroy"].includes(state)) {
        calling = true;
        setPhase("shown");
      }
    };
    const onError = () => setPhase("shown");
    el.addEventListener("agent.connected", onConnected);
    el.addEventListener("conversation.update", onUpdate);
    el.addEventListener("agent.error", onError);
    // In case the connected event came and went before we listened.
    timers.push(window.setTimeout(() => presses === 0 && press(), 8000));
    // Never leave someone staring at "Connecting": show the widget's own button.
    timers.push(window.setTimeout(() => setPhase("shown"), 20000));
    return () => {
      window.clearInterval(pin);
      timers.forEach((t) => window.clearTimeout(t));
      el.removeEventListener("agent.connected", onConnected);
      el.removeEventListener("conversation.update", onUpdate);
      el.removeEventListener("agent.error", onError);
    };
  }, [ready]);

  return (
    <div className="mb-3 space-y-2 border-b border-hairline pb-3" ref={holder} data-test-call>
      <div className="text-[12.5px] font-medium text-ink">Test call</div>
      {!open ? (
        <Button
          size="sm"
          className="h-8 w-full text-[12.5px]"
          onClick={() => setOpen(true)}
          onPointerEnter={preload}
          onFocus={preload}
          data-action="test-call"
        >
          <Mic className="mr-1 h-3.5 w-3.5" /> Talk to this receptionist
        </Button>
      ) : failed ? (
        <p role="alert" className="text-[12px] text-ink-muted">{failed}</p>
      ) : ready ? (
        <>
          {phase === "starting" ? <p className="text-[12px] text-ink-muted" data-test-call-status="starting">Connecting the call… allow the microphone if your browser asks.</p> : null}
          {/* Hidden (not removed) while starting, so it can connect and be pressed. */}
          {createElement("telnyx-ai-agent", { "agent-id": assistantId, style: phase === "starting" ? { visibility: "hidden", height: 0, display: "block", overflow: "hidden" } : undefined })}
        </>
      ) : (
        <p className="text-[12px] text-ink-muted">Loading the call…</p>
      )}
    </div>
  );
}
