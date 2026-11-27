// An interactive, isolated preview. Every change is sample data in the browser session.
import { esc } from "./pages";
const agency = [["overview","Overview"],["clients","Clients"],["receptionists","Receptionists"],["numbers","Numbers"],["connections","Connections"],["brand","Brand"],["billing","Billing"],["help","Help"]] as const;
const customer = [["home","Home"],["inbox","Inbox"],["calendar","Calendar"],["contacts","Contacts"],["settings","Settings"]] as const;
// Match the onboarding colour vocabulary without introducing a buyer's logo.
const icons: Record<string, string> = {
 overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z"/>',
 clients: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h6M3 21h18"/>',
 receptionists: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M12 3v4m-5 6h.01m10 0h.01M9 17h6"/>',
 numbers: '<path d="M22 16.5v3a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3.1 19 19 0 0 1-5.9-6 19.5 19.5 0 0 1-3.1-8.4A2 2 0 0 1 4.3 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1l-1.3 1.3a15 15 0 0 0 5.9 6l1.3-1.3a2 2 0 0 1 2.1-.5l2.8.7a2 2 0 0 1 1.7 1.7Z"/>',
 connections: '<path d="M7 3v5m10-5v5M5 8h14v2a7 7 0 0 1-7 7v4m0-4a7 7 0 0 1-7-7V8Z"/>',
 brand: '<circle cx="12" cy="12" r="9"/><path d="M7 12h.01M10 7h.01M15 7h.01m2 5h.01M9 17h.01"/>',
 billing: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-14 5h4"/>',
 help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/>',
 inbox: '<path d="M3 12 6 5h12l3 7v7H3z"/><path d="M3 12h5l2 3h4l2-3h5"/>',
 calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m4 3-3 3-2-2"/>',
 contacts: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
 settings: '<circle cx="12" cy="12" r="3"/><path d="m12 2 3 2 4 1 1 4 2 3-2 3-1 4-4 1-3 2-3-2-4-1-1-4-2-3 2-3 1-4 4-1z"/>',
};
const tones: Record<string,string> = { overview:"violet",home:"violet",clients:"blue",receptionists:"violet",numbers:"teal",connections:"teal",brand:"pink",billing:"orange",help:"blue",inbox:"blue",calendar:"pink",contacts:"teal",settings:"violet" };
const icon=(key:string)=>`<span class="preview-icon" data-tone="${tones[key]||"violet"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]||icons.overview}</svg></span>`;
const metricIcon:Record<string,string>={"Clients":"clients","Receptionists":"receptionists","Calls":"numbers","Bookings":"calendar","Calls answered":"numbers","Bookings made":"calendar","Messages for you":"inbox"};

export function dashboardPreview(base:string, section:string|null=null, view:string|null=null):string {
 const isCustomer=view==="customer";
 const sections=isCustomer?customer:agency;
 const selected=sections.find(([k])=>k===section)??sections[0];
 const resume=esc(base);
 const href=(key:string,client=isCustomer)=>resume+"?preview=dashboard&amp;view="+(client?"customer":"agency")+"&amp;section="+key;
 const overview=selected[0]==="overview"||selected[0]==="home";
 const stats=isCustomer?["Calls answered","Bookings made","Messages for you"]:["Clients","Receptionists","Calls","Bookings"];
 const form=(body:string,action:string)=>`<form method="post" class="preview-form" data-demo-form="${action}">${body}<button class="btn p" type="submit">Save in preview</button></form>`;
 const sample=`<div class="preview-panel"><h2>Sample business</h2><p data-demo-name>Example Plumbing</p><p data-demo-greeting>Friendly AI receptionist</p><p data-demo-hours>24/7</p><a class="btn o" href="${href("home",true)}">See customer's dashboard</a></div>`;
 let body="";
 if(overview) body=`<div class="preview-stats">${stats.map(t=>`<section class="preview-panel preview-metric" data-tone="${tones[metricIcon[t]]}"><div class="preview-metric-label"><p>${t}</p>${icon(metricIcon[t])}</div><strong data-demo-stat="${t}">0</strong><small>Sample data</small></section>`).join("")}</div><section class="preview-panel preview-empty"><div class="preview-hero-icon">${icon(isCustomer?"numbers":"receptionists")}</div><h2>${isCustomer?"Your receptionist":"Create your first receptionist"}</h2><p>${isCustomer?"See the calls and appointments your AI handles.":"Try adding a sample client and viewing their dashboard."}</p><a class="btn p" href="${href(isCustomer?"settings":"clients")}">${isCustomer?"Receptionist settings":"Manage clients"}</a></section>`;
 else if(selected[0]==="clients") body=sample+`<section class="preview-panel"><h2>Add a sample client</h2>${form('<label class="f">Business name<input name="name" maxlength="80" required placeholder="Example Plumbing"></label>',"client")}<p>Practice only. No invitation or email is sent.</p></section>`;
 else if(selected[0]==="receptionists"||selected[0]==="settings") body=sample+`<section class="preview-panel"><h2>Receptionist settings</h2>${form('<label class="f">Greeting<input name="greeting" maxlength="160" placeholder="Hello, how can I help?" required></label><label class="f">Opening hours<select name="hours"><option>24/7</option><option>Weekdays, 9am-5pm</option></select></label>',"receptionist")}</section>`;
 else if(selected[0]==="calendar") body=`<section class="preview-panel"><h2>Appointments</h2><p data-demo-booking>No sample appointments yet.</p>${form('<label class="f">Appointment name<input name="booking" required maxlength="80" placeholder="Sample consultation"></label>',"booking")}</section>`;
 else if(selected[0]==="inbox"||selected[0]==="contacts") body=`<section class="preview-panel"><h2>${selected[1]}</h2><p>Try recording a sample enquiry.</p><p data-demo-message>No sample enquiries yet.</p>${form('<label class="f">Example enquiry<input name="message" required maxlength="120" placeholder="Request a callback"></label>',"message")}</section>`;
 else if(selected[0]==="brand") body=`<section class="preview-panel"><h2>Agency identity</h2>${form('<label class="f">Agency name<input required name="agency" maxlength="80" placeholder="Your agency"></label><label class="f">Accent colour<input type="color" name="colour" value="#7c3aed"></label>',"brand")}</section>`;
 else if(selected[0]==="billing") body=`<section class="preview-panel"><h2>Monthly subscription</h2><p data-demo-price>No sample plan yet.</p>${form('<label class="f">Monthly price (AUD)<input name="price" type="number" min="1" step="0.01" required placeholder="199"></label>',"billing")}<p>No payment is collected in preview.</p></section>`;
 else if(selected[0]==="numbers") body=`<section class="preview-panel"><h2>Sample phone number</h2><p data-demo-number>No number attached.</p>${form('<label class="f">Choose a sample number<select name="number"><option>+61 2 5550 0100</option><option>+61 7 5550 0100</option></select></label>',"number")}<p>No number is purchased.</p></section>`;
 else if(selected[0]==="connections") body=`<section class="preview-panel"><h2>Sample connections</h2><p data-demo-connection>No connected accounts.</p>${form('<label class="f">Try a connection<select name="connection"><option>Google Calendar</option><option>Telnyx</option><option>OpenRouter</option></select></label>',"connection")}<p>No real accounts are accessed.</p></section>`;
 else body=`<section class="preview-panel"><h2>${selected[1]}</h2><p>These features require connected accounts. You can explore the sample client or return to finish onboarding.</p><a class="btn o" href="${resume}">Continue onboarding</a></section>`;
 return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Dashboard preview</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/wizard.css"><script src="/dashboard-preview.js" defer></script></head><body data-neutral-onboarding class="preview-dashboard"><div class="preview-layout"><aside class="preview-sidebar"><a class="preview-mark" data-demo-agency href="${href(isCustomer?"home":"overview")}">Your agency</a><p class="preview-caption">${isCustomer?"Customer workspace":"Agency workspace"}</p><nav aria-label="Preview navigation">${sections.map(([key,label])=>`<a href="${href(key)}"${key===selected[0]?' aria-current="page"':""}>${icon(key)}<span>${label}</span></a>`).join("")}</nav></aside><main class="preview-main"><header class="preview-header"><span>${isCustomer?"Customer":"Agency"} dashboard / ${selected[1]}</span><a class="btn p" href="${resume}">Continue onboarding</a></header><div class="preview-content"><div class="preview-notice"><b>Preview mode</b><span>Sample data only. No real calls, messages or payments.</span><a class="btn o" href="${href(isCustomer?"overview":"home",!isCustomer)}">${isCustomer?"Switch to agency view":"Switch to customer view"}</a></div><h1>${overview?(isCustomer?"Your business dashboard":"Your agency overview"):selected[1]}</h1><p class="lead data-demo-status" role="status">${isCustomer?"Manage your own AI receptionist.":"Manage your clients and receptionists."}</p>${body}</div></main></div></body></html>`;
}
