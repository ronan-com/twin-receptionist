#!/usr/bin/env python3
"""One-time first-boot setup for the 1-Click Droplet (run by receptionist-oneclick.service).

- oneclick/pending.env exists (settings came in user data): wait for DNS, run install.sh, done.
- otherwise: a one-page form on plain http port 80, protected by the code in oneclick/code.
  On submit it shows the A record to add and waits for DNS, then stops the page (Caddy needs
  port 80), writes /opt/receptionist/.env and runs install.sh. If that fails the page comes
  back with the error. On success it writes oneclick/done, deletes the code and disables itself.
All installing is install.sh's job; this file only collects settings and calls it.
"""
import hmac, html, json, os, re, secrets, socket, subprocess, sys, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.environ.get("RECEPTIONIST_ROOT", "/opt/receptionist")
OC = os.path.join(ROOT, "oneclick")
PORT = int(os.environ.get("ONECLICK_PORT", "80"))
SKIP_DNS = bool(os.environ.get("SELFHOST_TEST")) or os.environ.get("SKIP_DNS_CHECK") == "1"
HTTPS_PORT = os.environ.get("HTTPS_PORT", "443").rsplit(":", 1)[-1]
DOMAIN_RE = re.compile(r"^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
EMAIL_RE = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")

S = {"phase": "form", "error": "", "domain": "", "ips": [], "session": "", "keep": {}}
FAILS = {}            # ip -> (count, locked_until)
LOCK = threading.Lock()
PENDING = {"env": ""}  # settings in memory only until DNS is ready
SERVER = None


def path(name): return os.path.join(OC, name)
def norm(code): return re.sub(r"[\s-]", "", code).upper()
def log(msg): print(f"receptionist-setup: {msg}", flush=True)


def write_private(p, text):
    fd = os.open(p + ".new", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f: f.write(text)
    os.replace(p + ".new", p)


def env_line(k, v):
    """KEY=value per deploy/selfhost/lib.sh read_env (same rule as download-site/userdata.ts)."""
    v = re.sub(r"[\r\n]+", " ", v)
    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
        v = '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return f"{k}={v}\n"


def my_ip():
    if os.environ.get("ONECLICK_IP"): return os.environ["ONECLICK_IP"]
    try:
        with urllib.request.urlopen("http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address", timeout=3) as r:
            return r.read().decode().strip()
    except Exception:
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True).stdout.split()
        return out[0] if out else "?"


def resolve(domain):
    try: subprocess.run(["resolvectl", "flush-caches"], capture_output=True, timeout=5)
    except Exception: pass
    try: return sorted({a[4][0] for a in socket.getaddrinfo(domain, None, socket.AF_INET)})
    except OSError: return []


def wait_dns(domain, ip, keep_going=lambda: True):
    while keep_going():
        S["ips"] = resolve(domain)
        if SKIP_DNS or ip in S["ips"]: return True
        time.sleep(10)
    return False


def install(env_text):
    write_private(os.path.join(ROOT, ".env"), env_text)
    with open(path("install.log"), "ab") as f:
        rc = subprocess.run(["bash", os.path.join(ROOT, "install.sh")], stdout=f, stderr=subprocess.STDOUT).returncode
    with open(path("install.log"), "rb") as f:
        lines = f.read().decode(errors="replace").strip().splitlines()
    return rc == 0, (lines[-1] if lines else "install.sh printed nothing")


def finish(status):
    write_private(path("done"), status + "\n")
    for n in ("code", "pending.env"):
        try: os.remove(path(n))
        except OSError: pass
    if not os.environ.get("SELFHOST_TEST"):
        subprocess.run(["systemctl", "disable", "--no-ask-password", "receptionist-oneclick.service"], capture_output=True, timeout=30)
    log(status)


def settings_from(form):
    g = lambda k: (form.get(k) or [""])[0].strip()
    brand, email = g("brand"), g("email")
    domain = re.sub(r"^https?://", "", g("domain").lower()).split("/")[0]
    err = []
    if not brand: err.append("Enter a brand name.")
    if not EMAIL_RE.match(email): err.append("Enter the owner's email address.")
    if not DOMAIN_RE.match(domain): err.append("Enter a domain such as app.example.com.")
    env = {"PRODUCT_NAME": brand, "DOMAIN": domain, "FIRST_ADMIN_EMAIL": email,
           "TELNYX_API_KEY": g("telnyx"), "OWN_PHONE_ACCOUNT": "required" if g("own_phone") else ""}
    mail, sender = g("mail"), g("from")
    if mail == "resend":
        if not g("resend").startswith("re_"): err.append("A Resend API key starts with re_.")
        env["SMTP_URL"] = "smtps://resend:" + urllib.parse.quote(g("resend"), safe="") + "@smtp.resend.com:465"
    elif mail == "smtp":
        if not re.match(r"^smtps?://", g("smtp")): err.append("The SMTP URL starts with smtp:// or smtps://.")
        env["SMTP_URL"] = g("smtp")
    if mail in ("resend", "smtp"):
        if not EMAIL_RE.match(sender.split("<")[-1].rstrip(">")): err.append("Enter the address emails are sent from.")
        env["MAIL_FROM"] = sender if "<" in sender else f"{brand} <{sender}>"
    text = "# Written by the 1-Click setup page. Edit, then run: sudo bash install.sh\n"
    text += "".join(env_line(k, v) for k, v in env.items())
    return text, domain, {"brand": brand, "email": email, "domain": domain}, err


CSS = """body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f6f7f9;color:#111}
main{max-width:560px;margin:32px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 4px #0002}
label{display:block;margin:14px 0 4px;font-weight:600}input[type=text],input[type=email],input[type=password]{width:100%;padding:9px;box-sizing:border-box;border:1px solid #bbb;border-radius:6px}
button{margin-top:20px;padding:10px 18px;border:0;border-radius:6px;background:#111;color:#fff;font-size:16px}
.err{background:#fee;border:1px solid #e99;padding:10px;border-radius:6px}.hint{color:#555;font-size:14px}
code{background:#eee;padding:2px 5px;border-radius:4px}fieldset{border:1px solid #ddd;border-radius:6px;margin-top:14px}"""


def page(title, body):
    return (f"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{title}</title><style>{CSS}</style></head><body><main>{body}</main></body></html>")


def form_page(errors=(), keep=None):
    k = {n: html.escape(v, quote=True) for n, v in (keep or S["keep"]).items()}
    err = "".join(f"<p>{html.escape(e)}</p>" for e in errors)
    return page("Server setup", f"""<h1>Set up your server</h1>
{f'<div class=err>{err}</div>' if err else ''}
<form method=post action=/ autocomplete=off>
<label>Setup code</label><input type=text name=code required placeholder="XXXXX-XXXXX">
<p class=hint>Shown when you log in to this server (SSH or the Droplet console), or the SETUP_CODE you put in user data.</p>
<label>Brand name</label><input type=text name=brand required value="{k.get('brand', '')}">
<label>Owner email (signs in first, becomes the platform admin)</label><input type=email name=email required value="{k.get('email', '')}">
<label>Domain for the app</label><input type=text name=domain required placeholder="app.example.com" value="{k.get('domain', '')}">
<label>Telnyx API key</label><input type=password name=telnyx placeholder="KEY...">
<label><input type=checkbox name=own_phone> Every agency brings its own Telnyx key instead</label>
<fieldset><legend>Email sender</legend>
<label><input type=radio name=mail value=resend checked> Resend</label><input type=password name=resend placeholder="re_...">
<label><input type=radio name=mail value=smtp> Other SMTP</label><input type=text name=smtp placeholder="smtps://user:pass@smtp.example.com:465">
<label><input type=radio name=mail value=none> Later (emails go to the app log)</label>
<label>Send from</label><input type=text name=from placeholder="hello@example.com"></fieldset>
<p class=hint>This page is plain http (there is no certificate yet). The keys can also be left empty and added later in /opt/receptionist/.env.</p>
<button>Continue</button></form>""")


def status_page():
    d, ip = html.escape(S["domain"]), html.escape(my_ip())
    url = f"https://{S['domain']}" + ("" if HTTPS_PORT == "443" else f":{HTTPS_PORT}")
    return page("Server setup", f"""<h1>Almost there</h1>
<p id=dns>Add this DNS record where your domain is managed, then wait here:</p>
<p><code>A</code> &nbsp; <code>{d}</code> &nbsp; → &nbsp; <code>{ip}</code> &nbsp; (DNS only / not proxied, lowest TTL)</p>
<p id=s>Checking DNS…</p>
<form method=post action=/reset><button>Start over</button></form>
<script>
const url={json.dumps(url)};let down=0;
async function tick(){{
  try{{const r=await fetch('/status',{{cache:'no-store'}});const j=await r.json();down=0;
    if(j.phase==='dns')s.textContent=j.ips.length?('{d} points at '+j.ips.join(', ')+' (not this server yet)'):'{d} does not resolve yet. Checking every 10 seconds…';
    else if(j.phase==='installing')s.textContent='DNS is ready. Starting the app…';
    else {{location.href='/';return}}
  }}catch(e){{down++;s.textContent='Installing and getting the https certificate (usually 1 to 3 minutes). This page moves to '+url+' when it is ready.';
    try{{await fetch(url+'/api/health',{{mode:'no-cors',cache:'no-store'}});location.href=url;return}}catch(e2){{}}}}
  setTimeout(tick,5000)}}
tick();</script>""")


class Handler(BaseHTTPRequestHandler):
    server_version, sys_version = "setup", ""

    def log_message(self, *a): pass

    def send(self, code, body, ctype="text/html; charset=utf-8", headers=()):
        b = body.encode()
        self.send_response(code)
        for k, v in [("Content-Type", ctype), ("Content-Length", str(len(b))), ("Cache-Control", "no-store"),
                     ("X-Frame-Options", "DENY"), ("Referrer-Policy", "no-referrer"), *headers]:
            self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)

    def authed(self):
        c = self.headers.get("Cookie", "")
        m = re.search(r"(?:^|;\s*)s=([A-Za-z0-9_-]+)", c)
        return bool(S["session"] and m and hmac.compare_digest(m.group(1), S["session"]))

    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        with LOCK:
            if p == "/status":
                if not self.authed(): return self.send(403, "{}", "application/json")
                return self.send(200, json.dumps({"phase": S["phase"], "ips": S["ips"]}), "application/json")
            if p != "/": return self.send(404, page("Not found", "<p>Not found.</p>"))
            if self.authed() and S["phase"] in ("dns", "installing"): return self.send(200, status_page())
            return self.send(200, form_page([S["error"]] if S["error"] else []))

    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        if n > 16384: return self.send(413, "too large", "text/plain")
        form = urllib.parse.parse_qs(self.rfile.read(n).decode(errors="replace"))
        with LOCK:
            if p == "/reset":
                if self.authed() and S["phase"] == "dns": S["phase"] = "form"
                return self.send(303, "", headers=[("Location", "/")])
            if p != "/" or S["phase"] not in ("form", "failed"): return self.send(303, "", headers=[("Location", "/")])
            ip, now = self.client_address[0], time.time()
            count, until = FAILS.get(ip, (0, 0))
            if until > now: return self.send(429, form_page(["Too many wrong codes. Wait a minute and try again."]))
            code = open(path("code")).read().strip()
            if not hmac.compare_digest(norm((form.get("code") or [""])[0]).encode(), norm(code).encode()):
                count += 1
                FAILS[ip] = (count, now + 60 if count % 5 == 0 else 0)
                return self.send(403, form_page(["That setup code is not right."]))
            FAILS.pop(ip, None)
            text, domain, keep, err = settings_from(form)
            if err: return self.send(400, form_page(err, keep))
            S.update(phase="dns", error="", domain=domain, ips=[], keep=keep, session=secrets.token_urlsafe(24))
            PENDING["env"] = text
            threading.Thread(target=dns_then_go, args=(domain, S["session"]), daemon=True).start()
            log(f"settings received for {domain}; waiting for DNS")
            return self.send(303, "", headers=[("Location", "/"), ("Set-Cookie", f"s={S['session']}; Path=/; HttpOnly; SameSite=Strict")])


def dns_then_go(domain, session):
    if not wait_dns(domain, my_ip(), lambda: S["phase"] == "dns" and S["session"] == session): return
    with LOCK: S["phase"] = "installing"
    time.sleep(6)  # let the browser's next poll see "installing"
    SERVER.shutdown()


def serve_page():
    global SERVER
    if not os.path.exists(path("code")): sys.exit("no setup code in " + path("code"))
    while True:
        for _ in range(30):
            try: SERVER = ThreadingHTTPServer(("0.0.0.0", PORT), Handler); break
            except OSError: time.sleep(2)
        else: sys.exit(f"port {PORT} stays busy")
        log(f"setup page on http://{my_ip()}:{PORT}/")
        SERVER.serve_forever()
        SERVER.server_close()   # port 80 is free for Caddy now
        ok, last = install(PENDING["env"])
        if ok: return finish(f"https://{S['domain']} (set up {time.strftime('%Y-%m-%d')})")
        log(f"install failed: {last}; the setup page is back")
        subprocess.run(["bash", os.path.join(ROOT, "dc.sh"), "stop", "caddy"], capture_output=True)
        os.remove(os.path.join(ROOT, ".env"))
        with LOCK: S.update(phase="failed", error=f"{last} (full log: {path('install.log')}). Fix it and submit again.")
        PENDING["env"] = ""


def from_user_data():
    text = open(path("pending.env")).read()
    m = re.search(r"^\s*(?:export\s+)?DOMAIN=[\"']?([^\"'\s]+)", text, re.M)
    domain = re.sub(r"^https?://", "", (m.group(1) if m else "").lower()).split("/")[0]
    ip = my_ip()
    log(f"waiting for {domain} to point at {ip}")
    start = time.time()
    if not wait_dns(domain, ip, lambda: time.time() - start < 3 * 86400):
        return finish(f"FAILED: {domain} never pointed at {ip}; fix DNS, then: sudo bash {ROOT}/install.sh")
    for attempt in range(3):
        ok, last = install(text)
        if ok: return finish(f"https://{domain} (set up {time.strftime('%Y-%m-%d')})")
        log(f"attempt {attempt + 1}: {last}")
        time.sleep(60)
    finish(f"{last}; fix it, then: sudo bash {ROOT}/install.sh")


if __name__ == "__main__":
    if os.path.exists(path("done")): sys.exit(0)
    if os.path.exists(path("pending.env")): from_user_data()
    elif os.path.exists(os.path.join(ROOT, ".env")): finish("configured by hand in " + os.path.join(ROOT, ".env"))
    else: serve_page()
