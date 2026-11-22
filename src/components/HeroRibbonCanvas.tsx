import { useEffect, useRef } from "react";

/**
 * Stripe-style hero ribbon.
 *
 * Geometry measured from the live stripe.com mobile hero (390px viewport):
 *  - the white/colour boundary crosses the top edge at x ≈ 0.21W and runs
 *    down-right with dx/dy ≈ 0.72, exiting the right edge at y ≈ 425.
 *  - a second, steeper orange sweep enters the top edge at x ≈ 0.53W with
 *    dx/dy ≈ 0.90 and leaves the right edge much higher up.
 *  - both fields are filled with dense, near-parallel woven strands.
 */

type P = { x: number; y: number };

const COOL: Array<[number, string]> = [
  [0.0, "#bcc6ff"],
  [0.12, "#b8bcfe"],
  [0.3, "#bcb0fd"],
  [0.48, "#cba4f7"],
  [0.68, "#eb96ef"],
  [1.0, "#ff8bee"],
];

const WARM: Array<[number, string]> = [
  [0.0, "rgba(255,150,40,0)"],
  [0.1, "rgba(255,150,40,0.55)"],
  [0.22, "rgba(255,148,32,1)"],
  [0.6, "rgba(255,137,28,1)"],
  [1.0, "rgba(255,150,44,1)"],
];

export default function HeroRibbonCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let W = 0;
    let H = 0;
    let start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const grad = (
      from: P,
      to: P,
      stops: Array<[number, string]>,
    ): CanvasGradient => {
      const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    };

    /** Fill the half-plane to the right of the line through `origin` with
     *  slope dx/dy = `slope`, using a gradient across the perpendicular. */
    const sweep = (
      origin: P,
      slope: number,
      span: number,
      stops: Array<[number, string]>,
      bow: number,
    ) => {
      const len = Math.hypot(slope, 1);
      const d = { x: slope / len, y: 1 / len }; // along the sweep
      const n = { x: 1 / len, y: -slope / len }; // into the colour field

      const far = (W + H) * 2;
      ctx.beginPath();
      // boundary edge, slightly bowed so it reads as a crescent not a slab
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const s = -H * 0.4 + t * far;
        const b = bow * Math.sin(Math.PI * t);
        const px = origin.x + d.x * s + n.x * b;
        const py = origin.y + d.y * s + n.y * b;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      const tail = {
        x: origin.x + d.x * (far - H * 0.4),
        y: origin.y + d.y * (far - H * 0.4),
      };
      ctx.lineTo(tail.x + n.x * far, tail.y + n.y * far);
      ctx.lineTo(origin.x - d.x * H * 0.4 + n.x * far, origin.y - d.y * H * 0.4 + n.y * far);
      ctx.closePath();
      ctx.fillStyle = grad(origin, { x: origin.x + n.x * span, y: origin.y + n.y * span }, stops);
      ctx.fill();
      return { d, n };
    };

    /** Dense parallel woven strands over whatever is already painted.
     *  Only the strands move: slow phase drift + faint travelling shimmer. */
    const strands = (slope: number, t: number) => {
      const len = Math.hypot(slope, 1);
      const d = { x: slope / len, y: 1 / len };
      const n = { x: 1 / len, y: -slope / len };
      const reach = (W + H) * 1.4;
      const gap = 3.1;
      const count = Math.round(reach / gap);

      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.lineWidth = 1.6;
      for (let i = 0; i < count; i++) {
        const off = i * gap - H * 0.6;
        const seed = (i * 12.9898) % 1;
        // visible but unhurried drift — cloth breathing in slow air
        const wob =
          Math.sin(t * 0.00045 + i * 0.11) * 3.2 +
          Math.sin(t * 0.00019 + i * 0.037) * 5.0 +
          Math.sin(t * 0.00031 + i * 0.006) * 2.4;
        const o = off + wob;
        const ax = n.x * o - d.x * H;
        const ay = n.y * o - d.y * H;
        const bx = n.x * o + d.x * reach;
        const by = n.y * o + d.y * reach;
        const light = seed > 0.5;
        const base = 0.035 + (((i * 7919) % 100) / 100) * 0.055;
        // shimmer band travelling across the weave
        const shimmer = 1 + 0.75 * Math.sin(t * 0.0006 - i * 0.05);
        const a = base * shimmer;

        ctx.strokeStyle = light
          ? `rgba(255,255,255,${a})`
          : `rgba(70,30,90,${a * 0.55})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.restore();
    };

    const draw = (now: number) => {
      const t = reduced ? 0 : now - start;
      ctx.clearRect(0, 0, W, H);

      // On wide screens keep the sweep anchored to the top-right corner at a
      // mobile-like scale rather than stretching it across the page.
      const virtual = W <= 640 ? W : Math.max(520, W * 0.55);
      const ox = W - virtual;

      // Silhouette breathes: the whole ribbon slowly drifts, tilts and bows.
      const drift =
        Math.sin(t * 0.00016) * virtual * 0.035 +
        Math.sin(t * 0.00009 + 2.1) * virtual * 0.022;
      const tilt =
        Math.sin(t * 0.00012 + 0.7) * 0.055 + Math.sin(t * 0.00021) * 0.03;
      const bowFlex = 1 + 0.55 * Math.sin(t * 0.00018 + 1.2);

      const origin = { x: ox + virtual * 0.213 + drift, y: 0 };
      const { d } = sweep(
        origin,
        0.72 + tilt,
        virtual * 0.62,
        COOL,
        virtual * 0.018 * bowFlex,
      );

      // breathing of the colour depth only (no geometry change)
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0004);
      const pulse2 = 0.5 + 0.5 * Math.sin(t * 0.00027 + 1.7);


      // the field also warms toward pink further along the sweep
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      const run = H * (1.15 + 0.05 * pulse);
      const pink = ctx.createLinearGradient(
        origin.x,
        origin.y,
        origin.x + d.x * run,
        origin.y + d.y * run,
      );
      pink.addColorStop(0, "rgba(255,139,238,0)");
      pink.addColorStop(0.28, `rgba(255,139,238,${0.36 + 0.06 * pulse2})`);
      pink.addColorStop(0.55, `rgba(255,139,238,${0.78 + 0.06 * pulse})`);
      pink.addColorStop(0.8, "rgba(255,136,236,1)");
      pink.addColorStop(1, "rgba(255,136,236,1)");

      ctx.fillStyle = pink;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // orange sweep, drifting with the main ribbon
      sweep(
        { x: ox + virtual * 0.53 + drift * 0.7, y: 0 },
        0.9 + tilt * 0.8,
        virtual * (0.255 + 0.012 * pulse2),
        WARM,
        virtual * 0.012 * bowFlex,
      );

      strands(0.78 + tilt, t);

      raf = !reduced && visible && !document.hidden ? requestAnimationFrame(draw) : 0;
    };

    // Only animate while the hero is on screen and the tab is visible; with
    // reduced motion, draw a single still frame (redrawn on resize).
    let visible = true;
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const onResize = () => {
      resize();
      if (reduced) kick();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !reduced) kick();
    });
    const onVisibility = () => {
      if (!document.hidden && visible && !reduced) kick();
    };

    resize();
    start = performance.now();
    raf = requestAnimationFrame(draw);
    io.observe(canvas);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="h-full w-full"
      style={{ display: "block" }}
    />
  );
}
