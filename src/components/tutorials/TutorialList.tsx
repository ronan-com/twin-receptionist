import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Compass, LifeBuoy, PlayCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GuideAnimation } from "@/components/onboarding/Guides";
import { fillTutorial, plainTutorial, videoEmbed, type Tutorial, type TutorialAction } from "@/lib/tutorials";
import { cn } from "@/lib/utils";

// The list on the Tutorials page (/admin/tutorials) and the businesses' "How it works"
// page: search, groups, and cards that open to numbered steps, a video or animated
// guide, and a "Go there" button. /…#<id> opens and scrolls to that tutorial.

type Names = { product?: string; agency?: string };

/** **bold** in tutorial text, as <strong>. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{p}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function Video({ url, title }: { url?: string; title: string }) {
  const v = videoEmbed(url);
  if (!v) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-black" data-tutorial-video={v.kind}>
      {v.kind === "iframe" ? (
        <iframe
          src={v.src}
          title={title}
          loading="lazy"
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <video src={v.src} controls preload="metadata" playsInline className="aspect-video w-full" />
      )}
    </div>
  );
}

/** "/admin/settings?tab=email" for a router Link. */
function splitHref(href: string): { to: string; search?: Record<string, string> } {
  const [to, q] = href.split("?");
  return q ? { to, search: Object.fromEntries(new URLSearchParams(q)) } : { to };
}

function matches(t: Tutorial, groupTitle: string, words: string[], names: Names) {
  if (!words.length) return true;
  const hay = plainTutorial(fillTutorial([t.title, t.summary, ...t.steps, t.keywords ?? "", groupTitle].join(" "), names)).toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function TutorialList({
  tutorials,
  groups,
  names,
  onAction,
  canAct,
  accent = "text-indigo",
  search = true,
  size = "md",
}: {
  tutorials: Tutorial[];
  groups?: { id: string; title: string }[];
  names: Names;
  onAction?: (a: TutorialAction) => void;
  /** Which actions work here (e.g. no tour for someone without Get started). */
  canAct?: (a: TutorialAction) => boolean;
  accent?: string;
  search?: boolean;
  /** "lg" = bigger type, for business owners on a phone. */
  size?: "md" | "lg";
}) {
  const hash = useRouterState({ select: (s) => s.location.hash });
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const fill = (s: string) => fillTutorial(s, names);

  // Open (and scroll to) the tutorial named in the address: /admin/tutorials#test-call.
  useEffect(() => {
    const id = decodeURIComponent((hash ?? "").replace(/^#/, ""));
    if (!id || !tutorials.some((t) => t.id === id)) return;
    setQ("");
    setOpen(id);
    const t = window.setTimeout(() => document.getElementById(`tutorial-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => window.clearTimeout(t);
  }, [hash, tutorials]);

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${next ? `#${next}` : ""}`);
    } catch {
      /* the address just doesn't update */
    }
  };

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sections = useMemo(() => {
    const gs = groups ?? [{ id: "", title: "" }];
    return gs
      .map((g) => ({ ...g, items: tutorials.filter((t) => (!groups || t.group === g.id) && matches(t, g.title, words, names)) }))
      .filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorials, groups, q, names.agency, names.product]);
  const found = sections.reduce((n, g) => n + g.items.length, 0);
  const onlyOne = words.length && found === 1 ? sections[0].items[0].id : null;
  const lg = size === "lg";

  return (
    <div className="space-y-5" data-tutorials>
      {search ? (
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tutorials, e.g. transfer, number, logo"
            aria-label="Search tutorials"
            className="h-10 bg-white pl-9 pr-9 text-[14px]"
            data-field="tutorial-search"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted hover:bg-canvas-2 hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      {found === 0 ? (
        <p className="rounded-[10px] border border-hairline bg-white px-4 py-6 text-center text-[13.5px] text-ink-muted" data-tutorials-empty>
          No tutorial matches "{q.trim()}". Try another word, or ask through the <strong className="font-semibold text-ink">?</strong> menu.
        </p>
      ) : null}

      {sections.map((g) => (
        <section key={g.id || "all"} aria-label={g.title || undefined} data-tutorial-group={g.id || undefined} className="space-y-2">
          {g.title ? <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{g.title}</h2> : null}
          <ul className="space-y-2">
            {g.items.map((t) => {
              const isOpen = open === t.id || onlyOne === t.id;
              const href = splitHref(t.to);
              const act = t.action && onAction && (!canAct || canAct(t.action)) ? t.action : null;
              const hasVideo = Boolean(videoEmbed(t.video));
              return (
                <li key={t.id} id={`tutorial-${t.id}`} data-tutorial={t.id} data-open={isOpen || undefined} className="scroll-mt-20 overflow-hidden rounded-[10px] border border-hairline bg-white">
                  <button
                    type="button"
                    onClick={() => toggle(t.id)}
                    aria-expanded={isOpen}
                    aria-controls={`tutorial-${t.id}-body`}
                    className={cn("flex w-full items-center gap-3 px-4 text-left outline-none hover:bg-canvas-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo", lg ? "min-h-[68px] py-3" : "min-h-[56px] py-2.5")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("flex items-center gap-2 font-semibold text-ink", lg ? "text-[16px]" : "text-[14px]")}>
                        {fill(t.title)}
                        {hasVideo || t.guide ? <PlayCircle className={cn("h-3.5 w-3.5 shrink-0", accent)} aria-label="Has a video" /> : null}
                      </span>
                      <span className={cn("mt-0.5 block text-ink-muted", lg ? "text-[14px]" : "text-[12.5px]")}>{fill(t.summary)}</span>
                    </span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-muted transition-transform", isOpen && "rotate-180")} />
                  </button>
                  {isOpen ? (
                    <div id={`tutorial-${t.id}-body`} className="space-y-4 border-t border-hairline bg-canvas-2/40 px-4 py-4">
                      <Video url={t.video} title={fill(t.title)} />
                      {t.guide && !hasVideo ? <GuideAnimation kind={t.guide} className="max-w-[560px]" /> : null}
                      <ol className="space-y-2.5">
                        {t.steps.map((s, i) => (
                          <li key={i} className={cn("flex gap-3 leading-relaxed text-ink-muted", lg ? "text-[15px]" : "text-[13.5px]")}>
                            <span className={cn("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11.5px] font-semibold ring-1 ring-hairline", accent)}>{i + 1}</span>
                            <span className="min-w-0">
                              <Rich text={fill(s)} />
                            </span>
                          </li>
                        ))}
                      </ol>
                      <div className="flex flex-wrap items-center gap-2">
                        {act ? (
                          <Button type="button" size="sm" className={lg ? "h-11 px-4 text-[14px]" : "h-9"} onClick={() => onAction!(act)} data-tutorial-action={act}>
                            {act === "tour" ? <Compass className="mr-1.5 h-4 w-4" /> : <LifeBuoy className="mr-1.5 h-4 w-4" />}
                            {act === "tour" ? "Take the tour" : "Contact support"}
                          </Button>
                        ) : null}
                        {t.to ? (
                        <Button asChild size="sm" variant={act ? "outline" : "default"} className={lg ? "h-11 px-4 text-[14px]" : "h-9"}>
                          <Link to={href.to} search={href.search as never} data-tutorial-go={t.id}>
                            Go there
                            {t.toLabel ? <span className="ml-1 font-normal opacity-80">· {t.toLabel.replace(/^Open /, "")}</span> : null}
                            <ArrowRight className="ml-1.5 h-4 w-4" />
                          </Link>
                        </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

