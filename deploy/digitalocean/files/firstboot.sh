#!/bin/bash
# cloud-init runs this once per Droplet (/var/lib/cloud/scripts/per-instance). It picks how
# this Droplet gets its settings, then starts receptionist-oneclick.service:
#   - user data is a complete .env (has DOMAIN= and FIRST_ADMIN_EMAIL=): install from it, no page
#   - user data is a script that sets up /opt/receptionist itself (hosted wizard): stay out of the way
#   - otherwise: the one-time setup page on http://<ip>/, protected by a code (SETUP_CODE= in
#     user data, or a random one). Echo output lands on the console and in cloud-init-output.log.
set -u
R=${RECEPTIONIST_ROOT:-/opt/receptionist}; O=$R/oneclick
say() { echo "receptionist-setup: $*"; }
if [ -e "$O/done" ] || [ -e "$R/.env" ]; then say "already set up"; exit 0; fi
umask 077; mkdir -p "$O"

UD=${USER_DATA_FILE:-/var/lib/cloud/instance/user-data.txt}
if [ -r "$UD" ]; then ud=$(cat "$UD")
else ud=$(curl -fsS --max-time 5 http://169.254.169.254/metadata/v1/user-data 2>/dev/null || true); fi
case $(printf '%s\n' "$ud" | head -n1) in
  '#!'*|'#cloud-config'*|'#include'*|'#cloud-boothook'*|'#part-handler'*|Content-Type:*)
    # A cloud-init format, which cloud-init itself runs.
    if [[ $ud == *"/opt/receptionist"* ]]; then say "user data sets up /opt/receptionist itself; the setup page stays off"; exit 0; fi
    ud= ;;
esac
has() { printf '%s\n' "$ud" | grep -qE "^[[:space:]]*(export[[:space:]]+)?$1="; }

if has DOMAIN && has FIRST_ADMIN_EMAIL; then
  printf '%s\n' "$ud" > "$O/pending.env"; chmod 600 "$O/pending.env"
  say "settings found in user data: installing without the setup page (journalctl -u receptionist-oneclick -f)"
else
  code=$(printf '%s\n' "$ud" | sed -nE "s/^[[:space:]]*SETUP_CODE=[\"']?([A-Za-z0-9-]{8,64})[\"']?[[:space:]]*$/\1/p" | head -n1)
  if [ -z "$code" ]; then
    raw=$(tr -dc 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' < /dev/urandom | head -c 10)
    code="${raw:0:5}-${raw:5:5}"
  fi
  printf '%s\n' "$code" > "$O/code"; chmod 600 "$O/code"
  ip=$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || hostname -I | awk '{print $1}')
  say "finish setup in a browser: http://$ip/   setup code: $code"
fi

if [ -d /run/systemd/system ] && [ -z "${ONECLICK_NO_SYSTEMD:-}" ]; then
  systemctl enable --now --no-block receptionist-oneclick.service
else
  setsid nohup python3 "$O/oneclick.py" >> "$O/oneclick.log" 2>&1 < /dev/null &
fi
