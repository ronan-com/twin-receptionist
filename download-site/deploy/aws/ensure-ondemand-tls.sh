#!/bin/bash
# Runs ON the AWS server from remote-deploy.sh, before the setup site's Caddy file is loaded.
# The setup site's buyers can have their private link on their own domain (setup.theirdomain.com). Caddy gets that
# certificate on demand, but only after asking the setup site, and the question is a GLOBAL Caddy option, which has to
# sit at the top of the main Caddyfile (/opt/twin/Caddyfile, deployed from deploy/Caddyfile, which already has it).
# This script only does something on a server whose Caddyfile predates that: it adds the block, checks it, and puts the
# old file back (and fails the deploy) if Caddy doesn't accept it. Safe to run on every deploy.
set -euo pipefail
CF=/opt/twin/Caddyfile
[ -f "$CF" ] || { echo "no $CF: skipping the on-demand TLS option"; exit 0; }
if grep -q 'on_demand_tls' "$CF"; then echo "Caddyfile already has on_demand_tls"; exit 0; fi
first=$(grep -v -E '^[[:space:]]*(#|$)' "$CF" | head -1 || true)
if [[ $first =~ ^[[:space:]]*\{[[:space:]]*$ ]]; then
  echo "$CF already starts with a global options block that has no on_demand_tls."
  echo "Add this inside it by hand, then deploy again:  on_demand_tls { ask http://setup-site:4500/api/tls-allowed }"
  exit 1
fi
cp -p "$CF" "$CF.bak-ondemand"
# In place (cat >), not mv: the file is bind-mounted into the Caddy container, and a new inode wouldn't be seen.
{ printf '{\n\ton_demand_tls {\n\t\task http://setup-site:4500/api/tls-allowed\n\t}\n}\n\n'; cat "$CF.bak-ondemand"; } > "$CF"
if ! docker exec twin-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  cat "$CF.bak-ondemand" > "$CF"
  echo "Caddy rejected the on_demand_tls block; the old Caddyfile is back. Add the option by hand (see this script)."
  exit 1
fi
echo "added on_demand_tls to $CF (backup: $CF.bak-ondemand)"
