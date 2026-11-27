import { createElement, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VapiTestCall } from "./VapiTestCall";
import { api } from "@/lib/api/base";

// A test call never waits forever: if the call button or the phone service has not answered by then, say so.
const LOAD_LIMIT_MS = 15_000;
const CONNECT_LIMIT_MS = 20_000;

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
export function TestCall({ assistantId, provider, clientId, big = false }: { assistantId: string; provider?: string; clientId?: string; big?: boolean }) {
  // A Vapi receptionist is called with Vapi's web SDK; everything else is the Telnyx widget below, as it always was.
  if (provider === "vapi" && clientId) return <VapiTestCall assistantId={assistantId} clientId={clientId} big={big} />;
  return <TelnyxTestCall assistantId={assistantId} clientId={clientId} big={big} />;
}

function TelnyxTestCall({ assistantId, clientId, big }: { assistantId: string; clientId?: string; big: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
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
    const fail = (m: string) => !cancelled && setFailed(m);
    // Asks our server first: it checks the receptionist exists on the phone service and can take a browser call.
    const check = clientId ? api.get(`/api/clients/${clientId}/web-call`).catch((e: Error) => fail(e.message || "The test call can't start right now.")) : Promise.resolve();
    // Registers the call button element, only when someone asks for it.
    const load = Promise.race([
      // @ts-expect-error the widget ships without type definitions
      import("@telnyx/ai-agent-widget"),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("slow")), LOAD_LIMIT_MS)),
    ]);
    void Promise.all([check, load])
      .then(() => !cancelled && setReady(true))
      .catch(() => fail("The call button didn't load. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, [open, attempt, clientId]);

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
        style.textContent = ":host{display:block!important;width:100%!important;max-width:100%!important}main{position:static!important;inset:auto!important;pointer-events:auto!important;width:100%!important;max-width:100%!important}main>div{position:static!important;width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important}main *{max-width:100%!important;box-sizing:border-box}";
        root.appendChild(style);
      }
      if (root || ++tries > 40) window.clearInterval(pin);
    }, 100);

    // Start the call once the widget is connected. It ignores a press until it has
    // caught up with its own connection, so press again if no call has begun.
    let calling = false;
    let connected = false;
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
    const onError = (e: Event) => {
      if (calling) return;
      const m = (e as CustomEvent<{ message?: string }>).detail?.message;
      setFailed(`The call couldn't connect${m ? ` (${m})` : ""}. Check that your microphone is allowed, then try again.`);
    };
    const onConn = () => (connected = true);
    el.addEventListener("agent.connected", onConn);
    el.addEventListener("agent.connected", onConnected);
    el.addEventListener("conversation.update", onUpdate);
    el.addEventListener("agent.error", onError);
    // In case the connected event came and went before we listened.
    timers.push(window.setTimeout(() => presses === 0 && press(), 8000));
    // Never leave someone staring at "Connecting". Never connected to the phone service: say so. Connected but the
    // call didn't start by itself: show the widget's own button.
    timers.push(
      window.setTimeout(() => {
        if (calling) return;
        if (connected) setPhase("shown");
        else setFailed("The test call couldn't connect to the phone service. Check your connection and that your microphone isn't blocked, then try again.");
      }, CONNECT_LIMIT_MS),
    );
    return () => {
      window.clearInterval(pin);
      timers.forEach((t) => window.clearTimeout(t));
      el.removeEventListener("agent.connected", onConn);
      el.removeEventListener("agent.connected", onConnected);
      el.removeEventListener("conversation.update", onUpdate);
      el.removeEventListener("agent.error", onError);
    };
  }, [ready]);

  return (
    <div className={big ? "min-w-0 space-y-2 overflow-hidden" : "mb-3 min-w-0 space-y-2 overflow-hidden border-b border-hairline pb-3"} ref={holder} data-test-call>
      {big ? null : <div className="text-[12.5px] font-medium text-ink">Test call</div>}
      {!open ? (
        <Button
          size={big ? "lg" : "sm"}
          className={big ? "h-14 w-full text-[16px] font-semibold" : "h-8 w-full text-[12.5px]"}
          onClick={() => setOpen(true)}
          onPointerEnter={preload}
          onFocus={preload}
          data-action="test-call"
        >
          <Mic className={big ? "mr-2 h-5 w-5" : "mr-1 h-3.5 w-3.5"} /> {big ? "Test call" : "Talk to this receptionist"}
        </Button>
      ) : failed ? (
        <div role="alert" className="space-y-2">
          <p className="text-[12px] text-ink-muted">{failed}</p>
          <Button size="sm" variant="outline" className="h-8 w-full text-[12.5px]" data-action="test-call-retry" onClick={() => { setFailed(""); setReady(false); setPhase("starting"); setAttempt((n) => n + 1); }}>
            Try again
          </Button>
        </div>
      ) : ready ? (
        <>
          {phase === "starting" ? <p className="text-[12px] text-ink-muted" data-test-call-status="starting">Connecting the call… allow the microphone if your browser asks.</p> : null}
          {/* Hidden (not removed) while starting, so it can connect and be pressed. */}
          {createElement("telnyx-ai-agent", { "agent-id": assistantId, style: phase === "starting" ? { visibility: "hidden", height: 0, display: "block", overflow: "hidden" } : { display: "block", width: "100%", maxWidth: "100%" } })}
        </>
      ) : (
        <p className="text-[12px] text-ink-muted">Loading the call…</p>
      )}
    </div>
  );
}
