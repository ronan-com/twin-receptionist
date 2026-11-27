(() => {
 const key="agency-preview:"+location.pathname;
 let state={};
 try{state=JSON.parse(sessionStorage.getItem(key)||"{}")||{}}catch{}
 const update=(sel,val)=>document.querySelectorAll(sel).forEach(el=>el.textContent=val);
 function render(){
 update("[data-demo-name]",state.name||"Example Plumbing");
 update("[data-demo-agency]",state.agency||"Your agency");
 update("[data-demo-greeting]",state.greeting||"Friendly AI receptionist");
 update("[data-demo-booking]",state.booking||"No sample appointments yet.");
 update("[data-demo-hours]",state.hours||"24/7");
 update("[data-demo-number]",state.number||"No number attached.");
 update("[data-demo-connection]",state.connection?state.connection+" — simulated connection":"No connected accounts.");
 update("[data-demo-message]",state.message||"No sample enquiries yet.");
 update("[data-demo-price]",state.price?"AUD "+state.price+" / month (sample)":"No sample plan yet.");
 document.querySelectorAll("[data-demo-stat]").forEach(el=>{const k=el.getAttribute("data-demo-stat");el.textContent=String(k==="Clients"||k==="Receptionists"?Number(!!state.name):k==="Bookings"||k==="Bookings made"?Number(!!state.booking):k==="Messages for you"?Number(!!state.message):0)});
 if(/^#[0-9a-f]{6}$/i.test(state.colour||""))document.documentElement.style.setProperty("--preview-accent",state.colour);
 }
 document.querySelectorAll("[data-demo-form]").forEach(form=>{form.addEventListener("submit",e=>{e.preventDefault();for(const [k,v] of new FormData(form)){if(["name","greeting","hours","booking","message","agency","colour","price","number","connection"].includes(k))state[k]=String(v).slice(0,160)}try{sessionStorage.setItem(key,JSON.stringify(state))}catch{}render();update(".data-demo-status","Saved in this preview. No live data was changed.");});});
 render();
})();
