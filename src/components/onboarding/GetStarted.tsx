import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Compass, PlayCircle, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InitialsAvatar } from "@/components/app/primitives";
import { brandApi } from "@/lib/api/console";
import { PRODUCT } from "@/lib/app/product";
import { cn } from "@/lib/utils";
import { GUIDES, GuideAnimation, type GuideKind } from "./Guides";
import { Tour, type TourStep } from "./Tour";

// "Get started" for agency owners and admins on the agency console: a welcome
// screen the first time, a guided tour of the sidebar, a checklist on the Overview
// page (Checklist.tsx) and three animated how-tos. What a person has seen is
// remembered per user in this browser (there is no server-side user preferences
// store); the checklist's ticks come from real data, not from this.

type Saved = { welcomed: boolean; dismissed: boolean; toured: boolean };
const EMPTY: Saved = { welcomed: false, dismissed: false, toured: false };
const keyFor = (userId: string) => `get-started:v1:${userId}`;

function load(userId: string): Saved {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<Saved>;
    return { welcomed: !!v.welcomed, dismissed: !!v.dismissed, toured: !!v.toured };
  } catch {
    return EMPTY;
  }
}
function save(userId: string, v: Saved) {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(v));
  } catch {
    /* private window or blocked storage: it just shows again next time */
  }
}

type Dialogs = null | "welcome" | GuideKind;

export interface GetStartedApi {
  dismissed: boolean;
  setDismissed: (v: boolean) => void;
  /** Reopen the welcome screen (help menu). */
  openWelcome: () => void;
  startTour: () => void;
  openGuide: (kind: GuideKind) => void;
}

const Ctx = createContext<GetStartedApi | null>(null);
/** Null where Get started is off (client logins, the platform admin, read-only views). */
export const useGetStarted = () => useContext(Ctx);

const NAV_COPY: Record<string, { title: string; body: string }> = {
  "/admin": { title: "Overview", body: "Your home base: calls, bookings and anything that needs attention, across all your clients." },
  "/admin/clients": { title: "Clients", body: "The businesses you look after. Add one, send them an onboarding link, and see their receptionist." },
  "/admin/calls": { title: "Calls", body: "Every call your receptionists answer, with the transcript and outcome. Test calls show up here too." },
  "/admin/receptionists": { title: "AI Receptionists", body: "All your receptionists in one list. Open one to change its greeting, hours and call handling." },
  "/admin/voices": { title: "Voices", body: "Listen to the voices on offer and see which one each receptionist uses." },
  "/admin/phone-numbers": { title: "Phone Numbers", body: "The numbers your receptionists answer. Connect one so real callers get through." },
  "/admin/number-requests": { title: "Number Requests", body: "Ask for a new number for a client. When it is ready it appears under Phone Numbers." },
  "/admin/connections": { title: "Connections", body: "Link your phone account, calendars and email so receptionists can book and follow up." },
  "/admin/usage": { title: "Usage", body: "Minutes and activity for each client, so you always know what is being used." },
  "/admin/tutorials": { title: "Tutorials", body: "Short how-tos for everything here, each with a button that takes you to the right page. You can take this tour again from there." },
  "/admin/settings": { title: "Settings", body: "Your team, your logo and brand colour, and your account. Branding here sets how clients see their dashboard." },
};

export function buildTourSteps(navPaths: string[], withChecklist: boolean): TourStep[] {
  const steps: TourStep[] = [];
  for (const to of Object.keys(NAV_COPY)) {
    if (!navPaths.includes(to)) continue;
    steps.push({ id: to, target: `nav:${to}`, ...NAV_COPY[to] });
    if (to === "/admin" && withChecklist) steps.push({ id: "checklist", target: "checklist", title: "Your Get started list", body: "A few things to do, ticked off for you as you go. Each one links to where you do it." });
  }
  steps.push({ id: "help", target: "help", title: "Help is always here", body: "Open this menu to take the tour again, find a tutorial, reopen the Get started list or contact us." });
  return steps;
}

export function GetStartedProvider({
  enabled,
  userId,
  userName,
  orgName,
  navPaths,
  children,
}: {
  enabled: boolean;
  userId: string;
  userName: string;
  orgName: string;
  navPaths: string[];
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [saved, setSaved] = useState<Saved>(() => (enabled ? load(userId) : EMPTY));
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [from, setFrom] = useState<"welcome" | null>(null);
  const [touring, setTouring] = useState(false);
  const autoShown = useRef(false);

  useEffect(() => {
    if (enabled) setSaved(load(userId));
  }, [enabled, userId]);

  const patch = useCallback(
    (p: Partial<Saved>) =>
      setSaved((s) => {
        const v = { ...s, ...p };
        save(userId, v);
        return v;
      }),
    [userId],
  );

  // First visit: the welcome screen, once, on the Overview page.
  useEffect(() => {
    if (!enabled || autoShown.current || saved.welcomed || pathname !== "/admin") return;
    autoShown.current = true;
    setDialog("welcome");
  }, [enabled, saved.welcomed, pathname]);

  const steps = useMemo(() => buildTourSteps(navPaths, !saved.dismissed), [navPaths, saved.dismissed]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setFrom(null);
    patch({ welcomed: true });
  }, [patch]);

  const startTour = useCallback(() => {
    setDialog(null);
    setFrom(null);
    patch({ welcomed: true });
    if (pathname !== "/admin") void navigate({ to: "/admin" });
    window.setTimeout(() => setTouring(true), 350);
  }, [navigate, pathname, patch]);

  const api = useMemo<GetStartedApi>(
    () => ({
      dismissed: saved.dismissed,
      setDismissed: (v) => patch({ dismissed: v }),
      openWelcome: () => {
        patch({ dismissed: false });
        if (pathname !== "/admin") void navigate({ to: "/admin" });
        setFrom(null);
        setDialog("welcome");
      },
      startTour,
      openGuide: (kind) => {
        setFrom(null);
        setDialog(kind);
      },
    }),
    [saved.dismissed, patch, pathname, navigate, startTour],
  );

  if (!enabled) return <Ctx.Provider value={null}>{children}</Ctx.Provider>;

  const guide = dialog && dialog !== "welcome" ? dialog : null;

  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog open={dialog !== null} onOpenChange={(o) => (!o ? closeDialog() : undefined)}>
        <DialogContent className="max-h-[92vh] max-w-[640px] gap-0 overflow-y-auto p-0 sm:rounded-2xl" data-get-started-dialog={dialog ?? undefined}>
          {dialog === "welcome" ? (
            <Welcome
              orgName={orgName}
              userName={userName}
              onTour={startTour}
              onCreate={() => {
                closeDialog();
                void navigate({ to: "/admin/clients/new" });
              }}
              onSkip={closeDialog}
              onGuide={(k) => {
                setFrom("welcome");
                setDialog(k);
              }}
            />
          ) : guide ? (
            <GuideView
              kind={guide}
              back={from === "welcome" ? () => setDialog("welcome") : null}
              onDone={() => {
                const to = guide === "receptionist" ? "/admin/clients/new" : "/admin/clients";
                closeDialog();
                void navigate({ to });
              }}
            />
          ) : (
            <>
              <DialogTitle className="sr-only">Get started</DialogTitle>
              <DialogDescription className="sr-only">Get started with {PRODUCT}</DialogDescription>
            </>
          )}
        </DialogContent>
      </Dialog>
      {touring ? (
        <Tour
          steps={steps}
          onClose={() => setTouring(false)}
          onDone={() => {
            setTouring(false);
            patch({ toured: true });
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

function Welcome({
  orgName,
  userName,
  onTour,
  onCreate,
  onSkip,
  onGuide,
}: {
  orgName: string;
  userName: string;
  onTour: () => void;
  onCreate: () => void;
  onSkip: () => void;
  onGuide: (k: GuideKind) => void;
}) {
  const logo = useQuery({ queryKey: ["console", "brand"], queryFn: brandApi.get, retry: false }).data?.logo;
  const first = userName.trim().split(/\s+/)[0];
  return (
    <div data-welcome>
      <div className="border-b border-hairline bg-[linear-gradient(135deg,color-mix(in_srgb,var(--indigo)_14%,#fff),#fff_75%)] px-6 pb-5 pt-7 sm:px-8">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt="" className="h-12 max-w-[120px] rounded-lg bg-white object-contain p-1 ring-1 ring-hairline" />
          ) : (
            <InitialsAvatar name={orgName || PRODUCT} size={48} />
          )}
          <div className="min-w-0 text-[12.5px] font-medium text-ink-muted">
            <div className="truncate text-ink">{orgName || "Your agency"}</div>
            {orgName && orgName.trim().toLowerCase() !== PRODUCT.toLowerCase() ? <div>Powered by {PRODUCT}</div> : null}
          </div>
        </div>
        <DialogTitle className="mt-4 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[28px]">
          {first ? `Welcome, ${first}.` : "Welcome."} Let's get you set up.
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
          A receptionist for your first client takes about five minutes. Pick how you would like to start.
        </DialogDescription>
      </div>

      <div className="grid gap-3 px-6 py-5 sm:grid-cols-2 sm:px-8">
        <button
          type="button"
          onClick={onTour}
          data-action="take-tour"
          className="group flex flex-col items-start gap-2 rounded-xl border border-hairline bg-white p-4 text-left transition hover:border-indigo hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--indigo)_12%,#fff)] text-indigo">
            <Compass className="h-5 w-5" />
          </span>
          <span className="text-[15px] font-semibold text-ink">Take the tour</span>
          <span className="text-[12.5px] leading-snug text-ink-muted">One minute, a look at every part of your dashboard.</span>
        </button>
        <button
          type="button"
          onClick={onCreate}
          data-action="create-first"
          className="group flex flex-col items-start gap-2 rounded-xl border border-indigo bg-indigo p-4 text-left text-white shadow-sm transition hover:bg-indigo-deep hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/20">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="text-[15px] font-semibold">Create your first receptionist</span>
          <span className="text-[12.5px] leading-snug text-white/85">Jump straight in. We guide you through each choice.</span>
        </button>
      </div>

      <div className="border-t border-hairline bg-canvas-2/60 px-6 py-4 sm:px-8">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Watch how</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(GUIDES) as GuideKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onGuide(k)}
              data-guide-open={k}
              className="flex items-center gap-2 rounded-lg border border-hairline bg-white px-3 py-2 text-left text-[12.5px] font-medium text-ink transition hover:border-indigo focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo"
            >
              <PlayCircle className="h-4 w-4 shrink-0 text-indigo" />
              <span className="leading-tight">{GUIDES[k].title}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onSkip} data-action="skip-welcome" className="text-[13px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

export function GuideView({ kind, back, onDone, doneLabel }: { kind: GuideKind; back: (() => void) | null; onDone?: () => void; doneLabel?: string }) {
  const g = GUIDES[kind];
  const label = doneLabel ?? (kind === "receptionist" ? "Create a receptionist" : kind === "invite" ? "Go to Clients" : "Open Clients");
  return (
    <div className="p-5 sm:p-6" data-guide-view={kind}>
      <DialogTitle className={cn("text-[18px] font-semibold tracking-[-0.02em] text-ink", back && "pl-0")}>{g.title}</DialogTitle>
      <DialogDescription className="mb-4 mt-1 text-[13px] text-ink-muted">{g.blurb}</DialogDescription>
      <GuideAnimation kind={kind} />
      <div className="mt-5 flex items-center justify-between gap-2">
        {back ? (
          <Button type="button" variant="ghost" size="sm" onClick={back} className="h-8 text-[12.5px]">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
        ) : (
          <span />
        )}
        {onDone ? (
          <Button type="button" size="sm" onClick={onDone} className="h-8 text-[12.5px]">
            {label} <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
