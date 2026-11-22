import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageUp, Loader2, PhoneCall, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Panel } from "@/components/app/primitives";
import { Field, FormSection } from "@/components/app/forms";
import { brandQueryKey, brandVars, textOn, useWorkspaceBrand } from "@/components/app/WorkspaceBrand";
import { saveBrand, uploadBrandImage, type BrandLook } from "@/lib/api/manage";
import { useWorkspace } from "@/lib/app/workspace";

// Settings > Branding (area S): the business's own logo, background and colours for
// its workspace, overriding its agency's defaults. Colours preview live before saving;
// images are uploaded straight away (the server checks size and type).

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_PRIMARY = "#635bff";

type Colours = { primaryColor: string; accentColor: string; bgColor: string };
const coloursOf = (b: Partial<BrandLook> | undefined): Colours => ({ primaryColor: b?.primaryColor ?? "", accentColor: b?.accentColor ?? "", bgColor: b?.bgColor ?? "" });

function ColourField({ id, label, hint, value, fallback, onChange, disabled }: { id: string; label: string; hint: string; value: string; fallback: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label} htmlFor={id} hint={value ? hint : `${hint} Using ${fallback ? "your agency's" : "the standard"} colour.`}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(value) ? value : fallback || DEFAULT_PRIMARY}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          disabled={disabled}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-[5px] border border-hairline bg-white p-1 disabled:cursor-default"
        />
        <Input
          id={id}
          value={text}
          placeholder={fallback || "Not set"}
          maxLength={7}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (v === "" || HEX.test(v)) onChange(v.toLowerCase());
          }}
          className="min-w-0 font-mono text-[12.5px]"
        />
        {value && !disabled ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-[12px]" onClick={() => onChange("")} aria-label={`Reset ${label}`}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

function ImageField({ kind, label, hint, current, inherited, onUpload, onRemove, busy, disabled }: { kind: "logo" | "background"; label: string; hint: string; current: string; inherited: string; onUpload: (f: File) => void; onRemove: () => void; busy: boolean; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const shown = current || inherited;
  return (
    <div className="flex flex-col gap-3 rounded-[6px] border border-hairline bg-white p-3 sm:flex-row sm:items-center">
      <div className="flex h-16 w-full shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-hairline bg-canvas-2 sm:w-28">
        {shown ? (
          kind === "logo" ? <img src={shown} alt="" className="max-h-14 max-w-full object-contain" /> : <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url("${shown}")` }} />
        ) : (
          <span className="text-[11.5px] text-ink-muted">None</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="text-[12px] text-ink-muted">{current ? hint : inherited ? "Using your agency's. Upload your own to replace it here." : hint}</div>
      </div>
      {!disabled ? (
        <div className="flex shrink-0 gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            data-upload={kind}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageUp className="mr-1.5 h-3.5 w-3.5" />} Upload
          </Button>
          {current ? (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-ink-muted" onClick={onRemove} disabled={busy}>
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Preview({ look, name }: { look: BrandLook; name: string }) {
  const vars = brandVars(look) as React.CSSProperties;
  const primary = HEX.test(look.primaryColor) ? look.primaryColor : DEFAULT_PRIMARY;
  const accent = HEX.test(look.accentColor) ? look.accentColor : primary;
  const bg: React.CSSProperties = {
    backgroundColor: HEX.test(look.bgColor) ? look.bgColor : "#f6f9fc",
    ...(look.bgImage ? { backgroundImage: `url("${look.bgImage}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
  };
  return (
    <div data-brand-preview style={vars} className="overflow-hidden rounded-[8px] border border-hairline">
      <div className="flex min-h-[220px]">
        <div className="w-[34%] max-w-[150px] shrink-0 border-r border-hairline bg-white p-2.5">
          {look.logo ? <img src={look.logo} alt="" className="mb-2 max-h-8 max-w-full object-contain" /> : <div className="mb-2 truncate text-[12px] font-semibold text-ink">{name}</div>}
          {["Dashboard", "Calls", "Bookings"].map((n, i) => (
            <div key={n} className="mb-1 truncate rounded-[4px] px-2 py-1 text-[11px]" style={i === 0 ? { background: `${primary}1f`, color: primary, fontWeight: 600 } : { color: "#425466" }}>
              {n}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-3" style={bg}>
          <div className="rounded-[6px] border border-hairline bg-white p-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
              <PhoneCall className="h-3.5 w-3.5" style={{ color: primary }} /> Calls today
            </div>
            <div className="mt-1 text-[20px] font-semibold text-ink">12</div>
            <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: accent, color: textOn(accent) }}>
              3 new bookings
            </span>
            <div className="mt-3">
              <span className="inline-block rounded-[5px] px-3 py-1.5 text-[11.5px] font-medium" style={{ background: primary, color: textOn(primary) }}>
                Primary button
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrandingEditor() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const id = ws.businessId;
  const canEdit = ws.access.canManage;
  const q = useWorkspaceBrand();
  const own = q.data?.own;
  const agency = q.data?.agency;
  const initial = useMemo(() => coloursOf(own), [own]);
  const [colours, setColours] = useState<Colours>(initial);
  useEffect(() => setColours(initial), [initial]);
  const dirty = JSON.stringify(colours) !== JSON.stringify(initial);

  const done = (data: Awaited<ReturnType<typeof saveBrand>>) => qc.setQueryData(brandQueryKey(id), data);
  const save = useMutation({
    mutationFn: () => saveBrand(id!, colours),
    onSuccess: (d) => {
      done(d);
      toast.success("Branding saved", { description: "Everyone on this business's workspace sees it." });
    },
    onError: (e) => toast.error("Couldn't save the branding", { description: e.message }),
  });
  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: "logo" | "background"; file: File }) => uploadBrandImage(id!, kind, file),
    onSuccess: (d, v) => {
      done(d);
      toast.success(v.kind === "logo" ? "Logo uploaded" : "Background uploaded");
    },
    onError: (e) => toast.error("Couldn't upload", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: (kind: "logo" | "background") => saveBrand(id!, kind === "logo" ? { removeLogo: true } : { removeBackground: true }),
    onSuccess: done,
    onError: (e) => toast.error("Couldn't remove it", { description: e.message }),
  });

  if (q.isPending) return <div className="h-40 animate-pulse rounded-[6px] bg-canvas-2" />;
  if (q.error || !own || !agency) return <Notice tone="danger">{q.error?.message ?? "Branding couldn't be loaded."}</Notice>;

  const effectiveLogo = own.logo || agency.logo;
  const effectiveBg = own.bgImage || agency.bgImage;
  const previewLook: BrandLook = {
    logo: effectiveLogo,
    bgImage: effectiveBg,
    primaryColor: colours.primaryColor || agency.primaryColor,
    accentColor: colours.accentColor || agency.accentColor,
    bgColor: colours.bgColor || agency.bgColor,
  };
  const set = (k: keyof Colours) => (v: string) => setColours((c) => ({ ...c, [k]: v }));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" data-branding>
      <div className="min-w-0 space-y-4">
        <FormSection title="Logo and background" description="Shown to everyone who uses this workspace. PNG, JPEG or WebP; logos under 400 KB, backgrounds under 1.5 MB.">
          <div className="space-y-2">
            <ImageField kind="logo" label="Logo" hint="Shown above the business switcher." current={own.logo} inherited={agency.logo} busy={upload.isPending || remove.isPending} disabled={!canEdit} onUpload={(file) => upload.mutate({ kind: "logo", file })} onRemove={() => remove.mutate("logo")} />
            <ImageField kind="background" label="Background image" hint="Fills the page behind your dashboard." current={own.bgImage} inherited={agency.bgImage} busy={upload.isPending || remove.isPending} disabled={!canEdit} onUpload={(file) => upload.mutate({ kind: "background", file })} onRemove={() => remove.mutate("background")} />
          </div>
        </FormSection>
        <FormSection title="Colours" description="Your brand colours for buttons, links and highlights. Leave one empty to use your agency's.">
          <div className="grid gap-4 sm:grid-cols-3">
            <ColourField id="br-primary" label="Primary" hint="Buttons, links and the selected menu item." value={colours.primaryColor} fallback={agency.primaryColor} onChange={set("primaryColor")} disabled={!canEdit} />
            <ColourField id="br-accent" label="Accent" hint="Badges and highlights." value={colours.accentColor} fallback={agency.accentColor} onChange={set("accentColor")} disabled={!canEdit} />
            <ColourField id="br-bg" label="Background" hint="Behind the dashboard when there's no image." value={colours.bgColor} fallback={agency.bgColor} onChange={set("bgColor")} disabled={!canEdit} />
          </div>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Save colours
              </Button>
              <Button size="sm" variant="outline" onClick={() => setColours(initial)} disabled={!dirty || save.isPending}>
                Discard
              </Button>
              {initial.primaryColor || initial.accentColor || initial.bgColor ? (
                <Button size="sm" variant="ghost" className="text-ink-muted" onClick={() => setColours({ primaryColor: "", accentColor: "", bgColor: "" })} disabled={save.isPending}>
                  Use my agency's colours
                </Button>
              ) : null}
            </div>
          ) : null}
        </FormSection>
      </div>
      <Panel title="Preview" description={dirty ? "Unsaved: this is how it will look." : "How your workspace looks."} className="h-fit lg:sticky lg:top-[72px]">
        <Preview look={previewLook} name={ws.business?.name ?? "Your business"} />
      </Panel>
    </div>
  );
}
