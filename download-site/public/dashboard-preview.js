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
 const savedColour=/^#[0-9a-f]{6}$/i.test(state.colour||"")?state.colour:"#7c3aed";
 const channels=savedColour.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 const luminance=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
 document.body.style.setProperty("--preview-accent",savedColour);
 document.body.style.setProperty("--preview-foreground",luminance>.179?"#000":"#fff");
 const picker=document.querySelector('input[name="colour"]');if(picker)picker.value=savedColour;
 }
 document.querySelectorAll("[data-demo-form]").forEach(form=>{form.addEventListener("submit",e=>{e.preventDefault();for(const [k,v] of new FormData(form)){if(["name","greeting","hours","booking","message","agency","colour","price","number","connection"].includes(k))state[k]=String(v).slice(0,160)}try{sessionStorage.setItem(key,JSON.stringify(state))}catch{}render();update(".data-demo-status","Saved in this preview. No live data was changed.");});});
 render();
})();
