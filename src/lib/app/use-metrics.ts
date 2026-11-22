import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedRange } from "./date-range";
import { appointmentsQuery, callsForRangeQuery, leadsQuery, smsCountQuery } from "./queries";
import { compareKpis, computeKpis, isInRange, type Kpis, type KpiDeltas } from "./metrics";
import type { Appointment, CallListRow, Lead } from "./types";

export interface RangeMetrics {
  loading: boolean;
  error: string | null;
  current: CallListRow[];
  previous: CallListRow[];
  kpis: Kpis;
  prevKpis: Kpis;
  deltas: KpiDeltas;
  appointments: Appointment[];
  leads: Lead[];
  refetch: () => void;
}

export function useRangeMetrics(businessId: string | null, range: ResolvedRange): RangeMetrics {
  const callsQ = useQuery(callsForRangeQuery(businessId, range));
  const apptQ = useQuery(appointmentsQuery(businessId));
  const leadsQ = useQuery(leadsQuery(businessId));
  const smsQ = useQuery(smsCountQuery(businessId, range));

  return useMemo(() => {
    const all = callsQ.data ?? [];
    const current = all.filter((c) => isInRange(c.started_at, range.from, range.to));
    const previous = all.filter((c) => isInRange(c.started_at, range.prevFrom, range.prevTo));
    const appts = apptQ.data ?? [];
    const leads = leadsQ.data ?? [];
    const apptCur = appts.filter((a) => isInRange(a.created_at, range.from, range.to) && a.status !== "cancelled").length;
    const apptPrev = appts.filter((a) => isInRange(a.created_at, range.prevFrom, range.prevTo) && a.status !== "cancelled").length;
    const leadCur = leads.filter((l) => isInRange(l.created_at, range.from, range.to)).length;
    const leadPrev = leads.filter((l) => isInRange(l.created_at, range.prevFrom, range.prevTo)).length;
    const kpis = computeKpis(current, { appointments: apptCur, leads: leadCur, smsSent: smsQ.data ?? 0 });
    const prevKpis = computeKpis(previous, { appointments: apptPrev, leads: leadPrev });
    return {
      loading: callsQ.isPending || apptQ.isPending || leadsQ.isPending,
      error: callsQ.error?.message ?? apptQ.error?.message ?? leadsQ.error?.message ?? null,
      current,
      previous,
      kpis,
      prevKpis,
      deltas: compareKpis(kpis, prevKpis),
      appointments: appts,
      leads,
      refetch: () => {
        void callsQ.refetch();
        void apptQ.refetch();
        void leadsQ.refetch();
      },
    };
  }, [callsQ, apptQ, leadsQ, smsQ.data, range]);
}
