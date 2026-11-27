import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/base";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/primitives";
import type { CustomerPlan } from "./CustomerBilling";
export function ClientPayment({businessId}: {businessId:string}) {
 const q=useQuery({queryKey:["customer-payment",businessId],queryFn:()=>api.get<{billing:CustomerPlan|null}>("/api/manage/"+encodeURIComponent(businessId)+"/customer-billing")});
 const b=q.data?.billing;
 if (!b) return null;
 return <Panel title="Your subscription"><p className="text-sm">{b.currency} {(b.monthlyCents/100).toFixed(2)} per month</p><p className="mt-2 text-sm text-ink-muted">{b.status==="active"?"Your agency has marked your subscription active.":b.status==="past_due"?"Please contact your agency about your payment.":b.status==="cancelled"?"Your agency has marked this subscription cancelled.":"Complete your subscription through Stripe. The amount and billing terms shown at checkout are authoritative."}</p>{b.status==="not_started"?<Button asChild className="mt-3"><a href={b.checkoutUrl} target="_blank" rel="noopener noreferrer">Subscribe with Stripe</a></Button>:null}</Panel>
}