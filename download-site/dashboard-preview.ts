// Credential-free dashboard preview: no app accounts, provider calls, or install state changes.
import { esc } from "./pages";

const sections = [
  ["overview", "Overview"], ["clients", "Clients"], ["calls", "Calls"],
  ["receptionists", "AI Receptionists"], ["voices", "Voices"],
  ["numbers", "Phone Numbers"], ["connections", "Connections"], ["usage", "Usage"],
  ["qa", "System / QA"], ["audit", "Audit Log"], ["support", "Support requests"],
  ["tutorials", "Tutorials"], ["settings", "Settings"],
] as const;

export function dashboardPreview(base: string, section: string | null = null): string {
  const selected = sections.find(([key]) => key === section) ?? sections[0];
  const resume = esc(base);
  const link = (key: string) => resume + "?preview=dashboard&amp;section=" + key;
  const cards = [["Clients", "0", "0 active"], ["Receptionists", "0", "0 numbers attached"], ["Calls", "0", "No calls yet"], ["AI resolution", "0%", "No calls yet"], ["Failed calls", "0", "No calls yet"], ["Bookings", "0", "No bookings yet"], ["Follow-ups", "0", "No follow-ups yet"], ["Avg length", "0s", "No calls yet"]];
  const overview = selected[0] === "overview";
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Your agency | Dashboard preview</title>
<link rel="stylesheet" href="/wizard.css"></head>
<body data-neutral-onboarding class="preview-dashboard">
<div class="preview-layout">
<aside class="preview-sidebar"><a class="preview-mark" href="${link("overview")}">Your agency</a>
<p class="preview-caption">Agency workspace</p><nav aria-label="Preview navigation">${sections.map(([key, label]) => `<a href="${link(key)}"${key === selected[0] ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav></aside>
<main class="preview-main"><header class="preview-header"><span>Agency console / ${selected[1]}</span><a class="btn p" href="${resume}">Continue onboarding</a></header>
<div class="preview-content"><div class="preview-notice"><b>Preview mode</b><span>Your dashboard is ready to explore. Connect your accounts when you are ready to start using it.</span></div>
<h1>${overview ? "Your agency overview" : selected[1]}</h1><p class="lead">${overview ? "Your clients, receptionists and calls." : "This area will be available when your agency is connected."}</p>
${overview ? `<section class="preview-panel preview-empty"><h2>Create your first receptionist</h2><p>Add a business and set up its AI receptionist after finishing onboarding.</p><a class="btn p" href="${resume}">Continue onboarding</a></section><div class="preview-stats">${cards.map(([label,value,sub])=>`<section class="preview-panel"><p>${label}</p><strong>${value}</strong><small>${sub}</small></section>`).join("")}</div><section class="preview-panel"><h2>Needs attention</h2><p>No incidents or failed calls.</p></section>` : `<section class="preview-panel preview-empty"><h2>${selected[1]}</h2><p>No live data yet. Finish onboarding to use this part of your dashboard.</p><a class="btn p" href="${resume}">Continue onboarding</a></section>`}
</div></main></div></body></html>`;
}
