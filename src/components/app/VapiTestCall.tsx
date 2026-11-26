import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/base";

// Browser test call for a receptionist that runs on Vapi: @vapi-ai/web with the agency's
// public key (from /api/clients/<id>/web-call) and the receptionist's assistant id.
// Same one click as the Telnyx widget: press the button and the call starts.

type Phase = "idle" | "connecting" | "live" | "failed";

// The SDK is loaded when someone asks for a call (or hovers the button), not with the page.
const loadSdk = () => import("@vapi-ai/web");

export function VapiTestCall({ assistantId, clientId, big = false }: { assistantId: string; clientId: string; big?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = useRef<any>(null);

  // Never leave a call running behind a closed card.
  useEffect(() => () => void call.current?.stop?.(), []);

  const start = async () => {
    setError("");
    setPhase("connecting");
    try {
      const [{ default: Vapi }, cfg] = await Promise.all([loadSdk(), api.get<{ provider: string; publicKey?: string; assistantId: string }>(`/api/clients/${clientId}/web-call`)]);
      if (cfg.provider !== "vapi" || !cfg.publicKey) throw new Error("Add your Vapi public key in Connections to use the test call.");
      const vapi = new Vapi(cfg.publicKey);
      call.current = vapi;
      vapi.on("call-start", () => setPhase("live"));
      vapi.on("call-end", () => {
        call.current = null;
        setMuted(false);
        setPhase("idle");
      });
      vapi.on("error", (e: unknown) => {
        const message = (e as { error?: { message?: string }; message?: string })?.error?.message ?? (e as Error)?.message ?? "The call couldn't start.";
        setError(String(message));
        setPhase("failed");
        void vapi.stop();
      });
      await vapi.start(cfg.assistantId || assistantId);
    } catch (err) {
      call.current = null;
      setError((err as Error).message || "The call couldn't start.");
      setPhase("failed");
    }
  };

  const stop = () => {
    void call.current?.stop?.();
  };
  const toggleMute = () => {
    const next = !muted;
    call.current?.setMuted?.(next);
    setMuted(next);
  };

  return (
    <div className={big ? "min-w-0 space-y-2" : "mb-3 space-y-2 border-b border-hairline pb-3"} data-test-call data-engine="vapi">
      {big ? null : <div className="text-[12.5px] font-medium text-ink">Test call</div>}
      {phase === "idle" || phase === "failed" ? (
        <Button size={big ? "lg" : "sm"} className={big ? "h-14 w-full text-[16px] font-semibold" : "h-8 w-full text-[12.5px]"} onClick={() => void start()} onPointerEnter={() => void loadSdk().catch(() => {})} onFocus={() => void loadSdk().catch(() => {})} data-action="test-call">
          <Mic className={big ? "mr-2 h-5 w-5" : "mr-1 h-3.5 w-3.5"} /> {big ? "Test call" : "Talk to this receptionist"}
        </Button>
      ) : phase === "connecting" ? (
        <p className="text-[12px] text-ink-muted" data-test-call-status="starting">
          Connecting the call… allow the microphone if your browser asks.
        </p>
      ) : (
        <div className="flex gap-2" data-test-call-status="live">
          <Button size="sm" variant="outline" className="h-8 flex-1 text-[12.5px]" onClick={toggleMute} aria-pressed={muted} data-action="mute">
            {muted ? <MicOff className="mr-1 h-3.5 w-3.5" /> : <Mic className="mr-1 h-3.5 w-3.5" />} {muted ? "Unmute" : "Mute"}
          </Button>
          <Button size="sm" variant="destructive" className="h-8 flex-1 text-[12.5px]" onClick={stop} data-action="hang-up">
            <PhoneOff className="mr-1 h-3.5 w-3.5" /> End call
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-[12px] text-ink-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
