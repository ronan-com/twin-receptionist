import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brandVars, textOn } from "@/components/app/WorkspaceBrand";
import type { BrandChange } from "@/lib/api/console";
import type { Brand } from "@/lib/shared";
import { PRODUCT } from "@/lib/app/product";

// The branding editor (not a route): logo, background and colours, with a live preview
// of the customer workspace. Used for the agency default (Settings) and per company.

type Props = {
  brand: Brand | undefined;
  /** What blank fields fall back to (the agency's branding), for the preview. */
  fallback?: Brand;
  canManage: boolean;
  previewName: string;
  upload: (kind: "logo" | "background", file: File) => Promise<Brand>;
  save: (change: BrandChange) => Promise<Brand>;
  onSaved: (b: Brand) => void | Promise<void>;
};

const COLOURS = [
  { key: "primaryColor", label: "Primary", hint: "Buttons, links, highlights", def: "#635bff" },
  { key: "accentColor", label: "Accent", hint: "Secondary highlights", def: "#635bff" },
  { key: "sidebarColor", label: "Sidebar", hint: "Optional", def: "#ffffff" },
  { key: "bgColor", label: "Background", hint: "Optional, behind the cards", def: "#f6f9fc" },
] as const;
type ColourKey = (typeof COLOURS)[number]["key"];

export function BrandEditor({ brand, fallback, canManage, previewName, upload, save, onSaved }: Props) {
  const [draft, setDraft] = useState<Record<ColourKey, string>>({ primaryColor: "", accentColor: "", sidebarColor: "", bgColor: "" });
  const logoInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft({ primaryColor: brand?.primaryColor ?? "", accentColor: brand?.accentColor ?? "", sidebarColor: brand?.sidebarColor ?? "", bgColor: brand?.bgColor ?? "" });
  }, [brand?.primaryColor, brand?.accentColor, brand?.sidebarColor, brand?.bgColor]);

  const up = useMutation({
    mutationFn: ({ kind, file }: { kind: "logo" | "background"; file: File }) => upload(kind, file),
    onSuccess: async (b, v) => {
      toast.success(v.kind === "logo" ? "Logo saved" : "Background saved");
      await onSaved(b);
    },
    onError: (e: Error) => toast.error("Couldn't upload", { description: e.message }),
  });
  const change = useMutation({
    mutationFn: (c: { body: BrandChange; message: string }) => save(c.body),
    onSuccess: async (b, v) => {
      toast.success(v.message);
      await onSaved(b);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = up.isPending || change.isPending;
  const dirty = COLOURS.some((c) => (brand?.[c.key] ?? "") !== draft[c.key]);

  // The preview: this level's picks, then the fallback, then Answered's defaults.
  const eff = {
    logo: brand?.logo || fallback?.logo || "",
    bgImage: brand?.bgImage || fallback?.bgImage || "",
    primaryColor: draft.primaryColor || fallback?.primaryColor || "",
    accentColor: draft.accentColor || fallback?.accentColor || "",
    sidebarColor: draft.sidebarColor || fallback?.sidebarColor || "",
    bgColor: draft.bgColor || fallback?.bgColor || "",
  };
  const sidebarDark = /^#[0-9a-f]{6}$/i.test(eff.sidebarColor) && textOn(eff.sidebarColor) === "#ffffff";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]" data-brand-editor>
      <div className="min-w-0 space-y-5">
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-ink">Logo</h3>
          <p className="text-[12px] text-ink-muted">PNG, JPEG or WebP, up to 400 KB.</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-14 w-40 items-center justify-center rounded-[6px] border border-hairline bg-canvas-2" data-brand-logo={brand?.logo ? "set" : "none"}>
              {brand?.logo ? <img src={brand.logo} alt="Logo" className="max-h-11 max-w-[90%] object-contain" /> : <span className="text-[12px] text-ink-muted">No logo</span>}
            </div>
            {canManage ? (
              <>
                <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden data-upload="logo" onChange={(e) => e.target.files?.[0] && up.mutate({ kind: "logo", file: e.target.files[0] })} />
                <Button size="sm" variant="outline" className="h-8 text-[12.5px]" disabled={busy} onClick={() => logoInput.current?.click()}>
                  <ImageUp className="mr-1.5 h-3.5 w-3.5" /> {brand?.logo ? "Replace" : "Upload logo"}
                </Button>
                {brand?.logo ? (
                  <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" disabled={busy} onClick={() => change.mutate({ body: { removeLogo: true }, message: "Logo removed" })}>
                    Remove
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-ink">Background image</h3>
          <p className="text-[12px] text-ink-muted">Optional. PNG, JPEG or WebP, up to 1.5 MB.</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-14 w-40 rounded-[6px] border border-hairline" style={{ background: brand?.bgImage ? `center/cover url(${brand.bgImage})` : "var(--canvas-2)" }} data-brand-background={brand?.bgImage ? "image" : "none"} />
            {canManage ? (
              <>
                <input ref={bgInput} type="file" accept="image/png,image/jpeg,image/webp" hidden data-upload="background" onChange={(e) => e.target.files?.[0] && up.mutate({ kind: "background", file: e.target.files[0] })} />
                <Button size="sm" variant="outline" className="h-8 text-[12.5px]" disabled={busy} onClick={() => bgInput.current?.click()}>
                  <ImageUp className="mr-1.5 h-3.5 w-3.5" /> {brand?.bgImage ? "Replace" : "Upload image"}
                </Button>
                {brand?.bgImage ? (
                  <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" disabled={busy} onClick={() => change.mutate({ body: { removeBackground: true }, message: "Background removed" })}>
                    Remove
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-ink">Colours</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {COLOURS.map((c) => (
              <div key={c.key} className="flex min-w-0 items-center gap-2 rounded-[6px] border border-hairline px-2.5 py-2">
                <input
                  type="color"
                  aria-label={`${c.label} colour`}
                  data-colour={c.key}
                  value={draft[c.key] || c.def}
                  disabled={!canManage}
                  onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-hairline bg-white p-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-ink">{c.label}</div>
                  <div className="truncate text-[11.5px] text-ink-muted">{draft[c.key] ? draft[c.key] : `Default · ${c.hint}`}</div>
                </div>
                {draft[c.key] && canManage ? (
                  <button type="button" className="text-[11.5px] text-ink-muted hover:text-ink" onClick={() => setDraft((d) => ({ ...d, [c.key]: "" }))}>
                    Clear
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-[12.5px]" disabled={busy || !dirty} onClick={() => change.mutate({ body: { ...draft }, message: "Colours saved" })} data-action="save-colours">
                Save colours
              </Button>
              {dirty ? (
                <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" onClick={() => setDraft({ primaryColor: brand?.primaryColor ?? "", accentColor: brand?.accentColor ?? "", sidebarColor: brand?.sidebarColor ?? "", bgColor: brand?.bgColor ?? "" })}>
                  Undo
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 text-[12px] font-medium text-ink-muted">Preview: {previewName}'s workspace</div>
        <div
          className="overflow-hidden rounded-[8px] border border-hairline"
          style={{ ...(brandVars(eff) as CSSProperties), background: [eff.bgImage ? `center/cover url(${eff.bgImage})` : "", eff.bgColor || "var(--canvas-2)"].filter(Boolean).join(", ") }}
          data-brand-preview
        >
          <div className="flex h-[200px]">
            <div className="flex w-[92px] shrink-0 flex-col gap-1.5 border-r border-hairline p-2" style={{ background: eff.sidebarColor || "#ffffff", color: sidebarDark ? "#ffffff" : "var(--ink)" }}>
              {eff.logo ? <img src={eff.logo} alt="" className="mb-1 max-h-7 max-w-full object-contain" /> : <div className="mb-1 truncate text-[10.5px] font-semibold">{previewName}</div>}
              {["Overview", "Calls", "Bookings"].map((n, i) => (
                <div key={n} className="truncate rounded-[4px] px-1.5 py-1 text-[10px]" style={i === 0 ? { background: "var(--primary)", color: "var(--primary-foreground)" } : { opacity: 0.8 }}>
                  {n}
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-2 p-2.5">
              <div className="rounded-[6px] border border-hairline bg-white p-2">
                <div className="text-[10px] text-ink-muted">Calls this week</div>
                <div className="text-[16px] font-semibold text-ink">24</div>
                <div className="mt-1 h-1.5 rounded-full bg-canvas-2">
                  <div className="h-1.5 w-2/3 rounded-full" style={{ background: "var(--primary)" }} />
                </div>
              </div>
              <div className="flex gap-1.5">
                <span className="rounded-[4px] px-2 py-1 text-[10px]" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
                  Primary
                </span>
                <span className="rounded-[4px] px-2 py-1 text-[10px]" style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}>
                  Accent
                </span>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-muted">Unsaved colours show here first. Blank fields use {fallback ? "your agency's branding" : `${PRODUCT}'s defaults`}.</p>
      </div>
    </div>
  );
}
