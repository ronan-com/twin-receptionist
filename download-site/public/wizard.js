// Small helpers for the setup wizard. Every form works without this file; it adds
// copy buttons, confirm prompts, no double-submits, and live progress.
"use strict";
(function () {
  // ---- Runs on the guide page too ----
  // Copy buttons (the ones next to things you paste into a provider)
  Array.prototype.forEach.call(document.querySelectorAll(".cp .copy[hidden]"), function (b) { b.hidden = false; });
  document.addEventListener("click", function (e) {
    const b = e.target.closest("button.copy");
    if (!b) return;
    const v = b.getAttribute("data-copy") || "";
    const done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () {});
    else { const t = document.createElement("textarea"); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (_) {} t.remove(); }
  });

  // "Show me how" opens the guide in a side panel (a bottom sheet on a phone) instead of pushing the page down.
  let panel = null, scrim = null, opener = null;
  function closePanel() {
    if (!panel) return;
    panel.remove(); scrim.remove(); panel = scrim = null;
    document.body.classList.remove("howopen");
    if (opener) { opener.focus(); opener = null; }
  }
  document.addEventListener("click", function (e) {
    const sum = e.target.closest("details.how > summary");
    if (!sum) return;
    e.preventDefault();
    closePanel();
    const box = sum.parentElement.querySelector(".howbox");
    opener = sum;
    scrim = document.createElement("div"); scrim.className = "howscrim"; scrim.addEventListener("click", closePanel);
    panel = document.createElement("aside"); panel.className = "howpanel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true");
    const title = sum.parentElement.getAttribute("data-title") || "Show me how";
    panel.setAttribute("aria-label", title);
    const head = document.createElement("header"), t = document.createElement("b"), x = document.createElement("button");
    t.textContent = title; x.type = "button"; x.className = "howclose"; x.setAttribute("aria-label", "Close"); x.textContent = "\u00d7"; x.addEventListener("click", closePanel);
    head.appendChild(t); head.appendChild(x);
    const body = document.createElement("div"); body.className = "howbody"; body.innerHTML = box.innerHTML;
    if (body.querySelectorAll(".howpart").length > 1) panel.classList.add("multi");
    Array.prototype.forEach.call(body.querySelectorAll(".cp .copy[hidden]"), function (b) { b.hidden = false; });
    panel.appendChild(head); panel.appendChild(body);
    document.body.appendChild(scrim); document.body.appendChild(panel); document.body.classList.add("howopen");
    x.focus();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });

  const root = document.querySelector(".wiz");
  if (!root) return;

  // Brand step: shrink the chosen logo to a small PNG (it travels to the agency's server as one
  // setting, so it must stay under about 30 KB) and put it in the form.
  const lf = document.getElementById("logoFile");
  if (lf) {
    const note = document.getElementById("logoNote"), prev = document.getElementById("logoPreview");
    const rm = document.getElementById("logoRemove"), field = document.getElementById("logo"), flag = document.getElementById("removeLogo");
    const MAX = 29000;
    const set = function (data) {
      field.value = data || ""; flag.value = data ? "" : "1";
      prev.hidden = !data; if (data) prev.src = data; rm.hidden = !data;
    };
    lf.addEventListener("change", function () {
      const file = lf.files && lf.files[0]; if (!file) return;
      const read = new FileReader();
      read.onload = function () {
        const img = new Image();
        img.onload = function () {
          let data = "";
          for (const edge of [240, 192, 144, 112, 80, 56]) {
            const k = Math.min(1, edge / Math.max(img.width, img.height)), c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            data = c.toDataURL("image/png");
            if (data.length <= MAX) break;
          }
          if (data.length > MAX) { note.textContent = "That picture is too detailed to shrink enough. Try a simpler logo, or add it later in Settings."; lf.value = ""; return; }
          set(data);
          note.textContent = "Logo added. Choose another file to replace it.";
        };
        img.onerror = function () { note.textContent = "We couldn't read that file. Try a PNG or JPG."; lf.value = ""; };
        img.src = read.result;
      };
      read.readAsDataURL(file);
    });
    if (rm) rm.addEventListener("click", function () { set(""); lf.value = ""; note.textContent = "No logo. You can add one later in Settings."; });
  }

  // Confirm prompts and no double-submits
  document.addEventListener("submit", function (e) {
    const f = e.target;
    if (f.classList && f.classList.contains("chat-form")) return; // the help chat handles its own sends
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

  // Admin, "Set up for them": keep checking public DNS and tick each record as it appears (POST with the page's token).
  const dp = document.querySelector("[data-dns-poll]");
  if (dp) {
    let tries = 0;
    const note = dp.querySelector("[data-dns-note]");
    const tick = async function () {
      tries++;
      try {
        const r = await fetch(dp.getAttribute("data-dns-poll"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "t=" + encodeURIComponent(dp.getAttribute("data-t") || "") });
        if (r.ok) {
          const j = await r.json();
          Array.prototype.forEach.call(j.rows || [], function (x) {
            const tr = Array.prototype.find.call(dp.querySelectorAll("tr[data-rec]"), function (e) { return e.getAttribute("data-rec") === x.key; });
            const cell = tr && tr.querySelector(".rok");
            if (cell) cell.textContent = x.ok ? "\u2713 live" : x.seen ? "found: " + x.seen : "waiting";
          });
          const host = Array.prototype.find.call(dp.querySelectorAll("tr[data-rec]"), function (e) { return e.getAttribute("data-rec").indexOf("setup-host:") === 0; });
          if (host && j.host !== null && j.host !== undefined) host.querySelector(".rok").textContent = j.host ? "\u2713 live" : "waiting";
          if (j.all && j.host !== false) { if (note) note.textContent = "Every record is live."; return; }
        }
      } catch (_) {}
      if (tries < 60) setTimeout(tick, 10000);
      else if (note) note.textContent = "Still waiting. Press Check DNS now later.";
    };
    setTimeout(tick, 8000);
  }

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
