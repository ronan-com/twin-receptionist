import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, Clock, PhoneIncoming } from "lucide-react";
import { BrandMark, BrandWave } from "@/components/app/BrandMark";
import type { Hue } from "@/components/app/hues";
import { OTHER_BRAND, PRODUCT } from "@/lib/app/product";

const AUTH_FACTS: { label: string; value: string; hue: Hue; icon: typeof PhoneIncoming }[] = [
  { label: "Answers", value: "Every call", hue: "indigo", icon: PhoneIncoming },
  { label: "Books into", value: "Your calendar", hue: "cyan", icon: CalendarCheck },
  { label: "Availability", value: "24 / 7", hue: "magenta", icon: Clock },
];

// Answered's sign-in layout: brand panel on the left (wide screens), form on the right.
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-ink lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-hairline bg-canvas-2 lg:flex lg:flex-col lg:justify-between lg:p-10">
        {/* Answered's ribbon: a colour sweep across the top, fading into the canvas. */}
        <div className="auth-ribbon" aria-hidden>
          <div className="auth-ribbon__band auth-ribbon__band--a" />
          <div className="auth-ribbon__band auth-ribbon__band--b" />
          <div className="auth-ribbon__fibers" />
          <div className="auth-ribbon__fade" />
        </div>
        <div className="relative">
          <span className="inline-flex rounded-[10px] bg-white/90 px-3 py-2 shadow-[0_6px_24px_-12px_rgba(6,27,49,0.45)] backdrop-blur">
            <BrandMark to="/" size="lg" />
          </span>
        </div>
        <div className="relative max-w-md">
          <BrandWave className="mb-6 h-4" animate />
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">Every call answered. Every booking made.</h2>
          <p className="mt-4 text-[15px] leading-6 text-ink-muted">
            Your workspace shows what your receptionist handled today — calls, bookings, follow-ups and the questions it couldn't answer yet.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-3 text-[12.5px] text-ink-muted">
            {AUTH_FACTS.map((f) => (
              <div key={f.label} data-hue={f.hue} className="rounded-[10px] border border-[var(--hue-line)] bg-white/80 p-3 shadow-[0_4px_18px_-12px_rgba(6,27,49,0.35)]">
                <dt>
                  <span className="hue-icon mb-2 flex h-7 w-7 items-center justify-center rounded-[7px]" aria-hidden>
                    <f.icon className="h-[15px] w-[15px]" />
                  </span>
                  {f.label}
                </dt>
                <dd className="mt-0.5 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="relative text-[12px] text-ink-muted">© {new Date().getFullYear()} {PRODUCT}. Built for businesses that never want to miss a call.</p>
      </aside>

      <main className="relative flex min-h-screen min-w-0 flex-col px-4 py-8 sm:px-10 lg:min-h-0 lg:justify-center lg:px-16">
        {/* On phones the side panel is hidden: keep a ribbon across the top. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[5px] bg-[linear-gradient(90deg,#635bff,#a78bfa_22%,#ff5caa_46%,#ff7a59_68%,#ffb03d_84%,#00d4ff)] lg:hidden" aria-hidden />
        <div className="mb-10 lg:hidden">
          <BrandMark to="/" />
        </div>
        <div className="mx-auto w-full max-w-[380px]">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-[13.5px] text-ink-muted">{subtitle}</p> : null}
          {children}
          {footer ? <div className="mt-6 text-[13px] text-ink-muted">{footer}</div> : null}
          <p className="mt-10 text-[12px] leading-5 text-ink-muted">
            By continuing you agree to {PRODUCT}'s terms and acknowledge the privacy policy.{" "}
            {OTHER_BRAND ? null : (
              <Link to="/" className="text-indigo hover:underline">
                Back to answeredai.co
              </Link>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
      {children}
    </div>
  );
}
