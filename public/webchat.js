/*
 * Website chat widget. One script tag, no dependencies:
 *   <script src="https://<server>/webchat.js" data-receptionist="<public id>" async></script>
 * Optional: data-open="true" opens the panel straight away (the dashboard preview does).
 * Draws inside a shadow root so the host page's CSS can't touch it. Server: server/webchat.ts.
 */
(function () {
  "use strict";
  var script = document.currentScript || document.querySelector("script[data-receptionist][src*='webchat.js']");
  if (!script || window.TwinWebchat) return;
  var id = script.getAttribute("data-receptionist");
  if (!id) return;
  var base;
  try {
    base = new URL(script.src).origin;
  } catch (e) {
    return;
  }
  var api = base + "/api/webchat/" + encodeURIComponent(id);
  var KEY = "twin-chat:" + id;
  var DAY = 24 * 3600 * 1000;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // The visitor's chat survives page loads for a day. Storage can be blocked: then it lasts until the page closes.
  var memory = null;
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && s.cid && Date.now() - s.at < DAY) return s;
    } catch (e) {}
    return memory && Date.now() - memory.at < DAY ? memory : null;
  }
  function save(s) {
    s.at = Date.now();
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  function lum(hex) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  var cfg;
  fetch(api + "/config", { mode: "cors", credentials: "omit" })
    .then(function (r) { if (!r.ok) throw new Error("off"); return r.json(); })
    .then(function (c) { cfg = c; if (document.body) start(); else document.addEventListener("DOMContentLoaded", start); })
    .catch(function () { /* chat is off or not allowed here: show nothing */ });

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    for (var k in props || {}) {
      if (k === "text") n.textContent = props[k];
      else if (k === "class") n.className = props[k];
      else n.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function start() {
    var color = /^#[0-9a-f]{6}$/i.test(cfg.color) ? cfg.color : "#2563eb";
    var ink = lum(color) > 0.55 ? "#111827" : "#ffffff";
    var state = load() || { cid: uuid(), msgs: [] };
    var busy = false;
    var isOpen = false;

    var host = el("div", { id: "twin-webchat-host" });
    host.style.cssText = "all:initial;position:fixed;right:0;bottom:0;z-index:2147483000;";
    var root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style>" +
      ":host{all:initial}*{box-sizing:border-box}" +
      ".w{position:fixed;right:20px;bottom:20px;font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111827}" +
      "button{font:inherit;cursor:pointer}" +
      ".fab{width:58px;height:58px;border-radius:50%;border:0;background:" + color + ";color:" + ink + ";box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
      ".fab:hover{transform:scale(1.06)}.fab:focus-visible,.x:focus-visible,.send:focus-visible,textarea:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}" +
      ".fab svg{width:28px;height:28px}" +
      ".p{display:none;position:absolute;right:0;bottom:72px;width:370px;max-width:calc(100vw - 24px);height:min(580px,calc(100vh - 110px));background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;flex-direction:column}" +
      ".w.open .p{display:flex}" +
      ".h{display:flex;align-items:center;gap:10px;padding:12px 14px;background:" + color + ";color:" + ink + "}" +
      ".av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);flex:none;display:flex;align-items:center;justify-content:center;font-weight:600;overflow:hidden}" +
      ".av img{width:100%;height:100%;object-fit:cover}" +
      ".t{min-width:0;flex:1}.t b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t span{font-size:12px;opacity:.85}" +
      ".x{background:transparent;border:0;color:inherit;width:34px;height:34px;border-radius:8px;font-size:22px;line-height:1}" +
      ".m{flex:1;overflow-y:auto;padding:14px;background:#f6f7f9;display:flex;flex-direction:column;gap:8px}" +
      ".b{max-width:84%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}" +
      ".b.a{background:#fff;border:1px solid #e5e7eb;align-self:flex-start;border-bottom-left-radius:4px}" +
      ".b.u{background:" + color + ";color:" + ink + ";align-self:flex-end;border-bottom-right-radius:4px}" +
      ".b.e{align-self:center;background:#fef2f2;color:#991b1b;font-size:13px;border:1px solid #fecaca}" +
      ".dots{display:inline-flex;gap:4px;padding:3px 0}.dots i{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:d 1.2s infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}" +
      "@keyframes d{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}" +
      "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff;align-items:flex-end}" +
      "textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 11px;font:inherit;max-height:96px;min-height:40px;color:#111827;background:#fff}" +
      ".send{border:0;border-radius:10px;background:" + color + ";color:" + ink + ";width:42px;height:40px;display:flex;align-items:center;justify-content:center}.send:disabled{opacity:.5;cursor:default}" +
      ".send svg{width:20px;height:20px}" +
      ".f{font-size:11px;color:#6b7280;text-align:center;padding:0 10px 8px;background:#fff}" +
      ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
      "@media (max-width:480px){.w{right:12px;bottom:12px}.p{position:fixed;inset:0;width:100%;max-width:none;height:100%;height:100dvh;border-radius:0}textarea{font-size:16px}}" +
      "@media (prefers-reduced-motion:reduce){.dots i,.fab{animation:none;transition:none}}" +
      "</style>";

    var name = cfg.name || "Assistant";
    var avatar = el("div", { class: "av", "aria-hidden": "true" });
    if (cfg.logo) {
      var img = el("img", { alt: "", src: base + cfg.logo.replace(/^(?!\/)/, "/") });
      img.onerror = function () { avatar.textContent = name.charAt(0).toUpperCase(); };
      avatar.appendChild(img);
    } else avatar.textContent = name.charAt(0).toUpperCase();

    var closeBtn = el("button", { class: "x", type: "button", "aria-label": "Close chat", text: "×" });
    var log = el("div", { class: "m", role: "log", "aria-live": "polite", "aria-label": "Chat messages" });
    var input = el("textarea", { rows: "1", placeholder: "Type your message", "aria-label": "Your message", maxlength: String(cfg.maxLength || 1000) });
    var send = el("button", { class: "send", type: "submit", "aria-label": "Send" });
    send.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z"/></svg>';
    var form = el("form", {}, [input, send]);
    var panel = el("div", { class: "p", role: "dialog", "aria-label": "Chat with " + name }, [
      el("div", { class: "h" }, [avatar, el("div", { class: "t" }, [el("b", { text: name }), el("span", { text: cfg.businessName || "" })]), closeBtn]),
      log,
      form,
      el("div", { class: "f", text: "AI assistant. Replies may not always be right." }),
    ]);
    var fab = el("button", { class: "fab", type: "button", "aria-label": "Chat with " + name, "aria-expanded": "false" });
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
    var wrap = el("div", { class: "w" }, [panel, fab]);
    root.appendChild(wrap);

    function bubble(kind, text) {
      var b = el("div", { class: "b " + kind, text: text });
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }
    var typing = null;
    function showTyping(on) {
      if (on && !typing) {
        typing = el("div", { class: "b a", "aria-label": name + " is typing" }, [el("span", { class: "dots" }, [el("i"), el("i"), el("i")])]);
        log.appendChild(typing);
        log.scrollTop = log.scrollHeight;
      } else if (!on && typing) {
        typing.remove();
        typing = null;
      }
    }

    bubble("a", cfg.greeting);
    state.msgs.forEach(function (m) { bubble(m.r === "u" ? "u" : "a", m.t); });

    function setOpen(v) {
      isOpen = v;
      wrap.classList.toggle("open", v);
      fab.setAttribute("aria-expanded", String(v));
      fab.style.display = v && window.matchMedia("(max-width:480px)").matches ? "none" : "";
      if (v) setTimeout(function () { input.focus(); log.scrollTop = log.scrollHeight; }, 30);
      else fab.focus();
    }
    fab.onclick = function () { setOpen(!isOpen); };
    closeBtn.onclick = function () { setOpen(false); };
    root.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen) setOpen(false); });

    function grow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 96) + "px";
    }
    input.addEventListener("input", grow);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      send.disabled = true;
      input.value = "";
      grow();
      bubble("u", text);
      state.msgs.push({ r: "u", t: text });
      save(state);
      showTyping(true);
      fetch(api + "/message", {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: state.cid, message: text }),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          showTyping(false);
          if (x.ok && x.d.reply) {
            bubble("a", x.d.reply);
            state.msgs.push({ r: "a", t: x.d.reply });
            save(state);
          } else bubble("e", x.d.error || "Sorry, that didn't send. Please try again.");
        })
        .catch(function () {
          showTyping(false);
          bubble("e", "Can't reach the chat right now. Please check your connection and try again.");
        })
        .then(function () {
          busy = false;
          send.disabled = false;
          if (isOpen) input.focus();
        });
    });

    document.body.appendChild(host);
    window.TwinWebchat = {
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      destroy: function () { host.remove(); delete window.TwinWebchat; },
    };
    if (script.getAttribute("data-open") === "true") setOpen(true);
  }
})();
