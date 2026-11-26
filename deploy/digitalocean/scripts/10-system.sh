#!/bin/bash
# Packer step: OS updates, the few packages the stack needs, and Docker (same official
# get.docker.com route install.sh uses, so install.sh finds Docker already there).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APT=(-qqy -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
apt-get -qq update
apt-get "${APT[@]}" full-upgrade
apt-get "${APT[@]}" install curl openssl ufw ca-certificates python3
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh >/tmp/get-docker.log 2>&1 || { tail -n 30 /tmp/get-docker.log; exit 1; }
systemctl enable --now docker
docker compose version
# img_check fails on /opt/digitalocean (the Droplet agent); DigitalOcean adds it per Droplet.
apt-get -qqy purge droplet-agent 2>/dev/null || true
rm -rf /opt/digitalocean
apt-get -qqy autoremove
apt-get -qqy clean
