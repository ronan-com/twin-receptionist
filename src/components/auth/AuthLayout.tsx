import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BrandMark, BrandWave } from "@/components/app/BrandMark";

// Answered's sign-in layout: brand panel on the left (wide screens), form on the right.
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-ink lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-hairline bg-canvas-2 lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full opacity-60 blur-3xl"
          style={{ background: "conic-gradient(from 200deg, #ffb37a, #ff8fb1, #c084fc, #8b9bff, #00d4ff, #ffb37a)" }}
          aria-hidden
        />
        <div className="relative">
          <BrandMark to="/" size="lg" />
        </div>
        <div className="relative max-w-md">
          <BrandWave className="mb-6 h-4" animate />
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">Every call answered. Every booking made.</h2>
          <p className="mt-4 text-[15px] leading-6 text-ink-muted">
            Your workspace shows what your receptionist handled today — calls, bookings, follow-ups and the questions it couldn't answer yet.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-hairline pt-6 text-[12.5px] text-ink-muted">
            <div>
              <dt>Answers</dt>
              <dd className="mt-1 text-[20px] font-semibold tabular-nums text-ink">Every call</dd>
            </div>
            <div>
              <dt>Books into</dt>
              <dd className="mt-1 text-[20px] font-semibold tabular-nums text-ink">Your calendar</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd className="mt-1 text-[20px] font-semibold tabular-nums text-ink">24 / 7</dd>
            </div>
          </dl>
        </div>
        <p className="relative text-[12px] text-ink-muted">© {new Date().getFullYear()} Answered. Built for businesses that never want to miss a call.</p>
      </aside>

      <main className="flex min-h-screen min-w-0 flex-col px-4 py-8 sm:px-10 lg:min-h-0 lg:justify-center lg:px-16">
        <div className="mb-10 lg:hidden">
          <BrandMark to="/" />
        </div>
        <div className="mx-auto w-full max-w-[380px]">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-[13.5px] text-ink-muted">{subtitle}</p> : null}
          {children}
          {footer ? <div className="mt-6 text-[13px] text-ink-muted">{footer}</div> : null}
          <p className="mt-10 text-[12px] leading-5 text-ink-muted">
            By continuing you agree to Answered's terms and acknowledge the privacy policy.{" "}
            <Link to="/" className="text-indigo hover:underline">
              Back to answeredai.co
            </Link>
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
