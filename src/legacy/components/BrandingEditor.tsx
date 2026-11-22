import { useEffect, useRef, useState } from "react";
import type { Brand } from "../lib/shared";

// Logo and background, for an agency's own screens or (with clientId) one business's
// customer dashboard. A business's own settings override its agency's.

const base = (clientId?: string) => (clientId ? `/api/clients/${encodeURIComponent(clientId)}/brand` : "/api/org/brand");

async function call<T>(method: string, url: string, body?: BodyInit, type?: string): Promise<T> {
  const res = await fetch(url, { method, headers: type ? { "Content-Type": type } : undefined, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export default function BrandingEditor({ clientId, businessName }: { clientId?: string; businessName?: string }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [color, setColor] = useState("#0b0b0b");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    call<Brand>("GET", base(clientId))
      .then((b) => {
        setBrand(b);
        if (b.bgColor) setColor(b.bgColor);
      })
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  async function run(key: string, action: () => Promise<Brand>, message: string) {
    setBusy(key);
    setError("");
    setNote("");
    try {
      setBrand(await action());
      setNote(message);
      // The header and background are drawn from the account, so reload to show the change.
      window.setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const upload = (kind: "logo" | "background", file?: File) => {
    if (!file) return;
    run(kind, () => call<Brand>("POST", `${base(clientId)}/${kind}`, file, file.type || "application/octet-stream"), kind === "logo" ? "Logo saved." : "Background saved.");
  };
  const change = (key: string, body: object, message: string) =>
    run(key, () => call<Brand>("PUT", base(clientId), JSON.stringify(body), "application/json"), message);

  return (
    <section className="card stack">
      <h2>Branding</h2>
      <p className="muted">
        {clientId
          ? `Your logo and background for ${businessName ?? "this business"}'s customer dashboard. Anything you leave blank uses your agency's branding.`
          : "Your logo and background for your dashboard and for your clients' dashboards. Only the logo and background change."}
      </p>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {note && (
        <div className="notice notice-ok" role="status">
          {note}
        </div>
      )}

      <div className="brand-row">
        <div className="brand-preview">{brand?.logo ? <img src={brand.logo} alt="Your logo" /> : <span className="muted">No logo</span>}</div>
        <div className="brand-actions">
          <strong>Logo</strong>
          <span className="hint">PNG, JPEG or WebP, up to 400 KB. A wide logo on a transparent background works best.</span>
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload("logo", e.target.files?.[0])} />
          <span className="row-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={() => logoInput.current?.click()}>
              {busy === "logo" ? "Uploading…" : brand?.logo ? "Replace logo" : "Upload logo"}
            </button>
            {brand?.logo && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== ""} onClick={() => change("rmlogo", { removeLogo: true }, "Logo removed.")}>
                Remove
              </button>
            )}
          </span>
        </div>
      </div>

      <div className="brand-row">
        <div className="brand-preview" style={{ background: brand?.bgImage ? `center/cover url(${brand.bgImage})` : brand?.bgColor || undefined }}>
          {!brand?.bgImage && !brand?.bgColor && <span className="muted">Default</span>}
        </div>
        <div className="brand-actions">
          <strong>Background</strong>
          <span className="hint">The page behind the cards. Pick a colour, or upload an image (PNG, JPEG or WebP, up to 1.5 MB).</span>
          <span className="row-actions">
            <input type="color" aria-label="Background colour" value={color} onChange={(e) => setColor(e.target.value)} className="brand-color" />
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={() => change("color", { bgColor: color }, "Background colour saved.")}>
              Use colour
            </button>
            <input ref={bgInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload("background", e.target.files?.[0])} />
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={() => bgInput.current?.click()}>
              {busy === "background" ? "Uploading…" : "Upload image"}
            </button>
            {(brand?.bgColor || brand?.bgImage) && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== ""} onClick={() => change("rmbg", { bgColor: "", removeBackground: true }, "Background reset.")}>
                Reset
              </button>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
