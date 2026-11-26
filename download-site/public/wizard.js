// Small helpers for the setup wizard. Every form works without this file; it adds
// copy buttons, confirm prompts, no double-submits, and live progress.
"use strict";
(function () {
  const root = document.querySelector(".wiz");
  if (!root) return;

  // Copy buttons
  document.addEventListener("click", function (e) {
    const b = e.target.closest("button.copy");
    if (!b) return;
    const v = b.getAttribute("data-copy") || "";
    const done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () {});
    else { const t = document.createElement("textarea"); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (_) {} t.remove(); }
  });

  // Confirm prompts and no double-submits
  document.addEventListener("submit", function (e) {
    const f = e.target;
    const b = e.submitter || f.querySelector("button[type=submit]") || document.querySelector('button[form="' + f.id + '"]');
    const msg = b && b.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) { e.preventDefault(); return; }
    if (f.dataset.sent) { e.preventDefault(); return; }
    f.dataset.sent = "1";
    if (b) { b.classList.add("busy"); b.innerHTML = '<span class="spin"></span> ' + (/check/i.test(b.textContent) ? "Checking..." : "Working..."); }
  });

  // Domain step: show the dashboard address as it's typed
  const dom = document.getElementById("domain"), pv = document.getElementById("pv");
  if (dom && pv) dom.addEventListener("input", function () {
    const d = dom.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    pv.textContent = "app." + (d || "your-domain");
  });

  // Live progress: reload when something meaningful changes; stream the install log.
  if (root.dataset.live !== "1") return;
  const url = root.dataset.status;
  const rev = root.dataset.rev;
  const log = document.getElementById("log");
  let next = log ? Number(log.dataset.next || 0) : 0;
  let failures = 0;
  if (log) log.scrollTop = log.scrollHeight;
  async function poll() {
    try {
      const r = await fetch(url + "?from=" + next, { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      failures = 0;
      if (j.rev !== rev) {
        if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.value) { setTimeout(poll, 3000); return; }
        location.reload();
        return;
      }
      if (log && j.log) {
        const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
        log.textContent += j.log;
        if (log.textContent.length > 80000) log.textContent = log.textContent.slice(-60000);
        if (stick) log.scrollTop = log.scrollHeight;
      }
      next = j.next;
    } catch (_) {
      failures++;
    }
    setTimeout(poll, Math.min(15000, 2500 * (1 + failures)));
  }
  setTimeout(poll, 2500);
})();
