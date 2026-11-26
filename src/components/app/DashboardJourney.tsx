import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  MessageSquare,
  PhoneIncoming,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/app/product";

const stages = [
  {
    label: "Call",
    icon: PhoneIncoming,
    title: "Call answered",
    detail:
      `${PRODUCT} identified Alex as a new patient and captured the reason for the call.`,
  },
  {
    label: "Booking",
    icon: CalendarCheck,
    title: "Appointment booked",
    detail:
      "A check-up and clean was added to the calendar for Thursday at 10:30 am.",
  },
  {
    label: "Confirmation",
    icon: MessageSquare,
    title: "Confirmation sent",
    detail:
      "Alex received the appointment details immediately after the call ended.",
  },
];

/** Operational preview shown only inside the public demo workspace. */
export function DashboardJourney() {
  const [step, setStep] = useState(1);
  const stage = stages[step];

  return (
    <section className="dashboard-journey" aria-labelledby="journey-heading">
      <div className="journey-intro">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo">
            Latest completed booking
          </p>
          <h2
            id="journey-heading"
            className="mt-1 text-[21px] font-semibold tracking-[-0.035em] text-ink sm:text-[24px]"
          >
            Alex Morgan · Check-up &amp; clean
          </h2>
        </div>
        <span className="shrink-0 rounded-full border border-[#cde8db] bg-[#edf8f3] px-2.5 py-1 text-[10px] font-semibold text-[#217e66]">
          Completed
        </span>
      </div>

      <div className="journey-content">
        <div className="min-w-0">
          <div
            className="journey-steps"
            role="group"
            aria-label="Booking activity details"
          >
            {stages.map(({ label, icon: Icon }, index) => (
              <button
                key={label}
                type="button"
                aria-pressed={step === index}
                aria-controls="journey-scene"
                onClick={() => setStep(index)}
                className={cn("journey-step", step === index && "is-current")}
              >
                <span className="journey-step-icon">
                  {step === index ? <Icon size={15} /> : <Check size={15} />}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div id="journey-scene" className="journey-scene">
            <div key={step} className="journey-enter">
              <h3 className="text-[15px] font-semibold text-ink">
                {stage.title}
              </h3>
              <p className="mt-1 max-w-md text-[12.5px] leading-5 text-ink-muted">
                {stage.detail}
              </p>

              {step === 0 ? (
                <div className="mt-3 space-y-2 text-[12.5px] leading-5">
                  <p className="journey-message">
                    <strong className="mr-2 text-ink">Alex</strong> Could I book
                    a check-up and clean?
                  </p>
                  <p className="journey-message is-answer">
                    <strong className="mr-2 text-indigo">{PRODUCT}</strong> Of
                    course. How does Thursday at <strong>10:30 am</strong>{" "}
                    sound?
                  </p>
                </div>
              ) : step === 1 ? (
                <dl className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="journey-message">
                    <dt className="text-[10.5px] text-ink-muted">
                      Appointment
                    </dt>
                    <dd className="mt-1 font-semibold text-ink">
                      Thu · 10:30 am
                    </dd>
                  </div>
                  <div className="journey-message">
                    <dt className="text-[10.5px] text-ink-muted">Calendar</dt>
                    <dd className="mt-1 font-semibold text-ink">Dr Patel</dd>
                  </div>
                </dl>
              ) : (
                <div className="journey-message is-answer mt-3 text-[12.5px] leading-5">
                  Hi Alex, your check-up and clean is confirmed for{" "}
                  <strong>Thursday at 10:30 am.</strong>
                  <span className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[#217e66]">
                    <Check size={13} /> SMS delivered
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="journey-receipt">
          <div className="flex items-center gap-3 border-b border-hairline pb-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#efedff] text-[12px] font-semibold text-indigo">
              AM
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink">Alex Morgan</p>
              <p className="text-[11px] text-ink-muted">New patient</p>
            </div>
            <CalendarCheck className="ml-auto h-5 w-5 shrink-0 text-indigo/60" />
          </div>
          <div className="py-4">
            <p className="text-[11px] font-medium text-ink-muted">Thursday</p>
            <p className="mt-0.5 text-[30px] font-semibold leading-tight tracking-[-0.045em] text-ink">
              10:30{" "}
              <span className="text-[17px] font-medium text-ink-muted">am</span>
            </p>
            <p className="mt-2 text-[12px] text-ink">Check-up &amp; clean</p>
          </div>
          <div className="journey-status is-confirmed">
            <Check size={14} /> Booking completed
          </div>
        </div>
      </div>

      <div className="journey-footer">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <Link to="/app/calls" className="journey-link">
            Open call <ArrowRight size={13} />
          </Link>
          <Link to="/app/bookings" className="journey-link">
            Open booking <ArrowRight size={13} />
          </Link>
          <Link to="/app/leads" className="journey-link">
            View follow-ups <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}
