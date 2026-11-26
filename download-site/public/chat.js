// The "Need help?" bubble: plain JavaScript, no framework. Sends the conversation to this page's chat
// address and shows the answer. Nothing here knows about keys; the server decides what the helper knows.
"use strict";
(function () {
  const root = document.getElementById("chat");
  if (!root) return;
  const fab = root.querySelector(".chat-fab"), panel = root.querySelector(".chat-panel"), log = root.querySelector(".chat-log");
  const form = root.querySelector(".chat-form"), box = form.querySelector("textarea"), send = form.querySelector(".chat-send");
  const url = root.dataset.url, token = root.dataset.t || "", view = root.dataset.view || "";
  const max = Number(root.dataset.max) || 500;
  const KEY = "setupchat";
  let history = [], busy = false, drawn = false;
  root.hidden = false;

  try { const saved = JSON.parse(sessionStorage.getItem(KEY) || "[]"); if (Array.isArray(saved)) history = saved.filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"; }).slice(-10); } catch (_) {}
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-10))); } catch (_) {} }

  // Text only (never innerHTML): split into paragraphs, turn **bold** into <b>.
  function fill(el, text) {
    String(text).split(/\n+/).forEach(function (line) {
      if (!line.trim()) return;
      const p = document.createElement("p");
      line.split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
        if (/^\*\*[^*]+\*\*$/.test(part)) { const b = document.createElement("b"); b.textContent = part.slice(2, -2); p.appendChild(b); }
        else if (part) p.appendChild(document.createTextNode(part));
      });
      el.appendChild(p);
    });
  }
  function add(kind, text) {
    const d = document.createElement("div"); d.className = "chat-msg " + kind; fill(d, text);
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function draw() {
    if (drawn) return; drawn = true;
    add("bot", "Hi! I can help with the setup. Ask me anything, like where to find a key or what a step needs.");
    history.forEach(function (m) { add(m.role === "user" ? "me" : "bot", m.content); });
    if (!history.length) {
      const chips = document.createElement("div"); chips.className = "chat-chips";
      ["Where do I find my Railway token?", "How do I get my Telnyx key?", "What do I do on this step?"].forEach(function (q) {
        const c = document.createElement("button"); c.type = "button"; c.className = "chat-chip"; c.textContent = q;
        c.addEventListener("click", function () { chips.remove(); ask(q); });
        chips.appendChild(c);
      });
      log.appendChild(chips);
    }
  }

  function setOpen(on) {
    root.classList.toggle("open", on); panel.hidden = !on; fab.setAttribute("aria-expanded", on ? "true" : "false");
    if (on) { draw(); log.scrollTop = log.scrollHeight; box.focus(); } else fab.focus();
  }
  fab.addEventListener("click", function () { setOpen(true); });
  root.querySelector(".chat-x").addEventListener("click", function () { setOpen(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.classList.contains("open")) setOpen(false); });

  async function ask(q) {
    q = String(q || "").trim();
    if (!q || busy) return;
    if (q.length > max) { add("err", "Please keep your question under " + max + " characters."); return; }
    busy = true; send.disabled = true;
    add("me", q);
    history.push({ role: "user", content: q }); save();
    const wait = add("bot wait", "Thinking...");
    try {
      const r = await fetch(url, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, view: view, messages: history.slice(-10) }),
      });
      let j = {}; try { j = await r.json(); } catch (_) {}
      wait.remove();
      if (r.ok && j.reply) { history.push({ role: "assistant", content: j.reply }); save(); add("bot", j.reply); }
      else { history.pop(); save(); add("err", j.error || "Something went wrong. Try again in a minute."); }
    } catch (_) {
      wait.remove(); history.pop(); save();
      add("err", "We couldn't reach the help chat. Check your connection and try again.");
    }
    busy = false; send.disabled = false; box.focus();
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); const q = box.value; box.value = ""; ask(q); });
  box.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
})();
