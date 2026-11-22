import { useEffect, useRef } from "react";
import { WORLD_LAND } from "./worldLand";

type P = { x: number; y: number; z: number; s: number; c: [number, number, number] };

/** Real country outlines (Natural Earth 110m, simplified), [lon, lat] pairs. */
const LAND: number[][][] = WORLD_LAND;


/** Stripe-style particle globe, themed as live calls landing around the world. */
export default function CallGlobe({ theme = "light" }: { theme?: "light" | "dark" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = false;
    let pageVisible = !document.hidden;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.35 : 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // deep navy -> indigo -> violet -> magenta -> warm accent
    const ramp: [number, number, number][] = [
      [10, 39, 92],
      [37, 68, 190],
      [124, 106, 255],
      [162, 106, 255],
      [255, 92, 174],
      [255, 140, 96],
    ];
    const pick = (t: number): [number, number, number] => {
      const f = Math.min(0.999, Math.max(0, t)) * (ramp.length - 1);
      const i = Math.floor(f);
      const k = f - i;
      const a = ramp[i];
      const b = ramp[Math.min(ramp.length - 1, i + 1)];
      return [
        Math.round(a[0] + (b[0] - a[0]) * k),
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k),
      ];
    };

    const COUNT = window.innerWidth < 640 ? 850 : 1500;
    const pts: P[] = [];
    for (let i = 0; i < COUNT; i++) {
      // fibonacci sphere
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * 2.399963;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const jitter = 0.985 + Math.random() * 0.03;
      pts.push({
        x: x * jitter,
        y: y * jitter,
        z: z * jitter,
        s: 0.7 + Math.random() * 1.3,
        c: pick((x + 1) / 2 + (Math.random() - 0.5) * 0.15),
      });
    }

    // continent outlines as unit-sphere vertices
    const toVec = (lon: number, lat: number) => {
      const la = (lat * Math.PI) / 180;
      const lo = (lon * Math.PI) / 180;
      return {
        x: Math.cos(la) * Math.sin(lo),
        y: Math.sin(la),
        z: Math.cos(la) * Math.cos(lo),
        s: 1,
        c: [0, 0, 0] as [number, number, number],
      };
    };
    const landPaths: P[][] = LAND.map((poly) => poly.map(([lon, lat]) => toVec(lon, lat)));

    // live "calls": arcs travelling between surface points
    type Arc = { a: P; b: P; t: number; speed: number; hue: [number, number, number] };
    const mkArc = (): Arc => {
      const a = pts[Math.floor(Math.random() * pts.length)];
      const b = pts[Math.floor(Math.random() * pts.length)];
      return {
        a,
        b,
        t: 0,
        speed: 0.0025 + Math.random() * 0.003,
        hue: pick(0.35 + Math.random() * 0.65),
      };
    };
    const arcs: Arc[] = Array.from({ length: 5 }, mkArc);

    let rot = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.44;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const tilt = -0.35;
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);

      const project = (p: P) => {
        const x1 = p.x * cos - p.z * sin;
        const z1 = p.x * sin + p.z * cos;
        const y1 = p.y * ct - z1 * st;
        const z2 = p.y * st + z1 * ct;
        return { x: cx + x1 * R, y: cy - y1 * R, z: z2 };
      };

      // faint navy sphere wash so the land reads as a globe
      const wash = ctx.createRadialGradient(
        cx - R * 0.3,
        cy - R * 0.35,
        R * 0.1,
        cx,
        cy,
        R,
      );
      wash.addColorStop(0, theme === "dark" ? "rgba(130,148,255,0.15)" : "rgba(24,58,138,0.10)");
      wash.addColorStop(1, theme === "dark" ? "rgba(5,15,35,0.04)" : "rgba(6,20,50,0.04)");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = wash;
      ctx.fill();

      // faint real country outlines (front hemisphere only)
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = theme === "dark" ? "rgba(190,202,255,0.42)" : "rgba(17,45,110,0.28)";
      ctx.fillStyle = theme === "dark" ? "rgba(126,143,255,0.07)" : "rgba(23,58,138,0.06)";
      for (const path of landPaths) {
        let started = false;
        ctx.beginPath();
        for (const v of path) {
          const q = project(v);
          if (q.z < 0) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(q.x, q.y);
            started = true;
          } else {
            ctx.lineTo(q.x, q.y);
          }
        }
        ctx.fill();
        ctx.stroke();
      }


      for (const p of pts) {
        const q = project(p);
        const depth = (q.z + 1) / 2;
        const alpha = (theme === "dark" ? 0.22 : 0.12) + depth * (theme === "dark" ? 0.78 : 0.75);
        const size = p.s * (0.55 + depth * 0.75);
        ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${alpha.toFixed(3)})`;
        ctx.fillRect(q.x, q.y, size, size);
      }

      for (let i = 0; i < arcs.length; i++) {
        const arc = arcs[i];
        if (!reduce) arc.t += arc.speed;
        if (arc.t > 1.25) {
          arcs[i] = mkArc();
          continue;
        }
        const a = project(arc.a);
        const b = project(arc.b);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.35;
        const prog = Math.min(1, arc.t);
        const fade = arc.t > 1 ? 1 - (arc.t - 1) / 0.25 : 1;
        const [r, g, bl] = arc.hue;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        // partial quadratic via sampling
        const steps = 40;
        for (let s = 1; s <= steps * prog; s++) {
          const t = s / steps;
          const it = 1 - t;
          ctx.lineTo(
            it * it * a.x + 2 * it * t * mx + t * t * b.x,
            it * it * a.y + 2 * it * t * my + t * t * b.y,
          );
        }
        ctx.strokeStyle = `rgba(${r},${g},${bl},${(0.55 * fade).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        for (const node of [a, prog >= 1 ? b : null]) {
          if (!node) continue;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 3.2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${r},${g},${bl},${(0.9 * fade).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(node.x, node.y, 7, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${r},${g},${bl},${(0.22 * fade).toFixed(3)})`;
          ctx.stroke();
        }
      }

      if (!reduce) rot += 0.0016;
      if (!reduce && visible && pageVisible) raf = requestAnimationFrame(draw);
    };

    const render = () => {
      cancelAnimationFrame(raf);
      draw();
    };
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce || visible) render();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) render();
      else cancelAnimationFrame(raf);
    }, { threshold: 0.05 });
    io.observe(canvas);
    const onVisibilityChange = () => {
      pageVisible = !document.hidden;
      if (pageVisible && visible) render();
      else cancelAnimationFrame(raf);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (reduce) render();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="block h-[390px] w-full sm:h-[500px] md:h-[650px]"
    />
  );
}
