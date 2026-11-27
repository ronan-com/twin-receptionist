import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, Notice, ErrorState } from "@/components/app/primitives";
import { api } from "@/lib/api/base";
export type CustomerPlan = { monthlyCents: number; currency: string; checkoutUrl: string; status: "not_started" | "active" | "past_due" | "cancelled" };
export const billingStatus = { not_started: "Awaiting subscription", active: "Active", past_due: "Past due", cancelled: "Cancelled" };
const empty: CustomerPlan = {monthlyCents: 0, currency: "AUD", checkoutUrl: "", status: "not_started"};
export function CustomerBilling({companyId, editable}: {companyId:string;editable:boolean}) {
 const qc=useQueryClient();
 const url="/api/console/companies/"+encodeURIComponent(companyId)+"/billing";
 const key=["console","customer-billing",companyId];
 const q=useQuery({queryKey:key,queryFn:()=>api.get<{billing:CustomerPlan|null}>(url)});
 const [draft,setDraft]=useState<CustomerPlan>(empty);
 const [price,setPrice]=useState("");
 useEffect(()=>{const b=q.data?.billing??empty;setDraft(b);setPrice(b.monthlyCents?String(b.monthlyCents/100):"")},[q.data]);
 const save=useMutation({mutationFn:()=>api.put<{billing:CustomerPlan}>(url,{...draft,monthlyCents:Math.round(Number(price)*100)}),onSuccess:(data)=>{qc.setQueryData(key,data);toast.success("Billing details saved")},onError:(e:Error)=>toast.error(e.message)});
 const clear=useMutation({mutationFn:()=>api.del<{billing:null}>(url),onSuccess:(data)=>{qc.setQueryData(key,data);toast.success("Payment link removed")},onError:(e:Error)=>toast.error(e.message)});
 return <Panel title="Customer billing" description="Monthly subscriptions paid directly into your agency's Stripe account.">
  {q.error?<ErrorState message={q.error.message} onRetry={()=>void q.refetch()}/>:q.isPending?<p>Loading billing…</p>:<>
   <Notice tone="neutral">Create a recurring monthly price and Payment Link in <a className="underline" href="https://dashboard.stripe.com/payment-links" target="_blank" rel="noopener noreferrer">your Stripe dashboard</a>. Enter the same price here. Stripe handles checkout, renewals and invoices; update the recorded status here after checking Stripe.</Notice>
   <form className="mt-4 grid gap-3" onSubmit={e=>{e.preventDefault();save.mutate()}}>
    <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm">Monthly price<Input type="number" min="0.01" max="1000000" step="0.01" required value={price} disabled={!editable} onChange={e=>setPrice(e.target.value)}/></label>
    <label className="grid gap-1 text-sm">Currency<select className="h-9 rounded-md border border-hairline px-2" value={draft.currency} disabled={!editable} onChange={e=>setDraft(s=>({...s,currency:e.target.value}))}>{["AUD","USD","NZD","GBP","EUR","CAD"].map(c=><option key={c}>{c}</option>)}</select></label></div>
    <label className="grid gap-1 text-sm">Stripe subscription payment link<Input type="url" placeholder="https://buy.stripe.com/..." required value={draft.checkoutUrl} disabled={!editable} onChange={e=>setDraft(s=>({...s,checkoutUrl:e.target.value}))}/></label>
    <label className="grid gap-1 text-sm">Payment status (manual)<select className="h-9 rounded-md border border-hairline px-2" value={draft.status} disabled={!editable} onChange={e=>setDraft(s=>({...s,status:e.target.value as CustomerPlan["status"]}))}>{Object.entries(billingStatus).map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label>
    {editable?<div className="flex flex-wrap gap-2"><Button type="submit" disabled={save.isPending}>Save billing</Button>{q.data?.billing?<Button type="button" variant="outline" disabled={clear.isPending} onClick={()=>clear.mutate()}>Remove payment link</Button>:null}</div>:null}
   </form>
   {q.data?.billing?<p className="mt-3 text-sm text-ink-muted">Saved plan: {q.data.billing.currency} {(q.data.billing.monthlyCents/100).toFixed(2)} / month. {billingStatus[q.data.billing.status]}. Removing a link here does not cancel a subscription in Stripe.</p>:null}
  </>}
 </Panel>
}
