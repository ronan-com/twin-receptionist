import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel, Notice, ErrorState } from "@/components/app/primitives";
import { companyApi } from "@/lib/api/console";
import { useConsole } from "./-shared";
import { CustomerBilling } from "@/components/app/CustomerBilling";
import { useState } from "react";
export const Route=createFileRoute("/_authenticated/admin/billing")({component:BillingPage});
function BillingPage(){
 const {ws,role,platform}=useConsole();
 const allowed=!ws.viewing && role==="owner" && !platform;
 const q=useQuery({queryKey:["console","companies"],queryFn:companyApi.list,enabled:allowed});
 const [id,setId]=useState("");
 const companies=(q.data??[]).filter(c=>!c.is_demo);
 const selected=companies.find(c=>c.id===id);
 return <div className="space-y-5"><PageHeader title="Customer billing" description="Manage monthly payment links for your clients."/>
 {!allowed?<Notice tone="info">Only the agency owner can manage customer billing.</Notice>:q.error?<ErrorState message={q.error.message} onRetry={()=>void q.refetch()}/>:<><Panel title="Choose a client"><select aria-label="Client" className="h-10 w-full rounded-md border border-hairline px-3" value={selected?.id??""} onChange={e=>setId(e.target.value)}><option value="">Select a client</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>{!q.isPending&&!companies.length?<p className="mt-3 text-sm text-ink-muted">Add a client to start billing.</p>:null}</Panel>{selected?<CustomerBilling key={selected.id} companyId={selected.id} editable/>:null}</>}
 </div>
}