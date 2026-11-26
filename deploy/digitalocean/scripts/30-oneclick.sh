#!/bin/bash
# Packer step: installs the first-boot setup (cloud-init per-instance hook, the one-time setup
# page and its service, the MOTD) and turns on the firewall. Nothing is started here.
set -euo pipefail
F=${ONECLICK_FILES:-/tmp/oneclick}
R=${RECEPTIONIST_ROOT:-/opt/receptionist}
install -d -m 700 "$R/oneclick"
install -m 700 "$F/oneclick.py" "$R/oneclick/oneclick.py"
python3 -m py_compile "$R/oneclick/oneclick.py" && rm -rf "$R/oneclick/__pycache__"
[ -n "${SELFHOST_TEST:-}" ] && exit 0

install -d /var/lib/cloud/scripts/per-instance
install -m 755 "$F/firstboot.sh" /var/lib/cloud/scripts/per-instance/01-receptionist-setup
install -m 644 "$F/receptionist-oneclick.service" /etc/systemd/system/receptionist-oneclick.service
install -m 755 "$F/motd.sh" /etc/update-motd.d/99-one-click
systemctl daemon-reload   # enabled per Droplet by the first-boot hook, never in the image

# Same rules install.sh sets: ssh, http, https only.
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable
