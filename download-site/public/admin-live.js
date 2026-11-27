// The live alert on every admin page: every 20 seconds, ask /admin/alerts/live what help requests came in. A new one
// shows a red banner at the top, plays a short sound, updates the nav badges, and (once allowed) a desktop
// notification. Works while any admin tab is open; nothing to set up. Plain JavaScript, text only (never innerHTML).
"use strict";
(function () {
  const body = document.body;
  const url = body && body.dataset.liveAlerts;
  if (!url) return;
  let since = body.dataset.since || new Date().toISOString();
  const bar = document.getElementById("livebar");
  const btn = document.getElementById("notifbtn");
  const hasNotif = typeof window.Notification === "function";

  if (btn && hasNotif && Notification.permission === "default") {
    btn.hidden = false;
    btn.addEventListener("click", function () {
      Notification.requestPermission().then(function () { btn.hidden = Notification.permission === "default"; }).catch(function () {});
    });
  }

  let audio = null;
  function unlock() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (_) {} }
  document.addEventListener("click", unlock, { once: true });
  function beep() {
    try {
      unlock();
      if (!audio) return;
      [0, 0.18].forEach(function (at, i) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, audio.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.16);
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + at); o.stop(audio.currentTime + at + 0.18);
      });
    } catch (_) {}
  }

  function badge(name, n) {
    const b = document.querySelector('[data-badge="' + name + '"]');
    if (!b) return;
    b.textContent = n ? String(n) : "";
    b.hidden = !n;
  }

  function show(item) {
    if (!bar) return;
    bar.querySelector(".livetext").textContent = item.text;
    const a = bar.querySelector(".liveopen");
    if (/^\/admin\/tickets\/\d+$/.test(item.url)) a.setAttribute("href", item.url);
    bar.hidden = false;
  }
  if (bar) bar.querySelector(".livex").addEventListener("click", function () { bar.hidden = true; });

  function notify(item) {
    if (!hasNotif || Notification.permission !== "granted") return;
    try {
      const n = new Notification("Help request", { body: item.text, tag: "help-" + item.id });
      n.onclick = function () { window.focus(); if (/^\/admin\/tickets\/\d+$/.test(item.url)) location.href = item.url; n.close(); };
    } catch (_) {}
  }

  let busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch(url + "?since=" + encodeURIComponent(since), { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        if (j && j.ok) {
          since = j.now || since;
          badge("open", j.open);
          badge("help", j.needsHelp);
          const items = Array.isArray(j.items) ? j.items : [];
          if (items.length) { show(items[0]); beep(); items.slice(0, 3).forEach(notify); }
        }
      }
    } catch (_) {}
    busy = false;
  }
  setInterval(poll, 20000);
})();
